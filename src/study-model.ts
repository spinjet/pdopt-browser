import { buildStudyPlan, predictorMode, type Estimator } from "./study-plan";
import { studyHoldout } from "./study-partition";
export { studyHoldout } from "./study-partition";
import { compareFeasibility, evaluateCandidates } from "./study-evaluate";
import {
  fitGaussianProcess,
  fitSurface,
  GP_TRAINING_LIMIT,
  sampleIndices,
  SURFACE_TRAINING_LIMIT,
} from "./study-estimators";
import type { CandidateValues } from "./study-constraints";
import { outsideBinBounds } from "./domain";
import {
  RandomForestClassifier,
  RandomForestRegression,
} from "ml-random-forest";
import type { Dataset, Study, StudyNode, StudyValue, Variable } from "./domain";
import { shuffle } from "./data-columns";
import { randomGenerator } from "./numbers";
import { encode } from "./processing";
import { isCategorical, MAX_JS_TRAINING_ROWS, type Validation } from "./study";

export type Predict = (features: number[][]) => number[];
export interface TrainingSplit {
  train: number[][];
  labels: number[];
  holdout: number[][];
  truth: number[];
  categorical: boolean;
  dropped: number;
}

function features(predictors: Variable[], vals: StudyValue[]) {
  return predictors.flatMap((v, i) =>
    isCategorical(v)
      ? v.states.map((category) => Number(category === vals[i]))
      : [Number(vals[i])],
  );
}

function fromRow(
  v: Variable,
  row: string[],
  missing: Set<string>,
): StudyValue | undefined {
  if (!v.columnId) return;
  const raw = row[Number(v.columnId.slice(1))];
  if (raw === undefined || missing.has(raw)) return;
  if (isCategorical(v)) return v.states.includes(raw) ? raw : undefined;
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || outsideBinBounds(v, value))
    return;
  return v.representation === "finiteNumeric" &&
    !v.states.includes(String(value))
    ? undefined
    : value;
}

export function trainingSplit(
  dataset: Dataset,
  response: Variable,
  predictors: Variable[],
  missingTokens: string[],
  partition?: Set<number>,
): TrainingSplit {
  const groups = new Map<number, { x: number[]; y: number; index: number }[]>();
  const categorical = isCategorical(response);
  const missing = new Set(["", ...missingTokens]);
  let count = 0;
  for (const [index, row] of dataset.rows.entries()) {
    const output = fromRow(response, row, missing);
    const values = predictors.map((p) => fromRow(p, row, missing));
    if (output === undefined || values.some((value) => value === undefined))
      continue;
    const y = categorical
      ? response.states.indexOf(String(output))
      : Number(output);
    const key = categorical ? y : 0;
    const group = groups.get(key) ?? [];
    if (!groups.has(key)) groups.set(key, group);
    group.push({ x: features(predictors, values as StudyValue[]), y, index });
    count++;
  }
  if (count < 8)
    throw new Error(
      "At least 8 complete training rows are needed for " +
        response.label +
        ".",
    );
  const train = [],
    labels = [],
    holdout = [],
    truth = [];
  const random = randomGenerator(4921);
  for (const group of groups.values()) {
    if (!partition) shuffle(group, random);
    const size =
      group.length < 2 ? 0 : Math.max(1, Math.floor(group.length * 0.2));
    for (const [i, { x, y, index }] of group.entries()) {
      if (partition ? partition.has(index) : i < size) {
        holdout.push(x);
        truth.push(y);
      } else {
        train.push(x);
        labels.push(y);
      }
    }
  }
  if ((!partition && !holdout.length) || train.length < 4)
    throw new Error(
      "Too few rows per response class to validate " + response.label + ".",
    );
  return {
    train,
    labels,
    holdout,
    truth,
    categorical,
    dropped: dataset.rows.length - count,
  };
}

