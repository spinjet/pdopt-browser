<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  axisScale,
  displayValue,
  fitCanvas,
  plotPosition,
  type PlotAxis,
  type PlotPoint,
} from "./study-plot";
const props = defineProps<{
  label: string;
  axes: PlotAxis[];
  points: PlotPoint[];
  selected: ReadonlySet<string>;
  highlight: boolean;
  defaultX: string;
  defaultY: string;
}>();
const emit = defineEmits<{ select: [ids: string[]] }>();
const canvas = ref<HTMLCanvasElement>();
const xId = ref(props.defaultX),
  yId = ref(props.defaultY);
const xAxis = computed(
  () => props.axes.find((a) => a.id === xId.value) ?? props.axes[0],
);
const yAxis = computed(
  () => props.axes.find((a) => a.id === yId.value) ?? props.axes[0],
);
const scales = computed(
  () =>
    [
      axisScale(xAxis.value, props.points),
      axisScale(yAxis.value, props.points),
    ] as const,
);
let points: { x: number; y: number; point: PlotPoint }[] = [];
let frame = 0,
  observer: ResizeObserver;
let drag:
  | { start: { x: number; y: number }; end: { x: number; y: number } }
  | undefined;
const hovered = ref<PlotPoint>();
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}
function draw() {
  if (!canvas.value || !xAxis.value || !yAxis.value) return;
  const { ctx, width, height } = fitCanvas(canvas.value);
  const left = 76,
    right = width - 20,
    top = 18,
    bottom = height - 48;
  if (left >= right || top >= bottom) return;
  const [xs, ys] = scales.value;
  const px = (p: number) => left + p * (right - left);
  const py = (p: number) => bottom - p * (bottom - top);
  ctx.font = "11px system-ui";
  ctx.strokeStyle = "#dce6eb";
  ctx.fillStyle = "#3e5769";
  for (const value of xs.ticks) {
    const x = px(xs.project(value));
    if (!Number.isFinite(x)) continue;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(displayValue(value), x, bottom + 17, 75);
  }
  for (const value of ys.ticks) {
    const y = py(ys.project(value));
    if (!Number.isFinite(y)) continue;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(displayValue(value), left - 8, y + 4, 65);
  }
  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(xAxis.value.label, (left + right) / 2, height - 7, right - left);
  ctx.save();
  ctx.translate(14, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yAxis.value.label, 0, 0, bottom - top);
  ctx.restore();
  points = props.points.flatMap((point) => {
    const x = px(xs.project(point.values[xAxis.value.id]));
    const y = py(ys.project(point.values[yAxis.value.id]));
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y, point }] : [];
  });
  for (const layer of [0, 1]) {
    for (const { x, y, point } of points) {
      const selected = props.highlight && props.selected.has(point.id);
      if (Number(selected) !== layer) continue;
      ctx.fillStyle = selected
        ? "#bd4b18"
        : point.observed
          ? "#6980a350"
          : props.highlight
            ? "#14827b36"
            : point.pareto
              ? "#137c74e8"
              : "#5a8aa785";
      ctx.beginPath();
      ctx.arc(x, y, selected ? 4 : point.pareto ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (drag) {
    const { start, end } = drag;
    ctx.fillStyle = "#0c766623";
    ctx.strokeStyle = "#117c72";
    ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  }
  if (!points.length) {
    ctx.fillStyle = "#3e5769";
    ctx.fillText(
      "No designs for these axes",
      (left + right) / 2,
      (top + bottom) / 2,
    );
  }
}
function nearest(position: { x: number; y: number }) {
  let hit: PlotPoint | undefined,
    best = 64;
  for (const { x, y, point } of points) {
    if (point.observed) continue;
    const distance = (x - position.x) ** 2 + (y - position.y) ** 2;
    if (distance < best) {
      best = distance;
      hit = point;
    }
  }
  return hit;
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  const el = canvas.value!;
  el.setPointerCapture(event.pointerId);
  const at = plotPosition(el, event);
  drag = { start: at, end: at };
  schedule();
}
function move(event: PointerEvent) {
  const at = plotPosition(canvas.value!, event);
  if (!drag) {
    hovered.value = nearest(at);
    return;
  }
  drag.end = at;
  schedule();
}
function up(event: PointerEvent) {
  if (!drag) return;
  const { start } = drag;
  const end = plotPosition(canvas.value!, event);
  drag = undefined;
  if (Math.abs(start.x - end.x) < 4 && Math.abs(start.y - end.y) < 4) {
    const hit = nearest(end);
    if (hit) emit("select", [hit.id]);
  } else {
    const ids = points
      .filter(
        ({ x, y, point }) =>
          !point.observed &&
          x >= Math.min(start.x, end.x) &&
          x <= Math.max(start.x, end.x) &&
          y >= Math.min(start.y, end.y) &&
          y <= Math.max(start.y, end.y),
      )
      .map(({ point }) => point.id);
    emit("select", ids);
  }
  schedule();
}
onMounted(() => {
  observer = new ResizeObserver(schedule);
  observer.observe(canvas.value!);
  schedule();
});
onBeforeUnmount(() => {
  observer.disconnect();
  cancelAnimationFrame(frame);
});
watch(
  [() => props.points, () => props.selected, () => props.highlight, xId, yId],
  schedule,
);
</script>

<template>
  <section class="study-scatter" :aria-label="label">
    <div class="study-toolbar">
      <label
        >X axis
        <select v-model="xId">
          <option v-for="axis in axes" :key="axis.id" :value="axis.id">
            {{ axis.label }}
          </option>
        </select></label
      >
      <label
        >Y axis
        <select v-model="yId">
          <option v-for="axis in axes" :key="axis.id" :value="axis.id">
            {{ axis.label }}
          </option>
        </select></label
      >
    </div>
    <canvas
      ref="canvas"
      :aria-label="label + ' chart'"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointerleave="hovered = undefined"
      @pointercancel="
        drag = undefined;
        schedule();
      "
    />
    <p class="study-chart-caption">
      {{
        hovered
          ? hovered.id +
            " · " +
            displayValue(hovered.values[xId]) +
            " / " +
            displayValue(hovered.values[yId])
          : "Click a design or drag a box to select."
      }}
    </p>
  </section>
</template>
