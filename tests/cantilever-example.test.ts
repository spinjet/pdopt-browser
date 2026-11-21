import { expect, test } from "vitest";
import {
  cantileverCsv,
  cantileverInputs,
  materials,
  sampleCount,
  spanMm,
} from "../src/cantilever-example";

test("cantilever CSV has 512 Latin hypercube rows with one material per case", () => {
  const csv = cantileverCsv();
  expect(cantileverCsv()).toBe(csv);
  const rows = csv
    .split("\n")
    .slice(1)
    .map((row) => row.split(","));
  expect(rows).toHaveLength(sampleCount);
  for (const [column, { min, max }] of cantileverInputs.entries()) {
    const values = rows.map((row) => Number(row[column]));
    expect(values.every((n) => n >= min && n < max)).toBe(true);
    const strata = values.map((n) =>
      Math.floor(((n - min) / (max - min)) * sampleCount),
    );
    expect(new Set(strata).size).toBe(sampleCount);
  }

  expect(
    materials.map(({ name }) => rows.filter((row) => row[3] === name).length),
  ).toEqual([171, 170, 171]);
  // Ensure the input columns did not receive the same permutation.
  expect(rows.some(([width, depth]) => width !== depth)).toBe(true);
});

test("cantilever outputs use the sampled geometry and the selected material", () => {
  const rows = cantileverCsv().split("\n").slice(1);
  for (const line of rows) {
    const [width, depth, load, name, stress, deflection, failure, mass] =
      line.split(",");
    const [b, h, f] = [width, depth, load].map(Number);
    const material = materials.find((material) => material.name === name)!;
    const expectedStress = (6 * f * spanMm) / (b * h ** 2);
    expect(Number(stress)).toBeCloseTo(expectedStress, 5);
    expect(Number(deflection)).toBeCloseTo(
      (4 * f * spanMm ** 3) / (material.modulusMpa * b * h ** 3),
      5,
    );
    expect(Number(mass)).toBeCloseTo(
      (material.densityKgM3 * b * h * spanMm) / 1e9,
      5,
    );
    expect(failure).toBe(
      expectedStress > material.allowableMpa ? "Fails" : "Passes",
    );
  }
});
