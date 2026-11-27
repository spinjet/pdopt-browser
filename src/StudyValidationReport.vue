<script setup lang="ts">
import { computed, ref } from "vue";
import type { Study } from "./domain";
import { constraintDefinitions, constraintLabel } from "./study-constraints";
import type { StudyValidationReport } from "./study-model";
import { displayValue } from "./study-plot";

const props = defineProps<{ study: Study; report: StudyValidationReport }>();
const page = ref(0),
  pageSize = 10;
const rows = computed(() =>
  props.report.nearLimits.slice(
    page.value * pageSize,
    (page.value + 1) * pageSize,
  ),
);
const label = (id: string) =>
  props.study.snapshot.variables.find((v) => v.id === id)?.label ?? id;
const rule = (id: string) => {
  const match = constraintDefinitions(props.study).find(
    (rule) => rule.id === id,
  );
  return match ? constraintLabel(props.study, match) : id;
};
</script>
<template>
  <section
    aria-labelledby="feasibility-validation-heading"
    class="study-feasibility-validation"
  >
    <h3 id="feasibility-validation-heading">Held-out feasibility</h3>
    <p>
      {{ report.feasibility.scored }} of {{ report.holdout }} rows scored ·
      {{ report.feasibility.unevaluable }} unevaluable.
      {{ report.feasibility.missed }} of
      {{ report.feasibility.predictedFeasible }} predicted-feasible rows
      violated a recorded requirement. {{ report.feasibility.rejected }} of
      {{ report.feasibility.observedFeasible }} observed-feasible rows were
      rejected.
    </p>
    <p v-if="report.comparisonError" class="field-error">
      Direct comparison unavailable. {{ report.comparisonError }}
    </p>
    <details v-if="report.comparison">
      <summary>Direct versus graph-based predictions</summary>
      <p>
        {{ report.comparison.scored }} shared rows with evaluable feasibility in
        both runs. Both runs use the same holdout and estimator settings.
      </p>
      <div class="study-table">
        <table>
          <thead>
            <tr>
              <th>Prediction path</th>
              <th>Missed violations / predicted-feasible</th>
              <th>False rejections / observed-feasible</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="path in ['configured', 'direct'] as const" :key="path">
              <th scope="row">
                {{
                  path === "configured"
                    ? "Configured path"
                    : "Direct from inputs"
                }}
              </th>
              <td>
                {{ report.comparison[path].missed }} /
                {{ report.comparison[path].predictedFeasible }}
              </td>
              <td>
                {{ report.comparison[path].rejected }} /
                {{ report.comparison[path].observedFeasible }}
              </td>
            </tr>
          </tbody>
        </table>
        <table v-if="report.comparison.responses.length">
          <thead>
            <tr>
              <th>Response</th>
              <th>Shared scored rows</th>
              <th>Configured score</th>
              <th>Direct score</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in report.comparison.responses"
              :key="row.configured.id"
            >
              <th scope="row">{{ label(row.configured.id) }}</th>
              <td>{{ row.shared }}</td>
              <td>
                {{ row.configured.metric }}
                {{
                  row.shared
                    ? displayValue(row.configured.value)
                    : "Unavailable"
                }}
              </td>
              <td>
                {{ row.direct.metric }}
                {{
                  row.shared ? displayValue(row.direct.value) : "Unavailable"
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
    <details v-if="report.nearLimits.length">
      <summary>
        Inspect {{ report.nearLimits.length }} held-out rows near numerical
        limits
      </summary>
      <div class="study-toolbar">
        <button :disabled="page === 0" @click="page--">
          Previous held-out rows
        </button>
        <span
          >{{ page + 1 }} of
          {{ Math.ceil(report.nearLimits.length / pageSize) }}</span
        >
        <button
          :disabled="(page + 1) * pageSize >= report.nearLimits.length"
          @click="page++"
        >
          Next held-out rows
        </button>
      </div>
      <div class="study-table">
        <table>
          <thead>
            <tr>
              <th>Data row</th>
              <th>Constraint</th>
              <th>Observed value and status</th>
              <th>Predicted value and status</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in rows" :key="row.row">
              <tr v-for="limit in row.limits" :key="limit.observed.id">
                <th scope="row">{{ row.row }}</th>
                <td>{{ rule(limit.observed.id) }}</td>
                <td>
                  {{
                    Object.values(limit.observed.values)
                      .map(displayValue)
                      .join(", ")
                  }}
                  · {{ limit.observed.status }}
                </td>
                <td>
                  {{
                    Object.values(limit.predicted?.values ?? {})
                      .map(displayValue)
                      .join(", ")
                  }}
                  · {{ limit.predicted?.status ?? "Unevaluable" }}
                  {{ limit.predicted?.reason }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>