export function fitJavaScript(
  split: TrainingSplit,
  seed = 491,
  limit = MAX_JS_TRAINING_ROWS,
): Predict {
  const indices = shuffle(
    split.train.map((_, i) => i),
    randomGenerator(seed),
  );
  // ml-cart evaluates candidate splits exhaustively. Bound browser training work.
  // Keep at least one record from each class before filling the sample.
  const firstPerClass = new Map<number, number>();
  if (split.categorical) {
    for (const i of indices)
      if (!firstPerClass.has(split.labels[i]))
        firstPerClass.set(split.labels[i], i);
  }
  const sample = [...new Set([...firstPerClass.values(), ...indices])].slice(
    0,
    limit,
  );
  const width = split.train[0].length;
  const options = {
    nEstimators: 24,
    seed,
    maxFeatures: width,
    replacement: false,
    useSampleBagging: true,
    noOOB: true,
    treeOptions: { maxDepth: 12, minNumSamples: 3 },
  };
  const forest = split.categorical
    ? new RandomForestClassifier(options)
    : new RandomForestRegression(options);
  const labels = sample.map((i) => split.labels[i]);
  if (labels.every((value) => value === labels[0]))
    return (X) => X.map(() => labels[0]);
  forest.train(
    sample.map((i) => split.train[i]),
    labels,
  );
  return (X) => (X.length ? forest.predict(X) : []);
}

export function checkConstraint(
  v: Variable,
  constraint: NonNullable<StudyNode["constraint"]>,
  value: StudyValue,
) {
  if (constraint.kind === "numeric") {
    const upper = constraint.operator === "lt" || constraint.operator === "lte";
    const margin = upper
      ? constraint.value - Number(value)
      : Number(value) - constraint.value;
    const strict = constraint.operator === "lt" || constraint.operator === "gt";
    return { margin, passes: strict ? margin > 0 : margin >= 0 };
  }
  const passes =
    constraint.kind === "categories"
      ? constraint.values.includes(String(value))
      : constraint.states.includes(encode(v, String(value)));
  return { margin: passes ? 1 : -1, passes };
}

function responseValue(v: Variable, value: number): StudyValue {
  if (isCategorical(v)) return v.states[value];
  if (v.representation === "discretised") return value;
  // A finite numeric variable can only take one of its declared values.
  return v.states
    .map(Number)
    .reduce((best, state) =>
      Math.abs(state - value) < Math.abs(best - value) ? state : best,
    );
}

export function scoreValidation(
  response: Variable,
  ids: string[],
  split: TrainingSplit,
  prediction: number[],
  constraint?: StudyNode["constraint"],
): Validation {
  let violations = 0,
    missed = 0,
    near = 0,
    nearMissed = 0,
    score = 0;
  let minObserved = Infinity,
    maxObserved = -Infinity,
    maxError = 0;
  const output = (y: number) => responseValue(response, y);
  for (const [i, truth] of split.truth.entries()) {
    if (split.categorical) {
      score += Number(truth === prediction[i]);
    } else {
      const error = Math.abs(truth - Number(output(prediction[i])));
      score += error;
      maxError = Math.max(maxError, error);
      minObserved = Math.min(minObserved, truth);
      maxObserved = Math.max(maxObserved, truth);
    }
    if (!constraint) continue;
    const actual = checkConstraint(response, constraint, output(truth));
    const predicted = checkConstraint(
      response,
      constraint,
      output(prediction[i]),
    );
    const thresholdDistance =
      constraint.kind === "numeric"
        ? Math.max(Math.abs(constraint.value) * 0.1, Number.EPSILON)
        : Infinity;
    const isNear = Math.abs(actual.margin) <= thresholdDistance;
    if (!actual.passes) violations++;
    if (!actual.passes && predicted.passes) missed++;
    if (isNear) {
      near++;
      if (!actual.passes && predicted.passes) nearMissed++;
    }
  }
  const value = split.truth.length ? score / split.truth.length : 0;
  const range = maxObserved - minObserved;
  const relative = (error: number) =>
    range > 0 && Number.isFinite(range) && Number.isFinite(error / range)
      ? error / range
      : null;
  return {
    id: response.id,
    predictors: ids,
    metric: split.categorical ? "Accuracy" : "MAE",
    value,
    numericError: split.categorical
      ? undefined
      : {
          minObserved,
          maxObserved,
          meanRelative: relative(value),
          maxRelative: relative(maxError),
          maxAbsolute: maxError,
        },
    rows: split.train.length + split.truth.length,
    dropped: split.dropped,
    holdout: split.truth.length,
    fittedRows: split.train.length,
    violations,
    missed,
    near,
    nearMissed,
  };
}

