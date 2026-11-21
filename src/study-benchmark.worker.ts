import { cantileverCsv, cantileverHeaders } from "./cantilever-example";
import { emptyProject, type StudyNode } from "./domain";
import { configureVariable, parseCsv } from "./processing";
import { randomGenerator } from "./numbers";
import { fitJavaScript, scoreValidation, trainingSplit } from "./study-model";

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
            split: trainingSplit(dataset, response, predictors, [""]),
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
      python.runPython(
        "from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor",
      );
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
        const before = performance.now();
        let prediction: number[];
        if (python) {
          python.globals.set("payload", JSON.stringify(split));
          const result = python.runPython(`
import json
data = json.loads(payload)
factory = RandomForestClassifier if data["categorical"] else RandomForestRegressor
model = factory(n_estimators=24, max_depth=12, min_samples_leaf=3, n_jobs=1, random_state=491)
model.fit(data["train"], data["labels"])
json.dumps(model.predict(data["holdout"]).tolist())
`) as string;
          prediction = JSON.parse(result) as number[];
        } else prediction = fitJavaScript(split)(split.holdout);
        const fitAndPredictMs = performance.now() - before;
        const quality = scoreValidation(
          response,
          predictors.map((v) => v.label),
          split,
          prediction,
          constraint,
        );
        models.push({
          label: response.label,
          fitAndPredictMs,
          metric: quality.metric,
          value: quality.value,
          violations: quality.violations,
          missed: quality.missed,
          near: quality.near,
          nearMissed: quality.nearMissed,
          holdout: quality.holdout,
        });
        self.postMessage({ model: response.label, scenario: scenario.name });
      }
      report.push({ name: scenario.name, rows: scenario.rows, models });
    }
    self.postMessage({ report, startupMs });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
