import type { Study, Dataset } from "./domain";
import { shuffle } from "./data-columns";
import { randomGenerator } from "./numbers";
import { defaultValidationSeed } from "./study-constraints";

/** Split the original designs before filtering any response or predictor column. */
export function studyHoldout(
  study: Pick<Study, "validationSeed" | "designIdColumn" | "snapshot">,
  dataset: Dataset,
) {
  const groups = new Map<string, number[]>();
  const missing = new Set(["", ...study.snapshot.missingTokens]);
  for (const [i, row] of dataset.rows.entries()) {
    const design =
      study.designIdColumn === undefined
        ? undefined
        : row[study.designIdColumn];
    const key =
      design === undefined || missing.has(design)
        ? `row:${i}`
        : `design:${design}`;
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }
  if (groups.size < 2)
    throw new Error(
      "At least two distinct designs are required for a holdout.",
    );
  const indices = shuffle(
    [...groups.values()],
    randomGenerator(study.validationSeed ?? defaultValidationSeed),
  );
  return new Set(
    indices.slice(0, Math.max(1, Math.floor(indices.length * 0.2))).flat(),
  );
}
