import { probabilityPercent } from "./query-figure";
import { instance } from "@viz-js/viz";
import { stateLabel, evidenceLabel, type Project } from "./domain";
import { contrastText, rgbFromHex } from "./colors";
import { graphDirection, type GraphDirection } from "./graph-direction";
export { graphDirection, type GraphDirection } from "./graph-direction";
let renderer: ReturnType<typeof instance> | undefined;
export interface GraphRoleColors {
  evidence: string;
  target: string;
}
interface GraphHighlights {
  colors: GraphRoleColors;
  targetIds: string[];
}

const compass = { left: "w", right: "e", top: "n", bottom: "s" } as const;
type Side = keyof typeof compass;
interface Port {
  name: string;
  neighbor: string;
}
type NodePorts = Partial<Record<Side, Port[]>>;
type GraphPorts = Map<string, NodePorts>;
const tableAttributes =
  'BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0"';

function sharedPorts(edges: Project["edges"]): GraphPorts {
  const nodes: GraphPorts = new Map();
  function add(node: string, side: Side, port: Port) {
    const ports = nodes.get(node) ?? {};
    (ports[side] ??= []).push(port);
    nodes.set(node, ports);
  }
  for (const [i, edge] of edges.entries()) {
    add(edge.source, edge.sourceHandle ?? "right", {
      name: "out" + i,
      neighbor: edge.target,
    });
    add(edge.target, edge.targetHandle ?? "left", {
      name: "in" + i,
      neighbor: edge.source,
    });
  }
  for (const [node, ports] of nodes) {
    for (const side of Object.keys(compass) as Side[])
      if ((ports[side]?.length ?? 0) < 2) delete ports[side];
    if (!Object.keys(ports).length) nodes.delete(node);
  }
  return nodes;
}

function portCells(ports: Port[] | undefined, horizontal: boolean) {
  const sideSize = 8;
  if (!ports) return `<TD WIDTH="${sideSize}" HEIGHT="${sideSize}"></TD>`;
  const size = horizontal
    ? `WIDTH="14" HEIGHT="${sideSize}"`
    : `WIDTH="${sideSize}" HEIGHT="14"`;
  const cells = ports.map(({ name }) => `<TD PORT="${name}" ${size}></TD>`);
  const rows = horizontal
    ? `<TR>${cells.join("")}</TR>`
    : cells.map((cell) => `<TR>${cell}</TR>`).join("");
  return `<TD><TABLE ${tableAttributes}>${rows}</TABLE></TD>`;
}

function nodeLabel(content: string, ports?: NodePorts) {
  const corner = '<TD WIDTH="8" HEIGHT="8"></TD>';
  const top = portCells(ports?.top, true);
  const bottom = portCells(ports?.bottom, true);
  const left = portCells(ports?.left, false);
  const right = portCells(ports?.right, false);
  return `<TABLE ${tableAttributes}>
    <TR>${corner}${top}${corner}</TR>
    <TR>${left}<TD><TABLE ${tableAttributes}>${content}</TABLE></TD>${right}</TR>
    <TR>${corner}${bottom}${corner}</TR>
  </TABLE>`;
}

