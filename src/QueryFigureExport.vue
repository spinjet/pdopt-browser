<script setup lang="ts">
import { computed, ref } from "vue";
import { download, downloadBytes, pngSizeSupported, svgToPng } from "./files";
import {
  figurePalettes,
  renderQueryFigure,
  type FigurePalette,
  type QueryFigureData,
} from "./query-figure";

const props = defineProps<{
  data: QueryFigureData;
  caption: string;
  heatmapPalette: FigurePalette;
  digits: number;
}>();
const dialog = ref<HTMLDialogElement>();
const open = ref(false);
const format = ref<"svg" | "png">("svg");
const widthMm = ref(180);
const dpi = ref(300);
const captionMode = ref<"query" | "custom" | "none">("query");
const customCaption = ref("");
const palette = ref<FigurePalette>("teal");
const hiddenSlices = ref<string[]>([]);
const slice = computed(() =>
  props.data.kind === "heatmap" ? props.data.slice : [],
);
const caption = computed(() => {
  if (captionMode.value === "query") return props.caption;
  if (captionMode.value === "custom") return customCaption.value.trim();
  return "";
});
function toggleSlice(id: string, checked: boolean) {
  hiddenSlices.value = checked
    ? hiddenSlices.value.filter((value) => value !== id)
    : [...hiddenSlices.value, id];
}
const busy = ref(false);
const error = ref("");
const validWidth = computed(
  () =>
    Number.isFinite(widthMm.value) &&
    widthMm.value >= 30 &&
    widthMm.value <= 600,
);
const figure = computed(() =>
  open.value && validWidth.value
    ? renderQueryFigure(props.data, widthMm.value, {
        caption: caption.value,
        palette:
          props.data.kind === "heatmap" ? props.heatmapPalette : palette.value,
        digits: props.digits,
        hiddenSlices: hiddenSlices.value,
      })
    : undefined,
);
const preview = computed(() =>
  figure.value
    ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(figure.value.svg)
    : undefined,
);
const pngSize = computed(
  () =>
    figure.value && {
      width: Math.round((widthMm.value * dpi.value) / 25.4),
      height: Math.round((figure.value.heightMm * dpi.value) / 25.4),
      dpi: dpi.value,
    },
);
const pngTooLarge = computed(
  () =>
    format.value === "png" &&
    pngSize.value &&
    !pngSizeSupported(pngSize.value.width, pngSize.value.height),
);

function show() {
  error.value = "";
  open.value = true;
  dialog.value?.showModal();
}

async function save() {
  const image = figure.value;
  if (!image || pngTooLarge.value || busy.value) return;
  const filename =
    props.data.kind === "heatmap" ? "query-heatmap" : "query-probabilities";
  error.value = "";
  if (format.value === "svg") {
    download(filename + ".svg", image.svg, "image/svg+xml");
    return;
  }
  busy.value = true;
  try {
    const bytes = await svgToPng(image.svg, pngSize.value!);
    downloadBytes(filename + ".png", bytes, "image/png");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button type="button" aria-haspopup="dialog" @click="show">
    Export figure
  </button>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog figure-dialog"
      aria-labelledby="figure-export-title"
      @close="open = false"
    >
      <header class="workspace-dialog-heading">
        <h2 id="figure-export-title">Export query figure</h2>
        <form method="dialog"><button autofocus>Close</button></form>
      </header>
      <div class="figure-export-content">
        <div class="figure-export-controls">
          <label class="field"
            >Figure format
            <select v-model="format">
              <option value="svg">SVG (vector)</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label class="field"
            >Width (mm)
            <input
              type="number"
              v-model.number="widthMm"
              min="30"
              max="600"
              step="any"
            />
          </label>
          <label v-if="format === 'png'" class="field"
            >Resolution
            <select v-model.number="dpi">
              <option :value="300">300 dpi</option>
              <option :value="600">600 dpi</option>
            </select>
          </label>
          <label v-if="data.kind === 'bars'" class="field">
            Colour scheme
            <select v-model="palette">
              <option
                v-for="(_, name) in figurePalettes"
                :key="name"
                :value="name"
              >
                {{ name === "teal" ? "Teal (PDOPT)" : name }}
              </option>
            </select>
          </label>
          <label class="field">
            Caption
            <select v-model="captionMode">
              <option value="query">Query expression</option>
              <option value="custom">Custom caption</option>
              <option value="none">No caption</option>
            </select>
          </label>
          <button
            class="primary"
            :disabled="!figure || pngTooLarge || busy"
            @click="save"
          >
            Download {{ format.toUpperCase() }}
          </button>
        </div>
        <label v-if="captionMode === 'custom'" class="field figure-caption">
          Custom caption
          <textarea v-model="customCaption" rows="2" maxlength="600"></textarea>
        </label>
        <fieldset v-if="slice.length" class="figure-slice-options">
          <legend>Slice labels</legend>
          <label v-for="entry in slice" :key="entry.id" class="check">
            <input
              type="checkbox"
              :checked="!hiddenSlices.includes(entry.id)"
              @change="
                toggleSlice(
                  entry.id,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ entry.label }}
          </label>
        </fieldset>
        <p v-if="!validWidth">Enter a width between 30 and 600 mm.</p>
        <p v-else-if="figure" class="tiny">
          {{ widthMm }} × {{ figure.heightMm.toFixed(1) }} mm
          <template v-if="format === 'png' && pngSize">
            · {{ pngSize.width }} × {{ pngSize.height }} px
          </template>
          · {{ figure.textPoints.toFixed(1) }} pt labels
        </p>
        <p v-if="pngTooLarge" role="status">
          Reduce the width or resolution, or choose SVG.
        </p>
        <p v-if="error" role="alert">{{ error }}</p>
        <div
          v-if="preview"
          class="figure-preview"
          tabindex="0"
          aria-label="Figure preview at export width"
        >
          <img
            :src="preview"
            :style="{ width: widthMm + 'mm' }"
            alt="Preview of the exported query figure"
          />
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
