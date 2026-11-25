<script setup lang="ts">
import { ref } from "vue";
import CantileverTutorial from "./CantileverTutorial.vue";

const props = defineProps<{ tab: keyof typeof help }>();
const width = defineModel<number>("width", { required: true });
const emit = defineEmits<{ close: [] }>();
const mode = ref<"tutorial" | "context">("tutorial");
const help = {
  data: {
    title: "Data",
    text: "Import a CSV, sample a column or calculate values from the existing columns. Review the data before adding variables to the network.",
  },
  network: {
    title: "Network",
    text: "Add variables from the dataset or create manual nodes. Connect the handle of a parent node to the handle of its child.",
  },
  states: {
    title: "States & training",
    text: "Check which states each variable can take. Set bin boundaries for continuous values, preview the usable rows, then fit the probability tables.",
  },
  queries: {
    title: "Queries",
    text: "Select the variables you want to learn about as targets. Set the known conditions under Query evidence. Duplicate a query to try different conditions.",
  },
  results: {
    title: "Results",
    text: "View how the evidence updates the network, or inspect the query distribution. Use Export figure on the diagram to save the current plot and slice.",
  },
  study: {
    title: "Optimisation Study",
    text: "Start from a query result, then review the retained design regions and configure inputs, fixed conditions, objectives and constraints. Fit surrogates before searching the regions.",
  },
};
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
      <h2>Cantilever beam tutorial</h2>
      <CantileverTutorial />
    </div>
    <div
      v-show="mode === 'context'"
      class="tutorial-content"
      tabindex="0"
      role="region"
      aria-label="Help for this view"
    >
      <h3>{{ help[props.tab].title }}</h3>
      <p>{{ help[props.tab].text }}</p>
    </div>
  </aside>
</template>
