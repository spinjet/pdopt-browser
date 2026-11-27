import type { Study, Variable } from "./domain";
import { GP_FEATURE_LIMIT, SURFACE_FEATURE_LIMIT } from "./study-estimators";
import { compileConstraint, constraintDefinitions } from "./study-constraints";

export type Estimator = "forest" | "linear" | "quadratic" | "gaussian-process";
export const estimatorLabels: Record<Estimator, string> = {
  forest: "Random forest",
  linear: "Linear response surface",
  quadratic: "Quadratic response surface",
  "gaussian-process": "Gaussian process",
};

export function isProvided(study: Study, id: string) {
  const role = study.nodes[id]?.role;
  return role === "input" || role === "fixed";
}

export function suggestPredictors(study: Study, response: string): string[] {
  const upstream = new Set<string>();
  function visit(id: string) {
    for (const edge of study.snapshot.edges) {
      if (edge.target === id && !upstream.has(edge.source)) {
        upstream.add(edge.source);
        visit(edge.source);
      }
    }
  }
  visit(response);
  const available = study.snapshot.variables.filter(
    (v) => v.columnId && isProvided(study, v.id),
  );
  const connected = available.filter((v) => upstream.has(v.id));
  return (connected.length ? connected : available).map((v) => v.id);
}

export function predictorMode(study: Study, id: string) {
  const node = study.nodes[id];
  return (
    node.predictorMode ??
    (node.role === "unused" && study.snapshot.edges.some((e) => e.target === id)
      ? "parents"
      : "direct")
  );
}

export function predictorIds(study: Study, id: string) {
  const node = study.nodes[id];
  return predictorMode(study, id) === "parents"
    ? [
        ...new Set([
          ...study.snapshot.edges
            .filter((edge) => edge.target === id)
            .map((edge) => edge.source),
          ...(node.extraPredictors ?? []),
        ]),
      ]
    : (node.predictors ?? suggestPredictors(study, id));
}

export function buildStudyPlan(study: Study) {
  const variables = new Map(study.snapshot.variables.map((v) => [v.id, v]));
  const constraints = constraintDefinitions(study).map((rule) =>
    compileConstraint(study, rule),
  );
  const objectives = study.snapshot.variables.filter(
    (v) =>
      study.nodes[v.id].role === "response" && !!study.nodes[v.id].objective,
  );
  if (objectives.some((v) => v.representation === "categorical"))
    throw new Error("Objectives must be numeric.");
  const models: {
    response: Variable;
    predictors: Variable[];
    estimator: Estimator;
  }[] = [];
  const visiting = new Set<string>();
  const complete = new Set<string>();
  function requireValue(id: string) {
    if (isProvided(study, id) || complete.has(id)) return;
    const response = variables.get(id);
    if (!response) throw new Error(`Unresolved study variable ${id}.`);
    if (visiting.has(id))
      throw new Error(
        `Surrogate dependency cycle involving ${response.label}.`,
      );
    if (!response.columnId)
      throw new Error(
        `No training column for ${response.label}. Set a design input or operating condition instead.`,
      );
    visiting.add(id);
    const mode = predictorMode(study, id);
    const ids = predictorIds(study, id);
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new Error(`Choose predictors for ${response.label}.`);
    if (mode === "direct" && ids.some((input) => !isProvided(study, input)))
      throw new Error(
        `Direct predictors for ${response.label} must be design inputs or fixed conditions.`,
      );
    if (
      mode === "parents" &&
      study.nodes[id].extraPredictors?.some(
        (input) => study.nodes[input]?.role !== "input",
      )
    )
      throw new Error(
        `Additional predictors for ${response.label} must be design inputs.`,
      );
    const predictors = ids.map((input) => {
      const variable = variables.get(input);
      if (!variable?.columnId)
        throw new Error(
          `No training column for ${variable?.label ?? input}, a predictor of ${response.label}.`,
        );
      requireValue(input);
      return variable;
    });
    const estimator = study.nodes[id].estimator ?? "forest";
    if (estimator !== "forest" && response.representation === "categorical")
      throw new Error(
        `Choose random forest for categorical response ${response.label}.`,
      );
    if (
      estimator === "gaussian-process" &&
      response.representation !== "discretised"
    )
      throw new Error(
        `Gaussian process requires a continuous response for ${response.label}.`,
      );
    const features = predictors.reduce(
      (count, variable) =>
        count +
        (variable.representation === "categorical"
          ? variable.states.length
          : 1),
      0,
    );
    if (estimator === "gaussian-process" && features > GP_FEATURE_LIMIT)
      throw new Error(
        `Gaussian process for ${response.label} supports up to ${GP_FEATURE_LIMIT} encoded predictors.`,
      );
    const terms =
      1 +
      features +
      (estimator === "quadratic" ? (features * (features + 1)) / 2 : 0);
    if (
      (estimator === "linear" || estimator === "quadratic") &&
      terms > SURFACE_FEATURE_LIMIT
    )
      throw new Error(
        `The response surface for ${response.label} exceeds ${SURFACE_FEATURE_LIMIT} terms.`,
      );
    models.push({ response, predictors, estimator });
    visiting.delete(id);
    complete.add(id);
  }
  for (const id of [
    ...objectives.map((v) => v.id),
    ...constraints.flatMap((c) => c.references),
  ])
    requireValue(id);
  return { models, objectives, constraints };
}
