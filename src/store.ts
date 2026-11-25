import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { z } from "zod";
import { ComputeClient } from "./client";
import {
  emptyProject,
  validateProject,
  invalidate,
  cyclicNodes,
  datasetSchema,
  variableSchema,
  cptSchema,
  evidenceSchema,
  type Project,
  type QueryGroup,
  type Dataset,
  LIMITS,
  thresholdCut,
  type EvidenceValue,
} from "./domain";
const resultSchema = z.object({
  prior: z.record(z.string(), z.array(z.number())),
  posterior: z.record(z.string(), z.array(z.number())),
  groups: z.record(
    z.string(),
    z.object({
      targetIds: z.array(z.string()),
      shape: z.array(z.number().int()),
      prior: z.array(z.number()),
      posterior: z.array(z.number()),
    }),
  ),
});
export const useProject = defineStore("project", () => {
  const project = ref<Project>(emptyProject()),
    dataset = ref<Dataset>(),
    busy = ref(false),
    error = ref(""),
    notice = ref(""),
    dirty = ref(false),
    selected = ref("");
  const revisions = ref({ model: 0, data: 0, query: 0 }),
    results = ref<z.infer<typeof resultSchema>>(),
    resultStamp = ref("");
  const activeTab = ref<
      "data" | "network" | "states" | "queries" | "results" | "study"
    >("data"),
    embedDataset = ref(true);
  const activeGroupId = ref("");
  const activeQuery = computed(() =>
    project.value.queryGroups.find((group) => group.id === activeGroupId.value),
  );
  const resultSnapshot = ref<Project>();
  const trainingPreview = ref<{
    retained: number;
    dropped: number;
    counts: number[][];
    stamp: string;
  }>();
  const client = new ComputeClient();
  const stamp = () => JSON.stringify(revisions.value);
  const trainingStamp = () =>
    `${revisions.value.model}/${revisions.value.data}`;
  const current = computed(
    () => !!results.value && resultStamp.value === stamp(),
  );
  const cycles = computed(() => cyclicNodes(project.value));
  function touch(kind: "model" | "data" | "query" | "display" = "model") {
    dirty.value = true;
    project.value.updatedAt = new Date().toISOString();
    if (kind !== "display") {
      revisions.value[kind]++;
      if (kind === "data") project.value.cpts = [];
      if (kind === "model") invalidate(project.value);
    }
  }
  async function job<T>(
    op: string,
    payload: unknown,
    parse: (x: unknown) => T,
  ): Promise<T | undefined> {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    const revision = stamp();
    try {
      const raw = await client.request(op, JSON.parse(JSON.stringify(payload)));
      if (revision !== stamp())
        throw new Error(
          "Discarded an outdated computation. Run it again for the current model.",
        );
      return parse(raw);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return undefined;
    } finally {
      busy.value = false;
    }
  }
  function payload(options?: unknown) {
    const { study: _study, ...model } = project.value;
    return { project: model, dataset: dataset.value, options };
  }
  async function importCsv(csv: string, name: string, delimiter = "") {
    const d = await job(
      "import",
      { csv, name, delimiter, tokens: project.value.missingTokens },
      (x) => datasetSchema.parse(x),
    );
    if (!d) return;
    if (
      (project.value.dataset || project.value.variables.length) &&
      !confirm(
        "Replace the dataset and clear the current network? Save your project first if needed.",
      )
    )
      return;
    const p = emptyProject();
    p.name = name.replace(/\.csv$/i, "");
    p.missingTokens = [...project.value.missingTokens];
    p.dataset = {
      name: d.name,
      hash: d.hash,
      rowCount: d.rows.length,
      headers: d.headers,
      delimiter: d.delimiter,
    };
    project.value = p;
    dataset.value = d;
    embedDataset.value = true;
    trainingPreview.value = undefined;
    selected.value = "";
    results.value = undefined;
    resultSnapshot.value = undefined;
    resultStamp.value = "";
    touch("data");
    return true;
  }
  async function previewDataColumn(
    column: import("./data-columns").ColumnRequest,
  ) {
    if (project.value.dataset && !dataset.value) {
      error.value = "Reattach the source CSV before adding columns.";
      return;
    }
    return await job(
      "column",
      { column, dataset: dataset.value, tokens: project.value.missingTokens },
      (x) =>
        z
          .object({
            dataset: datasetSchema,
            references: z.array(z.number()),
            examples: z.array(
              z.object({ row: z.number(), message: z.string() }),
            ),
            missing: z.number(),
            sourceHash: z.string(),
          })
          .parse(x),
    );
  }
  function appendDataColumn(next: Dataset, sourceHash: string) {
    const currentHash = dataset.value?.hash ?? "";
    if (
      busy.value ||
      currentHash !== sourceHash ||
      (project.value.dataset?.hash ?? "") !== sourceHash
    )
      return false;
    const d = dataset.value;
    if (
      next.headers.length !== (d?.headers.length ?? 0) + 1 ||
      (d &&
        (d.rows.length !== next.rows.length ||
          d.headers.some((name, i) => name !== next.headers[i])))
    )
      return false;
    if (project.value.study?.sourceHash === sourceHash && sourceHash)
      project.value.study.sourceHash = next.hash;
    dataset.value = next;
    project.value.dataset = {
      name: next.name,
      hash: next.hash,
      rowCount: next.rows.length,
      headers: next.headers,
      delimiter: next.delimiter,
    };
    // The existing columns and complete-case mask are unchanged.
    touch("display");
    return true;
  }
  async function reattach(csv: string, name: string) {
    const d = await job(
      "import",
      {
        csv,
        name,
        delimiter: project.value.dataset?.delimiter || "",
        tokens: project.value.missingTokens,
      },
      (x) => datasetSchema.parse(x),
    );
    if (!d) return;
    if (d.hash !== project.value.dataset?.hash) {
      error.value =
        "This CSV does not match the saved dataset hash. Your project was preserved.";
      return;
    }
    dataset.value = d;
    notice.value = "Matching dataset reattached.";
  }
  async function configure(
    columnId: string,
    representation: "categorical" | "finiteNumeric" | "discretised",
    method: "manual" | "equalWidth" | "quantile" = "equalWidth",
    bins = 3,
    manual: number[] = [],
  ) {
    if (
      project.value.variables.length >= 100 &&
      !project.value.variables.some((v) => v.columnId === columnId)
    ) {
      error.value = "Maximum 100 variables.";
      return;
    }
    const selectedAtStart = selected.value;
    const v = await job(
      "configure",
      payload({ columnId, representation, method, bins, manual }),
      (x) => variableSchema.parse(x),
    );
    if (!v) return;
    const old = project.value.variables.findIndex((x) => x.id === v.id);
    if (old >= 0) {
      const previousVariable = project.value.variables[old];
      v.label = previousVariable.label;
      v.position = previousVariable.position;
      if (
        v.representation !== previousVariable.representation ||
        JSON.stringify(v.states) !== JSON.stringify(previousVariable.states)
      )
        clearQueryEvidenceFor(v.id, v.representation !== "categorical");
      project.value.variables[old] = v;
      const previous = project.value.evidence[v.id];
      if (
        v.representation === "categorical" ||
        typeof previous !== "object" ||
        previous.kind !== "threshold"
      )
        delete project.value.evidence[v.id];
    } else {
      project.value.variables.push(v);
      if (!project.value.queryGroups.length)
        project.value.queryGroups.push({
          id: crypto.randomUUID(),
          name: v.label.trim().slice(0, 100) || "Query 1",
          targetIds: [v.id],
          evidence: {},
        });
    }
    if (selected.value === selectedAtStart) selected.value = v.id;
    touch();
  }
  function addManualNode(name: string) {
    if (project.value.variables.length >= 100) {
      error.value = "Maximum 100 variables.";
      return false;
    }
    const id = crypto.randomUUID();
    const index = project.value.variables.length;
    const variable = variableSchema.parse({
      id,
      label: name.trim() || "Variable " + (index + 1),
      columnId: "",
      representation: "categorical",
      states: ["False", "True"],
      stateLabels: ["False", "True"],
      displayDecimals: 0,
      parameterMode: "uniform",
      position: {
        x: 40 + (index % 4) * 230,
        y: 40 + Math.floor(index / 4) * 150,
      },
    });
    project.value.variables.push(variable);
    if (!project.value.queryGroups.length)
      project.value.queryGroups.push({
        id: crypto.randomUUID(),
        name: variable.label.slice(0, 100),
        targetIds: [id],
        evidence: {},
      });
    selected.value = id;
    touch();
    error.value = "";
    return true;
  }
  function setManualStates(id: string, input: string) {
    const variable = project.value.variables.find(
      (v) => v.id === id && !v.columnId,
    );
    if (!variable) return;
    const states = input
      .split(/\r?\n/)
      .map((state) => state.trim())
      .filter(Boolean);
    if (
      states.length < 2 ||
      states.length > LIMITS.states ||
      new Set(states).size !== states.length ||
      states.some((state) => state.length > 200)
    ) {
      error.value =
        "Enter 2–64 distinct state names, at most 200 characters each.";
      return;
    }
    if (JSON.stringify(states) !== JSON.stringify(variable.states)) {
      variable.states = states;
      variable.stateLabels = [...states];
      delete project.value.evidence[id];
      clearQueryEvidenceFor(id);
      touch();
    }
    error.value = "";
  }
  function renameStates(id: string, labels: string[]) {
    const v = project.value.variables.find((v) => v.id === id);
    if (!v) return;
    try {
      const parsed = variableSchema.parse({ ...v, stateLabels: labels });
      if (new Set(parsed.stateLabels).size !== parsed.stateLabels.length)
        throw new Error("State display names must be unique.");
      v.stateLabels = parsed.stateLabels;
      touch("display");
      error.value = "";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
  function setPrecision(id: string, precision: number) {
    if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
      error.value = "Decimal places must be an integer from 0 to 12.";
      return;
    }
    const v = project.value.variables.find((v) => v.id === id);
    if (v) {
      v.displayDecimals = precision;
      touch("display");
      error.value = "";
    }
  }
  function setParameterMode(id: string, mode: "learned" | "uniform") {
    const v = project.value.variables.find((v) => v.id === id);
    if (v && v.parameterMode !== mode) {
      v.parameterMode = mode;
      touch();
    }
  }
  function addGroup(source?: QueryGroup) {
    if (project.value.queryGroups.length >= 10) {
      error.value = "Use at most 10 query groups.";
      return;
    }
    const g = {
      id: crypto.randomUUID(),
      name: source
        ? `${source.name.slice(0, 93)} (copy)`
        : `Query ${project.value.queryGroups.length + 1}`,
      targetIds: source
        ? [...source.targetIds]
        : project.value.variables.slice(0, 1).map((v) => v.id),
      evidence: evidenceSchema.parse(source?.evidence ?? {}),
    };
    project.value.queryGroups.push(g);
    touch("query");
    return g.id;
  }
  function removeGroup(id: string) {
    project.value.queryGroups = project.value.queryGroups.filter(
      (g) => g.id !== id,
    );
    touch("query");
  }
  function addEdge(
    source: string,
    target: string,
    sourceHandle: "left" | "right" | "top" | "bottom" = "right",
    targetHandle: "left" | "right" | "top" | "bottom" = "left",
  ) {
    if (source === target) {
      error.value = "A node cannot connect to itself.";
      return;
    }
    if (
      project.value.edges.some(
        (e) => e.source === source && e.target === target,
      )
    ) {
      error.value = "This edge already exists.";
      return;
    }
    if (
      !project.value.variables.some((v) => v.id === source) ||
      !project.value.variables.some((v) => v.id === target)
    )
      return;
    project.value.edges.push({
      id: crypto.randomUUID(),
      source,
      target,
      sourceHandle,
      targetHandle,
    });
    touch();
  }
  function removeNode(id: string) {
    if (
      !confirm(
        "Delete this variable and its edges, evidence and dependent CPTs?",
      )
    )
      return;
    project.value.variables = project.value.variables.filter(
      (v) => v.id !== id,
    );
    project.value.edges = project.value.edges.filter(
      (e) => e.source !== id && e.target !== id,
    );
    project.value.cpts = project.value.cpts.filter((c) => c.variableId !== id);
    delete project.value.evidence[id];
    clearQueryEvidenceFor(id);
    for (const group of project.value.queryGroups)
      group.targetIds = group.targetIds.filter((x) => x !== id);
    selected.value = "";
    touch();
  }
  async function previewTraining() {
    const p = await job("preview", payload(), (x) =>
      z
        .object({
          retained: z.number(),
          dropped: z.number(),
          counts: z.array(z.array(z.number())),
        })
        .parse(x),
    );
    if (p) trainingPreview.value = { ...p, stamp: trainingStamp() };
  }
  async function train(method: "mle" | "dirichlet", alpha: number) {
    const previousPreview = trainingPreview.value?.stamp === trainingStamp();
    const r = await job("train", payload({ method, alpha }), (x) => {
      const result = z
        .object({
          cpts: z.array(cptSchema),
          retained: z.number().int().nonnegative(),
          dropped: z.number().int().nonnegative(),
        })
        .parse(x);
      validateProject({ ...project.value, cpts: result.cpts });
      return result;
    });
    if (!r) return;
    project.value.cpts = r.cpts;
    touch("model");
    if (previousPreview && trainingPreview.value)
      trainingPreview.value.stamp = trainingStamp();
    notice.value = `Trained ${r.cpts.length} CPTs from ${r.retained} rows; ${r.dropped} excluded.`;
  }
  async function query(group: QueryGroup) {
    const { study: _study, ...model } = project.value;
    const snapshot = JSON.parse(
      JSON.stringify({
        ...model,
        evidence: group.evidence ?? {},
        queryGroups: [group],
      }),
    ) as Project;
    if (snapshot.dataset) delete snapshot.dataset.embeddedCsv;
    const r = await job(
      "infer",
      {
        project: snapshot,
        engineUrl: new URL(
          `${import.meta.env.BASE_URL}vendor/jsagrum/dist/index.js`,
          location.origin,
        ).href,
      },
      (x) => {
        const r = resultSchema.parse(x);
        for (const v of snapshot.variables)
          if (
            r.prior[v.id]?.length !== v.states.length ||
            r.posterior[v.id]?.length !== v.states.length
          )
            throw new Error("Invalid graph probability response.");
        for (const g of snapshot.queryGroups) {
          const j = r.groups[g.id];
          const shape = g.targetIds.map(
            (id) => snapshot.variables.find((v) => v.id === id)!.states.length,
          );
          const size = shape.reduce((a, b) => a * b, 1);
          if (
            !j ||
            JSON.stringify(j.targetIds) !== JSON.stringify(g.targetIds) ||
            JSON.stringify(j.shape) !== JSON.stringify(shape) ||
            j.prior.length !== size ||
            j.posterior.length !== size
          )
            throw new Error("Invalid joint probability response.");
        }
        return r;
      },
    );
    if (r) {
      results.value = r;
      resultSnapshot.value = snapshot;
      resultStamp.value = stamp();
      return true;
    }
  }
  async function openProject(text: string) {
    try {
      if (new TextEncoder().encode(text).length > LIMITS.fileBytes)
        throw new Error("Project exceeds 100 MiB.");
      const p = validateProject(JSON.parse(text));
      for (const group of p.queryGroups) {
        group.evidence = evidenceSchema.parse(
          group.evidence ?? group.savedEvidence ?? p.evidence,
        );
        delete group.savedEvidence;
      }
      p.evidence = {};
      let d: Dataset | undefined;
      if (p.dataset?.embeddedCsv !== undefined) {
        const descriptor = p.dataset;
        d = await job(
          "import",
          {
            csv: descriptor.embeddedCsv,
            name: descriptor.name,
            delimiter: descriptor.delimiter,
            tokens: p.missingTokens,
          },
          (x) => datasetSchema.parse(x),
        );
        if (!d) return;
        if (d.hash !== descriptor.hash)
          throw new Error("Embedded dataset hash does not match.");
        delete descriptor.embeddedCsv;
      }
      if (dirty.value && !confirm("Replace unsaved work with this project?"))
        return;
      client.cancel();
      project.value = p;
      activeTab.value =
        p.variables.length && (!p.dataset || d) ? "network" : "data";
      embedDataset.value = true;
      dataset.value = d;
      results.value = undefined;
      resultSnapshot.value = undefined;
      resultStamp.value = "";
      trainingPreview.value = undefined;
      selected.value = "";
      revisions.value = { model: 0, data: 0, query: 0 };
      dirty.value = false;
      notice.value = d
        ? "Project and dataset opened."
        : p.dataset
          ? "Project opened. Locate its CSV in Data to retrain."
          : "Project opened.";
      error.value = "";
    } catch (e) {
      error.value = `Could not open project: ${e instanceof Error ? e.message : e}`;
    }
  }
  function savedProject(embed: boolean) {
    const p = JSON.parse(JSON.stringify(project.value)) as Project;
    if (p.dataset) {
      delete p.dataset.embeddedCsv;
      if (embed && dataset.value) p.dataset.embeddedCsv = dataset.value.csv;
    }
    const text = JSON.stringify(validateProject(p), null, 2);
    if (new Blob([text]).size > LIMITS.fileBytes)
      throw new Error(
        embed && dataset.value
          ? "Project exceeds 100 MiB with the CSV. Download the CSV separately and turn off embedding in Data settings."
          : "Project exceeds 100 MiB.",
      );
    return text;
  }
  function newProject() {
    if (
      dirty.value &&
      !confirm("Discard unsaved changes and create a new project?")
    )
      return;
    client.cancel();
    activeTab.value = "data";
    project.value = emptyProject();
    embedDataset.value = true;
    dataset.value = undefined;
    results.value = undefined;
    resultSnapshot.value = undefined;
    resultStamp.value = "";
    selected.value = "";
    trainingPreview.value = undefined;
    touch();
  }
  async function layout() {
    const r = await job(
      "layout",
      {
        project: project.value,
        layoutUrl: new URL(
          `${import.meta.env.BASE_URL}vendor/elkjs/elk-worker.min.js`,
          location.origin,
        ).href,
      },
      (x) =>
        z
          .array(z.object({ id: z.string(), x: z.number(), y: z.number() }))
          .parse(x),
    );
    if (r) {
      for (const pos of r) {
        const v = project.value.variables.find((v) => v.id === pos.id);
        if (v) v.position = { x: pos.x, y: pos.y };
      }
      touch("display");
      return true;
    }
  }
  function setEvidence(id: string, value: EvidenceValue | undefined) {
    const group = activeQuery.value;
    if (!group) return;
    const evidence = group.evidence ?? (group.evidence = {});
    if (value === undefined) delete evidence[id];
    else evidence[id] = value;
    touch("query");
  }
  function clearEvidence() {
    if (!activeQuery.value) return;
    activeQuery.value.evidence = {};
    touch("query");
  }
  function clearQueryEvidenceFor(id: string, keepThresholds = false) {
    for (const group of project.value.queryGroups) {
      const evidence = group.evidence;
      const value = evidence?.[id];
      if (!evidence || value === undefined) continue;
      if (
        keepThresholds &&
        typeof value === "object" &&
        value.kind === "threshold"
      )
        continue;
      delete evidence[id];
    }
  }
  async function addThresholdCut(id: string) {
    try {
      const v = project.value.variables.find((v) => v.id === id),
        e = activeQuery.value?.evidence?.[id];
      if (!v?.binning || typeof e !== "object" || e.kind !== "threshold")
        return;
      if (!dataset.value) {
        error.value =
          "Reattach the source CSV in Data to add a cut and retrain.";
        return;
      }
      if (
        !confirm(
          "Add this exact cut? This changes the variable states and invalidates dependent CPTs. Retrain before inference.",
        )
      )
        return;
      const cuts = [...new Set([...v.binning.cuts, thresholdCut(e)])].sort(
        (a, b) => a - b,
      );
      await configure(
        v.columnId,
        "discretised",
        "manual",
        cuts.length + 1,
        cuts,
      );
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function exportGraph(
    withProbabilities: boolean,
    direction: import("./graph-export").GraphDirection,
    colors: import("./graph-export").GraphRoleColors,
  ) {
    if (withProbabilities && !current.value) {
      error.value =
        "Run inference for current probabilities before exporting them.";
      return;
    }
    const group = withProbabilities
      ? resultSnapshot.value!.queryGroups[0]
      : activeQuery.value;
    return await job(
      "graph",
      {
        project: withProbabilities
          ? { ...project.value, evidence: resultSnapshot.value!.evidence }
          : { ...project.value, evidence: activeQuery.value?.evidence ?? {} },
        options: {
          posterior: withProbabilities ? results.value!.posterior : undefined,
          direction,
          highlights: { colors, targetIds: group?.targetIds ?? [] },
        },
      },
      (x) => z.object({ svg: z.string() }).parse(x),
    );
  }
  async function exportSamples(
    groupId: string,
    options: import("./sampling").SampleOptions,
  ) {
    if (!current.value || !results.value?.groups[groupId]) {
      error.value = "Run inference before sampling the current query.";
      return;
    }
    return await job(
      "sample",
      {
        project: resultSnapshot.value,
        options: { ...options, groupId, joint: results.value.groups[groupId] },
      },
      (x) =>
        z
          .object({ archive: z.instanceof(Uint8Array), count: z.number() })
          .parse(x),
    );
  }
  function cancel() {
    client.cancel();
  }
  return {
    setEvidence,
    clearEvidence,
    activeGroupId,
    activeQuery,
    addThresholdCut,
    exportGraph,
    exportSamples,
    activeTab,
    embedDataset,
    renameStates,
    setPrecision,
    setParameterMode,
    addGroup,
    removeGroup,
    project,
    dataset,
    busy,
    error,
    notice,
    dirty,
    selected,
    revisions,
    results,
    resultSnapshot,
    resultStamp,
    current,
    cycles,
    trainingPreview,
    stamp,
    trainingStamp,
    touch,
    importCsv,
    previewDataColumn,
    appendDataColumn,
    reattach,
    configure,
    addEdge,
    removeNode,
    previewTraining,
    addManualNode,
    setManualStates,
    train,
    query,
    openProject,
    savedProject,
    newProject,
    cancel,
    layout,
  };
});
