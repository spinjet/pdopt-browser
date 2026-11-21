<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import {
  VueFlow,
  Handle,
  MarkerType,
  Position,
  useVueFlow,
} from "@vue-flow/core";
import { useProject } from "./store";
import { stateLabel } from "./domain";
const props = defineProps<{ visible: boolean }>();
const st = useProject(),
  flow = useVueFlow({ id: "inference" }),
  expanded = ref<Record<string, boolean>>({});
const graphProject = computed(() =>
  st.current ? st.project : st.resultSnapshot || st.project,
);
const nodes = computed(() =>
  graphProject.value.variables.map((v) => {
    const probabilities = st.results?.posterior[v.id];
    return {
      id: v.id,
      position: v.position,
      type: "probability",
      draggable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: v.label,
        mode: v.parameterMode,
        observed: graphProject.value.evidence[v.id] !== undefined,
        probabilities,
        rows: v.states.map((_, i) => ({
          label: stateLabel(v, i),
          probability: probabilities?.[i],
        })),
      },
    };
  }),
);
const edges = computed(() =>
  graphProject.value.edges.map((e) => ({
    ...e,
    sourceHandle: e.sourceHandle || "right",
    targetHandle: e.targetHandle || "left",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#718599" },
    style: { stroke: "#718599", strokeWidth: 2 },
  })),
);
let initialFit = false,
  resultFit = false;
watch(
  () => st.project.id,
  () => {
    initialFit = false;
    resultFit = false;
  },
);
watch(
  [
    () => props.visible,
    () => st.resultStamp,
    () => graphProject.value.variables.length,
  ],
  async () => {
    if (!props.visible || !graphProject.value.variables.length) return;
    if (!initialFit || (!resultFit && st.results)) {
      initialFit = true;
      if (st.results) resultFit = true;
      await nextTick();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => flow.fitView({ padding: 0.2 })),
      );
    }
  },
);
</script>
<template>
  <section class="probability-graph" aria-label="Inference network">
    <div class="subpane-heading">
      <div>
        <h2>Probability graph</h2>
      </div>
      <button @click="flow.fitView({ padding: 0.2 })">Fit view</button>
    </div>
    <p v-if="st.results && !st.current" class="outdated-label">
      Outdated probabilities — run inference again
    </p>
    <div class="graph-wrap">
      <VueFlow
        id="inference"
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :edges-updatable="false"
        :delete-key-code="null"
        :min-zoom="0.15"
        :max-zoom="2"
        @node-click="(e) => (st.selected = e.node.id)"
      >
        <template #node-probability="{ id, data }"
          ><Handle
            v-for="side in [
              Position.Left,
              Position.Right,
              Position.Top,
              Position.Bottom,
            ]"
            :key="side"
            :id="side"
            type="source"
            :position="side"
            :connectable="false"
          />
          <div
            class="network-node probability-node nowheel"
            :class="{
              observed: data.observed,
              stale: st.results && !st.current,
            }"
          >
            <div class="node-type">
              <span>{{
                data.mode === "uniform" ? "Uniform CPT" : "Learned CPT"
              }}</span
              ><span v-if="data.observed">● Evidence</span>
            </div>
            <strong>{{ data.label }}</strong>
            <p v-if="!data.probabilities" class="tiny muted">Not computed</p>
            <template v-else
              ><div
                v-for="(row, k) in data.rows.slice(0, expanded[id] ? 64 : 3)"
                :key="k"
                class="node-probability"
              >
                <span :title="row.label">{{ row.label }}</span
                ><b :title="String(row.probability)"
                  >{{ ((row.probability ?? 0) * 100).toFixed(1) }}%</b
                >
                <div
                  class="prob-bar posterior"
                  :style="{ width: `${(row.probability ?? 0) * 100}%` }"
                ></div>
              </div>
              <button
                v-if="data.rows.length > 3"
                class="nodrag nopan"
                @click.stop="expanded[id] = !expanded[id]"
              >
                {{
                  expanded[id] ? "Show fewer" : `All ${data.rows.length} states`
                }}
              </button></template
            >
          </div>
        </template>
      </VueFlow>
      <p v-if="!graphProject.variables.length" class="empty-canvas">
        Add variables in Network to see the network here.
      </p>
    </div>
    <p class="tiny muted graph-note">
      Read-only network · edit structure and positions in Network.
    </p>
  </section>
</template>
