<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from "vue";
import { surrogateClient as client } from "./surrogate-client";
import { useProject } from "./store";
import { checkStudy, type StudyRun, type Validation } from "./study";
import StudySetup from "./StudySetup.vue";
import StudyExplore from "./StudyExplore.vue";
import StudyValidationReportPanel from "./StudyValidationReport.vue";
import type { StudyValidationReport } from "./study-model";

const st = useProject();
const study = computed(() => st.project.study);
const view = defineModel<"setup" | "run" | "explore">("view", {
  required: true,
});
const views = [
  { id: "setup", label: "Setup" },
  { id: "run", label: "Run" },
  { id: "explore", label: "Explore" },
] as const;
const task = ref<"counts" | "diagnostic" | "fit" | "search">();
const error = ref("");
const counts = ref<number[]>();
const diagnostic = ref<(number | null)[]>();
const estimate = ref<Validation[]>();
const report = shallowRef<StudyValidationReport>();
const run = shallowRef<StudyRun>();
const runNumber = ref(0);
const current = ref(0),
  total = ref(0),
  evaluated = ref(0),
  feasible = ref(0);
const fitKey = ref("");
const validationDetail = ref("");
const stale = ref(false);
const searchSummary = ref<StudyRun["summary"]>();
const key = computed(() =>
  study.value
    ? JSON.stringify([
        study.value.id,
        study.value.coverage,
        study.value.nodes,
        study.value.constraints,
        study.value.validationSeed,
        study.value.designIdColumn,
        st.dataset?.hash,
      ])
    : "",
);
const sameDataset = computed(
  () => !!st.dataset && st.dataset.hash === study.value?.sourceHash,
);
const blocked = computed(() => {
  if (!study.value) return "";
  try {
    checkStudy(study.value, st.dataset);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
});
function resetProgress() {
  current.value = total.value = evaluated.value = feasible.value = 0;
}
watch(
  () => study.value?.id,
  () => {
    if (task.value) client.cancel();
    task.value = undefined;
    counts.value = undefined;
    stale.value = false;
    view.value = "setup";
    error.value = "";
  },
);
watch(
  () => st.dataset?.hash,
  () => {
    counts.value = undefined;
  },
);
watch(key, () => {
  if (task.value) client.cancel();
  fitKey.value = "";
  if (run.value) stale.value = true;
  estimate.value = undefined;
  report.value = undefined;
  searchSummary.value = undefined;
  validationDetail.value = "";
  diagnostic.value = undefined;
  run.value = undefined;
  resetProgress();
  if (view.value === "explore") view.value = "setup";
});
onBeforeUnmount(() => {
  if (task.value) client.cancel();
});

async function request<T>(
  op: NonNullable<typeof task.value>,
  extra: Record<string, unknown> = {},
) {
  if (task.value || !study.value) return;
  task.value = op;
  error.value = "";
  const stamp = key.value;
  try {
    const value = await client.request(
      op,
      {
        study: JSON.parse(JSON.stringify(study.value)),
        key: stamp,
        ...extra,
      },
      {
        timeout: 120000,
        onProgress(update) {
          if (stamp !== key.value) return;
          const p = update as Partial<{
            current: number;
            regions: number;
            total: number;
            evaluated: number;
            feasible: number;
          }>;
          current.value = p.regions ?? p.current ?? 0;
          total.value = p.total ?? 0;
          evaluated.value = p.evaluated ?? 0;
          feasible.value = p.feasible ?? 0;
        },
      },
    );
    if (stamp === key.value) return value as T;
  } catch (e) {
    if (stamp === key.value)
      error.value = e instanceof Error ? e.message : String(e);
    if (
      (e as { code?: string }).code === "CANCELLED" ||
      ["RESOURCE_LIMIT", "ENGINE_FAILURE"].includes(
        (e as { code?: string }).code ?? "",
      )
    )
      fitKey.value = "";
  } finally {
    task.value = undefined;
  }
}
async function count() {
  if (counts.value || !sameDataset.value) return;
  counts.value = await request<number[]>("counts", {
    dataset: toRaw(st.dataset),
  });
}
async function diagnose() {
  const values = await request<(number | null)[]>("diagnostic", {
    engineUrl: new URL(
      import.meta.env.BASE_URL + "vendor/jsagrum/dist/index.js",
      location.origin,
    ).href,
  });
  if (values) diagnostic.value = values;
}
async function fit() {
  if (blocked.value || !st.dataset) return;
  view.value = "run";
  fitKey.value = "";
  estimate.value = undefined;
  resetProgress();
  const values = await request<StudyValidationReport>("fit", {
    dataset: toRaw(st.dataset),
  });
  if (values) {
    report.value = values;
    estimate.value = values.validation;
    fitKey.value = key.value;
  }
}
async function search() {
  if (key.value !== fitKey.value || blocked.value || !study.value) return;
  resetProgress();
  const result = await request<StudyRun>("search");
  if (result) {
    run.value = result;
    stale.value = false;
    searchSummary.value = result.summary;
    runNumber.value++;
    view.value = "explore";
  }
}
function editQuery() {
  st.activeTab = "queries";
  document.getElementById("queries-tab")?.focus();
}
function name(id: string) {
  return study.value?.snapshot.variables.find((v) => v.id === id)?.label ?? id;
}
function percentOfRange(ratio: number | null) {
  return ratio === null
    ? "Unavailable"
    : (ratio * 100).toLocaleString(undefined, {
        maximumSignificantDigits: 3,
      }) + "%";
}
</script>

<template>
  <main
    id="study-panel"
    v-show="st.activeTab === 'study'"
    role="tabpanel"
    aria-labelledby="study-tab"
    class="study-workspace"
  >
    <header class="study-header">
      <div>
        <h2>Design study</h2>
        <p v-if="study" class="query-notation">{{ study.notation }}</p>
        <p v-if="study" class="tiny muted">
          Query snapshot · model revision {{ study.modelRevision }}
        </p>
      </div>
      <button @click="editQuery">
        {{ study ? "Edit query" : "Go to Queries" }}
      </button>
    </header>
    <p v-if="!study" class="study-empty">
      Run a design-space query, then choose
      <strong>Start study from this query</strong> in Results.
    </p>
    <template v-else>
      <p v-if="stale" role="status" class="tiny muted">
        Study settings changed. Refit and search to see a current front.
      </p>
      <div
        class="view-switch study-views"
        role="group"
        aria-label="Study stage"
      >
        <button
          v-for="item in views"
          :key="item.id"
          :aria-pressed="view === item.id"
          :disabled="item.id === 'explore' && !run"
          @click="view = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <div v-if="error" class="banner error" role="alert">
        {{ error }}
        <button aria-label="Dismiss study error" @click="error = ''">×</button>
      </div>
      <div v-if="task" class="study-progress" role="status">
        <span v-if="task === 'fit'"
          >Fitting surrogates · {{ current
          }}{{ total ? " / " + total : "" }}</span
        >
        <span v-else-if="task === 'search'"
          >Searching regions · {{ current }}{{ total ? " / " + total : "" }} ·
          {{ evaluated }} evaluated · {{ feasible }} predicted feasible</span
        >
        <span v-else-if="task === 'diagnostic'"
          >Evaluating joint requirement probability…</span
        >
        <span v-else>Counting observed rows…</span>
        <progress :value="total ? current : undefined" :max="total || 1" />
        <button @click="client.cancel()">Cancel study computation</button>
      </div>
      <StudySetup
        v-if="view === 'setup'"
        :key="study.id"
        :study="study"
        :busy="!!task"
        :blocked="blocked"
        :counts="counts"
        :diagnostic="diagnostic"
        @counts="count"
        @diagnostic="diagnose"
        @next="fit"
      />
      <section v-else-if="view === 'run'" class="study-run">
        <div class="study-toolbar">
          <h3>Surrogate validation</h3>
          <button :disabled="!!task || !!blocked" @click="fit">
            {{ estimate ? "Refit surrogates" : "Fit surrogates" }}
          </button>
          <button
            class="primary"
            :disabled="!!task || !!blocked || key !== fitKey"
            @click="search"
          >
            Search retained regions
          </button>
        </div>
        <p v-if="blocked" class="field-error">{{ blocked }}</p>
        <p v-else-if="!estimate">
          Fit a model for each objective or constraint and review its held-out
          performance before searching.
        </p>
        <p v-if="searchSummary" role="status">
          Search results · {{ searchSummary.feasible }} feasible ·
          {{ searchSummary.violated }} violated ·
          {{ searchSummary.unevaluable }} unevaluable
        </p>
        <template v-if="estimate">
          <StudyValidationReportPanel
            v-if="report"
            :study="study"
            :report="report"
          />
          <p class="tiny muted">
            Models share one holdout. Relative errors use the observed range of
            the scored held-out response. For a chain, predictions start from
            recorded design inputs and operating conditions and use predicted
            intermediates.
          </p>
          <div class="study-table study-validation">
            <table>
              <thead>
                <tr>
                  <th>Response</th>
                  <th>Predictors</th>
                  <th>Held-out score</th>
                  <th>Fitted rows</th>
                  <th>Missed violations</th>
                </tr>
              </thead>
              <tbody v-for="row in estimate" :key="row.id">
                <tr>
                  <th scope="row">
                    <button
                      :aria-expanded="validationDetail === row.id"
                      @click="
                        validationDetail =
                          validationDetail === row.id ? '' : row.id
                      "
                    >
                      {{ name(row.id) }}
                    </button>
                  </th>
                  <td>
                    {{ row.predictors.map(name).join(", ") }}
                    <div class="tiny muted">
                      {{
                        row.structure === "parents" ? "Graph parents" : "Direct"
                      }}
                      · {{ row.estimator }}
                    </div>
                  </td>
                  <td>
                    {{ row.metric }}
                    {{
                      !row.holdout
                        ? "Unavailable"
                        : row.metric === "Accuracy"
                          ? (row.value * 100).toFixed(1) + "%"
                          : Number(row.value.toPrecision(4))
                    }}
                    <div v-if="row.numericError" class="tiny muted">
                      Relative MAE
                      {{ percentOfRange(row.numericError.meanRelative) }}
                    </div>
                  </td>
                  <td>{{ row.fittedRows.toLocaleString() }}</td>
                  <td>
                    {{
                      row.violations || row.near
                        ? row.missed + " of " + row.violations
                        : "—"
                    }}
                  </td>
                </tr>
                <tr v-if="validationDetail === row.id">
                  <td colspan="5">
                    <dl>
                      <dt>Complete / excluded rows</dt>
                      <dd>{{ row.rows }} / {{ row.dropped }}</dd>
                      <dt>Held-out rows</dt>
                      <dd>{{ row.holdout }}</dd>
                      <template v-if="row.numericError">
                        <dt>Observed held-out range</dt>
                        <dd>
                          {{
                            Number(row.numericError.minObserved.toPrecision(4))
                          }}
                          to
                          {{
                            Number(row.numericError.maxObserved.toPrecision(4))
                          }}
                        </dd>
                        <dt>Largest absolute error (% of range)</dt>
                        <dd>
                          {{ row.numericError.maxAbsolute?.toPrecision(4) }} ·
                          {{ percentOfRange(row.numericError.maxRelative) }}
                        </dd>
                        <dd
                          v-if="
                            row.numericError.minObserved ===
                            row.numericError.maxObserved
                          "
                        >
                          All held-out values are the same, so the relative
                          errors are undefined.
                        </dd>
                      </template>
                      <template v-if="row.confusion">
                        <dt>Confusion matrix (observed → predicted)</dt>
                        <dd
                          v-for="(labels, i) in row.confusion.counts"
                          :key="i"
                        >
                          {{ row.confusion.labels[i] }} →
                          {{
                            labels
                              .map(
                                (n, j) => row.confusion!.labels[j] + ": " + n,
                              )
                              .join(", ")
                          }}
                        </dd>
                      </template>
                      <template v-if="row.intervalCoverage">
                        <dt>Observed coverage of nominal 95% intervals</dt>
                        <dd>
                          {{ row.intervalCoverage.covered }} /
                          {{ row.intervalCoverage.total }}
                        </dd>
                      </template>
                      <template v-if="row.violations || row.near">
                        <dt>Near the limit</dt>
                        <dd>
                          {{ row.nearMissed }} missed across
                          {{ row.near }} held-out rows near the limit
                        </dd>
                      </template>
                    </dl>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
      <StudyExplore
        v-if="run"
        v-show="view === 'explore'"
        :key="runNumber"
        :study="study"
        :run="run"
        :dataset="sameDataset ? st.dataset : undefined"
      />
    </template>
  </main>
</template>
