<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { useProject } from "./store";
import { LIMITS } from "./domain";
import { download } from "./files";
import DataWorkspace from "./DataWorkspace.vue";
import HelpPanel from "./HelpPanel.vue";
import AboutPanel from "./AboutPanel.vue";
import BuildWorkspace from "./BuildWorkspace.vue";
import InferenceWorkspace from "./InferenceWorkspace.vue";
const SamplingWorkspace = defineAsyncComponent(
  () => import("./SamplingWorkspace.vue"),
);
const StudyWorkspace = defineAsyncComponent(
  () => import("./StudyWorkspace.vue"),
);
const st = useProject(),
  openInput = ref<HTMLInputElement>();
const version = import.meta.env.VITE_PDOPT_VERSION;
const buildCommit = import.meta.env.VITE_PDOPT_BUILD;
const helpOpen = ref(false);
const helpWidth = ref(380);
const resultView = ref<"graph" | "distribution">("distribution");
const studyView = ref<"setup" | "run" | "explore">("setup");
const helpView = computed(() => {
  if (st.activeTab === "results") return resultView.value;
  if (st.activeTab === "sampling") return "samples";
  if (st.activeTab === "study") return studyView.value;
  return st.activeTab;
});
function closeHelp() {
  helpOpen.value = false;
  document.getElementById("help-toggle")?.focus();
}
const workspaceTabs = [
  { id: "data", label: "Data" },
  { id: "exploration", label: "Probabilistic Exploration" },
  { id: "sampling", label: "Sampling" },
  { id: "study", label: "Optimisation Study" },
] as const;
const explorationTabs = [
  { id: "network", label: "Network" },
  { id: "states", label: "States & training" },
  { id: "queries", label: "Queries" },
  { id: "results", label: "Results" },
] as const;
type WorkspaceTab = (typeof workspaceTabs)[number]["id"];
type ExplorationTab = (typeof explorationTabs)[number]["id"];