export interface ResponseModel {
  variable: Variable;
  fitKey: string;
  validation: Validation;
  predict(rows: CandidateValues[]): StudyValue[];
  predictDetails?(
    rows: CandidateValues[],
  ): { value: StudyValue; std?: number }[];
}
export function surrogateFitKey(
  response: Variable,
  predictors: Variable[],
  missingTokens: string[],
  datasetHash: string,
  estimator: Estimator = "forest",
) {
  const encoding = (v: Variable) => [
    v.id,
    v.columnId,
    v.representation,
    v.states,
    v.binning,
  ];
  return JSON.stringify([
    datasetHash,
    estimator,
    missingTokens,
    encoding(response),
    predictors.map(encoding),
  ]);
}

export function fitResponse(
  dataset: Dataset,
  response: Variable,
  predictors: Variable[],
  missingTokens: string[],
  constraint?: StudyNode["constraint"],
  estimator: Estimator = "forest",
  partition?: Set<number>,
): ResponseModel {
  if (
    !response.columnId ||
    !predictors.length ||
    predictors.some((p) => !p.columnId)
  )
    throw new Error(
      "Prediction requires dataset columns for the response and its inputs.",
    );
  const ids = predictors.map((v) => v.id);
  const split = trainingSplit(
    dataset,
    response,
    predictors,
    missingTokens,
    partition,
  );
  const limit =
    estimator === "gaussian-process"
      ? GP_TRAINING_LIMIT
      : estimator === "forest"
        ? MAX_JS_TRAINING_ROWS
        : SURFACE_TRAINING_LIMIT;
  const indices = sampleIndices(split.train.length, limit);
  const train = indices.map((i) => split.train[i]),
    truth = indices.map((i) => split.labels[i]);
  const forest = estimator === "forest" ? fitJavaScript(split) : undefined;
  const numeric =
    estimator === "gaussian-process"
      ? fitGaussianProcess(train, truth)
      : estimator !== "forest"
        ? fitSurface(train, truth, estimator === "quadratic")
        : undefined;
  const predictNumbers = (matrix: number[][], uncertainty = false) =>
    numeric
      ? numeric(matrix, uncertainty)
      : forest!(matrix).map((value) => ({ value, std: undefined }));
  function predict(rows: CandidateValues[], uncertainty: boolean) {
    const matrix = rows.map((row) =>
      features(
        predictors,
        predictors.map((v) => {
          const value = row[v.id];
          if (value === undefined)
            throw new Error(`Missing input for ${v.label}.`);
          if (v.representation !== "discretised") encode(v, String(value));
          else if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error(`Expected a finite prediction for ${v.label}.`);
          return value;
        }),
      ),
    );
    return predictNumbers(matrix, uncertainty).map(({ value, std }) => ({
      value: responseValue(response, value),
      std,
    }));
  }
  const validation = scoreValidation(
    response,
    ids,
    split,
    predictNumbers(split.holdout).map((x) => x.value),
    constraint,
  );
  validation.fittedRows = Math.min(split.train.length, limit);
  validation.estimator = estimator;
  return {
    variable: response,
    fitKey: surrogateFitKey(
      response,
      predictors,
      missingTokens,
      dataset.hash,
      estimator,
    ),
    validation,
    predict: (rows) => predict(rows, false).map((item) => item.value),
    predictDetails:
      estimator === "gaussian-process"
        ? (rows) => predict(rows, true)
        : undefined,
  };
}

export function fitStudy(
  study: Study,
  dataset: Dataset,
  onFit: (current: number, total: number) => void,
  partition = studyHoldout(study, dataset),
) {
  const plan = buildStudyPlan(study);
  const models = plan.models.map(({ response, predictors, estimator }, i) => {
    const model = fitResponse(
      dataset,
      response,
      predictors,
      study.snapshot.missingTokens,
      undefined,
      estimator,
      partition,
    );
    model.validation.structure = predictorMode(study, response.id);
    onFit(i + 1, plan.models.length);
    return model;
  });
  return models;
}

