<script setup lang="ts">
import { ref } from "vue";
import CantileverTutorial from "./CantileverTutorial.vue";

const props = defineProps<{ tab: keyof typeof help }>();
const width = defineModel<number>("width", { required: true });
const emit = defineEmits<{ close: [] }>();
const mode = ref<"tutorial" | "context">("context");
const help = {
  data: {
    title: "Data",
    text: "Import a CSV, sample a column or calculate one from existing columns. Review the data before adding variables to the network. Save project embeds the current dataset by default.",
  },
  network: {
    title: "Network",
    text: "Add variables from the dataset or create manual nodes. Drag from a parent’s handle to a child’s handle to define a dependency. Use Auto layout to arrange nodes and Fit view to see the whole graph.",
  },
  states: {
    title: "States & training",
    text: "Select a variable to edit its states or set bin boundaries for continuous values. Review the usable rows, then train the conditional probability tables before running a query.",
  },
  queries: {
    title: "Queries",
    text: "Choose the variables you want to learn about as targets and set their known conditions under Query evidence. Each query keeps its own evidence. Duplicate a query to try another case.",
  },
  graph: {
    title: "Results · Network graph",
    text: "Inspect how the query’s evidence updates state probabilities across the network. Use Fit view to recenter the graph or Export network image to save a labelled SVG or PNG.",
  },
  distribution: {
    title: "Results · Query results",
    text: "Inspect the query as a chart or table. For queries with more than two targets, select a heatmap slice. Use Export figure for publication graphics or Export table CSV for the filtered rows.",
  },
  samples: {
    title: "Results · Sample distribution",
    text: "Generate a seeded sample from the full joint posterior. Brush axes or select points to inspect the same rows across plots and the sample table.",
  },
  setup: {
    title: "Optimisation Study · Setup",
    text: "Start a study from a query result. Review the retained design regions, then set inputs, fixed operating conditions, objectives and constraints.",
  },
  run: {
    title: "Optimisation Study · Run",
    text: "Fit surrogate models and review the held-out errors and missed constraint violations. Relative MAE expresses the average numeric error as a share of the observed range. Then search the retained regions.",
  },
  explore: {
    title: "Optimisation Study · Explore",
    text: "Compare predicted trade-offs on the Pareto plot and use parallel coordinates to filter designs. Open the design table to inspect and export the selected rows.",
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
