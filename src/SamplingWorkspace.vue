<script setup lang="ts">
import { useProject } from "./store";
import SampleExport from "./SampleExport.vue";

const st = useProject();
</script>

<template>
  <main
    id="sampling-panel"
    class="results-workspace"
    role="tabpanel"
    aria-labelledby="sampling-tab"
  >
    <header class="workspace-heading">
      <label class="field"
        >Source query
        <select v-model="st.activeGroupId">
          <option
            v-for="query in st.project.queryGroups"
            :key="query.id"
            :value="query.id"
          >
            {{ query.name }}
          </option>
        </select>
      </label>
    </header>
    <SampleExport
      v-if="st.current && st.activeGroupId"
      :key="st.activeGroupId"
      :group-id="st.activeGroupId"
    />
    <p v-else class="empty-results">
      Run inference for the source query to generate samples.
      <button @click="st.activeTab = 'queries'">Go to Queries</button>
    </p>
  </main>
</template>