export function scoreStudyChain(
  study: Study,
  dataset: Dataset,
  models: ResponseModel[],
  partition: Set<number>,
) {
  const plan = buildStudyPlan(study);
  const missing = new Set(["", ...study.snapshot.missingTokens]);
  const inputIds = new Set(
    study.snapshot.variables
      .filter((v) => ["input", "fixed"].includes(study.nodes[v.id].role))
      .map((v) => v.id),
  );
  const indices = [...partition];
  const recorded = indices.map((index) =>
    Object.fromEntries(
      study.snapshot.variables.flatMap((v) => {
        const value = fromRow(v, dataset.rows[index], missing);
        return value === undefined ? [] : [[v.id, value]];
      }),
    ),
  );
  const inputs = recorded.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([id]) => inputIds.has(id))),
  );
  const ids = plan.objectives.map((v) => v.id);
  const predicted = evaluateCandidates(inputs, models, plan.constraints, ids, {
    stopOnViolation: false,
    uncertainty: true,
  });
  const observed = evaluateCandidates(recorded, [], plan.constraints, ids, {
    stopOnViolation: false,
  });
  const responseScored: Record<string, boolean[]> = {};
  const validation = models.map(({ variable: v, validation: fit }) => {
    const categorical = isCategorical(v);
    const matrix = v.states.map(() => v.states.map(() => 0));
    const numericTruth: number[] = [],
      deviations: number[] = [];
    let correct = 0,
      scored = 0,
      violations = 0,
      missed = 0,
      near = 0,
      nearMissed = 0,
      covered = 0,
      intervalRows = 0;
    const flags = (responseScored[v.id] = predicted.map((entry, i) => {
      const truth = recorded[i][v.id],
        value = entry.outputs[v.id];
      if (truth === undefined || value === undefined) return false;
      scored++;
      if (categorical) {
        const a = v.states.indexOf(String(truth)),
          b = v.states.indexOf(String(value));
        matrix[a][b]++;
        correct += Number(a === b);
      } else {
        const absolute = Math.abs(Number(truth) - Number(value));
        numericTruth.push(Number(truth));
        deviations.push(absolute);
        const std = entry.uncertainty?.[v.id];
        if (std !== undefined) {
          intervalRows++;
          covered += Number(absolute <= 1.96 * std);
        }
      }
      const relevant = plan.constraints.filter(
        (rule) => rule.references.length === 1 && rule.references[0] === v.id,
      );
      if (relevant.length) {
        const actual = relevant.map((rule) => rule.check(recorded[i]));
        const guess = relevant.map((rule) =>
          rule.check({ ...inputs[i], ...entry.outputs }),
        );
        const violation = actual.some((item) => item.status === "Violated");
        const miss = violation && guess.every((item) => item.status === "Pass");
        const boundary = actual.some((item, j) => {
          const rule = relevant[j].definition;
          return (
            item.margin !== undefined &&
            rule.kind === "numeric" &&
            Math.abs(item.margin) <=
              Math.max(Math.abs(rule.value) * 0.1, Number.EPSILON)
          );
        });
        violations += Number(violation);
        missed += Number(miss);
        near += Number(boundary);
        nearMissed += Number(miss && boundary);
      }
      return true;
    }));
    const value = !scored
      ? 0
      : categorical
        ? correct / scored
        : deviations.reduce((a, b) => a + b, 0) / scored;
    const minObserved = numericTruth.reduce((a, b) => Math.min(a, b), Infinity);
    const maxObserved = numericTruth.reduce(
      (a, b) => Math.max(a, b),
      -Infinity,
    );
    const maxAbsolute = deviations.reduce((a, b) => Math.max(a, b), 0),
      range = maxObserved - minObserved;
    return {
      ...fit,
      holdout: scored,
      value,
      violations,
      missed,
      near,
      nearMissed,
      numericError:
        !categorical && scored
          ? {
              minObserved,
              maxObserved,
              maxAbsolute,
              meanRelative: range > 0 ? value / range : null,
              maxRelative: range > 0 ? maxAbsolute / range : null,
            }
          : undefined,
      confusion: categorical ? { labels: v.states, counts: matrix } : undefined,
      intervalCoverage: intervalRows
        ? { covered, total: intervalRows }
        : undefined,
    };
  });
  const nearLimits = observed.flatMap((entry, i) => {
    const outcomes = (entry.outcomes ?? []).filter((item) => {
      const rule = plan.constraints.find(
        (rule) => rule.definition.id === item.id,
      )?.definition;
      return (
        rule?.kind === "numeric" &&
        item.margin !== undefined &&
        Math.abs(item.margin) <=
          Math.max(Math.abs(rule.value) * 0.1, Number.EPSILON)
      );
    });
    if (!outcomes.length) return [];
    return [
      {
        row: indices[i] + 1,
        observed: entry.status,
        predicted: predicted[i].status,
        limits: outcomes.map((item) => ({
          observed: item,
          predicted: predicted[i].outcomes?.find(
            (check) => check.id === item.id,
          ),
        })),
      },
    ];
  });
  return {
    validation,
    predicted,
    observed,
    recorded,
    responseScored,
    feasibility: compareFeasibility(predicted, observed),
    nearLimits,
  };
}

