import Papa from "papaparse";
import { z } from "zod";
import { LIMITS, type Dataset } from "./domain";
import { compileFormula } from "./formula";
import { randomGenerator, nextDown } from "./numbers";
import { parseCsv } from "./processing";

const finite = z.number().finite();
export const distributionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uniform"), min: finite, max: finite }),
  z.object({
    kind: z.literal("normal"),
    mean: finite,
    deviation: finite.positive(),
  }),
  z.object({
    kind: z.literal("triangular"),
    min: finite,
    mode: finite,
    max: finite,
  }),
  z.object({
    kind: z.literal("categories"),
    values: z.array(z.string().trim().min(1)).min(2).max(LIMITS.states),
  }),
]);
export const columnRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sample"),
    name: z.string().trim().min(1).max(200),
    distribution: distributionSchema,
    method: z.enum(["random", "latin"]),
    seed: z.number().int().min(0).max(0xffffffff),
    rows: z.number().int().min(1).max(LIMITS.rows),
  }),
  z.object({
    kind: z.literal("calculate"),
    name: z.string().trim().min(1).max(200),
    formula: z.string(),
  }),
]);
export type ColumnRequest = z.infer<typeof columnRequestSchema>;
type Distribution = z.infer<typeof distributionSchema>;

export function shuffle<T>(items: T[], random: () => number) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Acklam's rational approximation for the inverse standard normal CDF.
function normalQuantile(p: number): number {
  if (p > 0.97575) return -normalQuantile(1 - p);
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((-0.007784894 * q - 0.322396458) * q - 2.400758277) * q -
        2.549732539) *
        q +
        4.374664141) *
        q +
        2.938163983) /
      ((((0.007784696 * q + 0.322467129) * q + 2.445134137) * q + 3.754408662) *
        q +
        1)
    );
  }
  const q = p - 0.5,
    r = q * q;
  return (
    ((((((-39.6968302866538 * r + 220.946098424521) * r - 275.928510446969) *
      r +
      138.357751867269) *
      r -
      30.6647980661472) *
      r +
      2.50662827745924) *
      q) /
    (((((-54.4760987982241 * r + 161.585836858041) * r - 155.698979859887) * r +
      66.8013118877197) *
      r -
      13.2806815528857) *
      r +
      1)
  );
}

function quantile(d: Distribution, p: number): string {
  if (d.kind === "categories") return d.values[Math.floor(p * d.values.length)];
  let value: number;
  if (d.kind === "normal") value = d.mean + d.deviation * normalQuantile(p);
  else if (d.kind === "uniform")
    value = Math.min(nextDown(d.max), d.min * (1 - p) + d.max * p);
  else {
    const range = d.max - d.min;
    const f = (d.mode - d.min) / range;
    value =
      p < f
        ? d.min + range * Math.sqrt(p * f)
        : d.max - range * Math.sqrt((1 - p) * (1 - f));
  }
  if (!Number.isFinite(value))
    throw new Error(
      "The distribution produced a non-finite value. Adjust its parameters.",
    );
  return String(value);
}

export function sampleColumn(
  request: Extract<ColumnRequest, { kind: "sample" }>,
  count: number,
  column: number,
  tokens: string[],
) {
  const { distribution: d, method, seed } = request;
  if ((d.kind === "uniform" || d.kind === "triangular") && !(d.min < d.max))
    throw new Error("The lower bound must be smaller than the upper bound.");
  if (
    d.kind === "triangular" &&
    (d.mode < d.min || d.mode > d.max || !Number.isFinite(d.max - d.min))
  )
    throw new Error("Set a finite range with the mode inside the bounds.");
  if (
    d.kind === "categories" &&
    (new Set(d.values).size !== d.values.length ||
      d.values.some((value) => tokens.includes(value)))
  )
    throw new Error(
      "Enter distinct categories that are not missing-data tokens.",
    );

  const random = randomGenerator((seed + Math.imul(column, 0x9e3779b9)) >>> 0);
  let result: string[];
  if (d.kind === "categories" && method === "latin") {
    const categories = shuffle([...d.values], random);
    result = shuffle(
      Array.from(
        { length: count },
        (_, i) => categories[i % categories.length],
      ),
      random,
    );
  } else {
    const probabilities = Array.from({ length: count }, (_, i) => {
      const u = (random() * 0x100000000 + 0.5) / 0x100000000;
      return method === "latin" ? Math.min(nextDown(1), (i + u) / count) : u;
    });
    if (method === "latin") shuffle(probabilities, random);
    result = probabilities.map((p) => quantile(d, p));
  }
  if (tokens.some((token) => result.includes(token)))
    throw new Error(
      "A sampled value matches a missing-data token. Adjust the distribution or missing-data policy.",
    );
  return result;
}

export async function previewColumn(
  request: ColumnRequest,
  dataset: Dataset | undefined,
  tokens: string[],
) {
  const headers = dataset?.headers ?? [];
  if (headers.length >= LIMITS.columns)
    throw new Error("The dataset already has 500 columns.");
  if (headers.includes(request.name))
    throw new Error("Use a unique column name.");
  if (!dataset && request.kind === "calculate")
    throw new Error("Create or attach a dataset first.");

  const examples: { row: number; message: string }[] = [];
  let references: number[] = [];
  let values: string[];
  let missing = 0;
  if (request.kind === "sample") {
    values = sampleColumn(
      request,
      dataset?.rows.length ?? request.rows,
      headers.length,
      tokens,
    );
  } else {
    const missingTokens = new Set(["", ...tokens]);
    const formula = compileFormula(
      request.formula,
      headers,
      (index) =>
        dataset!.rows.every((row) => {
          const value = row[index];
          return (
            missingTokens.has(value) ||
            (!!value.trim() && Number.isFinite(Number(value)))
          );
        }),
      tokens,
    );
    references = formula.references;
    values = dataset!.rows.map((row, i) => {
      try {
        const value = formula.cell(row);
        if (!value.trim() || tokens.includes(value))
          throw new Error("Result matches a missing-data token.");
        return value;
      } catch (error) {
        missing++;
        if (examples.length < 5)
          examples.push({ row: i + 1, message: (error as Error).message });
        return "";
      }
    });
  }
  const rows = values.map((value, i) => [...(dataset?.rows[i] ?? []), value]);
  const delimiter = dataset?.delimiter ?? ",";
  const csv = Papa.unparse([[...headers, request.name], ...rows], {
    delimiter,
    // Preserve whitespace-only source cells when serialising the augmented dataset.
    quotes: true,
  });
  const name =
    dataset?.name.replace(/(?:-augmented)?(?:\.csv)?$/i, "-augmented.csv") ??
    "sampled-data.csv";
  const augmented = await parseCsv(csv, name, delimiter, tokens);
  return {
    dataset: augmented,
    references,
    examples,
    missing,
    sourceHash: dataset?.hash ?? "",
  };
}
