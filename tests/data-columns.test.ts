import { describe, expect, test } from "vitest";
import {
  previewColumn,
  sampleColumn,
  type ColumnRequest,
} from "../src/data-columns";
import { columnReference, compileFormula } from "../src/formula";
import { parseCsv } from "../src/processing";

const sample: Extract<ColumnRequest, { kind: "sample" }> = {
  kind: "sample",
  name: "Width",
  rows: 512,
  method: "latin",
  seed: 42,
  distribution: { kind: "uniform", min: 10, max: 50 },
};

describe("data columns", () => {
  test("uniform strata, reproducibility, independent dimensions and balanced categories", async () => {
    const first = await previewColumn(sample, undefined, [""]);
    expect(first.dataset.rows).toEqual(
      (await previewColumn(sample, undefined, [""])).dataset.rows,
    );
    const values = first.dataset.rows.map(([v]) => Number(v));
    expect(
      new Set(values.map((v) => Math.floor(((v - 10) * 512) / 40))).size,
    ).toBe(512);
    const second = await previewColumn(
      { ...sample, name: "Depth" },
      first.dataset,
      [""],
    );
    expect(
      second.dataset.rows.every(
        ([width], i) => width === first.dataset.rows[i][0],
      ),
    ).toBe(true);
    expect(second.dataset.rows.map((row) => Number(row[1]))).not.toEqual(
      values,
    );
    const categories = sampleColumn(
      {
        ...sample,
        distribution: {
          kind: "categories",
          values: ["Steel", "Aluminium", "Titanium"],
        },
      },
      512,
      2,
      [""],
    );
    const counts = [...new Set(categories)].map(
      (name) => categories.filter((x) => x === name).length,
    );
    expect(counts.sort()).toEqual([170, 171, 171]);
    const roundTrip = await parseCsv(
      second.dataset.csv,
      second.dataset.name,
      ",",
      [""],
    );
    expect(roundTrip.hash).toBe(second.dataset.hash);
    expect(roundTrip.rows).toEqual(second.dataset.rows);
  });

  test("normal and triangular draws respect parameters", () => {
    const normal = sampleColumn(
      { ...sample, distribution: { kind: "normal", mean: 20, deviation: 3 } },
      512,
      0,
      [""],
    ).map(Number);
    expect(normal.reduce((a, b) => a + b, 0) / 512).toBeCloseTo(20, 1);
    const triangular = sampleColumn(
      {
        ...sample,
        method: "random",
        distribution: { kind: "triangular", min: 10, mode: 10, max: 37 },
      },
      512,
      0,
      [""],
    ).map(Number);
    expect(triangular.every((x) => x >= 10 && x <= 37)).toBe(true);
  });

  test("quoted headers, lazy IF, logic and row errors use explicit missing values", async () => {
    const dataset = await parseCsv(
      "State;Input ];Mass\nPasses;2;0.7\nFails;0;1\nPasses;3;NA",
      "data.csv",
      ";",
      [""],
    );
    const formula =
      '=AND([State] = "Passes", [Mass] < 1, IF(' +
      columnReference("Input ]") +
      " <> 0, (4 / " +
      columnReference("Input ]") +
      ") ^ 2 > 1, NOT(TRUE)))";
    const result = await previewColumn(
      { kind: "calculate", name: "Flag", formula },
      dataset,
      ["", "NA"],
    );
    expect(result.dataset.rows.map((row) => row.at(-1))).toEqual([
      "1",
      "0",
      "",
    ]);
    expect(result.missing).toBe(1);
    expect(result.examples[0].row).toBe(3);
    const bad = await previewColumn(
      {
        kind: "calculate",
        name: "Division",
        formula: "=1/" + columnReference("Input ]"),
      },
      result.dataset,
      ["", "NA"],
    );
    expect(bad.examples).toEqual([{ row: 2, message: "Division by zero." }]);
    expect(() => compileFormula("alert(1)", [], () => false, [""])).toThrow(
      /Unknown function/,
    );
  });
});
