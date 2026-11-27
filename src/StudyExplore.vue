<script setup lang="ts">
import { computed, ref } from "vue";
import type { Dataset, Study, StudyValue } from "./domain";
import { type StudyRun, isCategorical } from "./study";
import { constraintDefinitions, constraintLabel } from "./study-constraints";
import { csvCell, download } from "./files";
import { displayValue, type Brush, type PlotPoint } from "./study-plot";
import StudyScatter from "./StudyScatter.vue";
import StudyParallel from "./StudyParallel.vue";

const props = defineProps<{ study: Study; run: StudyRun; dataset?: Dataset }>();
const view = ref<"pareto" | "parallel" | "table">("pareto");
const suboptimal = ref(false),
  samples = ref(false),
  floating = ref(false);
const baseSelection = ref<Set<string>>();
const brushes = ref<Record<string, Brush | undefined>>({});
const selectedOnly = ref(true);
const page = ref(0);
const candidateFilter = ref<"feasible" | "violated" | "unevaluable">(
  "feasible",
);
const inspected = ref("");
const candidate = computed(() =>
  props.run.designs.find((d) => d.id === inspected.value),
);
const definitions = computed(() => constraintDefinitions(props.study));
const variableName = (id: string) =>
  props.study.snapshot.variables.find((v) => v.id === id)?.label ?? id;
function requirement(id: string) {
  const rule = definitions.value.find((rule) => rule.id === id);
  return rule ? constraintLabel(props.study, rule) : id;
}
const predictedIds = computed(
  () => new Set(props.run.validation.map((v) => v.id)),
);
const pageSize = 30;
const floatPosition = ref<{ left: number; top: number }>();
const wrapper = ref<HTMLElement>();
let move: { x: number; y: number } | undefined;
const variables = computed(() =>
  props.study.snapshot.variables.filter((v) => {
    const node = props.study.nodes[v.id];
    return (
      ["input", "fixed"].includes(node.role) || predictedIds.value.has(v.id)
    );
  }),
);
const axes = computed(() =>
  variables.value.map((v) => ({
    id: v.id,
    label: v.label,
    categories: isCategorical(v) ? v.states : undefined,
  })),
);
const objectives = computed(() =>
  axes.value.filter(
    (a) =>
      props.study.nodes[a.id].role === "response" &&
      props.study.nodes[a.id].objective,
  ),
);
const paretoX = computed(() =>
  props.study.snapshot.example === "cantilever"
    ? (objectives.value.find(
        (a) =>
          props.study.snapshot.variables.find((v) => v.id === a.id)
            ?.columnId === "c7",
      ) ?? objectives.value[0])
    : objectives.value[0],
);
const paretoY = computed(
  () =>
    objectives.value.find((a) => a.id !== paretoX.value.id) ?? paretoX.value,
);
const margins = computed(() =>
  definitions.value
    .filter((rule) => rule.kind === "numeric")
    .map((rule) => ({
      id: rule.id,
      label: constraintLabel(props.study, rule),
    })),
);
const feasible = computed(() =>
  props.run.designs.filter((d) => d.predicted.feasible),
);
const frontCount = computed(
  () => feasible.value.filter((d) => d.predicted.pareto).length,
);
const plotted = computed(() =>
  feasible.value.filter((d) => suboptimal.value || d.predicted.pareto),
);
const valuesById = computed(
  () =>
    new Map(
      feasible.value.map((d) => [
        d.id,
        { ...d.inputs, ...d.predicted.outputs },
      ]),
    ),
);
const observed = computed<PlotPoint[]>(() => {
  if (
    !samples.value ||
    !props.dataset ||
    props.dataset.hash !== props.study.sourceHash
  )
    return [];
  const { rows } = props.dataset;
  const stride = Math.max(1, Math.ceil(rows.length / 2000));
  const tokens = new Set(["", ...props.study.snapshot.missingTokens]);
  const result: PlotPoint[] = [];
  for (let i = 0; i < rows.length; i += stride) {
    const values: Record<string, StudyValue> = {};
    for (const v of variables.value) {
      if (!v.columnId) continue;
      const raw = rows[i][Number(v.columnId.slice(1))];
      if (raw === undefined || tokens.has(raw)) continue;
      if (isCategorical(v)) values[v.id] = raw;
      else if (Number.isFinite(Number(raw))) values[v.id] = Number(raw);
    }
    result.push({ id: "sample-" + (i + 1), values, observed: true });
  }
  return result;
});
const points = computed<PlotPoint[]>(() => [
  ...observed.value,
  ...plotted.value.map((d) => ({
    id: d.id,
    values: valuesById.value.get(d.id)!,
    pareto: d.predicted.pareto,
  })),
]);
const highlight = computed(
  () => !!baseSelection.value || Object.keys(brushes.value).length > 0,
);
const selection = computed(() => {
  const filters = Object.entries(brushes.value);
  return new Set(
    plotted.value
      .filter((d) => {
        if (baseSelection.value && !baseSelection.value.has(d.id)) return false;
        const values = valuesById.value.get(d.id)!;
        return filters.every(([id, brush]) => {
          if (!brush) return true;
          const value = values[id];
          return Array.isArray(brush)
            ? brush.includes(String(value))
            : typeof value === "number" &&
                value >= brush.min &&
                value <= brush.max;
        });
      })
      .map((d) => d.id),
  );
});
const table = computed(() =>
  candidateFilter.value !== "feasible"
    ? props.run.designs.filter(
        (d) => d.predicted.status.toLowerCase() === candidateFilter.value,
      )
    : plotted.value.filter(
        (d) => !selectedOnly.value || selection.value.has(d.id),
      ),
);
const shown = computed(() =>
  table.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
);

