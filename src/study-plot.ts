import type { StudyValue } from "./domain";

export interface PlotAxis {
  id: string;
  label: string;
  categories?: string[];
}
export interface PlotPoint {
  id: string;
  values: Record<string, StudyValue>;
  pareto?: boolean;
  observed?: boolean;
}
export interface NumericBrush {
  min: number;
  max: number;
}
export type Brush = NumericBrush | string[];

export function axisScale(axis: PlotAxis, points: PlotPoint[]) {
  const cats = axis.categories;
  if (cats)
    return {
      project: (x: StudyValue) => {
        const i = cats.indexOf(String(x));
        return i < 0 ? NaN : cats.length < 2 ? 0.5 : i / (cats.length - 1);
      },
      ticks: (cats.length > 12
        ? cats.filter((_, i) => i % Math.ceil(cats.length / 12) === 0)
        : cats) as StudyValue[],
      limits: undefined,
    };
  let min = Infinity,
    max = -Infinity;
  for (const point of points) {
    const value = point.values[axis.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min > max) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    const spacing = Math.max(1e-9, Math.abs(min) * 0.02);
    min -= spacing;
    max += spacing;
  }
  const limits = { min, max };
  return {
    limits,
    project: (x: StudyValue) =>
      typeof x === "number" ? (x - min) / (max - min) : NaN,
    ticks: Array.from(
      { length: 5 },
      (_, i) => min + ((max - min) * i) / 4,
    ) as StudyValue[],
  };
}

export function displayValue(value: StudyValue | undefined) {
  if (value === undefined) return "—";
  return typeof value === "number"
    ? String(Number(value.toPrecision(6)))
    : value;
}

export function fitCanvas(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.max(1, Math.round(width * ratio));
  const lines = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixels || canvas.height !== lines) {
    canvas.width = pixels;
    canvas.height = lines;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

export function plotPosition(canvas: HTMLCanvasElement, event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}
