import type { Project } from "./domain";

export type GraphDirection = "auto" | "TB" | "BT" | "LR" | "RL";

/** Layered layouts use one hierarchy axis. Mixed handles vote for the dominant flow. */
export function graphDirection(
  p: Pick<Project, "edges">,
  requested: GraphDirection = "auto",
): Exclude<GraphDirection, "auto"> {
  if (requested !== "auto") return requested;
  if (!p.edges.length) return "LR";
  const votes = { TB: 0, BT: 0, LR: 0, RL: 0 };
  const outgoing = {
    bottom: "TB",
    top: "BT",
    right: "LR",
    left: "RL",
  } as const;
  const incoming = {
    top: "TB",
    bottom: "BT",
    left: "LR",
    right: "RL",
  } as const;
  for (const edge of p.edges) {
    votes[outgoing[edge.sourceHandle ?? "right"]]++;
    votes[incoming[edge.targetHandle ?? "left"]]++;
  }
  // Prefer vertical flow in a tie, as in the network image export.
  return (["TB", "BT", "LR", "RL"] as const).reduce(
    (best, direction) => (votes[direction] > votes[best] ? direction : best),
    "TB",
  );
}
