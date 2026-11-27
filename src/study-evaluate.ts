import type {
  CandidateValues,
  CompiledConstraint,
  ConstraintOutcome,
} from "./study-constraints";
import type { ResponseModel } from "./study-model";
import type { Evaluation } from "./study";

export function evaluateCandidates(
  inputs: CandidateValues[],
  models: ResponseModel[],
  constraints: CompiledConstraint[],
  objectives: string[],
  options: { uncertainty?: boolean; stopOnViolation?: boolean } = {},
): Evaluation[] {
  const stop = options.stopOnViolation ?? true;
  const outcomes: Map<string, ConstraintOutcome>[] = inputs.map(
    () => new Map(),
  );
  const outputs = inputs.map(() => ({}) as CandidateValues);
  const values = inputs.map((row) => ({ ...row }));
  const uncertainty = inputs.map(() => ({}) as Record<string, number>);
  const errors = inputs.map(() => ({}) as Record<string, string>);
  const provided = new Set(inputs.flatMap((row) => Object.keys(row)));
  const known = new Set(provided);
  function checkReady() {
    for (const rule of constraints) {
      if (!rule.references.every((id) => known.has(id))) continue;
      for (const [i, candidate] of values.entries()) {
        if (!outcomes[i].has(rule.definition.id)) {
          outcomes[i].set(rule.definition.id, rule.check(candidate));
        }
      }
    }
  }
  const rejected = (i: number) =>
    stop && [...outcomes[i].values()].some((row) => row.status === "Violated");
  checkReady();
  for (const model of models) {
    const id = model.variable.id;
    const active = values.flatMap((row, i) => {
      if (rejected(i)) return [];
      const missing = model.validation.predictors.find(
        (parent) => row[parent] === undefined,
      );
      if (missing) {
        errors[i][id] =
          errors[i][missing] ??
          `Missing predictor for ${model.variable.label}.`;
        return [];
      }
      return [i];
    });
    function predict(indices: number[]) {
      if (!indices.length) return;
      try {
        const rows = indices.map((i) => values[i]);
        const result =
          model.predictDetails && options.uncertainty
            ? model.predictDetails(rows)
            : model.predict(rows).map((value) => ({ value, std: undefined }));
        for (const [j, i] of indices.entries()) {
          const item = result[j];
          if (
            item?.value === undefined ||
            (typeof item.value === "number" && !Number.isFinite(item.value))
          ) {
            errors[i][id] = `No usable prediction for ${model.variable.label}.`;
            continue;
          }
          values[i][id] = outputs[i][id] = item.value;
          if (item.std !== undefined && Number.isFinite(item.std))
            uncertainty[i][id] = item.std;
        }
      } catch (error) {
        if (indices.length === 1) {
          errors[indices[0]][id] =
            error instanceof Error ? error.message : String(error);
          return;
        }
        // Isolate a bad candidate without discarding an entire prediction batch.
        const split = indices.length >> 1;
        predict(indices.slice(0, split));
        predict(indices.slice(split));
      }
    }
    predict(active);
    known.add(id);
    checkReady();
  }
  return values.map((candidate, i) => {
    const checks = constraints.map((rule) => {
      const outcome =
        outcomes[i].get(rule.definition.id) ?? rule.check(candidate);
      if (outcome.status === "Unevaluable") {
        const missing = rule.references.find(
          (id) => candidate[id] === undefined,
        );
        if (missing && errors[i][missing])
          return { ...outcome, reason: errors[i][missing] };
        if (rejected(i) && missing && !provided.has(missing))
          return {
            ...outcome,
            reason: "Prediction skipped after a constraint violation.",
          };
      }
      return outcome;
    });
    const status = checks.some((row) => row.status === "Violated")
      ? "Violated"
      : checks.some((row) => row.status === "Unevaluable") ||
          objectives.some(
            (id) =>
              typeof candidate[id] !== "number" ||
              !Number.isFinite(candidate[id]),
          )
        ? "Unevaluable"
        : "Pass";
    return {
      outputs: outputs[i],
      uncertainty: uncertainty[i],
      status,
      outcomes: checks,
      pareto: false,
      feasible: status === "Pass",
      margins: Object.fromEntries(
        checks.flatMap((row) =>
          row.margin === undefined ? [] : [[row.id, row.margin]],
        ),
      ),
      reason:
        status === "Unevaluable"
          ? (checks.find((row) => row.reason)?.reason ??
            "One or more objectives have no usable value.")
          : undefined,
    };
  });
}

export function compareFeasibility(
  predicted: Evaluation[],
  observed: Evaluation[],
) {
  let predictedFeasible = 0,
    observedFeasible = 0,
    missed = 0,
    rejected = 0,
    unevaluable = 0;
  for (const [i, prediction] of predicted.entries()) {
    const actual = observed[i];
    if (
      prediction.status === "Unevaluable" ||
      actual.status === "Unevaluable"
    ) {
      unevaluable++;
      continue;
    }
    if (prediction.feasible) {
      predictedFeasible++;
      if (!actual.feasible) missed++;
    }
    if (actual.feasible) {
      observedFeasible++;
      if (!prediction.feasible) rejected++;
    }
  }
  return {
    predictedFeasible,
    observedFeasible,
    missed,
    rejected,
    unevaluable,
    scored: predicted.length - unevaluable,
  };
}
