import { cantileverCsv, cantileverHeaders } from "./cantilever-example";
import { emptyProject, type StudyNode } from "./domain";
import { configureVariable, parseCsv } from "./processing";
import { randomGenerator } from "./numbers";
import {
  fitJavaScript,
  scoreValidation,
  trainingSplit,
  studyHoldout,
} from "./study-model";

import {
  GP_TRAINING_LIMIT,
  SURFACE_TRAINING_LIMIT,
  fitGaussianProcess,
  fitSurface,
  sampleIndices,
  type NumericModel,
} from "./study-estimators";

type PyodideApi = Awaited<ReturnType<typeof import("pyodide").loadPyodide>>;

function syntheticCsv() {
  const random = randomGenerator(2271);
  const rows = [
    Array.from({ length: 10 }, (_, i) => "Input " + (i + 1))
      .concat(["Mass proxy", "Output B", "Output C", "Pass flag"])
      .join(","),
  ];
  for (let i = 0; i < 10000; i++) {
    const x = Array.from({ length: 9 }, () => 2 * random() - 1);
    const variant = i % 3;
    const a = 1 + 0.4 * x[0] + 0.3 * x[1] ** 2 + 0.2 * x[2] + 0.08 * variant;
    const b = 4 - x[1] + 0.4 * Math.sin(x[3] * Math.PI) + 0.8 * x[4] * x[5];
    const c = 3 + x[6] ** 2 + 0.7 * x[7] + 0.3 * x[8] + 0.2 * variant;
    rows.push(
      [
        ...x,
        "Variant " + variant,
        a,
        b,
        c,
        a + 0.14 * b > 1.95 ? "Fails" : "Passes",
      ].join(","),
    );
  }
  return rows.join("\n");
}

async function datasets() {
  const project = emptyProject();
  const scenarios = [
    {
      name: "Cantilever",
      csv: cantileverCsv(),
      input: [0, 1, 2, 3],
      categorical: [3, 6],
      output: [5, 7, 6],
      threshold: 1,
      constrained: 7,
    },
    {
      name: "Synthetic 10,000",
      csv: syntheticCsv(),
      input: [...Array(10).keys()],
      categorical: [9, 13],
      output: [10, 11, 12, 13],
      threshold: 1.2,
      constrained: 10,
    },
  ];
  return await Promise.all(
    scenarios.map(async (scenario) => {
      const dataset = await parseCsv(scenario.csv, scenario.name, ",", [""]);
      const holdout = studyHoldout({ snapshot: project }, dataset);
      const variable = (i: number) =>
        configureVariable(
          dataset,
          project,
          "c" + i,
          scenario.categorical.includes(i) ? "categorical" : "discretised",
          "equalWidth",
          4,
          [],
        );
      return {
        name: scenario.name,
        rows: dataset.rows.length,
        models: scenario.output.map((i) => {
          const response = variable(i);
          const predictors = (
            scenario.name === "Cantilever" &&
            cantileverHeaders[i] === "Beam mass (kg)"
              ? [0, 1, 3]
              : scenario.input
          ).map(variable);
          const constraint: StudyNode["constraint"] =
            i === scenario.constrained
              ? { kind: "numeric", operator: "lt", value: scenario.threshold }
              : scenario.categorical.includes(i)
                ? { kind: "categories", values: ["Passes"] }
                : undefined;
          return {
            response,
            predictors,
            constraint,
            split: trainingSplit(dataset, response, predictors, [""], holdout),
          };
        }),
      };
    }),
  );
}

