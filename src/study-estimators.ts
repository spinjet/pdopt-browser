import { shuffle } from "./data-columns";
import { randomGenerator } from "./numbers";

export const GP_TRAINING_LIMIT = 128;
export const GP_DATASET_LIMIT = 10000;
export const GP_FEATURE_LIMIT = 12;
export const SURFACE_TRAINING_LIMIT = 768;
export const SURFACE_FEATURE_LIMIT = 128;
export interface NumericPrediction {
  value: number;
  std?: number;
}
export type NumericModel = (
  rows: number[][],
  uncertainty?: boolean,
) => NumericPrediction[];

export function sampleIndices(count: number, limit: number, seed = 491) {
  return shuffle(
    Array.from({ length: count }, (_, i) => i),
    randomGenerator(seed),
  ).slice(0, limit);
}

function standardize(rows: number[][]) {
  const means = rows[0].map(
    (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length,
  );
  const scales = means.map(
    (mean, j) =>
      Math.sqrt(
        rows.reduce((sum, row) => sum + (row[j] - mean) ** 2, 0) / rows.length,
      ) || 1,
  );
  return (row: number[]) => row.map((v, j) => (v - means[j]) / scales[j]);
}

function cholesky(matrix: number[][]) {
  const lower = matrix.map((row) => row.map(() => 0));
  for (const [i, row] of matrix.entries()) {
    for (let j = 0; j <= i; j++) {
      let value = row[j];
      for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
      if (i === j && !(value > 0))
        throw new Error("The model matrix is not positive definite.");
      lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
    }
  }
  return lower;
}

function forward(lower: number[][], target: number[]) {
  const out = [...target];
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < i; j++) out[i] -= lower[i][j] * out[j];
    out[i] /= lower[i][i];
  }
  return out;
}

function solve(lower: number[][], target: number[]) {
  const out = forward(lower, target);
  for (let i = out.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < out.length; j++) out[i] -= lower[j][i] * out[j];
    out[i] /= lower[i][i];
  }
  return out;
}

export function fitSurface(
  rows: number[][],
  truth: number[],
  quadratic: boolean,
): NumericModel {
  const standard = standardize(rows);
  function basis(row: number[]) {
    const x = standard(row);
    const values = [1, ...x];
    if (quadratic)
      for (const [i, value] of x.entries())
        for (let j = i; j < x.length; j++) values.push(value * x[j]);
    return values;
  }
  const features = rows[0].length;
  const size = 1 + features + (quadratic ? (features * (features + 1)) / 2 : 0);
  if (size > SURFACE_FEATURE_LIMIT)
    throw new Error(
      `This response surface exceeds ${SURFACE_FEATURE_LIMIT} terms. Reduce predictors or choose forest.`,
    );
  const matrix = Array.from({ length: size }, () =>
    Array<number>(size).fill(0),
  );
  const target = Array<number>(size).fill(0);
  for (const [index, row] of rows.entries()) {
    const x = basis(row);
    for (let i = 0; i < size; i++) {
      target[i] += x[i] * truth[index];
      for (let j = 0; j <= i; j++) matrix[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < size; i++) matrix[i][i] += 1e-6;
  const coefficients = solve(cholesky(matrix), target);
  return (rows) =>
    rows.map((row) => ({
      value: basis(row).reduce(
        (sum, value, i) => sum + value * coefficients[i],
        0,
      ),
    }));
}

export function fitGaussianProcess(
  rows: number[][],
  truth: number[],
): NumericModel {
  const standard = standardize(rows);
  const train = rows.map(standard);
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  const scale = Math.sqrt(
    truth.reduce((sum, value) => sum + (value - mean) ** 2, 0) / truth.length,
  );
  if (!scale) return (rows) => rows.map(() => ({ value: mean, std: 0 }));
  function kernel(a: number[], b: number[]) {
    return Math.exp(
      -a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0) / (2 * a.length),
    );
  }
  const lower = cholesky(
    train.map((a, i) =>
      train.map((b, j) => kernel(a, b) + (i === j ? 0.025 : 0)),
    ),
  );
  const weights = solve(
    lower,
    truth.map((v) => (v - mean) / scale),
  );
  return (rows, uncertainty = true) =>
    rows.map((row) => {
      const x = standard(row);
      const k = train.map((y) => kernel(x, y));
      const value =
        mean + scale * k.reduce((sum, v, i) => sum + v * weights[i], 0);
      if (!uncertainty) return { value };
      const solved = forward(lower, k);
      const variance = 1 - solved.reduce((sum, v) => sum + v * v, 0);
      return { value, std: scale * Math.sqrt(Math.max(0, variance)) };
    });
}
