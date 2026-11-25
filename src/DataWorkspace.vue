<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useProject } from "./store";
import { LIMITS } from "./domain";
import { download } from "./files";
import { encode } from "./processing";
import DataColumnEditor from "./DataColumnEditor.vue";
import RawDataPreview from "./RawDataPreview.vue";
import {
  cantileverCsv,
  cantileverInputs,
  stressCutsMpa,
  deflectionCutsMm,
  massCutsKg,
} from "./cantilever-example";

const st = useProject();
const csvInput = ref<HTMLInputElement>();
const attachInput = ref<HTMLInputElement>();
const delimiter = ref("");
const tokenText = ref("");
const editor = ref<"sample" | "calculate">();
const preview = ref<Awaited<ReturnType<typeof st.previewDataColumn>>>();
const added = ref<number>();
const dataset = computed(() => preview.value?.dataset ?? st.dataset);
const descriptor = computed(() => st.project.dataset);
const needsSource = computed(() => !!descriptor.value && !st.dataset);
const addedToNetwork = computed(() =>
  st.project.variables.some((v) => v.columnId === "c" + added.value),
);

watch(
  () => st.project,
  () => {
    edit(undefined);
    added.value = undefined;
  },
);
watch(
  () => st.project.missingTokens,
  (tokens) => {
    tokenText.value = tokens.filter(Boolean).join(", ");
    preview.value = undefined;
  },
  { immediate: true },
);

async function edit(value: typeof editor.value) {
  const changed = editor.value !== value;
  editor.value = value;
  if (changed) preview.value = undefined;
  if (!value) return;
  added.value = undefined;
  await nextTick();
  document.getElementById("new-data-column-name")?.focus();
}
function applyColumn() {
  if (!preview.value) return;
  if (!st.appendDataColumn(preview.value.dataset, preview.value.sourceHash)) {
    st.error = "The dataset changed. Preview the column again.";
    preview.value = undefined;
    return;
  }
  void edit(undefined);
  added.value = st.dataset!.headers.length - 1;
  void nextTick(() => document.getElementById("add-data-column")?.focus());
}
async function addColumn() {
  const index = added.value;
  if (index === undefined || !st.dataset || addedToNetwork.value) return;
  const profile = st.dataset.profiles[index];
  await st.configure(
    "c" + index,
    profile.numeric
      ? profile.unique <= LIMITS.states
        ? "finiteNumeric"
        : "discretised"
      : "categorical",
  );
  if (addedToNetwork.value && st.activeTab === "data") {
    st.activeTab = "network";
    await nextTick();
    document.getElementById("network-tab")?.focus();
  }
}

async function read(input: HTMLInputElement, kind: "import" | "attach") {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > LIMITS.fileBytes) {
    st.error = "File exceeds 100 MiB.";
    return;
  }
  try {
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    if (kind === "attach") await st.reattach(csv, file.name);
    else await st.importCsv(csv, file.name, delimiter.value);
  } catch (e) {
    st.error = String(e);
  }
}

