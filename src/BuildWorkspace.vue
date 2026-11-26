<script setup lang="ts">
import { formatDecimal } from "./query-figure";
import GraphExport from "./GraphExport.vue";
import { computed, nextTick, ref, watch } from "vue";
import {
  VueFlow,
  ConnectionMode,
  Handle,
  Position,
  useVueFlow,
  type Connection,
} from "@vue-flow/core";
import { useProject } from "./store";
import { cptSize, stateLabel, precisionWarning, type Variable } from "./domain";
const st = useProject(),
  flow = useVueFlow({ id: "build" });
const stateNames = ref<string[]>([]);
const manualName = ref("");
const manualStates = ref("");
function addManualNode() {
  if (st.addManualNode(manualName.value)) manualName.value = "";
}
const method = ref<"mle" | "dirichlet">("dirichlet"),
  alpha = ref(1);
const canTrain = computed(
  () =>
    st.project.variables.length > 0 &&
    !st.cycles.length &&
    (!!st.dataset || st.project.variables.every((v) => !v.columnId)),
);
watch(
  () => [st.project.id, st.project.example],
  () => {
    method.value = st.project.example === "cantilever" ? "mle" : "dirichlet";
  },
  { immediate: true },
);
let fittedExample: string | undefined;
watch(
  () => [st.activeTab, st.project.id, st.project.example] as const,
  async ([tab, id, example]) => {
    if (tab !== "network" || example !== "cantilever" || fittedExample === id)
      return;
    fittedExample = id;
    await nextTick();
    requestAnimationFrame(() => flow.fitView({ padding: 0.25 }));
  },
);
const needsTraining = computed(
  () => st.project.cpts.length !== st.project.variables.length,
);
let previewAttempt = "";
watch(
  [
    () => st.activeTab,
    () => st.dataset,
    () => st.busy,
    () => st.trainingStamp(),
  ],
  ([tab, dataset, busy, stamp], previous) => {
    if (dataset !== previous?.[1] || tab !== previous?.[0]) previewAttempt = "";
    if (
      tab !== "states" ||
      !dataset ||
      busy ||
      !st.project.variables.some((v) => v.columnId) ||
      st.trainingPreview?.stamp === stamp ||
      previewAttempt === stamp
    )
      return;
    previewAttempt = stamp;
    void st.previewTraining();
  },
);
const selectedEdge = ref(""),
  graphCanvas = ref<HTMLDivElement>();
const representation = ref<Variable["representation"]>("categorical"),
  binMethod = ref<"manual" | "equalWidth" | "quantile">("equalWidth"),
  bins = ref(3),
  manual = ref("");
type Side = "left" | "right" | "top" | "bottom";
const sourceSide = ref<Side>("right"),
  targetSide = ref<Side>("left");
const source = ref(""),
  destination = ref("");
