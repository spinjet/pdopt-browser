import {
  stateLabel,
  type DesignConstraint,
  type Study,
  type StudyValue,
  type Variable,
} from "./domain";
import { compileFormula } from "./formula";
import { encode } from "./processing";

export const comparisonLabels = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
} as const;
export const defaultValidationSeed = 4921;
export type CandidateValues = Record<string, StudyValue>;
export type ConstraintStatus = "Pass" | "Violated" | "Unevaluable";
export interface ConstraintOutcome {
  id: string;
  status: ConstraintStatus;
  values: CandidateValues;
  margin?: number;
  reason?: string;
}
export interface CompiledConstraint {
  definition: DesignConstraint;
  references: string[];
  check(values: CandidateValues): ConstraintOutcome;
}

export function constraintDefinitions(study: Study): DesignConstraint[] {
  return (
    study.constraints ??
    Object.entries(study.nodes).flatMap(([variableId, node]) =>
      node.constraint
        ? [{ ...node.constraint, variableId, id: "legacy-" + variableId }]
        : [],
    )
  );
}

export function constraintLabel(study: Study, rule: DesignConstraint) {
  if (rule.kind === "expression") return rule.expression;
  const variable = study.snapshot.variables.find(
    (v) => v.id === rule.variableId,
  );
  if (!variable) return "Unknown variable";
  if (rule.kind === "numeric")
    return `${variable.label} ${comparisonLabels[rule.operator]} ${rule.value}`;
  const labels =
    rule.kind === "states"
      ? rule.states
      : rule.values.map((raw) => variable.states.indexOf(raw));
  return `${variable.label} ∈ {${labels.map((i) => stateLabel(variable, i)).join(", ")}}`;
}

export function compileConstraint(
  study: Study,
  rule: DesignConstraint,
): CompiledConstraint {
  const variables = study.snapshot.variables;
  let dependencies: Variable[];
  let test: (values: CandidateValues) => { passes: boolean; margin?: number };
  if (rule.kind === "expression") {
    const headers = variables.map((v) => v.label);
    const formula = compileFormula(
      rule.expression,
      headers,
      (i) => variables[i].representation !== "categorical",
      [],
    );
    dependencies = formula.references.map((i) => variables[i]);
    if (!dependencies.length)
      throw new Error("Reference a study variable in the expression.");
    if (
      dependencies.some(
        (v) => headers.indexOf(v.label) !== headers.lastIndexOf(v.label),
      )
    )
      throw new Error(
        "Rename duplicate variable labels before using them in a relationship.",
      );
    const evaluate = (values: CandidateValues) => {
      const result = formula.value((i) => values[variables[i].id]);
      if (typeof result !== "boolean")
        throw new Error("The relationship must evaluate to true or false.");
      return { passes: result };
    };
    const representative = Object.fromEntries(
      dependencies.map((v) => [
        v.id,
        v.representation === "categorical" ? v.states[0] : 1,
      ]),
    );
    // Catch an arithmetic-only or ill-typed expression during Setup. Domain errors
    // such as division by zero can depend on the candidate and are handled there.
    try {
      evaluate(representative);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        ![
          "Division by zero.",
          "The calculation produced a non-finite number.",
        ].includes(error.message)
      )
        throw error;
    }
    test = evaluate;
  } else {
    const variable = variables.find((v) => v.id === rule.variableId);
    if (!variable) throw new Error("Choose an available study variable.");
    dependencies = [variable];
    if (rule.kind === "numeric") {
      if (
        variable.representation === "categorical" ||
        !Number.isFinite(rule.value)
      )
        throw new Error("Choose a numeric variable and a finite limit.");
      test = (values) => {
        const value = values[variable.id];
        if (typeof value !== "number")
          throw new Error("Expected a numeric value.");
        const upper = rule.operator === "lt" || rule.operator === "lte";
        const margin = upper ? rule.value - value : value - rule.value;
        const strict = rule.operator === "lt" || rule.operator === "gt";
        return { passes: strict ? margin > 0 : margin >= 0, margin };
      };
    } else if (rule.kind === "categories") {
      if (
        variable.representation !== "categorical" ||
        !rule.values.length ||
        rule.values.some((value) => !variable.states.includes(value))
      )
        throw new Error("Choose at least one accepted category.");
      test = (values) => ({
        passes: rule.values.includes(String(values[variable.id])),
      });
    } else {
      if (
        !rule.states.length ||
        rule.states.some((i) => i >= variable.states.length)
      )
        throw new Error("Choose at least one valid state.");
      test = (values) => ({
        passes: rule.states.includes(
          encode(variable, String(values[variable.id])),
        ),
      });
    }
  }
  const references = dependencies.map((v) => v.id);
  return {
    definition: rule,
    references,
    check(values) {
      const known: CandidateValues = {};
      try {
        for (const v of dependencies) {
          const value = values[v.id];
          if (
            value === undefined ||
            (typeof value === "number" && !Number.isFinite(value))
          )
            throw new Error(`No usable value for ${v.label}.`);
          known[v.id] = value;
        }
        const { passes, margin } = test(known);
        return {
          id: rule.id,
          status: passes ? "Pass" : "Violated",
          values: known,
          margin,
        };
      } catch (error) {
        return {
          id: rule.id,
          status: "Unevaluable",
          values: known,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
