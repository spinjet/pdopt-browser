<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { z } from "zod";
import { strToU8, zipSync } from "fflate";
import { useProject } from "./store";
import { stateLabel, studyValueSchema, type StudyValue } from "./domain";
import { encode } from "./processing";
import { csvCell, downloadBytes } from "./files";
import { surrogateClient } from "./surrogate-client";
import { formatDecimal } from "./query-figure";
import type { PlotAxis } from "./study-plot";
import type { SampleOptions } from "./sampling";

const props = defineProps<{
  sample: { axes: PlotAxis[]; rows: StudyValue[][]; seed: number };
  options: SampleOptions;
}>();
const emit = defineEmits<{
  change: [
    sample:
      { axes: PlotAxis[]; rows: StudyValue[][]; seed: number } | undefined,
  ];
}>();
const st = useProject();
const variables = computed(() =>
  st.project.variables.filter((v) => v.columnId),
);
const sampled = new Set(props.sample.axes.map((axis) => axis.id));
const inputs = ref(
  variables.value.filter((v) => sampled.has(v.id)).map((v) => v.id),
);
const outputs = ref<string[]>([]);
const fixed = ref<Record<string, string>>({});
// Checkbox selection order must not alter feature order or deterministic model fits.
const predictors = computed(() =>
  variables.value.filter((v) => inputs.value.includes(v.id)),
);
const fixedPredictors = computed(() =>
  predictors.value.filter((v) => !sampled.has(v.id)),
);
const responses = computed(() =>
  variables.value.filter(
    (v) =>
      outputs.value.includes(v.id) &&
      !sampled.has(v.id) &&
      !inputs.value.includes(v.id),
  ),
);
const validation = z.object({
  metric: z.string(),
  value: z.number(),
  holdout: z.number(),
  dropped: z.number(),
});
const reportSchema = z.array(
  z.object({
    id: z.string(),
    reused: z.boolean().optional(),
    validation: validation.optional(),
    error: z.string().optional(),
  }),
);
const reports = ref<z.infer<typeof reportSchema>>([]);
const busy = ref(false);
const error = ref("");
const fitId = ref("");
const applied = ref<{ axes: PlotAxis[]; rows: StudyValue[][]; seed: number }>();
const key = computed(() =>
  JSON.stringify([
    inputs.value,
    outputs.value,
    fixed.value,
    st.project.dataset?.hash,
  ]),
);
watch(key, () => {
  reports.value = [];
  fitId.value = "";
  applied.value = undefined;
  emit("change", undefined);
});
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});
function inputRows(): Record<string, StudyValue>[] {
  const convert = (
    v: (typeof variables.value)[number],
    raw: string | number,
    label: boolean,
  ) => {
    if (v.representation === "categorical") {
      const source =
        st.resultSnapshot?.variables.find((variable) => variable.id === v.id) ??
        v;
      const value = label
        ? source.states[source.stateLabels.indexOf(String(raw))]
        : raw;
      if (value === undefined)
        throw new Error(`Unknown category for ${v.label}.`);
      encode(v, String(value));
      return value;
    }
    encode(v, String(raw));
    return Number(raw);
  };
  const details = predictors.value.map((v) => {
    const i = props.sample.axes.findIndex((axis) => axis.id === v.id);
    return {
      v,
      i,
      value: i < 0 ? convert(v, fixed.value[v.id] ?? "", false) : undefined,
    };
  });
  return props.sample.rows.map((row) =>
    Object.fromEntries(
      details.map(({ v, i, value }) => [
        v.id,
        i < 0 ? value! : convert(v, row[i], true),
      ]),
    ),
  );
}
async function fit() {
  const config = key.value;
  const id = crypto.randomUUID();
  busy.value = true;
  error.value = "";
  reports.value = [];
  fitId.value = "";
  try {
    inputRows();
    const result = reportSchema.parse(
      await surrogateClient.request(
        "sampling-fit",
        JSON.parse(
          JSON.stringify({
            key: id,
            datasetHash: st.project.dataset?.hash ?? "",
            dataset: st.dataset,
            missingTokens: st.project.missingTokens,
            predictors: predictors.value,
            outputs: responses.value,
          }),
        ),
        { timeout: 120000 },
      ),
    );
    if (mounted && config === key.value) {
      reports.value = result;
      fitId.value = id;
    }
  } catch (e) {
    if (mounted) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function predict() {
  const id = fitId.value;
  busy.value = true;
  error.value = "";
  try {
    const rows = inputRows();
    const values = z
      .record(z.string(), z.array(studyValueSchema))
      .parse(
        await surrogateClient.request("sampling-predict", { key: id, rows }),
      );
    if (!mounted || id !== fitId.value) return;
    const outputs = responses.value.filter(
      (v) => values[v.id]?.length === rows.length,
    );
    const show = (v: (typeof variables.value)[number], value: StudyValue) =>
      v.representation === "categorical"
        ? stateLabel(v, v.states.indexOf(String(value)))
        : value;
    const axes = [
      ...props.sample.axes.map((axis) => ({
        ...axis,
        label: axis.label + " (sampled)",
      })),
      ...fixedPredictors.value.map((v) => ({
        id: v.id,
        label: v.label + " (fixed)",
        categories:
          v.representation === "categorical" ? v.stateLabels : undefined,
      })),
      ...outputs.map((v) => ({
        id: v.id,
        label: v.label + " (predicted)",
        categories:
          v.representation === "categorical" ? v.stateLabels : undefined,
      })),
    ];
    applied.value = {
      axes,
      rows: props.sample.rows.map((row, i) => [
        ...row,
        ...fixedPredictors.value.map((v) => show(v, rows[i][v.id])),
        ...outputs.map((v) => show(v, values[v.id][i])),
      ]),
      seed: props.sample.seed,
    };
    emit("change", applied.value);
  } catch (e) {
    if (mounted) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function downloadPredictions() {
  const data = applied.value;
  if (!data) return;
  const columns = data.axes.map((axis) => ({
    variableId: axis.id,
    header: axis.label,
    source: sampled.has(axis.id)
      ? "sampled"
      : inputs.value.includes(axis.id)
        ? "fixed"
        : "predicted",
  }));
  const snapshot = st.resultSnapshot;
  const manifest = {
    formatVersion: 1,
    sampler: "joint-cdf/mulberry32-v1",
    ...props.options,
    projectId: st.project.id,
    query: snapshot?.queryGroups[0],
    datasetHash: st.project.dataset?.hash,
    distribution: st.results?.groups[st.activeGroupId],
    columns,
    predictors: predictors.value.map((v) => v.id),
    fixed: Object.fromEntries(
      fixedPredictors.value.map((v) => [v.id, fixed.value[v.id]]),
    ),
    surrogates: reports.value,
    notes:
      "Predictions are point estimates. Their spread does not measure residual uncertainty.",
  };
  const csv = [columns.map((c) => c.header), ...data.rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  downloadBytes(
    "pdopt-bn-sample-predictions.zip",
    zipSync({
      "samples.csv": strToU8(csv),
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    }),
    "application/zip",
  );
}
</script>

<template>
  <details class="sample-settings">
    <summary>Predict additional variables</summary>
    <p>
      Fit local surrogates or reuse compatible models from Optimisation Study.
      Predictions are point estimates. Their spread does not measure residual
      uncertainty.
    </p>
    <fieldset :disabled="busy">
      <legend>Prediction inputs</legend>
      <label v-for="v in variables" :key="v.id" class="check">
        <input
          type="checkbox"
          :value="v.id"
          v-model="inputs"
          :disabled="outputs.includes(v.id)"
        />
        {{ v.label }} ·
        {{ sampled.has(v.id) ? "sampled" : "fixed value required" }}
      </label>
      <label v-for="v in fixedPredictors" :key="v.id" class="field">
        Fixed {{ v.label }}
        <select v-if="v.representation === 'categorical'" v-model="fixed[v.id]">
          <option disabled value="">Choose a category</option>
          <option v-for="(value, i) in v.states" :key="value" :value="value">
            {{ stateLabel(v, i) }}
          </option>
        </select>
        <input v-else v-model="fixed[v.id]" type="number" step="any" />
      </label>
    </fieldset>
    <fieldset :disabled="busy">
      <legend>Prediction outputs</legend>
      <label
        v-for="v in variables.filter(
          (v) => !sampled.has(v.id) && !inputs.includes(v.id),
        )"
        :key="v.id"
        class="check"
      >
        <input type="checkbox" :value="v.id" v-model="outputs" />{{ v.label }}
      </label>
      <p
        v-if="
          variables.every((v) => sampled.has(v.id) || inputs.includes(v.id))
        "
      >
        No additional dataset variables are available as outputs.
      </p>
    </fieldset>
    <button
      @click="fit"
      :disabled="busy || !predictors.length || !responses.length"
    >
      Fit or reuse surrogates
    </button>
    <p role="status" v-if="busy">Computing local predictions…</p>
    <ul v-if="reports.length">
      <li v-for="report in reports" :key="report.id">
        {{ variables.find((v) => v.id === report.id)?.label }} ·
        <template v-if="report.validation">
          {{ report.reused ? "Study model" : "New fit" }} ·
          {{ report.validation.metric }}
          {{
            formatDecimal(
              report.validation.value,
              st.project.probabilityDecimalPlaces,
            )
          }}
          over {{ report.validation.holdout }} held-out rows ·
          {{ report.validation.dropped }} excluded
        </template>
        <template v-else>{{ report.error }}</template>
      </li>
    </ul>
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      v-if="reports.some((r) => r.validation)"
      @click="predict"
      :disabled="busy"
    >
      Apply predictions
    </button>
    <button v-if="applied" @click="downloadPredictions" :disabled="busy">
      Download samples with predictions
    </button>
  </details>
</template>
