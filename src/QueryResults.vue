<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { stateLabel, type Project } from "./domain";
import type { JointResult } from "./engine";
const props = defineProps<{
  project: Project;
  result: JointResult;
  current: boolean;
}>();
const presentation = ref<"diagram" | "table">("diagram");
const rowAxis = ref(0),
  columnAxis = ref(1);
const sliceStates = ref<number[]>([]);
const showValues = ref(false);
const selectedCell = ref({ row: 0, col: 0 });
const hoveredCell = ref<{ row: number; col: number }>();
const filters = ref<Record<string, string>>({}),
  page = ref(0),
  sort = ref("probability");
watch(
  () => props.result,
  () => {
    filters.value = {};
    rowAxis.value = 0;
    columnAxis.value = 1;
    sliceStates.value = props.result.shape.map(() => 0);
    selectedCell.value = { row: 0, col: 0 };
    hoveredCell.value = undefined;
    page.value = 0;
  },
  { immediate: true },
);
watch([filters, sort], () => (page.value = 0), { deep: true });
const variables = computed(() =>
  props.result.targetIds.map((id) =>
    props.project.variables.find((v) => v.id === id)!,
  ),
);
const rows = computed(() =>
  props.result.posterior.map((probability, index) => {
    let rem = index;
    const states = Array(variables.value.length).fill(0);
    for (let i = states.length - 1; i >= 0; i--) {
      states[i] = rem % props.result.shape[i];
      rem = Math.floor(rem / props.result.shape[i]);
    }
    return { index, states, probability, prior: props.result.prior[index] };
  }),
);
const filtered = computed(() =>
  rows.value.filter((row) =>
    variables.value.every(
      (v, i) =>
        !filters.value[v.id] || Number(filters.value[v.id]) === row.states[i],
    ),
  ),
);
const ordered = computed(() =>
  [...filtered.value].sort(
    sort.value === "probability"
      ? (a, b) => b.probability - a.probability || a.index - b.index
      : (a, b) => a.index - b.index,
  ),
);
const visible = computed(() =>
  ordered.value.slice(page.value * 50, (page.value + 1) * 50),
);
const mass = computed(() =>
  filtered.value.reduce((sum, r) => sum + r.probability, 0),
);
const max = computed(() =>
  props.result.posterior.reduce((peak, p) => Math.max(peak, p), 0),
);
function percent(p: number) {
  const value = p * 100;
  return (
    (value > 0 && value < 0.001 ? value.toPrecision(3) : value.toFixed(3)) + "%"
  );
}
const rowVariable = computed(() => variables.value[rowAxis.value]);
const columnVariable = computed(() => variables.value[columnAxis.value]);
const sliceAxes = computed(() =>
  variables.value
    .map((v, index) => ({ v, index }))
    .filter(
      ({ index }) => index !== rowAxis.value && index !== columnAxis.value,
    ),
);
function setAxis(axis: "row" | "column", index: number) {
  if (axis === "row") {
    if (index === columnAxis.value) columnAxis.value = rowAxis.value;
    rowAxis.value = index;
  } else {
    if (index === rowAxis.value) rowAxis.value = columnAxis.value;
    columnAxis.value = index;
  }
  selectedCell.value = { row: 0, col: 0 };
  hoveredCell.value = undefined;
}
function cell(row: number, col: number) {
  const index = props.result.shape.reduce(
    (offset, size, axis) =>
      offset * size +
      (axis === rowAxis.value
        ? row
        : axis === columnAxis.value
          ? col
          : sliceStates.value[axis]),
    0,
  );
  return props.result.posterior[index];
}
function cellDescription(row: number, col: number) {
  return (
    rowVariable.value.label +
    ": " +
    stateLabel(rowVariable.value, row) +
    " · " +
    columnVariable.value.label +
    ": " +
    stateLabel(columnVariable.value, col) +
    " · " +
    percent(cell(row, col))
  );
}
const inspectedCell = computed(() => hoveredCell.value ?? selectedCell.value);
function cellKeys(event: KeyboardEvent, row: number, col: number) {
  if (event.key === "ArrowUp") row--;
  else if (event.key === "ArrowDown") row++;
  else if (event.key === "ArrowLeft") col--;
  else if (event.key === "ArrowRight") col++;
  else return;
  event.preventDefault();
  row = Math.max(0, Math.min(rowVariable.value.states.length - 1, row));
  col = Math.max(0, Math.min(columnVariable.value.states.length - 1, col));
  const table = (event.currentTarget as HTMLElement).closest("table");
  table
    ?.querySelector<HTMLElement>('[data-cell="' + row + "-" + col + '"]')
    ?.focus();
}
function heatText(p: number) {
  const alpha = max.value ? 0.07 + (0.8 * p) / max.value : 0.07;
  const rgb = [20, 106, 105].map((c) => {
    const x = (255 * (1 - alpha) + c * alpha) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179
    ? "#000"
    : "#fff";
}
function color(p: number) {
  return `rgba(20,106,105,${max.value ? 0.07 + (0.8 * p) / max.value : 0.07})`;
}
</script>
<template>
  <div class="query-result" :class="{ 'stale-results': !current }">
    <p v-if="!current" class="outdated-label">
      Outdated results — run inference again
    </p>
    <div class="view-switch" role="group" aria-label="Query presentation">
      <button
        :aria-pressed="presentation === 'diagram'"
        @click="presentation = 'diagram'"
      >
        Diagram
      </button>
      <button
        :aria-pressed="presentation === 'table'"
        @click="presentation = 'table'"
      >
        Table
      </button>
    </div>
    <template v-if="variables.length === 1">
      <div v-if="presentation === 'diagram'" class="chart-legend">
        <span class="prior-key"></span>Prior
        <span class="posterior-key"></span>Posterior
      </div>
      <table class="marginal-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Prior</th>
            <th>Posterior</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.index">
            <th>{{ stateLabel(variables[0], row.states[0]) }}</th>
            <td>
              <div
                v-if="presentation === 'diagram'"
                class="prob-bar prior"
                :style="{ width: `${row.prior * 100}%` }"
              ></div>
              {{ percent(row.prior) }}
            </td>
            <td>
              <div
                v-if="presentation === 'diagram'"
                class="prob-bar posterior"
                :style="{ width: `${row.probability * 100}%` }"
              ></div>
              {{ percent(row.probability) }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <template v-else-if="presentation === 'diagram'">
      <div class="heatmap-toolbar">
        <template v-if="variables.length > 2">
          <label
            >Rows
            <select
              :value="rowAxis"
              @change="
                setAxis(
                  'row',
                  Number(($event.target as HTMLSelectElement).value),
                )
              "
            >
              <option v-for="(v, i) in variables" :key="v.id" :value="i">
                {{ v.label }}
              </option>
            </select>
          </label>
          <label
            >Columns
            <select
              :value="columnAxis"
              @change="
                setAxis(
                  'column',
                  Number(($event.target as HTMLSelectElement).value),
                )
              "
            >
              <option v-for="(v, i) in variables" :key="v.id" :value="i">
                {{ v.label }}
              </option>
            </select>
          </label>
          <label v-for="{ v, index } in sliceAxes" :key="v.id"
            >{{ v.label }}
            <select v-model.number="sliceStates[index]">
              <option v-for="(_, i) in v.states" :key="i" :value="i">
                {{ stateLabel(v, i) }}
              </option>
            </select>
          </label>
        </template>
        <label class="check"
          ><input type="checkbox" v-model="showValues" />Show values</label
        >
        <div class="heatmap-scale" aria-label="Joint probability scale">
          <span>0%</span><span class="heatmap-gradient"></span
          ><span>{{ percent(max) }}</span>
        </div>
      </div>
      <p v-if="sliceAxes.length" class="tiny muted">
        This slice shows joint probabilities on the scale of the full
        distribution.
      </p>
      <div class="heatmap-scroll" @mouseleave="hoveredCell = undefined">
        <table
          class="joint-heatmap"
          :style="{ '--heatmap-columns': columnVariable.states.length }"
        >
          <caption>
            Joint probability ·
            {{
              rowVariable.label
            }}
            by
            {{
              columnVariable.label
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span :title="rowVariable.label + ' / ' + columnVariable.label">
                  {{ rowVariable.label }} / {{ columnVariable.label }}
                </span>
              </th>
              <th v-for="(_, j) in columnVariable.states" :key="j" scope="col">
                <span :title="stateLabel(columnVariable, j)">{{
                  stateLabel(columnVariable, j)
                }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(_, i) in rowVariable.states" :key="i">
              <th scope="row">
                <span :title="stateLabel(rowVariable, i)">{{
                  stateLabel(rowVariable, i)
                }}</span>
              </th>
              <td v-for="(_, j) in columnVariable.states" :key="j">
                <button
                  :data-cell="i + '-' + j"
                  :aria-label="cellDescription(i, j)"
                  :title="String(cell(i, j))"
                  :aria-pressed="
                    selectedCell.row === i && selectedCell.col === j
                  "
                  :tabindex="
                    selectedCell.row === i && selectedCell.col === j ? 0 : -1
                  "
                  :style="{
                    background: color(cell(i, j)),
                    color: heatText(cell(i, j)),
                  }"
                  @mouseenter="hoveredCell = { row: i, col: j }"
                  @focus="
                    selectedCell = { row: i, col: j };
                    hoveredCell = undefined;
                  "
                  @click="selectedCell = { row: i, col: j }"
                  @keydown="cellKeys($event, i, j)"
                >
                  {{ showValues ? percent(cell(i, j)) : "" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="heatmap-detail">
        {{ cellDescription(inspectedCell.row, inspectedCell.col) }}
      </p>
    </template>
    <template v-if="variables.length > 1 && presentation === 'table'">
      <fieldset v-if="variables.length >= 3" class="combination-filters">
        <legend>Filter combinations</legend>
        <label v-for="v in variables" :key="v.id" class="field"
          >{{ v.label
          }}<select v-model="filters[v.id]">
            <option value="">All states</option>
            <option v-for="(_, k) in v.states" :key="k" :value="String(k)">
              {{ stateLabel(v, k) }}
            </option>
          </select></label
        >
      </fieldset>
      <div class="table-controls">
        <label
          >Sort combinations<select v-model="sort">
            <option value="probability">Posterior, highest first</option>
            <option value="state">State order</option>
          </select></label
        ><span
          >Displayed probability mass: {{ percent(mass) }} ·
          {{ filtered.length }} combinations</span
        >
      </div>
      <div class="joint-table-scroll">
        <table class="combination-table">
          <caption>
            Joint distribution table
          </caption>
          <thead>
            <tr>
              <th v-for="v in variables" :key="v.id" scope="col">
                {{ v.label }}
              </th>
              <th>Prior</th>
              <th>Posterior</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visible" :key="row.index">
              <th v-for="(v, i) in variables" :key="v.id">
                {{ stateLabel(v, row.states[i]) }}
              </th>
              <td>{{ percent(row.prior) }}</td>
              <td :title="String(row.probability)">
                {{ percent(row.probability) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button @click="page--" :disabled="page === 0">Previous</button
        ><span
          >Page {{ page + 1 }} of
          {{ Math.max(1, Math.ceil(filtered.length / 50)) }}</span
        ><button @click="page++" :disabled="(page + 1) * 50 >= filtered.length">
          Next
        </button>
      </div>
      <p v-if="variables.length >= 3" class="tiny muted">
        Filters do not renormalise probabilities. Exports include the full
        distribution.
      </p>
    </template>
  </div>
</template>
