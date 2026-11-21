import {
  allowedStates,
  inferenceReady,
  studySchema,
  type Dataset,
  type EvidenceValue,
  type Project,
  type Study,
  type StudyNode,
  type StudyValue,
  type Variable,
} from "./domain";
import type { JointResult } from "./engine";
import { cantileverHeaders, cantileverInputs } from "./cantilever-example";
import { encode } from "./processing";
import { nextDown } from "./numbers";

export type SearchDimension =
  { min: number; max: number } | { values: StudyValue[] };
export interface StudyRegion {
  index: number;
  states: number[];
  probability: number;
  bounds: Record<string, SearchDimension>;
  exclusions: string[];
  clipped: string[];
  retained: boolean;
}
export interface Validation {
  id: string;
  predictors: string[];
  metric: "MAE" | "Accuracy";
  value: number;
  rows: number;
  dropped: number;
  holdout: number;
  fittedRows: number;
  violations: number;
  missed: number;
  near: number;
  nearMissed: number;
}
export interface Evaluation {
  outputs: Record<string, StudyValue>;
  margins: Record<string, number>;
  feasible: boolean;
  pareto: boolean;
}
export interface StudyDesign {
  id: string;
  region: number;
  inputs: Record<string, StudyValue>;
  predicted: Evaluation;
  verified?: Evaluation;
}
export interface StudyRun {
  validation: Validation[];
  designs: StudyDesign[];
  verified: boolean;
}
export const STUDY_BUDGET = 12000;
export const MAX_JS_TRAINING_ROWS = 768;

export function isCategorical(v: Variable) {
  return v.representation === "categorical";
}

export function statesBounds(v: Variable, state: number): SearchDimension {
  if (!v.binning)
    return {
      values: [isCategorical(v) ? v.states[state] : Number(v.states[state])],
    };
  const { cuts } = v.binning;
  return {
    min: cuts[state - 1] ?? -Infinity,
    max: cuts[state] === undefined ? Infinity : nextDown(cuts[state]),
  };
}

function initialBounds(
  v: Variable,
  snapshot: Study["snapshot"],
): [number, number] | undefined {
  if (isCategorical(v)) return;
  if (snapshot.example === "cantilever") {
    const beam = cantileverInputs[Number(v.columnId.slice(1))];
    if (beam && v.columnId) return [beam.min, beam.max];
  }
  return (
    v.binning?.fittedRange ?? [Number(v.states[0]), Number(v.states.at(-1))]
  );
}

export function suggestPredictors(study: Study, response: string): string[] {
  const upstream = new Set<string>();
  function visit(id: string) {
    for (const edge of study.snapshot.edges) {
      if (edge.target === id && !upstream.has(edge.source)) {
        upstream.add(edge.source);
        visit(edge.source);
      }
    }
  }
  visit(response);
  const available = study.snapshot.variables.filter(
    (v) => v.columnId && ["input", "fixed"].includes(study.nodes[v.id].role),
  );
  const connected = available.filter((v) => upstream.has(v.id));
  return (connected.length ? connected : available).map((v) => v.id);
}

