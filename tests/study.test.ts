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
import { searchStudy } from "../src/study-search";
import {
  fitStudy,
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
  expect(study.nodes[mass.id]).toMatchObject({
    objective: "min",
    constraint: { kind: "numeric", value: 1 },
  });
  expect(studyResponses(study)).toHaveLength(3);
  expect(
    studyObservedCounts(study, dataset)?.reduce((a, b) => a + b, 0),
  ).toBeGreaterThan(0);
  const reopened = validateProject(
    JSON.parse(JSON.stringify({ ...project, study })),
  );
  expect(reopened.study?.notation).toBe("Beam design");
  const { retained } = checkStudy(study, dataset);
  const models = fitStudy(study, dataset, () => {});
  const run = searchStudy(study, retained, models, () => {});
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
  blocked.nodes[mass.id].constraint = {
    kind: "numeric",
    operator: "lt",
    value: 0,
  };
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
