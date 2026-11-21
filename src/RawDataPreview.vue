<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Dataset } from "./domain";

const props = defineProps<{ dataset: Dataset; preview?: boolean }>();

const viewport = ref<HTMLDivElement>();
const scrollTop = ref(0);
const viewportHeight = ref(0);
const range = ref(0);
const rowHeight = 32;
const overscan = 6;
// Keep the scroll height within browser limits even for million-row CSVs.
const rowsPerRange = 100_000;
const rowCount = computed(() => props.dataset.rows.length);
const rangeCount = computed(() => Math.ceil(rowCount.value / rowsPerRange));
const rangeStart = computed(() => range.value * rowsPerRange);
const rangeLength = computed(() =>
  Math.min(rowsPerRange, rowCount.value - rangeStart.value),
);
const first = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscan),
);
const end = computed(() =>
  Math.min(
    rangeLength.value,
    first.value + Math.ceil(viewportHeight.value / rowHeight) + 2 * overscan,
  ),
);
const visibleRows = computed(() =>
  props.dataset.rows.slice(
    rangeStart.value + first.value,
    rangeStart.value + end.value,
  ),
);

watch(viewport, (element, _, onCleanup) => {
  if (!element) return;
  const observer = new ResizeObserver(() => {
    viewportHeight.value = element.clientHeight;
  });
  observer.observe(element);
  onCleanup(() => observer.disconnect());
});

watch(
  () => [props.dataset.hash, props.preview],
  async () => {
    range.value = 0;
    await nextTick();
    scrollToTop();
    if (viewport.value)
      viewport.value.scrollLeft = props.preview
        ? viewport.value.scrollWidth
        : 0;
  },
);

function scrollToTop() {
  scrollTop.value = 0;
  if (viewport.value) viewport.value.scrollTop = 0;
}
function selectRange(event: Event) {
  range.value = Number((event.target as HTMLSelectElement).value);
  scrollToTop();
}
</script>
<template>
  <label v-if="rangeCount > 1" class="raw-data-range">
    Row range
    <select :value="range" @change="selectRange">
      <option v-for="n in rangeCount" :key="n" :value="n - 1">
        {{ ((n - 1) * rowsPerRange + 1).toLocaleString() }}–{{
          Math.min(n * rowsPerRange, rowCount).toLocaleString()
        }}
      </option>
    </select>
  </label>
  <div
    ref="viewport"
    class="raw-data-table"
    role="region"
    aria-label="Preview rows"
    tabindex="0"
    @scroll="scrollTop = ($event.target as HTMLDivElement).scrollTop"
  >
    <table
      :aria-rowcount="rowCount + 1"
      :style="{
        '--raw-columns': dataset.headers.length,
        '--raw-row-height': rowHeight + 'px',
      }"
    >
      <thead>
        <tr aria-rowindex="1">
          <th
            v-for="(header, i) in dataset.headers"
            :key="header"
            scope="col"
            :title="header"
            :class="{
              'data-preview-column':
                preview && i === dataset.headers.length - 1,
            }"
          >
            {{ header }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="first" class="raw-data-spacer" aria-hidden="true">
          <td
            :colspan="dataset.headers.length"
            :style="{ height: first * rowHeight + 'px' }"
          ></td>
        </tr>
        <tr
          v-for="(row, i) in visibleRows ?? []"
          :key="rangeStart + first + i"
          :aria-rowindex="rangeStart + first + i + 2"
          :class="{ 'raw-data-even': (rangeStart + first + i) % 2 === 1 }"
        >
          <td
            v-for="(cell, j) in row"
            :key="j"
            :title="cell"
            :class="{
              'data-preview-column':
                preview && j === dataset.headers.length - 1,
            }"
          >
            {{ cell }}
          </td>
        </tr>
        <tr v-if="end < rangeLength" class="raw-data-spacer" aria-hidden="true">
          <td
            :colspan="dataset.headers.length"
            :style="{ height: (rangeLength - end) * rowHeight + 'px' }"
          ></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
