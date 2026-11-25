import { contrastText, rgbFromHex } from "./colors";

export type QueryFigureData =
  | {
      kind: "bars";
      axis: string;
      states: { label: string; prior: number; posterior: number }[];
    }
  | {
      kind: "heatmap";
      rowAxis: string;
      columnAxis: string;
      rows: string[];
      columns: string[];
      probabilities: number[][];
      max: number;
      slice: { id: string; label: string }[];
      showValues: boolean;
    };

// Selected stops from the Matplotlib colormaps, interpolated in sRGB.
export const figurePalettes = {
  teal: ["#eff5f4", "#357f7e"],
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  cividis: ["#00224e", "#434e6c", "#7d7c78", "#bcad6c", "#fee838"],
  plasma: ["#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"],
  magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
  coolwarm: ["#3b4cc0", "#8db0fe", "#dddcdc", "#f4987a", "#b40426"],
  RdBu: [
    "#67001f",
    "#b2182b",
    "#d6604d",
    "#f4a582",
    "#fddbc7",
    "#f7f7f7",
    "#d1e5f0",
    "#92c5de",
    "#4393c3",
    "#2166ac",
    "#053061",
  ],
};
export type FigurePalette = keyof typeof figurePalettes;

function paletteColor(stops: number[][], t: number) {
  const position = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const left = Math.min(Math.floor(position), stops.length - 2);
  return stops[left].map((value, index) =>
    Math.round(value + (position - left) * (stops[left + 1][index] - value)),
  );
}

const font = "Arial, Helvetica, sans-serif";
const fontSize = 13;
const lineHeight = 16;
const padding = 20;

function escapeXml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function probabilityPercent(p: number) {
  const value = p * 100;
  return (
    (value > 0 && value < 0.001 ? value.toPrecision(3) : value.toFixed(3)) + "%"
  );
}

export function heatmapColor(p: number, max: number) {
  return `rgba(20,106,105,${max ? 0.07 + (0.8 * p) / max : 0.07})`;
}

export function heatmapText(p: number, max: number) {
  const alpha = max ? 0.07 + (0.8 * p) / max : 0.07;
  return contrastText([20, 106, 105].map((c) => 255 * (1 - alpha) + c * alpha));
}

