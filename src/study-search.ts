import type { Study, StudyValue, Variable } from "./domain";
import { evaluateCantilever, materials } from "./cantilever-example";
import { shuffle } from "./data-columns";
import { randomGenerator } from "./numbers";
import {
  beamColumns,
  STUDY_BUDGET,
  studyResponses,
  type Evaluation,
  type StudyDesign,
  type StudyRegion,
  type StudyRun,
} from "./study";
import { checkConstraint, type ResponseModel } from "./study-model";

function evaluate(
  study: Study,
  outputs: Evaluation["outputs"],
  responses: Variable[],
): Evaluation {
  const margins: Evaluation["margins"] = {};
  let feasible = true;
  for (const v of responses) {
    const constraint = study.nodes[v.id].constraint;
    if (!constraint) continue;
    const result = checkConstraint(v, constraint, outputs[v.id]);
    margins[v.id] = result.margin;
    feasible &&= result.passes;
  }
  return { outputs, feasible, pareto: false, margins };
}

function objectives(study: Study, responses: Variable[]) {
  return responses.flatMap((v) => {
    const direction = study.nodes[v.id].objective;
    return direction ? [{ id: v.id, sign: direction === "min" ? 1 : -1 }] : [];
  });
}

function dominates(a: number[], b: number[]) {
  return (
    a.every((value, i) => value <= b[i]) && a.some((value, i) => value < b[i])
  );
}

function nonDominated<T>(items: T[], values: (x: T) => number[]): T[] {
  let front: { item: T; values: number[] }[] = [];
  for (const item of items) {
    const objectiveValues = values(item);
    if (front.some((p) => dominates(p.values, objectiveValues))) continue;
    front = front.filter((p) => !dominates(objectiveValues, p.values));
    front.push({ item, values: objectiveValues });
  }
  return front.map((entry) => entry.item);
}

function beamEvaluator(study: Study, responses: Variable[]) {
  const columns = beamColumns(study);
  if (!columns) return;
  const [width, depth, load, material] = columns;
  if (
    !width ||
    !depth ||
    !load ||
    !material ||
    [width, depth, load, material].some(
      (v) => !["input", "fixed"].includes(study.nodes[v.id].role),
    ) ||
    responses.some((v) => !["c4", "c5", "c6", "c7"].includes(v.columnId))
  )
    return;
  return (input: Record<string, StudyValue>) => {
    const selected = materials.find((m) => m.name === input[material.id]);
    if (!selected) throw new Error("Unknown cantilever material.");
    const w = Number(input[width.id]),
      d = Number(input[depth.id]),
      f = Number(input[load.id]);
    if (w <= 0 || d <= 0 || f < 0)
      throw new Error(
        "The beam equations require positive dimensions and nonnegative load.",
      );
    const result = evaluateCantilever(w, d, f, selected);
    const columns = {
      c4: result.stress,
      c5: result.deflection,
      c6: result.failure,
      c7: result.massKg,
    };
    return evaluate(
      study,
      Object.fromEntries(
        responses.map((v) => [
          v.id,
          columns[v.columnId as keyof typeof columns],
        ]),
      ),
      responses,
    );
  };
}

export function searchStudy(
  study: Study,
  retained: StudyRegion[],
  models: ResponseModel[],
  progress: (update: {
    regions: number;
    total: number;
    evaluated: number;
    feasible: number;
  }) => void,
): StudyRun {
  const rng = randomGenerator(11593);
  const responses = studyResponses(study);
  const objective = objectives(study, responses);
  const objectiveValue = (evaluation: Evaluation) =>
    objective.map(({ id, sign }) => sign * Number(evaluation.outputs[id]));
  const verify = beamEvaluator(study, responses);
  const fixed = Object.fromEntries(
    study.snapshot.variables.flatMap((v) =>
      study.nodes[v.id].role === "fixed"
        ? [[v.id, study.nodes[v.id].value!]]
        : [],
    ),
  );
  const designs: StudyDesign[] = [];
  const budget = Math.max(
    1,
    Math.min(128, Math.floor(STUDY_BUDGET / retained.length)),
  );
  let feasible = 0;
  for (const [position, region] of retained.entries()) {
    const dimensions = Object.entries(region.bounds);
    const seen = new Set<string>();
    const local: StudyDesign[] = [];
    function batch(rows: Record<string, StudyValue>[]) {
      const unique = rows.filter((row) => {
        const key = JSON.stringify(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const predictions = models.map((model) => model.predict(unique));
      for (const [i, inputs] of unique.entries()) {
        const outputs = Object.fromEntries(
          models.map((model, j) => [model.variable.id, predictions[j][i]]),
        );
        const predicted = evaluate(study, outputs, responses);
        local.push({
          id: "region-" + region.index + "-design-" + (local.length + 1),
          region: region.index,
          inputs,
          predicted,
          verified: verify?.(inputs),
        });
        feasible += Number(predicted.feasible);
      }
    }
    // Start with stratified coverage of each region, then refine around promising designs.
    const initial = Math.ceil(budget / 2);
    const axes = dimensions.map(([id, dimension]) => {
      const values = Array.from({ length: initial }, (_, i) => {
        if ("values" in dimension)
          return dimension.values[i % dimension.values.length];
        const u = (i + rng()) / initial;
        return dimension.min * (1 - u) + dimension.max * u;
      });
      return [id, shuffle(values, rng)] as const;
    });
    batch(
      Array.from({ length: initial }, (_, i) => ({
        ...fixed,
        ...Object.fromEntries(axes.map(([id, values]) => [id, values[i]])),
      })),
    );
    for (let offset = initial; offset < budget;) {
      const count = Math.min(16, budget - offset);
      const valid = local.filter((x) => x.predicted.feasible);
      const seeds = valid.length
        ? nonDominated(valid, (x) => objectiveValue(x.predicted))
        : local
            .slice()
            .sort((a, b) => {
              const failed = (x: StudyDesign) =>
                Object.values(x.predicted.margins).filter((value) => value <= 0)
                  .length;
              return failed(a) - failed(b);
            })
            .slice(0, 4);
      const radius = 0.3 * (1 - offset / budget) + 0.02;
      batch(
        Array.from({ length: count }, () => {
          const center = seeds[Math.floor(rng() * seeds.length)].inputs;
          return {
            ...fixed,
            ...Object.fromEntries(
              dimensions.map(([id, d]) => {
                const value =
                  "values" in d
                    ? d.values[Math.floor(rng() * d.values.length)]
                    : Math.max(
                        d.min,
                        Math.min(
                          d.max,
                          Number(center[id]) +
                            (rng() * 2 - 1) * radius * (d.max - d.min),
                        ),
                      );
                return [id, value];
              }),
            ),
          };
        }),
      );
      offset += count;
    }
    designs.push(...local);
    if (
      position % Math.max(1, Math.floor(retained.length / 100)) === 0 ||
      position + 1 === retained.length
    )
      progress({
        regions: position + 1,
        total: retained.length,
        evaluated: designs.length,
        feasible,
      });
  }
  for (const sort of ["predicted", "verified"] as const) {
    const front = nonDominated(
      designs.filter((d) => d[sort]?.feasible),
      (d) => objectiveValue(d[sort]!),
    );
    for (const design of front) design[sort]!.pareto = true;
  }
  return {
    designs,
    validation: models.map((model) => model.validation),
    verified: !!verify,
  };
}