const workspaceTab = computed<WorkspaceTab>(() =>
  st.activeTab === "data" ||
  st.activeTab === "study" ||
  st.activeTab === "sampling"
    ? st.activeTab
    : "exploration",
);
const lastExplorationTab = ref<ExplorationTab>("network");
watch(
  [() => st.project.id, () => st.activeTab],
  ([projectId, tab], [previousId]) => {
    if (projectId !== previousId) lastExplorationTab.value = "network";
    if (tab !== "data" && tab !== "study" && tab !== "sampling")
      lastExplorationTab.value = tab;
  },
  { flush: "sync" },
);
function selectWorkspace(id: WorkspaceTab) {
  st.activeTab = id === "exploration" ? lastExplorationTab.value : id;
}
async function open(file: File | undefined) {
  if (!file) return;
  try {
    if (file.size > LIMITS.fileBytes)
      throw new Error("Project exceeds 100 MiB.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    await st.openProject(text);
  } catch (e) {
    st.error = String(e);
  }
  if (openInput.value) openInput.value.value = "";
}
watch(
  () => st.project.name,
  (name) => {
    document.title = `${name.trim() || "Untitled network"} · PDOPT-BN`;
  },
  { immediate: true },
);
async function save(includeResults = true) {
  try {
    download(
      `${st.project.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}.bayesnet.json`,
      await st.savedProject(st.embedDataset, includeResults),
    );
    st.dirty = false;
    st.notice =
      st.dataset && st.embedDataset
        ? "Project and dataset downloaded together."
        : "Project downloaded.";
  } catch (e) {
    st.error = String(e);
  }
}
function tabKeys<T extends string>(
  event: KeyboardEvent,
  tabs: readonly { id: T }[],
  activeId: string,
  select: (id: T) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const index = tabs.findIndex((tab) => tab.id === activeId);
  const offset = event.key === "ArrowLeft" ? -1 : 1;
  const next =
    tabs[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + offset + tabs.length) % tabs.length
    ].id;
  select(next);
  document.getElementById(next + "-tab")?.focus();
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (st.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">BN</span>
        <div>
          <strong>PDOPT</strong
          ><small>Probabilistic Design and Optimisation</small>
        </div>
      </div>
      <div class="project-name">
        <input
          aria-label="Project name"
          v-model="st.project.name"
          @change="st.touch('display')"
          maxlength="200"
        /><span v-if="st.dirty" title="Unsaved changes">●</span>
      </div>
      <nav aria-label="Project actions">
        <AboutPanel />
        <button
          id="help-toggle"
          aria-controls="help-panel"
          :aria-expanded="helpOpen"
          @click="helpOpen = !helpOpen"
        >
          Help/Tutorial
        </button>
        <button @click="st.newProject()" :disabled="st.busy">New</button
        ><button @click="openInput?.click()" :disabled="st.busy">Open</button
        ><button @click="save()">Save project</button>
        <button v-if="st.completedQueryIds.length" @click="save(false)">
          Save without cached results
        </button>
      </nav>
    </header>
    <div class="statusbar">
      <span class="privacy-dot"></span>Your data stays in this browser<span
        class="spacer"
      ></span
      >{{ st.project.variables.length }} variables ·
      {{ st.project.edges.length }} connections ·
      {{ st.project.cpts.length }} trained CPTs
    </div>
    <div
      class="workspace-tabs"
      role="tablist"
      aria-label="Workspace"
      @keydown="tabKeys($event, workspaceTabs, workspaceTab, selectWorkspace)"
    >
      <button
        v-for="tab in workspaceTabs"
        :id="tab.id + '-tab'"
        :key="tab.id"
        role="tab"
        :aria-controls="tab.id + '-panel'"
        :aria-selected="workspaceTab === tab.id"
        :tabindex="workspaceTab === tab.id ? 0 : -1"
        @click="selectWorkspace(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div v-if="st.error" class="banner error" role="alert">
      {{ st.error
      }}<button @click="st.error = ''" aria-label="Dismiss error">×</button>
    </div>
    <div v-if="st.notice" class="banner success" role="status">
      {{ st.notice }}
    </div>
    <div v-if="st.batchRunning" class="banner working" role="status">
      Running queries locally…<button @click="st.cancelQueries()">
        Cancel queries
      </button>
    </div>
    <div v-if="st.busy" class="banner working" role="status">
      Computing locally…<button @click="st.cancel()">Cancel computation</button>
    </div>
    <div
      class="workspace-body"
      :class="{ 'with-help': helpOpen }"
      :style="{ '--help-width': helpWidth + 'px' }"
    >
      <div class="workspace-stage">
        <DataWorkspace />
        <div
          id="exploration-panel"
          v-show="workspaceTab === 'exploration'"
          role="tabpanel"
          aria-labelledby="exploration-tab"
        >
          <div
            class="view-switch exploration-views"
            role="tablist"
            aria-label="Exploration views"
            @keydown="
              tabKeys(
                $event,
                explorationTabs,
                st.activeTab,
                (id) => (st.activeTab = id),
              )
            "
          >
            <button
              v-for="tab in explorationTabs"
              :id="tab.id + '-tab'"
              :key="tab.id"
              role="tab"
              :aria-controls="tab.id + '-panel'"
              :aria-selected="st.activeTab === tab.id"
              :tabindex="st.activeTab === tab.id ? 0 : -1"
              @click="st.activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <BuildWorkspace />
          <InferenceWorkspace v-model:view="resultView" />
        </div>
        <SamplingWorkspace
          v-if="st.current || st.activeTab === 'sampling'"
          v-show="st.activeTab === 'sampling'"
        />
        <StudyWorkspace
          v-if="st.activeTab === 'study' || st.project.study"
          v-model:view="studyView"
        />
      </div>
      <HelpPanel
        v-show="helpOpen"
        :tab="helpView"
        v-model:width="helpWidth"
        @close="closeHelp"
      />
    </div>
    <footer>
      <span
        >PDOPT · v{{ version
        }}<template v-if="buildCommit"> ({{ buildCommit }})</template></span
      >
      <span>(c) Andrea Spinelli 2023-2026</span>
    </footer>
    <input
      data-testid="project-file"
      hidden
      ref="openInput"
      type="file"
      accept=".json,application/json"
      @change="open(($event.target as HTMLInputElement).files?.[0])"
    />
  </div>
</template>