export function fitStudyWithValidation(
  study: Study,
  dataset: Dataset,
  progress: (current: number, total: number) => void,
) {
  const partition = studyHoldout(study, dataset);
  const models = fitStudy(study, dataset, progress, partition);
  const primary = scoreStudyChain(study, dataset, models, partition);
  let direct;
  let comparisonError: string | undefined;
  if (models.some((model) => model.validation.structure === "parents")) {
    try {
      const comparison: Study = {
        ...study,
        nodes: Object.fromEntries(
          Object.entries(study.nodes).map(([id, node]) => [
            id,
            { ...node, predictorMode: "direct" as const },
          ]),
        ),
      };
      direct = scoreStudyChain(
        comparison,
        dataset,
        fitStudy(comparison, dataset, () => {}, partition),
        partition,
      );
    } catch (error) {
      comparisonError = error instanceof Error ? error.message : String(error);
    }
  }
  const comparable = direct
    ? primary.predicted.map(
        (row, i) =>
          row.status !== "Unevaluable" &&
          direct!.predicted[i].status !== "Unevaluable" &&
          primary.observed[i].status !== "Unevaluable",
      )
    : [];
  const common = (rows: typeof primary.predicted) =>
    rows.filter((_, i) => comparable[i]);
  return {
    models,
    report: {
      validation: primary.validation,
      holdout: partition.size,
      feasibility: primary.feasibility,
      nearLimits: primary.nearLimits,
      comparisonError,
      comparison: direct
        ? {
            scored: comparable.filter(Boolean).length,
            configured: compareFeasibility(
              common(primary.predicted),
              common(primary.observed),
            ),
            direct: compareFeasibility(
              common(direct.predicted),
              common(primary.observed),
            ),
            responses: primary.validation.flatMap((row) => {
              const other = direct!.validation.find(
                (item) => item.id === row.id,
              );
              if (!other) return [];
              const indices = primary.responseScored[row.id].flatMap(
                (flag, i) =>
                  flag && direct!.responseScored[row.id][i] ? [i] : [],
              );
              const score = (predictions: typeof primary.predicted) =>
                indices.length
                  ? indices.reduce((sum, i) => {
                      const truth = primary.recorded[i][row.id],
                        prediction = predictions[i].outputs[row.id];
                      return (
                        sum +
                        (row.metric === "Accuracy"
                          ? Number(truth === prediction)
                          : Math.abs(Number(truth) - Number(prediction)))
                      );
                    }, 0) / indices.length
                  : 0;
              return [
                {
                  configured: { ...row, value: score(primary.predicted) },
                  direct: { ...other, value: score(direct!.predicted) },
                  shared: indices.length,
                },
              ];
            }),
          }
        : undefined,
    },
  };
}

export type StudyValidationReport = ReturnType<
  typeof fitStudyWithValidation
>["report"];
