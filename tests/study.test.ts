import { expect, test } from "vitest";
import { emptyProject, validateProject } from "../src/domain";
import {
  cantileverCsv,
  cantileverInputs,
  massCutsKg,
} from "../src/cantilever-example";
import { configureVariable, parseCsv } from "../src/processing";
import {
  checkStudy,
  initialiseStudy,
  selectRegions,
  studyObservedCounts,
  studyResponses,
} from "../src/study";
import { compileConstraint } from "../src/study-constraints";
import { buildStudyPlan } from "../src/study-plan";
import { evaluateCandidates } from "../src/study-evaluate";
import { searchStudy } from "../src/study-search";
import {
  fitResponse,
  fitStudy,
  studyHoldout,
  fitStudyWithValidation,
  scoreValidation,
  type TrainingSplit,
} from "../src/study-model";

async function beam() {
  const csv = cantileverCsv();
  const dataset = await parseCsv(csv, "cantilever-beam.csv", ",", [""]);
  const project = emptyProject();
  project.example = "cantilever";
  project.dataset = {
    name: dataset.name,
    hash: dataset.hash,
    rowCount: dataset.rows.length,
    headers: dataset.headers,
    delimiter: ",",
  };
  project.variables = dataset.headers.map((_, i) => {
    const cuts = cantileverInputs[i]?.cuts ?? (i === 7 ? massCutsKg : [1]);
    return configureVariable(
      dataset,
      project,
      "c" + i,
      [3, 6].includes(i) ? "categorical" : "discretised",
      "manual",
      cuts.length + 1,
      cuts,
      { lower: "unbounded", upper: "unbounded" },
    );
  });
  const [w, d, load, material, , , failure, mass] = project.variables;
  const targets = [w.id, d.id, material.id];
  project.evidence = {
    [load.id]: 1,
    [failure.id]: failure.states.indexOf("Passes"),
    [mass.id]: { kind: "threshold", operator: "lt", value: 1 },
  };
  project.queryGroups = [
    { id: "beam-design", name: "Design space", targetIds: targets },
  ];
  const posterior = Array<number>(48).fill(0);
  posterior[4] = 0.5;
  posterior[material.states.length * 4] = 0.25;
  posterior[material.states.length * 5] = 0.25;
  const study = initialiseStudy(
    project,
    { targetIds: targets, shape: [4, 4, 3], posterior, prior: posterior },
    "beam-design",
    "Beam design",
    6,
    dataset.hash,
  );
  study.coverage = 0.75;
  return { study, dataset, project, w, d, load, material, mass, failure };
}

test("selects joint regions with ties and reports bounds clipping and available coverage", async () => {
  const { study, w, material } = await beam();
  const initial = selectRegions(study);
  expect(initial.retained.map((r) => r.index)).toEqual([4, 12, 15]);
  expect(initial.achieved).toBe(1);
  study.nodes[w.id].min = 24;
  const smaller = selectRegions(study);
  expect(smaller.retained.map((r) => r.index)).toEqual([12, 15]);
  expect(smaller.available).toBe(0.5);
  expect(smaller.retained[0].bounds[w.id]).toMatchObject({ min: 24 });
  expect(smaller.retained[0].clipped).toContain(w.label);
  study.nodes[material.id].categories = [];
  expect(selectRegions(study).retained).toHaveLength(0);
  expect(selectRegions(study).exclusions).toContain(
    "Material allowed categories",
  );
});

