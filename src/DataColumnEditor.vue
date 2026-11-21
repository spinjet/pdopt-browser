<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useProject } from "./store";
import { LIMITS } from "./domain";
import { columnReference } from "./formula";
import { columnRequestSchema } from "./data-columns";

const st = useProject();
const props = defineProps<{ kind: "sample" | "calculate" }>();
const preview =
  defineModel<Awaited<ReturnType<typeof st.previewDataColumn>>>("preview");
const emit = defineEmits<{ apply: []; cancel: [] }>();
const name = ref("");
const distributionKind = ref<
  "uniform" | "normal" | "triangular" | "categories"
>("uniform");
const method = ref<"random" | "latin">("latin");
const seed = ref(42);
const rows = ref(512);
const minimum = ref(0);
const maximum = ref(1);
const mode = ref(0.5);
const mean = ref(0);
const deviation = ref(1);
const categories = ref("");
const formula = ref("");
const expression = ref<HTMLTextAreaElement>();
const error = ref("");
watch(
  [
    name,
    distributionKind,
    method,
    seed,
    rows,
    minimum,
    maximum,
    mode,
    mean,
    deviation,
    categories,
    formula,
  ],
  () => {
    preview.value = undefined;
    error.value = "";
  },
);
async function insertColumn(element: HTMLSelectElement) {
  const el = expression.value;
  const header = st.dataset?.headers[Number(element.value)];
  element.value = "";
  if (!el || !header) return;
  const start = el.selectionStart;
  const reference = columnReference(header);
  formula.value =
    formula.value.slice(0, start) +
    reference +
    formula.value.slice(el.selectionEnd);
  await nextTick();
  el.focus();
  el.setSelectionRange(start + reference.length, start + reference.length);
}
async function calculatePreview() {
  error.value = "";
  preview.value = undefined;
  const kind = distributionKind.value;
  const distribution =
    kind === "categories"
      ? {
          kind,
          values: categories.value
            .split(/\r?\n/)
            .map((v) => v.trim())
            .filter(Boolean),
        }
      : kind === "normal"
        ? { kind, mean: mean.value, deviation: deviation.value }
        : { kind, min: minimum.value, max: maximum.value, mode: mode.value };
  const request = columnRequestSchema.safeParse(
    props.kind === "sample"
      ? {
          kind: "sample",
          name: name.value,
          method: method.value,
          seed: seed.value,
          rows: st.dataset?.rows.length ?? rows.value,
          distribution,
        }
      : { kind: "calculate", name: name.value, formula: formula.value },
  );
  if (!request.success) {
    error.value = request.error.issues
      .map(
        (issue) => (issue.path.join(" · ") || "Column") + " — " + issue.message,
      )
      .join("\n");
    return;
  }
  const result = await st.previewDataColumn(request.data);
  if (!result) {
    error.value = st.error;
    st.error = "";
    return;
  }
  preview.value = result;
}
</script>

<template>
  <form class="data-column-editor" @submit.prevent="calculatePreview">
    <fieldset :disabled="st.busy">
      <legend>
        {{ kind === "sample" ? "Sample column" : "Calculate column" }}
      </legend>
      <label
        >Column name
        <input
          id="new-data-column-name"
          v-model="name"
          maxlength="200"
          required
      /></label>
      <template v-if="kind === 'sample'">
        <label
          >Distribution
          <select v-model="distributionKind">
            <option value="uniform">Uniform</option>
            <option value="normal">Normal</option>
            <option value="triangular">Triangular</option>
            <option value="categories">Equal-probability categories</option>
          </select>
        </label>
        <label
          >Sampling method
          <select v-model="method">
            <option value="random">Independent random</option>
            <option value="latin">
              {{
                distributionKind === "categories"
                  ? "Balanced stratified"
                  : "Latin hypercube"
              }}
            </option>
          </select>
        </label>
        <label
          >Seed
          <input
            type="number"
            v-model.number="seed"
            required
            min="0"
            max="4294967295"
        /></label>
        <label v-if="!st.dataset"
          >Row count
          <input
            type="number"
            v-model.number="rows"
            required
            min="1"
            :max="LIMITS.rows"
        /></label>
        <template
          v-if="
            distributionKind === 'uniform' || distributionKind === 'triangular'
          "
        >
          <label
            >Lower bound
            <input type="number" v-model.number="minimum" step="any" required
          /></label>
          <label v-if="distributionKind === 'triangular'"
            >Mode
            <input type="number" v-model.number="mode" step="any" required
          /></label>
          <label
            >Upper bound
            <input type="number" v-model.number="maximum" step="any" required
          /></label>
        </template>
        <template v-else-if="distributionKind === 'normal'">
          <label
            >Mean
            <input type="number" v-model.number="mean" step="any" required
          /></label>
          <label
            >Standard deviation
            <input type="number" v-model.number="deviation" step="any" required
          /></label>
        </template>
        <label v-else
          >Categories (one per line)
          <textarea v-model="categories" rows="3" required />
        </label>
      </template>
      <template v-else>
        <label
          >Insert a column
          <select
            value=""
            @change="insertColumn($event.target as HTMLSelectElement)"
          >
            <option disabled value="">Choose column…</option>
            <option
              v-for="(header, i) in st.dataset?.headers"
              :key="i"
              :value="i"
            >
              {{ header }}
            </option>
          </select>
        </label>
        <label class="column-formula"
          >Formula
          <textarea
            ref="expression"
            v-model="formula"
            rows="2"
            required
            placeholder="=[Width (mm)] * [Depth (mm)]"
          />
        </label>
        <p class="tiny muted">
          Arithmetic, comparisons, IF, AND, OR, NOT. Boolean results are 1 or 0.
        </p>
      </template>
      <div class="data-actions">
        <button class="primary" type="submit">Preview column</button>
        <button type="button" :disabled="!preview" @click="emit('apply')">
          Apply column
        </button>
        <button type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </fieldset>
    <p v-if="st.busy" role="status">
      Preparing preview…
      <button type="button" @click="st.cancel()">Cancel computation</button>
    </p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div v-if="preview">
      <p role="status">
        {{ preview.dataset.rows.length.toLocaleString() }} values ready ·
        {{ preview.missing.toLocaleString() }} missing or invalid
      </p>
      <ul v-if="preview.examples.length">
        <li v-for="example in preview.examples" :key="example.row">
          Row {{ example.row }} — {{ example.message }}
        </li>
      </ul>
      <div class="column-formula-preview">
        <table>
          <thead>
            <tr>
              <th>Row</th>
              <th v-for="i in preview.references" :key="i">
                {{ preview.dataset.headers[i] }}
              </th>
              <th>{{ name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in preview.dataset.rows.slice(0, 4)" :key="i">
              <th scope="row">{{ i + 1 }}</th>
              <td v-for="j in preview.references" :key="j">
                {{
                  st.project.missingTokens.includes(row[j]) ? "Missing" : row[j]
                }}
              </td>
              <td>{{ row.at(-1) || "Missing" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </form>
</template>
