<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  axisScale,
  displayValue,
  fitCanvas,
  plotPosition,
  type Brush,
  type PlotAxis,
  type PlotPoint,
} from "./study-plot";

const props = defineProps<{
  axes: PlotAxis[];
  points: PlotPoint[];
  selected: ReadonlySet<string>;
  highlight: boolean;
  brushes: Record<string, Brush | undefined>;
}>();
const emit = defineEmits<{
  brush: [id: string, value?: Brush];
  select: [ids: string[]];
}>();
const canvas = ref<HTMLCanvasElement>();
const inspect = ref(props.axes[0]?.id ?? "");
const axis = computed(() => props.axes.find((a) => a.id === inspect.value));
const scales = computed(() =>
  props.axes.map((a) => axisScale(a, props.points)),
);
const minWidth = computed(() => Math.max(580, props.axes.length * 105));
const currentBrush = computed(() => props.brushes[inspect.value]);
let observer: ResizeObserver,
  frame = 0;
let geometry = { x: [] as number[], top: 25, bottom: 300 };
let drag:
  | {
      axis: number;
      start: number;
      original?: { min: number; max: number };
      moved: boolean;
      y: number;
    }
  | undefined;
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}
function draw() {
  if (!canvas.value) return;
  const { ctx, width, height } = fitCanvas(canvas.value);
  const top = 48,
    bottom = height - 28;
  const x = props.axes.map((_, i) =>
    props.axes.length === 1
      ? width / 2
      : 66 + ((width - 132) * i) / (props.axes.length - 1),
  );
  geometry = { x, top, bottom };
  const y = (p: number) => bottom - p * (bottom - top);
  for (const layer of [0, 1]) {
    // Batch paths by colour for responsive pointer-driven brushing.
    ctx.beginPath();
    for (const point of props.points) {
      const selected = props.highlight && props.selected.has(point.id);
      if (Number(selected) !== layer) continue;
      let previous = false;
      for (const [i, axis] of props.axes.entries()) {
        const location = y(scales.value[i].project(point.values[axis.id]));
        if (!Number.isFinite(location)) {
          previous = false;
          continue;
        }
        if (previous) ctx.lineTo(x[i], location);
        else {
          ctx.moveTo(x[i], location);
          if (x.length === 1) ctx.lineTo(x[i] + 1, location);
        }
        previous = true;
      }
    }
    ctx.strokeStyle = layer
      ? "#bd4b187a"
      : props.highlight
        ? "#9db1bb36"
        : "#167d7759";
    ctx.stroke();
  }
  for (const [i, axis] of props.axes.entries()) {
    const scale = scales.value[i],
      brush = props.brushes[axis.id];
    ctx.strokeStyle = "#537282";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x[i], top);
    ctx.lineTo(x[i], bottom);
    ctx.stroke();
    if (brush && !Array.isArray(brush)) {
      const start = y(scale.project(brush.max)),
        end = y(scale.project(brush.min));
      ctx.fillStyle = "#cf642a45";
      ctx.fillRect(x[i] - 9, start, 18, Math.max(2, end - start));
      ctx.strokeStyle = "#ad4a17";
      ctx.strokeRect(x[i] - 9, start, 18, Math.max(2, end - start));
    }
    ctx.fillStyle = "#243e50";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(axis.label, x[i], 24, 100);
    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    for (const value of scale.ticks) {
      const at = y(scale.project(value));
      ctx.fillStyle =
        Array.isArray(brush) && brush.includes(String(value))
          ? "#ad4a17"
          : "#405b6d";
      ctx.fillText(displayValue(value), x[i] + 7, at + 4, 52);
    }
  }
}
function valueAt(index: number, y: number) {
  const limits = scales.value[index].limits!;
  const p = Math.max(
    0,
    Math.min(1, (geometry.bottom - y) / (geometry.bottom - geometry.top)),
  );
  return limits.min + (limits.max - limits.min) * p;
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  const point = plotPosition(canvas.value!, event);
  const i = geometry.x.findIndex((x) => Math.abs(x - point.x) <= 18);
  if (i < 0 || point.y < geometry.top - 6 || point.y > geometry.bottom + 6)
    return;
  const id = props.axes[i].id;
  inspect.value = id;
  if (!scales.value[i].limits) return;
  const start = valueAt(i, point.y);
  const brush = props.brushes[id];
  const original =
    brush && !Array.isArray(brush) && start >= brush.min && start <= brush.max
      ? { ...brush }
      : undefined;
  drag = { axis: i, start, original, moved: false, y: point.y };
  canvas.value!.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!drag) return;
  const y = plotPosition(canvas.value!, event).y;
  if (!drag.moved && Math.abs(drag.y - y) < 2) return;
  drag.moved = true;
  const position = valueAt(drag.axis, y),
    id = props.axes[drag.axis].id;
  if (!drag.original) {
    emit("brush", id, {
      min: Math.min(drag.start, position),
      max: Math.max(drag.start, position),
    });
    return;
  }
  const { min, max } = drag.original;
  const limits = scales.value[drag.axis].limits!;
  const shift = Math.max(
    limits.min - min,
    Math.min(limits.max - max, position - drag.start),
  );
  emit("brush", id, { min: min + shift, max: max + shift });
}
function up(event: PointerEvent) {
  if (drag) {
    move(event);
    drag = undefined;
    return;
  }
  const { x, y } = plotPosition(canvas.value!, event);
  const right = geometry.x.findIndex((at) => at > x);
  if (right < 1 || y < geometry.top || y > geometry.bottom) return;
  const left = right - 1,
    fraction = (x - geometry.x[left]) / (geometry.x[right] - geometry.x[left]);
  let nearest: PlotPoint | undefined,
    gap = 5;
  for (const point of props.points) {
    if (point.observed) continue;
    const a = scales.value[left].project(point.values[props.axes[left].id]);
    const b = scales.value[right].project(point.values[props.axes[right].id]);
    const lineY =
      geometry.bottom -
      (a * (1 - fraction) + b * fraction) * (geometry.bottom - geometry.top);
    const distance = Math.abs(lineY - y);
    if (distance < gap) {
      nearest = point;
      gap = distance;
    }
  }
  if (nearest) emit("select", [nearest.id]);
}
function brushCategory(value: string, checked: boolean) {
  const active = Array.isArray(currentBrush.value) ? currentBrush.value : [];
  const values = checked
    ? [...active, value]
    : active.filter((x) => x !== value);
  emit("brush", inspect.value, values.length ? values : undefined);
}
function setBound(kind: "min" | "max", event: Event) {
  const input = event.target as HTMLInputElement;
  const limits =
    scales.value[props.axes.findIndex((a) => a.id === inspect.value)].limits!;
  const brush =
    currentBrush.value && !Array.isArray(currentBrush.value)
      ? currentBrush.value
      : limits;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    emit("brush", inspect.value, undefined);
    return;
  }
  const next = {
    ...brush,
    [kind]: Math.max(limits.min, Math.min(limits.max, value)),
  };
  if (next.min <= next.max) emit("brush", inspect.value, next);
  else input.value = String(brush[kind]);
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
  [
    () => props.points,
    () => props.selected,
    () => props.brushes,
    () => props.highlight,
  ],
  schedule,
);
</script>