function select(ids: string[]) {
  baseSelection.value = new Set(ids);
  page.value = 0;
}
function brush(id: string, value?: Brush) {
  const next = { ...brushes.value };
  if (value) next[id] = value;
  else delete next[id];
  brushes.value = next;
  page.value = 0;
}
function clearSelection() {
  baseSelection.value = undefined;
  brushes.value = {};
  page.value = 0;
}
function exportSelection() {
  const headers = [
    "Design",
    "Region",
    "Evaluation",
    "Pareto",
    ...axes.value.map((a) => a.label),
    ...margins.value.map((a) => a.label + " margin"),
  ];
  const selected = plotted.value.filter((d) => selection.value.has(d.id));
  const rows = selected.map((d) => [
    d.id,
    d.region + 1,
    "predicted",
    d.predicted.pareto ? 1 : 0,
    ...axes.value.map((a) => valuesById.value.get(d.id)![a.id]),
    ...margins.value.map((a) => d.predicted.margins[a.id]),
  ]);
  download(
    "study-predicted-designs.csv",
    [headers, ...rows]
      .map((row) => row.map((v) => csvCell(v ?? "")).join(","))
      .join("\r\n"),
    "text/csv",
  );
}
function dragStart(event: PointerEvent) {
  if (event.button !== 0) return;
  const grip = event.currentTarget as HTMLElement,
    panel = grip.closest<HTMLElement>(".floating-study-scatter")!;
  const bounds = panel.getBoundingClientRect();
  move = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  grip.setPointerCapture(event.pointerId);
}
function dragMove(event: PointerEvent) {
  if (!move || !wrapper.value) return;
  const parent = wrapper.value.getBoundingClientRect();
  const panel = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    ".floating-study-scatter",
  )!;
  floatPosition.value = {
    left: Math.max(
      0,
      Math.min(
        parent.width - Math.min(110, panel.offsetWidth),
        event.clientX - parent.left - move.x,
      ),
    ),
    top: Math.max(
      0,
      Math.min(parent.height - 40, event.clientY - parent.top - move.y),
    ),
  };
}
</script>