function wrapLabel(
  label: string,
  maxWidth: number,
  measure: (s: string) => number,
) {
  const lines: string[] = [];
  let line = "";
  for (const word of label.trim().split(/\s+/u)) {
    const joined = line ? line + " " + word : word;
    if (measure(joined) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      if (line && measure(line + character) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  return [...lines, line];
}

function label(lines: string[], x: number, y: number, attributes = "") {
  return `<text x="${x}" y="${y}" ${attributes}>${lines
    .map(
      (line, i) =>
        `<tspan x="${x}" dy="${i ? lineHeight : 0}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

export function renderQueryFigure(
  data: QueryFigureData,
  widthMm: number,
  options: { caption: string; palette: FigurePalette; hiddenSlices: string[] },
) {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) ctx.font = `${fontSize}px ${font}`;
  const measure = (s: string) => ctx?.measureText(s).width ?? s.length * 8;
  const labels =
    data.kind === "bars" ? data.states.map((state) => state.label) : data.rows;
  const rowLabelWidth = Math.max(
    68,
    Math.min(180, Math.ceil(Math.max(...labels.map(measure)))),
  );
  const rows = labels.map((s) => wrapLabel(s, rowLabelWidth, measure));
  const x = padding + rowLabelWidth + 12;
  const cellWidth = data.kind === "heatmap" && data.showValues ? 67 : 46;
  const columns =
    data.kind === "heatmap"
      ? data.columns.map((s) => wrapLabel(s, 120, measure))
      : [];
  const rotate = columns.some(
    (lines) => lines.length > 1 || measure(lines[0]) > cellWidth - 6,
  );
  const colSpace = rotate
    ? Math.max(
        cellWidth,
        ...columns.map((lines) => lines.length * lineHeight + 8),
      )
    : cellWidth;
  const plotWidth =
    data.kind === "bars" ? 340 : Math.max(245, columns.length * colSpace);
  const scaleTitle = "Joint probability";
  const scaleX = x + plotWidth + 18;
  const scaleWidth =
    data.kind === "heatmap"
      ? Math.ceil(
          Math.max(
            measure(scaleTitle),
            24 + measure(probabilityPercent(data.max)),
          ),
        )
      : 0;
  const width =
    (data.kind === "heatmap" ? scaleX + scaleWidth : x + plotWidth) + padding;
  const colors = figurePalettes[options.palette];
  const stops = colors.map(rgbFromHex);
  const content: string[] = [];
  let y = padding + fontSize;
  function heading(value: string, bold = false) {
    const lines = wrapLabel(value, width - 2 * padding - 12, measure);
    content.push(label(lines, padding, y, bold ? 'font-weight="bold"' : ""));
    y += lines.length * lineHeight + 8;
  }
  if (options.caption) heading(options.caption);
  if (data.kind === "heatmap") {
    for (const slice of data.slice)
      if (!options.hiddenSlices.includes(slice.id)) heading(slice.label);
    heading(data.rowAxis, true);
    const top = y;
    const colWidth = plotWidth / data.columns.length;
    for (const [i, lines] of rows.entries()) {
      const rowHeight = Math.max(26, lines.length * lineHeight + 8);
      const center = y + rowHeight / 2 + fontSize / 3;
      content.push(
        label(
          lines,
          x - 8,
          center - ((lines.length - 1) * lineHeight) / 2,
          'text-anchor="end"',
        ),
      );
      for (const [j, probability] of data.probabilities[i].entries()) {
        const start = x + j * colWidth;
        const rgb = paletteColor(stops, data.max ? probability / data.max : 0);
        content.push(
          `<rect data-cell="${i}-${j}" x="${start}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="rgb(${rgb.join(",")})" stroke="white" />`,
        );
        if (data.showValues)
          content.push(
            label(
              [probabilityPercent(probability)],
              start + colWidth / 2,
              center,
              `text-anchor="middle" fill="${contrastText(rgb)}"`,
            ),
          );
      }
      y += rowHeight;
    }
    const bottom = y;
    const gradient = colors
      .map(
        (color, i) =>
          `<stop offset="${i / (colors.length - 1)}" stop-color="${color}"/>`,
      )
      .join("");
    content.push(
      `<defs><linearGradient id="probability-scale" x1="0%" y1="100%" x2="0%" y2="0%">${gradient}</linearGradient></defs>`,
    );
    content.push(label([scaleTitle], scaleX, top - 8));
    content.push(
      `<rect data-colorbar="" x="${scaleX}" y="${top}" width="12" height="${bottom - top}" fill="${data.max ? "url(#probability-scale)" : colors[0]}" stroke="#b4bfc6" stroke-width="0.5" />`,
    );
    if (data.max) {
      content.push(
        label([probabilityPercent(data.max)], scaleX + 20, top + 10),
      );
      if (bottom - top >= 75)
        content.push(
          label(
            [probabilityPercent(data.max / 2)],
            scaleX + 20,
            (top + bottom) / 2 + 4,
          ),
        );
    }
    content.push(label(["0%"], scaleX + 20, bottom));
    if (rotate) {
      for (const [j, lines] of columns.entries()) {
        const center = x + (j + 0.5) * colWidth;
        const offset = ((lines.length - 1) * lineHeight) / 2;
        content.push(
          `<g transform="translate(${center},${y + 6}) rotate(-90)">${label(lines, 0, -offset + fontSize / 3, 'text-anchor="end"')}</g>`,
        );
      }
      y += Math.ceil(Math.max(...columns.flat().map(measure))) + 24;
    } else {
      for (const [j, lines] of columns.entries())
        content.push(
          label(
            lines,
            x + (j + 0.5) * colWidth,
            y + 17,
            'text-anchor="middle"',
          ),
        );
      y += 36;
    }
    heading(data.columnAxis, true);
  } else {
    heading(data.axis, true);
    const series = [
      {
        name: "Prior",
        color: options.palette === "teal" ? "#677e97" : colors[0],
      },
      {
        name: "Posterior",
        color: options.palette === "teal" ? "#146a69" : colors.at(-1)!,
      },
    ];
    for (const [i, item] of series.entries()) {
      const start = x + i * 105;
      content.push(
        `<rect x="${start}" y="${y - 10}" width="12" height="12" fill="${item.color}"/>`,
      );
      content.push(label([item.name], start + 18, y));
    }
    y += 13;
    const top = y;
    const bars: string[] = [];
    for (const [i, lines] of rows.entries()) {
      const rowHeight = Math.max(30, lines.length * lineHeight + 8);
      const center = y + rowHeight / 2;
      bars.push(
        label(
          lines,
          x - 8,
          center + fontSize / 3 - ((lines.length - 1) * lineHeight) / 2,
          'text-anchor="end"',
        ),
      );
      for (const [j, p] of [
        data.states[i].prior,
        data.states[i].posterior,
      ].entries()) {
        bars.push(
          `<rect x="${x}" y="${center - 11 + j * 12}" width="${p * plotWidth}" height="10" fill="${series[j].color}"><title>${series[j].name} ${probabilityPercent(p)}</title></rect>`,
        );
      }
      y += rowHeight;
    }
    for (let i = 0; i <= 4; i++) {
      const tick = x + (i * plotWidth) / 4;
      content.push(
        `<path d="M${tick} ${top}V${y}" fill="none" stroke="#d8dfe4" />`,
      );
      content.push(label([`${i * 25}%`], tick, y + 18, 'text-anchor="middle"'));
    }
    content.push(...bars);
    content.push(
      label(["Probability"], x + plotWidth / 2, y + 39, 'text-anchor="middle"'),
    );
    y += 39;
  }
  const height = y + padding;
  const heightMm = (widthMm * height) / width;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm.toFixed(4)}mm" viewBox="0 0 ${width} ${height}" role="img"><title>${data.kind === "heatmap" ? "Joint probability heatmap" : "Prior and posterior probabilities by state"}</title><rect width="100%" height="100%" fill="white"/><g font-family="${font}" font-size="${fontSize}" fill="#182b3b">${content.join("")}</g></svg>`;
  return {
    svg,
    heightMm,
    textPoints: (((fontSize * widthMm) / width) * 72) / 25.4,
  };
}