self.onmessage = async ({ data }) => {
  try {
    const start = performance.now();
    let python: PyodideApi | undefined;
    if (data.runtime === "wasm") {
      const indexURL = new URL("../study-benchmark-assets/", self.location.href)
        .href;
      const module = (await import(
        /* @vite-ignore */ indexURL + "pyodide.mjs"
      )) as typeof import("pyodide");
      python = await module.loadPyodide({ indexURL });
      await python.loadPackage("scikit-learn");
      python.runPython(`
import json
from time import perf_counter
import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF
from sklearn.preprocessing import StandardScaler
`);
    }
    const startupMs = performance.now() - start;
    self.postMessage({ ready: true, startupMs });
    const scenarios = await datasets();
    const report = [];
    for (const scenario of scenarios) {
      const models = [];
      for (const {
        response,
        predictors,
        split,
        constraint,
      } of scenario.models) {
        const limit = split.categorical ? 768 : GP_TRAINING_LIMIT;
        const indices = sampleIndices(split.train.length, limit);
        const quality = (prediction: number[]) =>
          scoreValidation(
            response,
            predictors.map((v) => v.label),
            split,
            prediction,
            constraint,
          );
        const batch = Array.from(
          { length: 2048 },
          (_, i) => split.holdout[i % split.holdout.length],
        );
        if (python && !split.categorical) {
          self.postMessage({ fitStarted: "sklearn-gp" });
          python.globals.set(
            "payload",
            JSON.stringify({
              train: indices.map((i) => split.train[i]),
              truth: indices.map((i) => split.labels[i]),
              holdout: split.holdout,
              batch,
            }),
          );
          const report = JSON.parse(
            python.runPython(`
data = json.loads(payload)
started = perf_counter()
scaler = StandardScaler().fit(data["train"])
train = scaler.transform(data["train"])
model = GaussianProcessRegressor(kernel=RBF(np.sqrt(train.shape[1])), alpha=0.025, normalize_y=True, optimizer=None)
model.fit(train, data["truth"])
fitMs = (perf_counter()-started)*1000
validation_started = perf_counter()
means, std = model.predict(scaler.transform(data["holdout"]), return_std=True)
validationMs = (perf_counter()-validation_started)*1000
batch = scaler.transform(data["batch"])
pred_started = perf_counter()
model.predict(batch)
pointMs = (perf_counter()-pred_started)*1000
std_started = perf_counter()
model.predict(batch, return_std=True)
uncertaintyMs = (perf_counter()-std_started)*1000
json.dumps(dict(fitMs=fitMs, validationMs=validationMs, pointMs=pointMs, uncertaintyMs=uncertaintyMs, prediction=means.tolist(), std=std.tolist()))
`) as string,
          ) as {
            prediction: number[];
            std: number[];
            fitMs: number;
            validationMs: number;
            pointMs: number;
            uncertaintyMs: number;
          };
          const { prediction, std, ...timing } = report;
          models.push({
            label: response.label,
            estimator: "sklearn-gp",
            ...timing,
            ...quality(prediction),
            fittedRows: indices.length,
            intervalCoverage:
              split.truth.filter(
                (y, i) => Math.abs(y - prediction[i]) <= 1.96 * std[i],
              ).length / split.truth.length,
          });
        } else if (!python) {
          const fit = (estimator: string, trainLimit: number): NumericModel => {
            if (estimator === "forest") {
              const predict = fitJavaScript(split, 491, trainLimit);
              return (rows) => predict(rows).map((value) => ({ value }));
            }
            const sample = sampleIndices(split.train.length, trainLimit);
            const rows = sample.map((i) => split.train[i]),
              y = sample.map((i) => split.labels[i]);
            return estimator === "gp"
              ? fitGaussianProcess(rows, y)
              : fitSurface(rows, y, estimator === "quadratic");
          };
          const recipes: [string, number][] = [["forest", 768]];
          if (!split.categorical)
            recipes.push(
              ["forest", limit],
              ["linear", limit],
              ["quadratic", limit],
              ["linear", SURFACE_TRAINING_LIMIT],
              ["quadratic", SURFACE_TRAINING_LIMIT],
              ["gp", limit],
            );
          for (const [estimator, trainLimit] of recipes) {
            if (data.stopAfter && data.stopAfter !== estimator) continue;
            self.postMessage({ fitStarted: estimator });
            const before = performance.now();
            const model = fit(estimator, trainLimit);
            const fitMs = performance.now() - before;
            const startValidation = performance.now();
            const values = model(split.holdout, true);
            const validationMs = performance.now() - startValidation;
            const startPoint = performance.now();
            model(batch, false);
            const pointMs = performance.now() - startPoint;
            const startUncertainty = performance.now();
            if (estimator === "gp") model(batch, true);
            const uncertaintyMs =
              estimator === "gp"
                ? performance.now() - startUncertainty
                : undefined;
            const coverage =
              estimator === "gp"
                ? split.truth.filter(
                    (y, i) =>
                      Math.abs(y - values[i].value) <=
                      1.96 * (values[i].std ?? 0),
                  ).length / split.truth.length
                : undefined;
            models.push({
              label: response.label,
              estimator,
              matched: trainLimit === limit && !split.categorical,
              ...quality(values.map((item) => item.value)),
              fittedRows: Math.min(trainLimit, split.train.length),
              fitMs,
              validationMs,
              pointMs,
              uncertaintyMs,
              intervalCoverage: coverage,
            });
          }
        }
        self.postMessage({ model: response.label, scenario: scenario.name });
      }
      report.push({ name: scenario.name, rows: scenario.rows, models });
    }
    self.postMessage({ report, startupMs });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
