import {
  RandomForestClassifier,
  RandomForestRegression,
} from "ml-random-forest";
import type { Dataset, Study, StudyNode, StudyValue, Variable } from "./domain";
import { shuffle } from "./data-columns";
import { randomGenerator } from "./numbers";
import { encode } from "./processing";
import {
  isCategorical,
  MAX_JS_TRAINING_ROWS,
  studyResponses,
  suggestPredictors,
  type Validation,
} from "./study";

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
  const raw = row[Number(v.columnId.slice(1))];
  if (raw === undefined || missing.has(raw)) return;
  if (isCategorical(v)) return v.states.includes(raw) ? raw : undefined;
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) return;
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
): TrainingSplit {
  const groups = new Map<number, { x: number[]; y: number }[]>();
  const categorical = response.representation !== "discretised";
  const missing = new Set(["", ...missingTokens]);
  let count = 0;
  for (const row of dataset.rows) {
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
    group.push({ x: features(predictors, values as StudyValue[]), y });
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
    shuffle(group, random);
    const size =
      group.length < 2 ? 0 : Math.max(1, Math.floor(group.length * 0.2));
    for (const [i, { x, y }] of group.entries()) {
      if (i < size) {
        holdout.push(x);
        truth.push(y);
      } else {
        train.push(x);
        labels.push(y);
      }
    }
  }
  if (!holdout.length || train.length < 4)
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

export function fitJavaScript(split: TrainingSplit, seed = 491): Predict {
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
    MAX_JS_TRAINING_ROWS,
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
  if (v.representation === "discretised") return value;
  return isCategorical(v) ? v.states[value] : Number(v.states[value]);
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
  const output = (y: number) => responseValue(response, y);
  for (const [i, truth] of split.truth.entries()) {
    score += split.categorical
      ? Number(truth === prediction[i])
      : Math.abs(truth - prediction[i]);
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
  return {
    id: response.id,
    predictors: ids,
    metric: split.categorical ? "Accuracy" : "MAE",
    value: score / split.truth.length,
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
  validation: Validation;
  predict(rows: Record<string, StudyValue>[]): StudyValue[];
}
export function fitStudy(
  study: Study,
  dataset: Dataset,
  onFit: (current: number, total: number) => void,
) {
  const responses = studyResponses(study);
  return responses.map((response, i): ResponseModel => {
    const ids =
      study.nodes[response.id].predictors ??
      suggestPredictors(study, response.id);
    const predictors = ids.map((id) =>
      study.snapshot.variables.find((v) => v.id === id)!,
    );
    const split = trainingSplit(
      dataset,
      response,
      predictors,
      study.snapshot.missingTokens,
    );
    const model = fitJavaScript(split);
    const validation = scoreValidation(
      response,
      ids,
      split,
      model(split.holdout),
      study.nodes[response.id].constraint,
    );
    validation.fittedRows = Math.min(
      validation.fittedRows,
      MAX_JS_TRAINING_ROWS,
    );
    onFit(i + 1, responses.length);
    return {
      variable: response,
      validation,
      predict(rows) {
        const prediction = model(
          rows.map((row) =>
            features(
              predictors,
              ids.map((id) => row[id]),
            ),
          ),
        );
        return prediction.map((value) => responseValue(response, value));
      },
    };
  });
}
