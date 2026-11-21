<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useProject } from "./store";
import {
  inferenceReady,
  stateLabel,
  evidenceLabel,
  resolveEvidence,
  type Project,
} from "./domain";
import { validateQueries, querySize, QUERY_LIMITS } from "./engine";
import { csvCell, download } from "./files";
import ProbabilityGraph from "./ProbabilityGraph.vue";
import EvidenceControl from "./EvidenceControl.vue";
import SampleExport from "./SampleExport.vue";
import QueryResults from "./QueryResults.vue";
const st = useProject(),
  view = ref<"graph" | "distribution">("distribution"),
  activeGroupId = ref("");
watch(
  () => st.project.queryGroups.map((g) => g.id),
  (ids) => {
    if (!ids.includes(activeGroupId.value)) activeGroupId.value = ids[0] || "";
  },
  { immediate: true },
);
const active = computed(() =>
  st.project.queryGroups.find((g) => g.id === activeGroupId.value),
);
async function run() {
  if (await st.query()) {
    view.value = "distribution";
    st.activeTab = "results";
    await nextTick();
    document.getElementById("results-tab")?.focus();
  }
}
function editQuery() {
  st.activeTab = "queries";
  document.getElementById("queries-tab")?.focus();
}
const resultProject = computed(() =>
  st.current ? st.project : st.resultSnapshot || st.project,
);
const queryError = computed(() => {
  try {
    inferenceReady(st.project);
    resolveEvidence(st.project);
    validateQueries(st.project.variables, st.project.queryGroups);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
});
const totalSize = computed(() =>
  st.project.queryGroups.reduce(
    (n, g) => n + querySize(st.project.variables, g),
    0,
  ),
);
const completedGroups = computed(() =>
  resultProject.value.queryGroups.filter(
    (group) => st.results?.groups[group.id],
  ),
);
const completedGroup = computed(
  () =>
    completedGroups.value.find((group) => group.id === activeGroupId.value) ??
    completedGroups.value[0],
);
const result = computed(
  () => completedGroup.value && st.results?.groups[completedGroup.value.id],
);
function evidenceTerms(project: Project, evidence: Project["evidence"]) {
  return Object.entries(evidence)
    .map(([id, assignment]) => {
      const variable = project.variables.find((v) => v.id === id)!;
      return typeof assignment === "number"
        ? `${variable.label} = ${stateLabel(variable, assignment)}`
        : evidenceLabel(variable, assignment);
    })
    .join(", ");
}
function probabilityNotation(project: Project, ids: string[]) {
  const targets = ids
    .map((id) => project.variables.find((v) => v.id === id)?.label)
    .join(", ");
  const evidence = evidenceTerms(project, project.evidence);
  return evidence ? `P ( ${targets} | ${evidence} )` : `P ( ${targets} )`;
}
function target(id: string, checked: boolean) {
  if (!active.value) return;
  active.value.targetIds = checked
    ? [...active.value.targetIds, id]
    : active.value.targetIds.filter((x) => x !== id);
  st.touch("query");
}
function moveTarget(index: number, direction: number) {
  const group = active.value;
  if (!group) return;
  const other = index + direction;
  if (other < 0 || other >= group.targetIds.length) return;
  [group.targetIds[index], group.targetIds[other]] = [
    group.targetIds[other],
    group.targetIds[index],
  ];
  st.touch("query");
}
function renameGroup(value: string) {
  if (!active.value) return;
  if (!value.trim()) {
    st.error = "Query name cannot be blank.";
    return;
  }
  active.value.name = value.trim().slice(0, 100);
  st.touch("display");
  st.error = "";
}
async function addGroup() {
  const id = st.addGroup();
  if (id) {
    activeGroupId.value = id;
    await nextTick();
    document.getElementById(`query-tab-${id}`)?.focus();
  }
}
function queryTabKeys(e: KeyboardEvent) {
  const groups = st.project.queryGroups;
  if (!groups.length) return;
  let i = groups.findIndex((g) => g.id === activeGroupId.value);
  if (e.key === "ArrowRight") i = (i + 1) % groups.length;
  else if (e.key === "ArrowLeft") i = (i + groups.length - 1) % groups.length;
  else if (e.key === "Home") i = 0;
  else if (e.key === "End") i = groups.length - 1;
  else return;
  e.preventDefault();
  activeGroupId.value = groups[i].id;
  document.getElementById(`query-tab-${groups[i].id}`)?.focus();
}
function exportGroup(kind: "json" | "csv") {
  if (!st.current || !result.value || !completedGroup.value) return;
  const project = st.project,
    joint = result.value;
  const variables = joint.targetIds.map((id) =>
    project.variables.find((v) => v.id === id)!,
  );
  const provenance = {
    projectId: project.id,
    revisions: { ...st.revisions },
    group: {
      id: completedGroup.value.id,
      name: completedGroup.value.name,
      targetIds: completedGroup.value.targetIds,
    },
    evidence: Object.entries(project.evidence).map(([id, k]) => {
      const v = project.variables.find((v) => v.id === id)!;
      return { variableId: id, assignment: k, label: evidenceLabel(v, k) };
    }),
    engine: "jsagrum@0.1.3",
    method: "exact joint via conditional inference",
    datasetHash: project.dataset?.hash,
    training: project.cpts.map((c) => ({
      variableId: c.variableId,
      origin: c.origin,
      alphaPerCell: c.alphaPerCell,
      trainedAt: c.trainedAt,
    })),
    variables: variables.map((v) => ({
      id: v.id,
      label: v.label,
      states: v.states.map((sourceValue, index) => ({
        stateId: index,
        sourceValue,
        label: stateLabel(v, index),
      })),
      binning: v.binning,
    })),
  };
  if (kind === "json")
    download(
      "pdopt-bn-query.json",
      JSON.stringify({ provenance, ...joint }, null, 2),
    );
  else {
    const rows: unknown[][] = [
      [
        ...variables.flatMap((v) => [
          `${v.id}:stateId`,
          `${v.label}:stateLabel`,
        ]),
        "prior",
        "posterior",
        "provenance",
      ],
    ];
    joint.posterior.forEach((p, index) => {
      let rem = index;
      const states = Array(variables.length).fill(0);
      for (let i = variables.length - 1; i >= 0; i--) {
        states[i] = rem % joint.shape[i];
        rem = Math.floor(rem / joint.shape[i]);
      }
      rows.push([
        ...variables.flatMap((v, i) => [states[i], stateLabel(v, states[i])]),
        joint.prior[index],
        p,
        JSON.stringify(provenance),
      ]);
    });
    download(
      "pdopt-bn-query.csv",
      rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      "text/csv",
    );
  }
}
</script>
<template>
  <main
    id="queries-panel"
    class="query-workspace"
    role="tabpanel"
    aria-labelledby="queries-tab"
    v-show="st.activeTab === 'queries'"
  >
    <header class="workspace-heading">
      <h1>Queries</h1>
      <button
        @click="addGroup"
        :disabled="
          st.project.queryGroups.length >= QUERY_LIMITS.groups ||
          !st.project.variables.length
        "
      >
        Add query
      </button>
    </header>
    <div
      class="query-tabs"
      role="tablist"
      aria-label="Query views"
      @keydown="queryTabKeys"
    >
      <button
        v-for="g in st.project.queryGroups"
        :key="g.id"
        :id="`query-tab-${g.id}`"
        role="tab"
        :aria-selected="activeGroupId === g.id"
        :tabindex="activeGroupId === g.id ? 0 : -1"
        aria-controls="query-configuration"
        @click="activeGroupId = g.id"
      >
        {{ g.name }}
      </button>
    </div>

    <section class="query-controls" aria-label="Query settings">
      <fieldset>
        <legend>Shared evidence</legend>
        <div class="evidence-list">
          <EvidenceControl
            v-for="v in st.project.variables"
            :key="v.id"
            :variable="v"
          />
        </div>
        <button
          @click="
            st.project.evidence = {};
            st.touch('query');
          "
        >
          Clear evidence
        </button>
      </fieldset>
      <fieldset
        id="query-configuration"
        :aria-labelledby="active ? `query-tab-${active.id}` : undefined"
      >
        <legend>Query configuration</legend>
        <template v-if="active"
          ><label class="field"
            >Query name<input
              :key="active.id"
              :value="active.name"
              maxlength="100"
              @change="renameGroup(($event.target as HTMLInputElement).value)"
          /></label>
          <fieldset class="target-selector">
            <legend>Targets for active query</legend>
            <label v-for="v in st.project.variables" :key="v.id" class="check"
              ><input
                type="checkbox"
                :checked="active.targetIds.includes(v.id)"
                @change="
                  target(v.id, ($event.target as HTMLInputElement).checked)
                "
              />{{ v.label }}</label
            >
          </fieldset>
          <ol class="target-order">
            <li v-for="(id, i) in active.targetIds" :key="id">
              {{ st.project.variables.find((v) => v.id === id)?.label
              }}<button
                :aria-label="`Move target ${i + 1} up`"
                @click="moveTarget(i, -1)"
                :disabled="i === 0"
              >
                ↑</button
              ><button
                :aria-label="`Move target ${i + 1} down`"
                @click="moveTarget(i, 1)"
                :disabled="i === active.targetIds.length - 1"
              >
                ↓
              </button>
            </li>
          </ol>
          <p class="tiny">
            {{ querySize(st.project.variables, active).toLocaleString() }}
            combinations in this group · {{ totalSize.toLocaleString() }} total
          </p>
          <div class="saved-query-evidence">
            <button
              @click="st.saveQueryEvidence(active.id)"
              :disabled="st.busy"
            >
              Save evidence with query
            </button>
            <button
              @click="st.applyQueryEvidence(active.id)"
              :disabled="st.busy || !active.savedEvidence"
            >
              Apply saved evidence
            </button>
            <p v-if="active.savedEvidence" class="muted">
              Saved evidence:
              {{
                evidenceTerms(st.project, active.savedEvidence) ||
                "None (prior)"
              }}
            </p>
          </div>
          <button class="danger" @click="st.removeGroup(active.id)">
            Remove query
          </button></template
        >
        <p class="tiny muted">
          Limits: {{ QUERY_LIMITS.perGroup.toLocaleString() }} per group,
          {{ QUERY_LIMITS.total.toLocaleString() }} total,
          {{ QUERY_LIMITS.groups }} groups.
        </p>
      </fieldset>
    </section>
    <div class="workspace-heading query-run">
      <div>
        <strong>{{ active?.name || "Choose a query" }}</strong>
        <p v-if="active?.targetIds.length" class="query-notation">
          {{ probabilityNotation(st.project, active.targetIds) }}
        </p>
        <p v-else>
          Evidence:
          {{ evidenceTerms(st.project, st.project.evidence) || "None (prior)" }}
        </p>
        <p v-if="queryError" class="query-blocker">{{ queryError }}</p>
      </div>
      <button class="primary" @click="run" :disabled="st.busy || !!queryError">
        Run query
      </button>
    </div>
  </main>
  <main
    id="results-panel"
    class="results-workspace"
    role="tabpanel"
    aria-labelledby="results-tab"
    v-show="st.activeTab === 'results'"
  >
    <header class="workspace-heading results-heading">
      <div>
        <div class="view-switch" role="group" aria-label="Results view">
          <button :aria-pressed="view === 'graph'" @click="view = 'graph'">
            Network graph
          </button>
          <button
            :aria-pressed="view === 'distribution'"
            @click="view = 'distribution'"
          >
            Query results
          </button>
        </div>
        <template v-if="result && completedGroup">
          <p>
            <strong>{{ completedGroup.name }}</strong>
          </p>
          <p class="query-notation">
            {{ probabilityNotation(resultProject, result.targetIds) }}
          </p>
        </template>
        <p v-else-if="st.results">
          Evidence:
          {{
            evidenceTerms(resultProject, resultProject.evidence) ||
            "None (prior)"
          }}
        </p>
      </div>
      <button @click="editQuery">Edit query</button>
    </header>

    <ProbabilityGraph
      :visible="st.activeTab === 'results' && view === 'graph'"
      v-show="view === 'graph'"
    />
    <section
      v-show="view === 'distribution'"
      class="results-content"
      aria-label="Query results"
    >
      <template v-if="result && completedGroup">
        <div class="results-toolbar">
          <label v-if="completedGroups.length > 1">
            Query
            <select
              :value="completedGroup.id"
              @change="
                activeGroupId = ($event.target as HTMLSelectElement).value
              "
            >
              <option
                v-for="group in completedGroups"
                :key="group.id"
                :value="group.id"
              >
                {{ group.name }}
              </option>
            </select>
          </label>
          <span v-if="st.current" class="tiny muted">Current results</span>
          <details class="result-exports">
            <summary>Export results</summary>
            <div class="result-actions">
              <button @click="exportGroup('json')" :disabled="!st.current">
                Export JSON
              </button>
              <button @click="exportGroup('csv')" :disabled="!st.current">
                Export CSV
              </button>
            </div>
            <SampleExport :group-id="completedGroup.id" />
          </details>
        </div>
        <QueryResults
          :project="resultProject"
          :result="result"
          :current="st.current"
        />
      </template>
      <p v-else class="empty-results">Run a query to see its results here.</p>
    </section>
  </main>
</template>
