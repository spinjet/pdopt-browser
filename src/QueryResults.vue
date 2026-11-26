<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { stateLabel, type Project } from "./domain";
import type { JointResult } from "./engine";
import QueryFigureExport from "./QueryFigureExport.vue";
import Papa from "papaparse";
import { download } from "./files";
import {
  heatmapColor,
  heatmapText,
  probabilityPercent,
  figurePalettes,
  type QueryFigureData,
} from "./query-figure";
const props = defineProps<{
  project: Project;
  result: JointResult;
  current: boolean;
  caption: string;
}>();
const emit = defineEmits<{
  palette: [NonNullable<Project["heatmapPalette"]>];
  digits: [number];
}>();
const palette = computed(() => props.project.heatmapPalette ?? "Blues");
const gradient = computed(
  () => `linear-gradient(to right, ${figurePalettes[palette.value].join(",")})`,
);
const digits = computed(() => props.project.significantDigits ?? 3);
const percent = (p: number) => probabilityPercent(p, digits.value);
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
function exportTable() {
  const columns =
    variables.value.length === 1
      ? ["State"]
      : variables.value.map((variable) => variable.label);
  const records = variables.value.length === 1 ? rows.value : ordered.value;
  const csv = Papa.unparse([
    [...columns, "Prior", "Posterior"],
    ...records.map((row) => [
      ...row.states.map((state, index) =>
        stateLabel(variables.value[index], state),
      ),
      row.prior,
      row.probability,
    ]),
  ]);
  download("pdopt-bn-query-table.csv", csv + "\r\n", "text/csv;charset=utf-8");
}
const mass = computed(() =>
  filtered.value.reduce((sum, r) => sum + r.probability, 0),
);
const max = computed(() =>
  props.result.posterior.reduce((peak, p) => Math.max(peak, p), 0),
);
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
const figure = computed<QueryFigureData>(() => {
  const labels = (v: Project["variables"][number]) =>
    v.states.map((_, index) => stateLabel(v, index));
  if (variables.value.length === 1) {
    const variable = variables.value[0];
    return {
      kind: "bars",
      axis: variable.label,
      states: labels(variable).map((label, index) => ({
        label,
        prior: props.result.prior[index],
        posterior: props.result.posterior[index],
      })),
    };
  }
  const rowLabels = labels(rowVariable.value);
  const columnLabels = labels(columnVariable.value);
  return {
    kind: "heatmap",
    rowAxis: rowVariable.value.label,
    columnAxis: columnVariable.value.label,
    rows: rowLabels,
    columns: columnLabels,
    probabilities: rowLabels.map((_, i) =>
      columnLabels.map((_, j) => cell(i, j)),
    ),
    max: max.value,
    showValues: showValues.value,
    slice: sliceAxes.value.map(({ v, index }) => ({
      id: v.id,
      label: `${v.label} = ${stateLabel(v, sliceStates.value[index])}`,
    })),
  };
});
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
      <QueryFigureExport
        v-if="presentation === 'diagram'"
        :data="figure"
        :caption="caption"
        :heatmap-palette="palette"
        :digits="digits"
      />
      <button v-else type="button" @click="exportTable">
        Export table CSV
      </button>
      <label class="result-inline digits-control"
        >Significant digits
        <input
          type="number"
          min="1"
          max="8"
          step="1"
          :value="digits"
          @change="
            (e) => {
              const input = e.target as HTMLInputElement;
              const value = input.valueAsNumber;
              if (Number.isInteger(value) && value >= 1 && value <= 8)
                emit('digits', value);
              else input.value = String(digits);
            }
          "
        />
      </label>
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
        <label
          >Heatmap palette
          <select
            :value="palette"
            @change="
              emit(
                'palette',
                ($event.target as HTMLSelectElement).value as typeof palette,
              )
            "
          >
            <option
              v-for="(_, name) in figurePalettes"
              :key="name"
              :value="name"
            >
              {{ name }}
            </option>
          </select>
        </label>
        <div class="heatmap-scale" aria-label="Joint probability scale">
          <span>0%</span
          ><span
            class="heatmap-gradient"
            :style="{ background: gradient }"
          ></span
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
                  :title="percent(cell(i, j))"
                  :aria-pressed="
                    selectedCell.row === i && selectedCell.col === j
                  "
                  :tabindex="
                    selectedCell.row === i && selectedCell.col === j ? 0 : -1
                  "
                  :style="{
                    background: heatmapColor(cell(i, j), max, palette),
                    color: heatmapText(cell(i, j), max, palette),
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
              <td :title="percent(row.probability)">
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
        Filters do not renormalise probabilities. The CSV includes every
        filtered row.
      </p>
    </template>
  </div>
</template>