export function initialiseStudy(
  project: Project,
  joint: JointResult,
  groupId: string,
  notation: string,
  modelRevision: number,
  sourceHash?: string,
): Study {
  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  delete snapshot.study;
  if (snapshot.dataset) delete snapshot.dataset.embeddedCsv;
  const nodes: Study["nodes"] = {};
  let hasPilotObjectives = false;
  for (const v of snapshot.variables) {
    const limits = initialBounds(v, snapshot);
    const evidence = snapshot.evidence[v.id];
    const node: StudyNode = {
      role: "unused",
      min: limits?.[0],
      max: limits?.[1],
    };
    if (isCategorical(v)) node.categories = [...v.states];
    if (joint.targetIds.includes(v.id)) node.role = "input";
    else if (
      evidence !== undefined &&
      snapshot.example === "cantilever" &&
      v.columnId === "c2"
    ) {
      node.role = "fixed";
      const states = allowedStates(v, evidence);
      const cell = states.length === 1 ? statesBounds(v, states[0]) : undefined;
      if (cell && "min" in cell) {
        const low = Math.max(cell.min, limits![0]),
          high = Math.min(cell.max, limits![1]);
        node.value = 100 >= low && 100 <= high ? 100 : (low + high) / 2;
      }
    } else if (evidence !== undefined) {
      node.role = "response";
      if (typeof evidence === "object" && evidence.kind === "threshold")
        node.constraint = {
          kind: "numeric",
          operator: evidence.operator,
          value: evidence.value,
        };
      else {
        const states = allowedStates(v, evidence);
        node.constraint = isCategorical(v)
          ? { kind: "categories", values: states.map((k) => v.states[k]) }
          : { kind: "states", states };
      }
    }
    if (
      snapshot.example === "cantilever" &&
      joint.targetIds.every((id) =>
        ["c0", "c1", "c3"].includes(
          snapshot.variables.find((x) => x.id === id)?.columnId ?? "",
        ),
      ) &&
      ["c5", "c7"].includes(v.columnId)
    ) {
      node.role = "response";
      node.objective = "min";
      hasPilotObjectives = true;
    }
    nodes[v.id] = node;
  }
  // For other queries, let the engineer choose objectives explicitly.
  const study = studySchema.parse({
    id: crypto.randomUUID(),
    groupId,
    notation,
    modelRevision,
    sourceHash,
    snapshot,
    targetIds: joint.targetIds,
    shape: joint.shape,
    posterior: joint.posterior,
    coverage: 0.9,
    nodes,
  });
  if (hasPilotObjectives) {
    for (const v of snapshot.variables) {
      if (nodes[v.id].role === "response")
        study.nodes[v.id].predictors = suggestPredictors(study, v.id);
    }
  }
  return study;
}

export function fixedValueAllowed(study: Study, v: Variable, value: unknown) {
  if (
    isCategorical(v)
      ? typeof value !== "string"
      : typeof value !== "number" || !Number.isFinite(value)
  )
    return false;
  try {
    const state = encode(v, String(value));
    const evidence = study.snapshot.evidence[v.id];
    return evidence === undefined || allowedStates(v, evidence).includes(state);
  } catch {
    return false;
  }
}

function inputDimension(
  v: Variable,
  node: StudyNode,
  state?: number,
): SearchDimension | undefined {
  const interval = state === undefined ? undefined : statesBounds(v, state);
  if (isCategorical(v)) {
    const values = (
      interval && "values" in interval ? interval.values : v.states
    ).filter((value) => node.categories?.includes(String(value)));
    return values.length ? { values } : undefined;
  }
  if (node.min === undefined || node.max === undefined || node.min > node.max)
    return;
  if (!v.binning) {
    const values = (
      interval && "values" in interval ? interval.values : v.states.map(Number)
    ).filter(
      (value) => Number(value) >= node.min! && Number(value) <= node.max!,
    );
    return values.length ? { values } : undefined;
  }
  const min = Math.max(
    node.min,
    interval && "min" in interval ? interval.min : -Infinity,
  );
  const max = Math.min(
    node.max,
    interval && "max" in interval ? interval.max : Infinity,
  );
  return min <= max ? { min, max } : undefined;
}

