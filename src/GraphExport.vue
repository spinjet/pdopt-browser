<script setup lang="ts">
import { computed, ref } from "vue";
import type { GraphDirection, GraphRoleColors } from "./graph-export";
import { useProject } from "./store";
import { download, downloadBytes, svgToPng } from "./files";

const props = defineProps<{ probabilities?: boolean }>();
const st = useProject();
const dialog = ref<HTMLDialogElement>();
const format = ref<"svg" | "png">("svg");
const direction = ref<GraphDirection>("auto");
const colors = ref<GraphRoleColors>({ evidence: "#ffedc7", target: "#dbeafe" });
const svg = ref("");
const error = ref("");
const rendering = ref(false);
const saving = ref(false);
const preview = computed(
  () =>
    svg.value &&
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.value),
);

function show() {
  dialog.value?.showModal();
  void render();
}

async function render() {
  svg.value = "";
  error.value = "";
  rendering.value = true;
  try {
    const image = await st.exportGraph(
      !!props.probabilities,
      direction.value,
      colors.value,
    );
    if (image) svg.value = image.svg;
    else
      error.value =
        st.error || "Could not render the network image. Try again.";
  } finally {
    rendering.value = false;
  }
}

async function save() {
  const image = svg.value;
  if (!image || saving.value) return;
  error.value = "";
  if (format.value === "svg") {
    download("pdopt-bn-network.svg", image, "image/svg+xml");
    return;
  }
  saving.value = true;
  try {
    const png = await svgToPng(image);
    downloadBytes("pdopt-bn-network.png", png, "image/png");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

function close() {
  if (rendering.value) st.cancel();
}
</script>

<template>
  <button
    type="button"
    aria-haspopup="dialog"
    @click="show"
    :disabled="
      st.busy || !st.project.variables.length || (probabilities && !st.current)
    "
  >
    Export network image
  </button>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog figure-dialog"
      aria-label="Export network image"
      @close="close"
    >
      <header class="workspace-dialog-heading">
        <h2>Export network image</h2>
        <form method="dialog"><button autofocus>Close</button></form>
      </header>
      <div class="figure-export-content">
        <div class="figure-export-controls">
          <label class="field"
            >Image format
            <select v-model="format" :disabled="saving">
              <option value="svg">SVG (vector)</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label class="field"
            >Layout direction
            <select
              v-model="direction"
              :disabled="rendering || saving"
              @change="render"
            >
              <option value="auto">Auto (connection sides)</option>
              <option value="TB">Top to bottom</option>
              <option value="BT">Bottom to top</option>
              <option value="LR">Left to right</option>
              <option value="RL">Right to left</option>
            </select>
          </label>
          <label class="field graph-colour">
            Evidence nodes
            <input
              type="color"
              v-model="colors.evidence"
              :disabled="rendering || saving"
              @change="render"
            />
          </label>
          <label class="field graph-colour">
            Query target nodes
            <input
              type="color"
              v-model="colors.target"
              :disabled="rendering || saving"
              @change="render"
            />
          </label>
          <button class="primary" :disabled="!svg || saving" @click="save">
            Download network image
          </button>
          <button v-if="rendering" @click="st.cancel()">
            Cancel computation
          </button>
          <button v-else-if="!svg && error" @click="render">
            Retry preview
          </button>
        </div>
        <p v-if="rendering" role="status">Rendering network preview…</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <div
          v-if="preview"
          class="figure-preview network-image-preview"
          tabindex="0"
          aria-label="Network image preview"
        >
          <img :src="preview" alt="Preview of the exported network image" />
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
