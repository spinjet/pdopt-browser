<script setup lang="ts">
import { computed, ref } from "vue";
import MarkdownIt from "markdown-it";
import beamDiagram from "../doc/help/cantilever-beam.svg";

const props = defineProps<{
  tab:
    | "data"
    | "network"
    | "states"
    | "queries"
    | "graph"
    | "distribution"
    | "samples"
    | "setup"
    | "run"
    | "explore";
}>();
const width = defineModel<number>("width", { required: true });
const emit = defineEmits<{ close: [] }>();
const mode = ref<"tutorial" | "context">("context");
const help = import.meta.glob("../doc/help/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const markdown = new MarkdownIt({ html: false });
const imageRenderer = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.attrGet("src") === "./cantilever-beam.svg")
    token.attrSet("src", beamDiagram);
  return imageRenderer(tokens, index, options, env, self);
};
const contextualHtml = computed(() =>
  markdown.render(help[`../doc/help/${props.tab}.md`] ?? ""),
);
const tutorialHtml = markdown.render(help["../doc/help/cantilever.md"]);
</script>

<template>
  <aside id="help-panel" class="help-panel" aria-labelledby="help-title">
    <header class="help-panel-header">
      <h2 id="help-title">Help</h2>
      <button @click="emit('close')" aria-label="Close tutorial">Close</button>
    </header>
    <div class="help-panel-options">
      <label class="field">
        Help content
        <select v-model="mode">
          <option value="tutorial">Cantilever tutorial</option>
          <option value="context">Help for this view</option>
        </select>
      </label>
      <label class="field help-width">
        Panel width
        <input
          type="range"
          min="320"
          max="520"
          step="10"
          v-model.number="width"
        />
      </label>
    </div>
    <div
      v-show="mode === 'tutorial'"
      class="tutorial-content"
      tabindex="0"
      role="region"
      aria-label="Tutorial steps"
    >
      <article v-html="tutorialHtml" />
    </div>
    <div
      v-show="mode === 'context'"
      class="tutorial-content"
      tabindex="0"
      role="region"
      aria-label="Help for this view"
    >
      <article v-html="contextualHtml" />
    </div>
  </aside>
</template>