export function selectRegions(study: Study) {
  const variables = study.snapshot.variables.filter(
    (v) => study.targetIds.includes(v.id) || study.nodes[v.id].role === "input",
  );
  const regions = study.posterior.map((probability, index): StudyRegion => {
    let cursor = index;
    const states = Array<number>(study.shape.length);
    for (let i = states.length - 1; i >= 0; i--) {
      states[i] = cursor % study.shape[i];
      cursor = Math.floor(cursor / study.shape[i]);
    }
    const bounds: StudyRegion["bounds"] = {};
    const exclusions: string[] = [],
      clipped: string[] = [];
    for (const v of variables) {
      const axis = study.targetIds.indexOf(v.id);
      const state = states[axis];
      const node = study.nodes[v.id];
      if (node.role === "fixed") {
        if (
          !fixedValueAllowed(study, v, node.value) ||
          encode(v, String(node.value)) !== state
        )
          exclusions.push(v.label + " fixed value");
        continue;
      }
      if (node.role !== "input") {
        exclusions.push(v.label + " must be a design input or fixed condition");
        continue;
      }
      const dimension = inputDimension(v, node, state);
      if (!dimension) {
        exclusions.push(
          v.label +
            (isCategorical(v) ? " allowed categories" : " study bounds"),
        );
        continue;
      }
      bounds[v.id] = dimension;
      const cell = state === undefined ? undefined : statesBounds(v, state);
      if (
        cell &&
        "min" in cell &&
        "min" in dimension &&
        (dimension.min > cell.min || dimension.max < cell.max)
      )
        clipped.push(v.label);
    }
    return {
      index,
      states,
      probability,
      bounds,
      exclusions,
      clipped,
      retained: false,
    };
  });
  const eligible = regions
    .filter((r) => r.probability > 0 && r.exclusions.length === 0)
    .sort((a, b) => b.probability - a.probability || a.index - b.index);
  let achieved = 0,
    cutoff = Infinity;
  const retained = [];
  for (const region of eligible) {
    if (
      retained.length > 0 &&
      achieved >= study.coverage - 1e-12 &&
      Math.abs(region.probability - cutoff) > 1e-12
    )
      break;
    region.retained = true;
    retained.push(region);
    achieved += region.probability;
    cutoff = region.probability;
  }
  return {
    regions,
    retained,
    achieved: Math.min(1, achieved),
    available: Math.min(
      1,
      eligible.reduce((a, r) => a + r.probability, 0),
    ),
    exclusions: [
      ...new Set(
        regions.filter((r) => r.probability > 0).flatMap((r) => r.exclusions),
      ),
    ],
  };
}

export function studyResponses(study: Study) {
  return study.snapshot.variables.filter((v) => {
    const node = study.nodes[v.id];
    return node.role === "response" && (node.objective || node.constraint);
  });
}

export function checkStudy(study: Study, dataset?: Dataset) {
  if (!dataset || study.sourceHash !== dataset.hash)
    throw new Error(
      "Attach the dataset used by this query, or run the query again with the current dataset.",
    );
  const inputs = study.snapshot.variables.filter(
    (v) => study.nodes[v.id].role === "input",
  );
  if (!inputs.length) throw new Error("Choose at least one design input.");
  const responses = studyResponses(study);
  if (!responses.some((v) => study.nodes[v.id].objective))
    throw new Error("Choose at least one objective.");
  for (const v of study.snapshot.variables) {
    const node = study.nodes[v.id];
    if (node.role === "fixed" && !fixedValueAllowed(study, v, node.value))
      throw new Error("Set a valid operating value for " + v.label + ".");
  }
  for (const v of responses) {
    const node = study.nodes[v.id];
    if (node.objective && isCategorical(v))
      throw new Error("Objectives must be numeric.");
    if (
      node.constraint?.kind === "categories" &&
      !node.constraint.values.length
    )
      throw new Error("Choose accepted categories for " + v.label + ".");
    if (node.constraint?.kind === "states" && !node.constraint.states.length)
      throw new Error("Choose accepted states for " + v.label + ".");
    const ids = node.predictors ?? suggestPredictors(study, v.id);
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !["input", "fixed"].includes(study.nodes[id]?.role))
    )
      throw new Error(
        "Choose design inputs or fixed conditions as predictors for " +
          v.label +
          ".",
      );
    for (const variable of [
      v,
      ...ids.map((id) => study.snapshot.variables.find((x) => x.id === id)!),
    ]) {
      const i = variable.columnId ? Number(variable.columnId.slice(1)) : -1;
      if (
        !dataset.headers[i] ||
        dataset.headers[i] !== study.snapshot.dataset?.headers[i]
      )
        throw new Error(
          "No matching training column for " + variable.label + ".",
        );
    }
  }
  const selection = selectRegions(study);
  if (!selection.retained.length)
    throw new Error("There are no eligible design regions.");
  return selection;
}