test("fits the beam responses, preserves joint region bounds and checks surrogate feasibility", async () => {
  const { study, dataset, project, w, d, load, material, mass, failure } =
    await beam();
  expect(study.nodes[mass.id].objective).toBe("min");
  expect(study.constraints).toContainEqual(
    expect.objectContaining({
      kind: "numeric",
      variableId: mass.id,
      value: 1,
    }),
  );
  expect(studyResponses(study)).toHaveLength(3);
  expect(
    studyObservedCounts(study, dataset)?.reduce((a, b) => a + b, 0),
  ).toBeGreaterThan(0);
  const reopened = validateProject(
    JSON.parse(JSON.stringify({ ...project, schemaVersion: 4, study })),
  );
  expect(reopened.study?.notation).toBe("Beam design");
  const { retained } = checkStudy(study, dataset);
  const models = fitStudy(study, dataset, () => {});
  const run = searchStudy(study, retained, models, () => {});
  const studyMass = models.find((model) => model.variable.id === mass.id)!;
  const samplingMass = fitResponse(
    dataset,
    mass,
    studyMass.validation.predictors.map((id) =>
      project.variables.find((v) => v.id === id)!,
    ),
    project.missingTokens,
    undefined,
    "forest",
    studyHoldout(study, dataset),
  );
  const designs = run.designs.slice(0, 5).map((design) => design.inputs);
  expect(samplingMass.fitKey).toBe(studyMass.fitKey);
  expect(samplingMass.predict(designs)).toEqual(studyMass.predict(designs));
  const front = run.designs.filter((x) => x.predicted.pareto);
  expect(front.length).toBeGreaterThan(0);
  expect(run.validation.every((row) => row.holdout > 0)).toBe(true);
  for (const design of run.designs) {
    const region = retained.find((r) => r.index === design.region)!;
    expect(design.inputs[load.id]).toBe(100);
    expect(region.bounds[material.id]).toMatchObject({
      values: [design.inputs[material.id]],
    });
    for (const v of [w, d]) {
      const bounds = region.bounds[v.id];
      if ("min" in bounds) {
        expect(design.inputs[v.id]).toBeGreaterThanOrEqual(bounds.min);
        expect(design.inputs[v.id]).toBeLessThanOrEqual(bounds.max);
      }
    }
    if (design.predicted.pareto) {
      expect(design.predicted.feasible).toBe(true);
      expect(design.predicted.outputs[failure.id]).toBe("Passes");
      expect(Number(design.predicted.outputs[mass.id])).toBeLessThan(1);
    }
  }
  const blocked = structuredClone(study);
  blocked.constraints!.push({
    id: "unreachable",
    variableId: mass.id,
    kind: "numeric",
    operator: "lt",
    value: 0,
  });
  expect(
    searchStudy(blocked, retained, models, () => {}).designs.every(
      (d) => !d.predicted.feasible,
    ),
  ).toBe(true);
});

test("normalises held-out numeric errors by the observed range", async () => {
  const { mass } = await beam();
  const split: TrainingSplit = {
    train: [],
    labels: [],
    holdout: [[0], [1], [2]],
    truth: [-2, 0, 8],
    categorical: false,
    dropped: 0,
  };
  const score = scoreValidation(mass, [], split, [-1, 2, 5]);
  expect(score.value).toBe(2);
  expect(score.numericError).toEqual({
    minObserved: -2,
    maxObserved: 8,
    meanRelative: 0.2,
    maxRelative: 0.3,
    maxAbsolute: 3,
  });
  const constant = scoreValidation(
    mass,
    [],
    { ...split, truth: [0, 0, 0] },
    [1, 0, -1],
  );
  expect(constant.value).toBeCloseTo(2 / 3);
  expect(constant.numericError?.meanRelative).toBeNull();
  expect(constant.numericError?.maxRelative).toBeNull();
});

test("migrates legacy limits and preserves the strict boundary at full precision", async () => {
  const { project, study, mass, failure, w } = await beam();
  delete study.constraints;
  study.nodes[mass.id].constraint = {
    kind: "numeric",
    operator: "lt",
    value: 1,
  };
  study.nodes[failure.id].constraint = {
    kind: "categories",
    values: ["Passes"],
  };
  const restored = validateProject(
    JSON.parse(JSON.stringify({ ...project, study })),
  ).study!;
  expect(restored.nodes[mass.id].constraint).toBeUndefined();
  const numeric = restored.constraints!.find((c) => c.kind === "numeric")!;
  const rule = compileConstraint(restored, numeric);
  expect(rule.check({ [mass.id]: 1 })).toMatchObject({
    status: "Violated",
    margin: 0,
  });
  if (numeric.kind !== "numeric") throw new Error("Expected numerical rule");
  expect(
    compileConstraint(restored, { ...numeric, operator: "lte" }).check({
      [mass.id]: 1,
    }),
  ).toMatchObject({ status: "Pass", margin: 0 });
  expect(rule.check({})).toMatchObject({
    status: "Unevaluable",
    reason: expect.stringContaining(mass.label),
  });
  const relation = compileConstraint(restored, {
    id: "relation",
    kind: "expression",
    expression: `[${w.label}] / ([${w.label}] - 15) >= 1`,
  });
  expect(relation.check({ [w.id]: 15 })).toMatchObject({
    status: "Unevaluable",
    reason: "Division by zero.",
  });
  expect(restored.constraints).toContainEqual(
    expect.objectContaining({ kind: "categories", values: ["Passes"] }),
  );
  expect(
    validateProject(JSON.parse(JSON.stringify({ ...project, study: restored })))
      .study?.constraints,
  ).toEqual(restored.constraints);
});