function applyMissingTokens() {
  const tokens = [
    "",
    ...new Set(
      tokenText.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (tokens.length > 100) {
    st.error = "Use at most 99 additional missing tokens.";
    return;
  }
  if (JSON.stringify(tokens) !== JSON.stringify(st.project.missingTokens)) {
    st.project.missingTokens = tokens;
    st.touch("data");
  }
}

async function cantileverExample() {
  if (!(await st.importCsv(cantileverCsv(), "cantilever-beam.csv"))) return;
  st.project.example = "cantilever";
  for (const [i, { cuts }] of cantileverInputs.entries())
    await st.configure(`c${i}`, "discretised", "manual", cuts.length + 1, cuts);
  await st.configure("c3", "categorical");
  await st.configure(
    "c4",
    "discretised",
    "manual",
    stressCutsMpa.length + 1,
    stressCutsMpa,
  );
  await st.configure(
    "c5",
    "discretised",
    "manual",
    deflectionCutsMm.length + 1,
    deflectionCutsMm,
  );
  await st.configure("c6", "categorical");
  await st.configure(
    "c7",
    "discretised",
    "manual",
    massCutsKg.length + 1,
    massCutsKg,
  );
  const [width, depth, load, material, stress, deflection, failure, mass] =
    st.project.variables;
  if (!mass || st.project.variables.length !== 8) return;

  for (const input of [width, depth, load]) {
    st.addEdge(input.id, stress.id, "bottom", "top");
    st.addEdge(input.id, deflection.id, "bottom", "top");
  }
  st.addEdge(material.id, deflection.id, "bottom", "top");
  st.addEdge(stress.id, failure.id, "bottom", "top");
  st.addEdge(material.id, failure.id, "bottom", "top");
  for (const input of [width, depth, material]) {
    st.addEdge(input.id, mass.id, "bottom", "top");
  }
  st.project.queryGroups = [
    {
      id: crypto.randomUUID(),
      name: "Stress and deflection",
      targetIds: [stress.id, deflection.id],
      evidence: {},
    },
    {
      id: crypto.randomUUID(),
      name: "Bending failure",
      targetIds: [failure.id],
      evidence: {},
    },
    {
      id: crypto.randomUUID(),
      name: "Beam mass",
      targetIds: [mass.id],
      evidence: {},
    },
    {
      id: crypto.randomUUID(),
      name: "Design space",
      targetIds: [width.id, depth.id, material.id],
      evidence: {
        [load.id]: encode(load, "100"),
        [failure.id]: failure.states.indexOf("Passes"),
        [mass.id]: { kind: "threshold", operator: "lt", value: 1 },
      },
    },
  ];
  st.touch("query");
  await st.layout();
  await st.previewTraining();
  st.notice =
    "Cantilever example ready. Open States & training to train the model.";
}
</script>

<template>
  <main
    id="data-panel"
    v-show="st.activeTab === 'data'"
    class="data-workspace"
    role="tabpanel"
    aria-labelledby="data-tab"
  >
    <header class="workspace-heading">
      <div>
        <h1>Data</h1>
        <p v-if="descriptor">
          <strong>{{ descriptor.name }}</strong> ·
          <span
            >{{ descriptor.rowCount.toLocaleString() }} rows ·
            {{ descriptor.headers.length }} columns</span
          >
        </p>
        <p v-else>Import a CSV or sample your first column.</p>
      </div>
      <button
        v-if="descriptor && !needsSource"
        @click="st.activeTab = 'network'"
      >
        Go to Network
      </button>
    </header>
    <div class="data-workspace-content">
      <section class="data-source" aria-label="Data source">
        <div class="data-actions">
          <button
            v-if="needsSource"
            class="primary"
            :disabled="st.busy"
            @click="attachInput?.click()"
          >
            Locate project CSV
          </button>
          <button :disabled="st.busy" @click="csvInput?.click()">
            {{
              descriptor || st.project.variables.length
                ? "Replace dataset and start a new network"
                : "Import CSV"
            }}
          </button>
          <label class="data-delimiter"
            >CSV delimiter
            <select v-model="delimiter" :disabled="st.busy">
              <option value="">Auto-detect</option>
              <option value=",">Comma</option>
              <option value=";">Semicolon</option>
              <option :value="'\t'">Tab</option>
            </select>
          </label>
          <div class="data-actions data-example">
            <button
              v-if="!st.project.variables.length"
              :disabled="st.busy"
              @click="cantileverExample"
            >
              Load cantilever beam example
            </button>
          </div>
        </div>
        <p v-if="needsSource" class="muted">
          Locate <strong>{{ descriptor?.name }}</strong> to restore the data for
          this network.
        </p>
      </section>

      <section aria-label="Column tools">
        <div class="data-actions data-column-actions">
          <button
            :class="{ primary: editor !== 'calculate' }"
            :aria-pressed="editor === 'sample'"
            :disabled="st.busy || needsSource"
            @click="edit('sample')"
          >
            Sample column
          </button>
          <button
            :class="{ primary: editor === 'calculate' }"
            :aria-pressed="editor === 'calculate'"
            :disabled="st.busy || !st.dataset"
            @click="edit('calculate')"
          >
            Calculate column
          </button>
          <button
            v-if="st.dataset"
            @click="download(st.dataset.name, st.dataset.csv, 'text/csv')"
          >
            Download CSV
          </button>
        </div>
        <div
          v-if="added !== undefined && st.dataset"
          class="data-actions data-added"
        >
          <span role="status">Added {{ st.dataset.headers[added] }}</span>
          <button
            id="add-data-column"
            :disabled="st.busy || addedToNetwork"
            @click="addColumn"
          >
            {{ addedToNetwork ? "In network" : "Add to network" }}
          </button>
        </div>
        <DataColumnEditor
          v-if="editor"
          :key="editor"
          :kind="editor"
          v-model:preview="preview"
          @apply="applyColumn"
          @cancel="edit(undefined)"
        />
      </section>

      <section
        v-if="dataset"
        class="data-preview"
        aria-labelledby="data-rows-heading"
      >
        <h2 id="data-rows-heading">
          {{ preview ? "Preview with new column" : "Data rows" }}
        </h2>
        <RawDataPreview :dataset="dataset" :preview="!!preview" />
      </section>

      <details v-if="st.dataset" class="data-settings">
        <summary>Data settings</summary>
        <p>
          Empty fields are missing. Training excludes rows with missing values
          in model variables.
        </p>
        <label class="field"
          >Additional missing tokens (comma-separated)
          <input
            v-model="tokenText"
            placeholder="e.g. NA, null"
            :disabled="st.busy"
          />
        </label>
        <button :disabled="st.busy" @click="applyMissingTokens">
          Apply missing tokens
        </button>
        <label class="check"
          ><input type="checkbox" v-model="st.embedDataset" />Include raw CSV in
          project download</label
        >
      </details>
    </div>

    <input
      data-testid="csv-file"
      hidden
      ref="csvInput"
      type="file"
      accept=".csv,text/csv"
      @change="read($event.target as HTMLInputElement, 'import')"
    />
    <input
      data-testid="attach-file"
      hidden
      ref="attachInput"
      type="file"
      accept=".csv,text/csv"
      @change="read($event.target as HTMLInputElement, 'attach')"
    />
  </main>
</template>