export function studyObservedCounts(study: Study, dataset: Dataset) {
  const snapshot = study.snapshot;
  const counts = Array<number>(study.posterior.length).fill(0);
  const missing = new Set(["", ...snapshot.missingTokens]);
  const variable = (id: string) => snapshot.variables.find((v) => v.id === id)!;
  const axes = study.targetIds.map(variable);
  const predicates = Object.entries(snapshot.evidence).map(
    ([id, evidence]) => ({
      variable: variable(id),
      allowed: allowedStates(variable(id), evidence),
    }),
  );
  if ([...axes, ...predicates.map((x) => x.variable)].some((v) => !v.columnId))
    return undefined;
  function read(row: string[], v: Variable) {
    const raw = row[Number(v.columnId.slice(1))];
    return missing.has(raw) || raw === undefined ? -1 : encode(v, raw);
  }
  for (const row of dataset.rows) {
    try {
      if (predicates.some((p) => !p.allowed.includes(read(row, p.variable))))
        continue;
      let index = 0;
      for (let i = 0; i < axes.length; i++) {
        const state = read(row, axes[i]);
        if (state < 0) {
          index = -1;
          break;
        }
        index = index * study.shape[i] + state;
      }
      if (index >= 0) counts[index]++;
    } catch {
      // A row outside the snapshot state definitions cannot support a cell.
    }
  }
  return counts;
}

export function constraintEvent(
  v: Variable,
  constraint: NonNullable<StudyNode["constraint"]>,
): EvidenceValue | undefined {
  if (constraint.kind === "numeric")
    return {
      kind: "threshold",
      operator: constraint.operator,
      value: constraint.value,
    };
  const states =
    constraint.kind === "states"
      ? constraint.states
      : v.states.flatMap((value, i) =>
          constraint.values.includes(value) ? [i] : [],
        );
  return states.length ? { kind: "states", states } : undefined;
}

export function diagnosticProbabilities<
  T extends { groups: Record<string, JointResult>; logEvidence: number },
>(study: Study, run: (project: Project) => Promise<T>) {
  const base: Project = {
    ...study.snapshot,
    evidence: {},
    queryGroups: [
      { id: study.groupId, name: "Study regions", targetIds: study.targetIds },
    ],
  };
  inferenceReady(base);
  const requirements: Project["evidence"] = {};
  for (const v of base.variables) {
    const node = study.nodes[v.id];
    if (node.role === "fixed") {
      if (!fixedValueAllowed(study, v, node.value))
        throw new Error("Set a valid operating value for " + v.label + ".");
      base.evidence[v.id] = encode(v, String(node.value));
    }
    if (node.role === "response" && node.constraint) {
      const event = constraintEvent(v, node.constraint);
      if (!event) throw new Error("Set an accepted state for " + v.label + ".");
      requirements[v.id] = event;
    }
  }
  if (!Object.keys(requirements).length)
    throw new Error("Choose at least one constraint.");
  return (async () => {
    const denominator = await run(base);
    const p = denominator.groups[study.groupId].posterior;
    try {
      const numerator = await run({
        ...base,
        evidence: { ...base.evidence, ...requirements },
      });
      return numerator.groups[study.groupId].posterior.map((q, i) => {
        if (!p[i]) return null;
        if (!q) return 0;
        return Math.min(
          1,
          Math.exp(
            Math.log(q) -
              Math.log(p[i]) +
              numerator.logEvidence -
              denominator.logEvidence,
          ),
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "IMPOSSIBLE_EVIDENCE")
        throw error;
      return p.map((value) => (value > 0 ? 0 : null));
    }
  })();
}

export function beamColumns(study: Study) {
  if (study.snapshot.example !== "cantilever") return null;
  return cantileverHeaders.map((_, i) =>
    study.snapshot.variables.find((v) => v.columnId === "c" + i),
  );
}