test("validates a chained failure model on the same beam holdout as direct modelling", async () => {
  const { study, dataset, w, d, load, material, failure } = await beam();
  const stress = study.snapshot.variables[4];
  study.snapshot.edges = [
    [w, stress],
    [d, stress],
    [load, stress],
    [stress, failure],
    [material, failure],
  ].map(([a, b], i) => ({
    id: "edge-" + i,
    source: a.id,
    target: b.id,
  }));
  study.nodes[failure.id].predictorMode = "parents";
  const { report } = fitStudyWithValidation(study, dataset, () => {});
  const order = report.validation.map((v) => v.id);
  expect(order.indexOf(stress.id)).toBeLessThan(order.indexOf(failure.id));
  expect(report.comparison?.scored).toBe(report.holdout);
  expect(
    report.comparison?.responses.find((row) => row.configured.id === failure.id)
      ?.shared,
  ).toBe(report.holdout);
  expect(
    report.validation
      .find((row) => row.id === failure.id)
      ?.confusion?.counts.flat()
      .reduce((a, b) => a + b, 0),
  ).toBe(report.holdout);
});

test("filters input-only violations before predicting and reuses one intermediate across unrelated responses", async () => {
  const dataset = await parseCsv(
    "Diameter,Pressure,Flow,Energy,Design\n" +
      Array.from(
        { length: 40 },
        (_, i) =>
          `${i + 1},${2 * (i + 1)},${4 * (i + 1)},${8 * (i + 1)},Group-${i >> 1}`,
      ).join("\n"),
    "pump.csv",
    ",",
    [""],
  );
  const project = emptyProject();
  const vars = (project.variables = [0, 1, 2, 3].map((i) =>
    configureVariable(
      dataset,
      project,
      "c" + i,
      "discretised",
      "equalWidth",
      2,
      [],
    ),
  ));
  const [diameter, pressure, flow, energy] = vars;
  project.edges = [
    [diameter, pressure],
    [pressure, flow],
    [pressure, energy],
  ].map(([a, b], i) => ({ id: "pump-" + i, source: a.id, target: b.id }));
  const study = initialiseStudy(
    project,
    {
      targetIds: [diameter.id],
      shape: [2],
      posterior: [0.5, 0.5],
      prior: [0.5, 0.5],
    },
    "pump",
    "Pump study",
    0,
    dataset.hash,
  );
  study.nodes[energy.id] = {
    role: "response",
    objective: "min",
    predictorMode: "parents",
    estimator: "linear",
  };
  study.nodes[flow.id].predictorMode = "parents";
  study.nodes[flow.id].estimator = "quadratic";
  study.nodes[pressure.id].estimator = "gaussian-process";
  study.constraints = [
    {
      id: "inlet",
      kind: "numeric",
      variableId: diameter.id,
      operator: "gte",
      value: 10,
    },
    { id: "flow-limit", kind: "expression", expression: "[Flow] >= 20" },
  ];
  study.validationSeed = 10;
  study.designIdColumn = 4;
  const holdout = studyHoldout(study, dataset);
  expect(holdout).toEqual(studyHoldout(study, dataset));
  expect([...holdout].every((i) => holdout.has(i ^ 1))).toBe(true);
  const plan = buildStudyPlan(study);
  expect(
    plan.models.filter((entry) => entry.response.id === pressure.id),
  ).toHaveLength(1);
  const models = fitStudy(study, dataset, () => {});
  const shared = models.find((model) => model.variable.id === pressure.id)!;
  const original = shared.predictDetails!;
  let calls = 0;
  shared.predictDetails = (rows) => {
    calls += rows.length;
    return original(rows);
  };
  const results = evaluateCandidates(
    [{ [diameter.id]: 2 }, { [diameter.id]: 15 }, {}],
    models,
    plan.constraints,
    [energy.id],
    { uncertainty: true },
  );
  expect(results.map((row) => row.status)).toEqual([
    "Violated",
    "Pass",
    "Unevaluable",
  ]);
  expect(calls).toBe(1);
  expect(results[1].uncertainty[pressure.id]).toBeGreaterThanOrEqual(0);
  expect(results[1].outputs).toHaveProperty(flow.id);
  expect(results[1].outputs).toHaveProperty(energy.id);
  const rerun = evaluateCandidates(
    [{ [diameter.id]: 15 }],
    fitStudy(study, dataset, () => {}),
    plan.constraints,
    [energy.id],
    { uncertainty: true },
  );
  expect(rerun[0]).toEqual(results[1]);
  study.snapshot.edges.push({
    id: "cycle",
    source: energy.id,
    target: pressure.id,
  });
  expect(() => buildStudyPlan(study)).toThrow(/cycle/i);
});