<template>
  <section class="study-explore">
    <div class="study-toolbar study-explore-header">
      <div class="view-switch" role="group" aria-label="Study results view">
        <button :aria-pressed="view === 'pareto'" @click="view = 'pareto'">
          Pareto
        </button>
        <button :aria-pressed="view === 'parallel'" @click="view = 'parallel'">
          Parallel coordinates
        </button>
        <button
          :aria-pressed="view === 'table'"
          @click="
            view = 'table';
            page = 0;
          "
        >
          Design table
        </button>
      </div>
      <span>Surrogate predictions</span>
      <label class="check"
        ><input
          type="checkbox"
          v-model="suboptimal"
          @change="page = 0"
        />Feasible suboptimal designs</label
      >
      <label class="check"
        ><input type="checkbox" v-model="samples" :disabled="!dataset" />Sampled
        data overlay</label
      >
      <button
        v-if="view === 'parallel'"
        :aria-pressed="floating"
        @click="floating = !floating"
      >
        Floating scatter plot
      </button>
    </div>
    <div class="study-toolbar study-selection">
      <span role="status"
        >{{ selection.size.toLocaleString() }} selected ·
        {{ frontCount.toLocaleString() }} on front ·
        {{ feasible.length.toLocaleString() }} feasible</span
      >
      <button
        :disabled="!Object.keys(brushes).length"
        @click="
          brushes = {};
          page = 0;
        "
      >
        Clear brushes
      </button>
      <button :disabled="!highlight" @click="clearSelection">
        Clear selection
      </button>
      <button :disabled="!selection.size" @click="exportSelection">
        Export selected CSV
      </button>
    </div>
    <p v-if="run.summary" class="tiny muted">
      Predicted search results · {{ run.summary.feasible }} feasible ·
      {{ run.summary.violated }} violated ·
      {{ run.summary.unevaluable }} unevaluable
    </p>
    <p v-if="!feasible.length" class="study-empty">
      The search found no predicted feasible designs in these regions.
    </p>
    <p v-if="samples" class="tiny muted">
      Sampled rows appear in grey. {{ observed.length.toLocaleString() }} rows
      displayed.
    </p>
    <StudyScatter
      v-show="view === 'pareto'"
      label="Pareto"
      :axes="objectives"
      :points="points"
      :default-x="paretoX.id"
      :default-y="paretoY.id"
      :selected="selection"
      :highlight="highlight"
      @select="select"
    />
    <div
      v-show="view === 'parallel'"
      ref="wrapper"
      class="study-parallel-frame"
    >
      <StudyParallel
        :axes="axes"
        :points="points"
        :selected="selection"
        :highlight="highlight"
        :brushes="brushes"
        @brush="brush"
        @select="select"
      />
      <section
        v-show="floating"
        class="floating-study-scatter"
        aria-label="Floating scatter plot"
        :style="
          floatPosition
            ? {
                left: floatPosition.left + 'px',
                top: floatPosition.top + 'px',
                right: 'auto',
              }
            : undefined
        "
      >
        <header>
          <span
            class="scatter-drag-grip"
            @pointerdown="dragStart"
            @pointermove="dragMove"
            @pointerup="move = undefined"
            @pointercancel="move = undefined"
            >Scatter plot</span
          >
          <button aria-label="Close scatter plot" @click="floating = false">
            ×
          </button>
        </header>
        <StudyScatter
          label="Study scatter"
          :axes="axes"
          :points="points"
          :default-x="axes[0].id"
          :default-y="(objectives[1] ?? objectives[0]).id"
          :selected="selection"
          :highlight="highlight"
          @select="select"
        />
      </section>
    </div>
    <section v-if="view === 'table'" aria-label="Design table">
      <div class="study-toolbar">
        <label class="field"
          >Candidate status
          <select
            v-model="candidateFilter"
            @change="
              page = 0;
              inspected = '';
            "
          >
            <option value="feasible">Feasible</option>
            <option value="violated">Violated</option>
            <option value="unevaluable">Unevaluable</option>
          </select>
        </label>
        <label v-if="candidateFilter === 'feasible'" class="check"
          ><input
            type="checkbox"
            v-model="selectedOnly"
            @change="page = 0"
          />Selected designs only</label
        >
        <button :disabled="page === 0" @click="page--">Previous</button>
        <span
          >{{ table.length ? page * pageSize + 1 : 0 }}–{{
            Math.min((page + 1) * pageSize, table.length)
          }}
          of {{ table.length }}</span
        >
        <button
          :disabled="(page + 1) * pageSize >= table.length"
          @click="page++"
        >
          Next
        </button>
      </div>
      <div class="study-table">
        <table>
          <thead>
            <tr>
              <th>Design</th>
              <th>Region</th>
              <th>Evaluation</th>
              <th v-for="axis in axes" :key="axis.id">{{ axis.label }}</th>
              <th v-for="axis in margins" :key="axis.id">
                {{ axis.label }} margin
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in shown"
              :key="d.id"
              :class="{
                'study-row-selected': highlight && selection.has(d.id),
              }"
            >
              <th scope="row">
                <button
                  @click="
                    inspected = d.id;
                    if (d.predicted.feasible) select([d.id]);
                  "
                >
                  {{ d.id }}
                </button>
              </th>
              <td>{{ d.region + 1 }}</td>
              <td>
                Predicted ·
                {{ d.predicted.pareto ? "Pareto" : d.predicted.status }}
              </td>
              <td v-for="axis in axes" :key="axis.id">
                {{ d.predicted.outputs[axis.id] ?? d.inputs[axis.id] ?? "—" }}
              </td>
              <td
                v-for="axis in margins"
                :key="axis.id"
                :title="String(d.predicted.margins[axis.id])"
              >
                {{ displayValue(d.predicted.margins[axis.id]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section
        v-if="candidate"
        class="study-candidate-detail"
        aria-label="Predicted candidate detail"
      >
        <h3>Predicted candidate {{ candidate.id }}</h3>
        <p v-if="candidate.predicted.reason">
          {{ candidate.predicted.reason }}
        </p>
        <dl>
          <template
            v-for="(value, id) in candidate.predicted.outputs"
            :key="id"
          >
            <dt>{{ variableName(id) }}</dt>
            <dd>
              {{ displayValue(value) }}
              <template
                v-if="candidate.predicted.uncertainty?.[id] !== undefined"
              >
                · standard deviation
                {{ displayValue(candidate.predicted.uncertainty[id]) }} ·
                nominal 95% interval
                {{
                  displayValue(
                    Number(value) - 1.96 * candidate.predicted.uncertainty[id],
                  )
                }}
                to
                {{
                  displayValue(
                    Number(value) + 1.96 * candidate.predicted.uncertainty[id],
                  )
                }}, conditional on supplied parent values
              </template>
            </dd>
          </template>
        </dl>
        <div class="study-table">
          <table>
            <thead>
              <tr>
                <th>Constraint / limit</th>
                <th>Candidate values</th>
                <th>Status</th>
                <th>Signed margin</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="outcome in candidate.predicted.outcomes"
                :key="outcome.id"
              >
                <th scope="row">{{ requirement(outcome.id) }}</th>
                <td>
                  {{
                    Object.entries(outcome.values)
                      .map(([id, value]) => variableName(id) + ": " + value)
                      .join(", ") || "—"
                  }}
                </td>
                <td>
                  {{ outcome.status }}
                  <div v-if="outcome.reason" class="tiny muted">
                    {{ outcome.reason }}
                  </div>
                </td>
                <td>{{ outcome.margin ?? "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </section>
</template>