const selected = computed(() =>
  st.project.variables.find((v) => v.id === st.selected),
);
watch(
  () => selected.value?.states,
  (states) => (manualStates.value = states?.join("\n") ?? ""),
);
const cptEstimate = computed(() => {
  if (!selected.value) return "";
  try {
    return `${cptSize(st.project, selected.value.id).toLocaleString()} CPT cells`;
  } catch (e) {
    return (e as Error).message;
  }
});
const selectedCpt = computed(() =>
  st.project.cpts.find((c) => c.variableId === st.selected),
);
const selectedCounts = computed(() => {
  const i = st.project.variables.findIndex((v) => v.id === st.selected);
  return selected.value?.columnId &&
    st.trainingPreview?.stamp === st.trainingStamp()
    ? st.trainingPreview.counts[i]
    : undefined;
});
const nodes = computed(() =>
  st.project.variables.map((v) => ({
    id: v.id,
    position: v.position,
    type: "default",
    data: {
      label: v.label,
      states: v.states.length,
      evidence: st.activeQuery?.evidence?.[v.id] !== undefined,
      trained: st.project.cpts.some((c) => c.variableId === v.id),
      cycle: st.cycles.includes(v.id),
    },
    selected: st.selected === v.id,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  })),
);
const edges = computed(() =>
  st.project.edges.map((e) => ({
    ...e,
    selected: selectedEdge.value === e.id,
    sourceHandle: e.sourceHandle || "right",
    targetHandle: e.targetHandle || "left",
    style: {
      stroke:
        st.cycles.includes(e.source) && st.cycles.includes(e.target)
          ? "#bc3547"
          : "#718599",
      strokeWidth: 2,
    },
    markerEnd: "arrowclosed",
  })),
);
const lowerBound = ref<"observed" | "zero" | "custom" | "unbounded">(
  "observed",
);
const upperBound = ref<"observed" | "custom" | "unbounded">("observed");
const customMin = ref<number>();
const customMax = ref<number>();
watch(
  () => selected.value?.id,
  (id) => {
    if (id) inspect(id);
  },
  { immediate: true },
);
watch(
  () => selected.value?.stateLabels,
  (labels) => (stateNames.value = [...(labels || [])]),
  { immediate: true, deep: true },
);
function inspect(id: string) {
  selectedEdge.value = "";
  st.selected = id;
  const v = selected.value;
  if (v) {
    representation.value = v.representation;
    binMethod.value = v.binning?.method || "equalWidth";
    bins.value = v.binning?.requestedBins || 3;
    manual.value = v.binning?.cuts.join(", ") || "";
    lowerBound.value =
      v.binning?.bounds?.lower ?? (v.binning ? "unbounded" : "observed");
    upperBound.value =
      v.binning?.bounds?.upper ?? (v.binning ? "unbounded" : "observed");
    customMin.value = v.binning?.bounds?.min ?? v.binning?.fittedRange[0];
    customMax.value = v.binning?.bounds?.max ?? v.binning?.fittedRange[1];
  }
}
async function addColumn(i: number) {
  const p = st.dataset!.profiles[i];
  await st.configure(`c${i}`, p.numeric ? "discretised" : "categorical");
  if (st.selected) inspect(st.selected);
}
function configure() {
  if (!selected.value) return;
  if (
    st.project.cpts.length &&
    !confirm(
      "Changing variable states or bins invalidates dependent CPTs and query results. Continue?",
    )
  )
    return;
  void st.configure(
    selected.value.columnId,
    representation.value,
    binMethod.value,
    bins.value,
    manual.value
      .split(",")
      .filter((x) => x.trim())
      .map(Number),
    {
      lower: lowerBound.value,
      upper: upperBound.value,
      min: customMin.value,
      max: customMax.value,
    },
  );
}
function connect(c: Connection) {
  if (c.source && c.target)
    st.addEdge(
      c.source,
      c.target,
      (c.sourceHandle || "right") as Side,
      (c.targetHandle || "left") as Side,
    );
}
function deleteEdgeKey(event: KeyboardEvent) {
  if (!selectedEdge.value || !["Delete", "Backspace"].includes(event.key))
    return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, button, [contenteditable=true]"))
    return;
  event.preventDefault();
  dropEdge(selectedEdge.value);
}
function dropEdge(id: string) {
  if (!st.project.edges.some((e) => e.id === id)) return;
  selectedEdge.value = "";
  st.project.edges = st.project.edges.filter((e) => e.id !== id);
  st.touch();
}
async function autoLayout() {
  if (!(await st.layout())) return;
  await nextTick();
  await flow.fitView({ padding: 0.25 });
}
function parentAssignment(
  c: NonNullable<typeof selectedCpt.value>,
  row: number,
) {
  const labels: string[] = [];
  let rem = row;
  for (let i = c.parentIds.length - 1; i >= 0; i--) {
    const v = st.project.variables.find((v) => v.id === c.parentIds[i])!;
    labels.unshift(`${v.label} = ${stateLabel(v, rem % v.states.length)}`);
    rem = Math.floor(rem / v.states.length);
  }
  return labels.join(" · ") || "Root distribution";
}
</script>
<template>
  <div class="build-workspaces">
    <main
      id="network-panel"
      class="workspace network-workspace"
      role="tabpanel"
      aria-labelledby="network-tab"
      v-show="st.activeTab === 'network'"
    >
      <aside class="data-panel panel" aria-label="Network variables">
        <div class="panel-heading">
          <h2>Network variables</h2>
        </div>
        <div v-if="st.project.dataset" class="dataset-card">
          <strong>{{ st.project.dataset.name }}</strong>
          <small
            >{{ st.project.dataset.rowCount.toLocaleString() }} rows ·
            {{ st.project.dataset.headers.length }} columns</small
          >
          <small>{{
            st.dataset ? "Source attached" : "Source not attached"
          }}</small>
        </div>
        <button class="wide" @click="st.activeTab = 'data'">
          {{ st.dataset ? "Manage data" : "Go to Data" }}
        </button>
        <details class="manual-node">
          <summary>Add a manual node</summary>
          <form @submit.prevent="addManualNode">
            <label class="field"
              >Variable name<input v-model="manualName" maxlength="200"
            /></label>
            <button :disabled="st.busy">Add node</button>
          </form>
        </details>
        <div v-if="st.dataset" class="column-list">
          <div class="section-label">AVAILABLE COLUMNS</div>
          <div
            v-for="(header, i) in st.dataset.headers"
            :key="i"
            class="column-item"
          >
            <div>
              <strong>{{ header }}</strong
              ><small
                >{{
                  st.dataset.profiles[i].numeric ? "Numeric" : "Categorical"
                }}
                · {{ st.dataset.profiles[i].unique }} unique</small
              ><small
                >{{ st.dataset.profiles[i].missing }} missing at import</small
              >
            </div>
            <button
              :aria-label="`Add ${header}`"
              :disabled="
                st.busy ||
                st.project.variables.some((v) => v.columnId === `c${i}`)
              "
              @click="addColumn(i)"
            >
              {{
                st.project.variables.some((v) => v.columnId === `c${i}`)
                  ? "✓"
                  : "＋"
              }}
            </button>
          </div>
        </div>
      </aside>
      <section class="canvas-panel" aria-label="Network editor">
        <div class="canvas-heading">
          <div>
            <h1>Build your network</h1>
          </div>
          <div class="canvas-tools">
            <button
              v-if="selected"
              class="danger"
              :disabled="st.busy"
              @click="st.removeNode(selected.id)"
            >
              Delete variable
            </button>
            <button
              class="danger"
              :disabled="!st.project.edges.some((e) => e.id === selectedEdge)"
              @click="dropEdge(selectedEdge)"
            >
              Delete selected connection
            </button>
            <button v-if="selected" @click="st.activeTab = 'states'">
              Edit states
            </button>
            <button @click="flow.fitView({ padding: 0.25 })">Fit view</button
            ><button
              @click="autoLayout"
              :disabled="st.busy || !st.project.variables.length"
            >
              Auto layout
            </button>
            <GraphExport />
          </div>
        </div>
        <div v-if="st.cycles.length" class="cycle-warning" role="alert">
          Cycle detected in {{ st.cycles.length }} variables:
          {{
            st.project.variables
              .filter((v) => st.cycles.includes(v.id))
              .map((v) => v.label)
              .join(", ")
          }}. Remove a connection before training or inference.
        </div>
        <p class="canvas-help tiny muted">
          Click a connection to select it, then delete it using the button above
          or Delete / Backspace. All connections can also be removed in
          Connections below.
        </p>
        <div
          class="graph-wrap"
          ref="graphCanvas"
          tabindex="0"
          aria-label="Editable network canvas"
          @keydown="deleteEdgeKey"
        >
          <VueFlow
            :connection-mode="ConnectionMode.Loose"
            id="build"
            :nodes="nodes"
            :edges="edges"
            :min-zoom="0.2"
            :max-zoom="2"
            :default-viewport="{ x: 40, y: 40, zoom: 1 }"
            :delete-key-code="null"
            @connect="connect"
            @edge-click="
              (e) => {
                selectedEdge = e.edge.id;
                graphCanvas?.focus({ preventScroll: true });
              }
            "
            @pane-click="selectedEdge = ''"
            @node-click="(e) => inspect(e.node.id)"
            @node-drag-stop="
              (e) => {
                const v = st.project.variables.find((v) => v.id === e.node.id);
                if (v) {
                  v.position = { ...e.node.position };
                  st.touch('display');
                }
              }
            "
          >
            <template #node-default="{ data }"
              ><Handle
                v-for="side in [
                  Position.Left,
                  Position.Right,
                  Position.Top,
                  Position.Bottom,
                ]"
                :key="side"
                :id="side"
                type="source"
                :position="side"
              />
              <div
                class="network-node"
                :class="{ cyclic: data.cycle, observed: data.evidence }"
              >
                <div class="node-type">
                  DISCRETE VARIABLE
                  <span>{{
                    data.cycle
                      ? "⚠ Cycle"
                      : data.evidence
                        ? "● Evidence"
                        : data.trained
                          ? "✓ Trained"
                          : "○ Untrained"
                  }}</span>
                </div>
                <strong>{{ data.label }}</strong
                ><small>{{ data.states }} states</small>
              </div>
            </template>
          </VueFlow>
          <div v-if="!st.project.variables.length" class="empty-canvas">
            <div class="empty-icon">○ ── ○</div>
            <h2>A clear view of uncertainty</h2>
            <p>
              Import data and add variables to the canvas.<br />Connect them to
              describe your model’s dependencies.
            </p>
          </div>
        </div>
        <div class="graph-footer">
          <span
            >Drag handles to connect · Select a variable to edit its
            states</span
          ><span>{{
            st.cycles.length
              ? "Invalid draft"
              : st.project.cpts.length === st.project.variables.length &&
                  st.project.variables.length
                ? "Model trained"
                : "Draft model"
          }}</span>
        </div>
        <details class="connection-controls">
          <summary>Connections · keyboard controls</summary>
          <div class="inline">
            <label
              >From<select v-model="source">
                <option value="">Select variable</option>
                <option
                  v-for="v in st.project.variables"
                  :value="v.id"
                  :key="v.id"
                >
                  {{ v.label }}
                </option>
              </select></label
            ><label
              >To<select v-model="destination">
                <option value="">Select variable</option>
                <option
                  v-for="v in st.project.variables"
                  :value="v.id"
                  :key="v.id"
                >
                  {{ v.label }}
                </option>
              </select></label
            ><label
              >From side<select v-model="sourceSide">
                <option
                  v-for="side in ['left', 'right', 'top', 'bottom']"
                  :key="side"
                >
                  {{ side }}
                </option>
              </select></label
            ><label
              >To side<select v-model="targetSide">
                <option
                  v-for="side in ['left', 'right', 'top', 'bottom']"
                  :key="side"
                >
                  {{ side }}
                </option>
              </select></label
            ><button
              @click="st.addEdge(source, destination, sourceSide, targetSide)"
              :disabled="!source || !destination"
            >
              Connect
            </button>
          </div>
          <ul>
            <li v-for="e in st.project.edges" :key="e.id">
              {{ st.project.variables.find((v) => v.id === e.source)?.label }} →
              {{ st.project.variables.find((v) => v.id === e.target)?.label }}
              <button
                @click="dropEdge(e.id)"
                :aria-label="`Remove connection ${st.project.variables.find((v) => v.id === e.source)?.label} to ${st.project.variables.find((v) => v.id === e.target)?.label}`"
              >
                Remove
              </button>
            </li>
          </ul>
        </details>
      </section>
    </main>
    <main
      id="states-panel"
      class="states-workspace"
      role="tabpanel"
      aria-labelledby="states-tab"
      v-show="st.activeTab === 'states'"
    >
      <section class="inspector panel" aria-label="Variable settings">
        <div class="panel-heading">
          <h2>Variable settings</h2>
        </div>
        <label class="field"
          >Selected variable<select
            :value="st.selected"
            :disabled="st.busy"
            @change="inspect(($event.target as HTMLSelectElement).value)"
          >
            <option value="">Select a variable</option>
            <option v-for="v in st.project.variables" :value="v.id" :key="v.id">
              {{ v.label }}
            </option>
          </select></label
        >
        <template v-if="selected"
          ><label class="field"
            >Display name<input
              v-model="selected.label"
              @change="st.touch('display')"
              maxlength="200"
          /></label>
          <template v-if="!selected.columnId">
            <p class="muted">
              Manual variables use a uniform probability for each state.
            </p>
            <label class="field"
              >States (one per line)
              <textarea v-model="manualStates" rows="5"></textarea>
            </label>
            <button
              :disabled="st.busy"
              @click="st.setManualStates(selected.id, manualStates)"
            >
              Apply states
            </button>
          </template>
          <template v-else>
            <div class="tiny muted">
              Source:
              {{
                st.project.dataset?.headers[Number(selected.columnId.slice(1))]
              }}
            </div>
            <label class="field"
              >Representation<select v-model="representation">
                <option value="categorical">Categorical</option>
                <option value="finiteNumeric">Finite numeric states</option>
                <option value="discretised">Discretised numeric</option>
              </select></label
            >
            <template v-if="representation === 'discretised'"
              ><label class="field"
                >Binning method<select v-model="binMethod">
                  <option value="equalWidth">Equal width</option>
                  <option value="quantile">Quantile</option>
                  <option value="manual">Manual thresholds</option>
                </select></label
              ><label v-if="binMethod !== 'manual'" class="field"
                >Requested bins<input
                  type="number"
                  min="2"
                  max="64"
                  v-model.number="bins" /></label
              ><label v-else class="field"
                >Thresholds (comma-separated)<input
                  v-model="manual"
                  placeholder="10, 20, 30"
              /></label>
              <label class="field"
                >Lower bin bound
                <select v-model="lowerBound">
                  <option value="observed">Observed minimum</option>
                  <option value="zero">Zero</option>
                  <option value="custom">Custom</option>
                  <option value="unbounded">Unbounded</option>
                </select>
              </label>
              <label v-if="lowerBound === 'custom'" class="field"
                >Custom lower bound
                <input v-model.number="customMin" type="number" step="any" />
              </label>
              <label class="field"
                >Upper bin bound
                <select v-model="upperBound">
                  <option value="observed">Observed maximum</option>
                  <option value="custom">Custom</option>
                  <option value="unbounded">Unbounded</option>
                </select>
              </label>
              <label v-if="upperBound === 'custom'" class="field"
                >Custom upper bound
                <input v-model.number="customMax" type="number" step="any" />
              </label>
            </template>
            <button
              class="wide"
              @click="configure"
              :disabled="st.busy || !st.dataset"
            >
              Apply variable settings
            </button>
            <label v-if="selected.binning" class="field"
              >Decimal places<input
                type="number"
                min="0"
                max="12"
                step="1"
                :value="selected.displayDecimals"
                @change="
                  (e) => {
                    st.setPrecision(
                      selected!.id,
                      Number((e.target as HTMLInputElement).value),
                    );
                    (e.target as HTMLInputElement).value = String(
                      selected!.displayDecimals,
                    );
                  }
                "
            /></label>
            <p
              v-if="precisionWarning(selected)"
              class="precision-warning"
              role="status"
            >
              Rounded boundaries look identical. Increase decimal places; exact
              thresholds are unchanged.
            </p>
            <details v-if="selected.binning">
              <summary>Exact thresholds</summary>
              <code>{{ selected.binning.cuts.join(", ") }}</code>
            </details>
            <label class="field"
              >Parameter mode<select
                :value="selected.parameterMode"
                @change="
                  st.setParameterMode(
                    selected!.id,
                    ($event.target as HTMLSelectElement).value as
                      'learned' | 'uniform',
                  )
                "
              >
                <option value="learned">Learn from data</option>
                <option value="uniform">Force uniform CPT</option>
              </select></label
            >
            <p v-if="selected.parameterMode === 'uniform'" class="tiny muted">
              Training assigns equal probability to every state in every parent
              configuration. Incoming edges are retained but have no effect on
              this CPT. This does not rebalance the data or guarantee a uniform
              posterior after evidence.
            </p>
            <p class="tiny muted">{{ cptEstimate }}</p>
            <div class="section-label">
              {{ selected.states.length }} EFFECTIVE STATES
            </div>
            <p v-if="selectedCounts?.some((n) => n === 0)" class="tiny muted">
              Some states have no retained observations. Review the bins and
              training prior before interpreting results.
            </p>
            <ol class="states">
              <li v-for="(state, i) in selected.states" :key="i">
                <label
                  v-if="selected.representation === 'categorical'"
                  class="state-name-field"
                  ><small>Source: {{ state }}</small
                  ><input
                    :aria-label="`State display name for ${state}`"
                    v-model="stateNames[i]"
                    maxlength="200"
                /></label>
                <span v-else>{{ stateLabel(selected, i) }}</span
                ><small v-if="selectedCounts"
                  >{{ selectedCounts[i] }} rows</small
                >
              </li>
            </ol>
            <button
              v-if="selected.representation === 'categorical'"
              @click="st.renameStates(selected.id, stateNames)"
              class="wide"
            >
              Apply state names
            </button>
            <p v-if="selected.binning" class="tiny muted">
              Exact cuts enter the upper bin. Finite outer endpoints are
              included. Values beyond finite endpoints are excluded from
              training.
            </p>
          </template>
          <details v-if="selectedCpt" class="cpt">
            <summary>Trained CPT · {{ selectedCpt.origin }}</summary>
            <p class="tiny">
              {{
                selectedCpt.origin === "uniform"
                  ? "Uniform override"
                  : selectedCpt.origin === "dirichlet"
                    ? `α per cell: ${selectedCpt.alphaPerCell}`
                    : "Maximum likelihood"
              }}
              · {{ new Date(selectedCpt.trainedAt).toLocaleString() }}
            </p>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Parents / count</th>
                    <th v-for="(s, i) in selected.states" :key="i">
                      {{ stateLabel(selected, i) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(n, row) in selectedCpt.rowCounts.slice(0, 100)"
                    :key="row"
                  >
                    <th>
                      {{ parentAssignment(selectedCpt, row)
                      }}<small
                        >n = {{ n
                        }}{{
                          n === 0
                            ? selectedCpt.origin === "uniform"
                              ? " · uniform override"
                              : " · prior only"
                            : ""
                        }}</small
                      >
                    </th>
                    <td v-for="(_, k) in selected.states" :key="k">
                      {{
                        formatDecimal(
                          selectedCpt.values[row * selected.states.length + k],
                          st.project.probabilityDecimalPlaces,
                        )
                      }}<small
                        >count
                        {{
                          selectedCpt.counts[row * selected.states.length + k]
                        }}</small
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="selectedCpt.rowCounts.length > 100" class="tiny">
              Showing first 100 parent assignments. Download the project for the
              complete CPT.
            </p>
          </details>
          <p v-else class="tiny muted">
            CPT not trained for the current variable configuration.
          </p>
        </template>
        <p v-else class="muted">
          Select a variable to edit its states and review its probabilities.
        </p>
      </section>
      <section class="panel training-panel" aria-label="Training">
        <h2>Training</h2>
        <p v-if="st.project.variables.length">
          {{ needsTraining ? "Model needs training" : "Model trained" }}
        </p>
        <p v-else>Add variables in Network to train a model.</p>
        <p v-if="st.trainingPreview?.stamp === st.trainingStamp()">
          {{ st.trainingPreview.retained }} rows retained ·
          {{ st.trainingPreview.dropped }} excluded
          <span v-if="st.trainingPreview.outOfRange"
            >({{ st.trainingPreview.outOfRange }} outside bin bounds)</span
          >
        </p>
        <p v-if="st.project.variables.some((v) => v.columnId) && !st.dataset">
          Reattach the matching CSV in Data to train.
        </p>
        <p v-if="st.cycles.length">
          Resolve the cycle in Network before training.
        </p>
        <button
          class="primary"
          @click="st.train(method, alpha)"
          :disabled="st.busy || !canTrain"
        >
          Train model
        </button>
        <details class="training-options">
          <summary>Advanced training settings</summary>
          <label class="field"
            >Estimator
            <select v-model="method">
              <option value="dirichlet">Symmetric Dirichlet</option>
              <option value="mle">Maximum likelihood</option>
            </select>
          </label>
          <label v-if="method === 'dirichlet'" class="field"
            >α per cell
            <input
              type="number"
              min="0.000001"
              step="0.1"
              v-model.number="alpha"
            />
          </label>
          <button
            @click="st.previewTraining()"
            :disabled="
              st.busy ||
              !st.dataset ||
              !st.project.variables.some((v) => v.columnId)
            "
          >
            Review training data
          </button>
        </details>
      </section>
    </main>
  </div>
</template>