function labelText(text: string) {
  return text
    .replace(/[\u0000-\u001F\uFFFE\uFFFF]/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\\", "&#92;");
}

export function graphDot(
  p: Project,
  posterior?: Record<string, number[]>,
  direction: GraphDirection = "auto",
  highlights?: GraphHighlights,
): string {
  return layoutDot(p, posterior, direction, highlights);
}

function layoutDot(
  p: Project,
  posterior: Record<string, number[]> | undefined,
  direction: GraphDirection,
  highlights: GraphHighlights | undefined,
  ports?: GraphPorts,
): string {
  const ids = new Map(p.variables.map((v, i) => [v.id, `n${i}`]));
  const lines = [
    "digraph PDOPT_BN {",
    `graph [rankdir=${graphDirection(p, direction)}, splines=spline, outputorder=edgesfirst, bgcolor="white", pad="0.25", nodesep="0.78", ranksep="1.25"];`,
    'node [shape=box, style="rounded,filled", fillcolor="#edf5f3", color="#487e79", fontname="Arial", fontsize=11, margin=0, width=0, height=0];',
    'edge [color="#617985", arrowsize=0.75];',
  ];
  for (const v of p.variables) {
    const observed = p.evidence[v.id] !== undefined;
    const targetFill = highlights?.targetIds.includes(v.id)
      ? highlights.colors.target
      : undefined;
    const evidenceFill = observed ? highlights?.colors.evidence : undefined;
    const fill = evidenceFill ?? targetFill ?? "#edf5f3";
    const header = targetFill ?? fill;
    const states: string[] = [];
    if (posterior) {
      const values = posterior[v.id];
      if (!values || values.length !== v.states.length)
        throw new Error("Missing current node probabilities.");
      states.push(
        ...v.states.map(
          (_, k) =>
            `${stateLabel(v, k)}: ${probabilityPercent(values[k], p.probabilityDecimalPlaces)}`,
        ),
      );
    }
    const title = `<TR><TD BGCOLOR="${header}" CELLPADDING="2"><FONT COLOR="${contrastText(rgbFromHex(header))}"><B>${labelText(v.label)}</B></FONT></TD></TR>`;
    const evidence = observed
      ? `<TR><TD>${labelText(evidenceLabel(v, p.evidence[v.id]))}</TD></TR>`
      : "";
    const body = states.length
      ? `<TR><TD HEIGHT="8"></TD></TR><TR><TD>${states.map(labelText).join("<BR/>")}</TD></TR>`
      : "";
    const uniform =
      v.parameterMode === "uniform"
        ? '<TR><TD CELLPADDING="2"><FONT POINT-SIZE="9">Uniform CPT</FONT></TD></TR>'
        : "";
    const label = nodeLabel(
      title + evidence + body + uniform,
      ports?.get(v.id),
    );
    lines.push(
      `${ids.get(v.id)} [fillcolor="${fill}", fontcolor="${contrastText(rgbFromHex(fill))}", label=<${label}>];`,
    );
  }
  function attachment(node: string, side: Side, name: string) {
    return `${ids.get(node)}:${ports?.get(node)?.[side] ? name + ":" : ""}${compass[side]}`;
  }
  for (const [i, edge] of p.edges.entries()) {
    const start = attachment(
      edge.source,
      edge.sourceHandle ?? "right",
      "out" + i,
    );
    const end = attachment(edge.target, edge.targetHandle ?? "left", "in" + i);
    lines.push(`${start} -> ${end};`);
  }
  lines.push("}");
  return lines.join("\n");
}
export async function graphSvg(
  p: Project,
  posterior?: Record<string, number[]>,
  direction: GraphDirection = "auto",
  highlights?: GraphHighlights,
) {
  if (!p.variables.length)
    throw new Error("Add variables before exporting a network image.");
  const viz = await (renderer ??= instance());
  const ports = sharedPorts(p.edges);
  let dot = graphDot(p, posterior, direction, highlights);
  if (ports.size) {
    // Order the ports by neighbouring nodes in the initial layout, so edges
    // can fan out without crossing each other immediately at the node.
    const layout = JSON.parse(
      viz.renderString(dot, { format: "json0", engine: "dot" }),
    ) as {
      objects: { name: string; pos: string }[];
    };
    const positions = new Map(
      layout.objects.map(({ name, pos }) => [
        p.variables[Number(name.slice(1))].id,
        pos.split(",").map(Number),
      ]),
    );
    for (const node of ports.values()) {
      for (const [side, entries] of Object.entries(node)) {
        const horizontal = side === "top" || side === "bottom";
        const coord = (id: string) =>
          horizontal ? positions.get(id)![0] : -positions.get(id)![1];
        entries.sort((a, b) => coord(a.neighbor) - coord(b.neighbor));
      }
    }
    dot = layoutDot(p, posterior, direction, highlights, ports);
  }
  let svg = viz.renderString(dot, { format: "svg", engine: "dot" });
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/, "");
  if (svg.length > 10 * 1024 * 1024)
    throw new Error(
      "Graph image exceeds 10 MiB. Export structure without probabilities.",
    );
  return svg;
}