<template>
  <section class="study-parallel" aria-label="Parallel coordinates">
    <div class="study-toolbar">
      <label
        >Brush axis
        <select v-model="inspect">
          <option v-for="item in axes" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select></label
      >
      <div
        v-if="axis?.categories"
        class="study-toolbar study-category-brush"
        aria-label="Category brush"
      >
        <label
          v-for="category in axis.categories"
          :key="category"
          class="check"
        >
          <input
            type="checkbox"
            :checked="
              Array.isArray(currentBrush) && currentBrush.includes(category)
            "
            @change="
              brushCategory(
                category,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />{{ category }}
        </label>
      </div>
      <template v-else>
        <label
          >Brush minimum
          <input
            type="number"
            step="any"
            :value="
              currentBrush && !Array.isArray(currentBrush)
                ? currentBrush.min
                : ''
            "
            @change="setBound('min', $event)"
        /></label>
        <label
          >Brush maximum
          <input
            type="number"
            step="any"
            :value="
              currentBrush && !Array.isArray(currentBrush)
                ? currentBrush.max
                : ''
            "
            @change="setBound('max', $event)"
        /></label>
      </template>
      <button
        :disabled="!currentBrush"
        @click="emit('brush', inspect, undefined)"
      >
        Clear axis brush
      </button>
    </div>
    <div class="study-parallel-scroll">
      <canvas
        ref="canvas"
        aria-label="Parallel coordinates chart"
        :style="{ minWidth: minWidth + 'px' }"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="drag = undefined"
      />
    </div>
    <p class="study-chart-caption">
      Drag along an axis to brush. Drag inside the interval to move it.
    </p>
  </section>
</template>
