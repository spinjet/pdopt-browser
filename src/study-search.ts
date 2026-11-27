import type { Study, StudyValue } from "./domain";
import { shuffle } from "./data-columns";
import { randomGenerator } from "./numbers";
import {
  STUDY_BUDGET,
  type Evaluation,
  type StudyDesign,
  type StudyRegion,
  type StudyRun,
} from "./study";
import type { ResponseModel } from "./study-model";
import { evaluateCandidates } from "./study-evaluate";
import { buildStudyPlan } from "./study-plan";

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

export function searchStudy(
  study: Study,
  retained: StudyRegion[],
  models: ResponseModel[],
  progress: (update: {
    regions: number;
    total: number;
    evaluated: number;
    feasible: number;
    violated: number;
    unevaluable: number;
  }) => void,
): StudyRun {
  const rng = randomGenerator(11593);
  const plan = buildStudyPlan(study);
  const objective = plan.objectives.map((v) => ({
    id: v.id,
    sign: study.nodes[v.id].objective === "min" ? 1 : -1,
  }));
  const objectiveValue = (evaluation: Evaluation) =>
    objective.map(({ id, sign }) => sign * Number(evaluation.outputs[id]));
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
  const summary = { feasible: 0, violated: 0, unevaluable: 0 };
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
      const predictions = evaluateCandidates(
        unique,
        models,
        plan.constraints,
        objective.map((item) => item.id),
        { uncertainty: true },
      );
      for (const [i, inputs] of unique.entries()) {
        const predicted = predictions[i];
        local.push({
          id: "region-" + region.index + "-design-" + (local.length + 1),
          region: region.index,
          inputs,
          predicted,
        });
        summary[
          predicted.feasible
            ? "feasible"
            : predicted.status === "Violated"
              ? "violated"
              : "unevaluable"
        ]++;
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
        ...summary,
      });
  }
  const front = nonDominated(
    designs.filter((design) => design.predicted.feasible),
    (design) => objectiveValue(design.predicted),
  );
  for (const design of front) design.predicted.pareto = true;
  return {
    designs,
    summary,
    validation: models.map((model) => model.validation),
  };
}
