<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import Papa from "papaparse";
import type { StudyValue } from "./domain";
import { download } from "./files";
import StudyParallel from "./StudyParallel.vue";
import StudyScatter from "./StudyScatter.vue";
import {
  displayValue,
  type Brush,
  type PlotAxis,
  type PlotPoint,
} from "./study-plot";

const props = defineProps<{
  axes: PlotAxis[];
  rows: StudyValue[][];
  seed: number;
}>();
const view = ref<"scatter" | "parallel" | "table">("scatter");
const selectedIds = shallowRef<Set<string>>();
const brushes = ref<Record<string, Brush | undefined>>({});
const page = ref(0);
const pageSize = 50;
const singleAxis = { id: "draw-order", label: "Draw order" };
const scatterAxes = computed(() =>
  props.axes.length === 1 ? [...props.axes, singleAxis] : props.axes,
);
const points = computed<PlotPoint[]>(() =>
  props.rows.map((row, i) => ({
    id: String(i + 1),
    values: Object.fromEntries(
      scatterAxes.value.map((axis, j) => [
        axis.id,
        j < row.length ? row[j] : i + 1,
      ]),
    ),
  })),
);
const activeBrushes = computed(() => Object.entries(brushes.value));
const highlight = computed(
  () => selectedIds.value !== undefined || activeBrushes.value.length > 0,
);
const selected = computed(() =>
  points.value.filter((point) => {
    if (selectedIds.value && !selectedIds.value.has(point.id)) return false;
    return activeBrushes.value.every(([id, brush]) => {
      const value = point.values[id];
      if (!brush) return true;
      if (Array.isArray(brush)) return brush.includes(String(value));
      return (
        typeof value === "number" && value >= brush.min && value <= brush.max
      );
    });
  }),
);
const selection = computed(
  () => new Set(selected.value.map((point) => point.id)),
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(selected.value.length / pageSize)),
);
const visibleRows = computed(() =>
  selected.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
);

function select(ids: string[]) {
  selectedIds.value = new Set(ids);
  page.value = 0;
}
function brush(id: string, value?: Brush) {
  if (value) brushes.value[id] = value;
  else delete brushes.value[id];
  page.value = 0;
}
function clearBrushes() {
  brushes.value = {};
  page.value = 0;
}
function clearSelection() {
  selectedIds.value = undefined;
  clearBrushes();
}
function exportSelection() {
  const csv = Papa.unparse({
    fields: props.axes.map((axis) => axis.label),
    data: selected.value.map(({ values }) =>
      props.axes.map((axis) => values[axis.id]),
    ),
  });
  download("pdopt-bn-selected-samples.csv", csv, "text/csv;charset=utf-8");
}
</script>

<template>
  <section class="study-explore sample-explore" aria-label="Sample analytics">
    <div class="study-toolbar study-explore-header">
      <div class="view-switch" role="group" aria-label="Sample analytics view">
        <button :aria-pressed="view === 'scatter'" @click="view = 'scatter'">
          Scatter plot
        </button>
        <button
          v-if="axes.length > 1"
          :aria-pressed="view === 'parallel'"
          @click="view = 'parallel'"
        >
          Parallel coordinates
        </button>
        <button :aria-pressed="view === 'table'" @click="view = 'table'">
          Sample table
        </button>
      </div>
      <span role="status"
        >{{ selected.length.toLocaleString() }} of
        {{ points.length.toLocaleString() }} samples selected · Seed
        {{ seed }}</span
      >
      <button :disabled="!activeBrushes.length" @click="clearBrushes">
        Clear brushes
      </button>
      <button :disabled="!highlight" @click="clearSelection">
        Clear selection
      </button>
    </div>
    <StudyScatter
      v-show="view === 'scatter'"
      label="Query sample scatter"
      :axes="scatterAxes"
      :points="points"
      :selected="selection"
      :highlight="highlight"
      :default-x="scatterAxes[0].id"
      :default-y="scatterAxes[1].id"
      @select="select"
    />
    <StudyParallel
      v-if="axes.length > 1"
      v-show="view === 'parallel'"
      :axes="axes"
      :points="points"
      :selected="selection"
      :highlight="highlight"
      :brushes="brushes"
      @select="select"
      @brush="brush"
    />
    <section v-if="view === 'table'" aria-label="Sample table">
      <button :disabled="!selected.length" @click="exportSelection">
        Export selected CSV
      </button>
      <div class="study-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th v-for="axis in axes" :key="axis.id" scope="col">
                {{ axis.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="point in visibleRows" :key="point.id">
              <th scope="row">
                <button
                  @click="select([point.id])"
                  :aria-label="'Select sample ' + point.id"
                >
                  {{ point.id }}
                </button>
              </th>
              <td v-for="axis in axes" :key="axis.id">
                {{ displayValue(point.values[axis.id]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button :disabled="page === 0" @click="page--">Previous</button>
        <span>Page {{ page + 1 }} of {{ pageCount }}</span>
        <button :disabled="page + 1 >= pageCount" @click="page++">Next</button>
      </div>
    </section>
  </section>
</template>
