<script setup lang="ts">
import { probabilityPercent } from "./query-figure";
import { computed, nextTick, ref, watch } from "vue";
import {
  Handle,
  MarkerType,
  Position,
  VueFlow,
  useVueFlow,
} from "@vue-flow/core";
import {
  allowedStates,
  stateLabel,
  type Study,
  type StudyNode,
} from "./domain";
import {
  isCategorical,
  selectRegions,
  statesBounds,
  type StudyRegion,
} from "./study";
import { useProject } from "./store";
import StudyConstraints from "./StudyConstraints.vue";
import {
  buildStudyPlan,
  estimatorLabels,
  predictorIds,
  predictorMode,
} from "./study-plan";
import {
  constraintDefinitions,
  constraintLabel,
  defaultValidationSeed,
} from "./study-constraints";
import {
  GP_TRAINING_LIMIT,
  GP_DATASET_LIMIT,
  GP_FEATURE_LIMIT,
} from "./study-estimators";

const props = defineProps<{
  study: Study;
  busy: boolean;
  counts?: number[];
  diagnostic?: (number | null)[];
  blocked: string;
}>();
const emit = defineEmits<{ counts: []; diagnostic: []; next: [] }>();
const st = useProject();
const flow = useVueFlow({ id: "study-graph" });
const selected = ref(props.study.targetIds[0]);
const picking = ref(false);
const onlyRetained = ref(true);
const page = ref(0);
const pageSize = 24;
const selection = computed(() => selectRegions(props.study));
const variables = computed(() => props.study.snapshot.variables);
const targets = computed(() =>
  props.study.targetIds.map((id) => variables.value.find((v) => v.id === id)!),
);
const variable = computed(() =>
  variables.value.find((v) => v.id === selected.value)!,
);
const node = computed(() => props.study.nodes[selected.value]);
const nodeRoles = {
  unused: "Unused",
  input: "Design input",
  fixed: "Operating condition",
  response: "Response",
};
const editor = ref<InstanceType<typeof StudyConstraints>>();
const modelled = computed(
  () => node.value && ["response", "unused"].includes(node.value.role),
);
const mode = computed(() => predictorMode(props.study, selected.value));
const predictors = computed(() =>
  modelled.value ? predictorIds(props.study, selected.value) : [],
);
const modelPlan = computed(() => {
  try {
    return buildStudyPlan(props.study);
  } catch {
    return undefined;
  }
});
const rules = computed(() => constraintDefinitions(props.study));
const available = computed(() =>
  variables.value.filter(
    (v) =>
      v.columnId &&
      (mode.value === "parents"
        ? props.study.nodes[v.id].role === "input"
        : ["input", "fixed"].includes(props.study.nodes[v.id].role)),
  ),
);
const graphParents = computed(() =>
  props.study.snapshot.edges
    .filter((e) => e.target === selected.value)
    .map((e) => e.source),
);
const activePath = computed(() => {
  const ids = new Set<string>(),
    links = new Set<string>();
  function visit(id: string) {
    if (ids.has(id)) return;
    ids.add(id);
    if (!["unused", "response"].includes(props.study.nodes[id]?.role)) return;
    for (const parent of predictorIds(props.study, id)) {
      links.add(parent + ":" + id);
      if (props.study.nodes[parent]) visit(parent);
    }
  }
  visit(selected.value);
  return { ids, links };
});
function predictorLabel(id: string) {
  return variables.value.find((v) => v.id === id)?.label ?? id;
}
function predictorSource(id: string) {
  const role = props.study.nodes[id]?.role;
  return role === "input"
    ? "Design input"
    : role === "fixed"
      ? "Operating condition"
      : "Predicted intermediate";
}
function updatePredictor(id: string, checked: boolean) {
  if (mode.value === "parents") {
    if (graphParents.value.includes(id)) return;
    const extra = node.value.extraPredictors ?? [];
    change({
      extraPredictors: checked ? [...extra, id] : extra.filter((x) => x !== id),
    });
  } else list("predictors", id, checked, predictors.value);
}
function roleLabel(id: string) {
  const role = props.study.nodes[id].role;
  return role === "unused" &&
    modelPlan.value?.models.some((entry) => entry.response.id === id)
    ? "Predicted intermediate"
    : nodeRoles[role];
}
const summary = computed(() =>
  variables.value.filter(
    (v) =>
      props.study.nodes[v.id].role !== "unused" ||
      modelPlan.value?.models.some((entry) => entry.response.id === v.id),
  ),
);
const graphNodes = computed(() =>
  variables.value.map((v) => ({
    id: v.id,
    position: v.position,
    type: "study",
    data: {
      label: v.label,
      role: roleLabel(v.id),
      objective: props.study.nodes[v.id].objective,
      constraint: rules.value.some(
        (rule) => "variableId" in rule && rule.variableId === v.id,
      ),
      selected: v.id === selected.value,
      predictor: activePath.value.ids.has(v.id) && v.id !== selected.value,
      eligible:
        picking.value && available.value.some((item) => item.id === v.id),
    },
  })),
);
const sides = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const edges = computed(() => {
  const original = props.study.snapshot.edges;
  const visible = original.map((e) => ({
    ...e,
    sourceHandle: e.sourceHandle ?? "right",
    targetHandle: e.targetHandle ?? "left",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#718599" },
    style: activePath.value.links.has(e.source + ":" + e.target)
      ? { stroke: "#0f766e", strokeWidth: 4 }
      : { stroke: "#718599", strokeWidth: 2 },
  }));
  for (const key of activePath.value.links) {
    const [source, target] = key.split(":");
    if (
      !props.study.nodes[source] ||
      original.some((e) => e.source === source && e.target === target)
    )
      continue;
    visible.push({
      id: "study-predictor-" + key,
      source,
      target,
      sourceHandle: "right",
      targetHandle: "left",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#0f766e" },
      style: { stroke: "#0f766e", strokeWidth: 3, strokeDasharray: "5 4" },
    } as (typeof visible)[number]);
  }
  return visible;
});
const rows = computed(() =>
  onlyRetained.value ? selection.value.retained : selection.value.regions,
);
const visibleRows = computed(() =>
  rows.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
);
const fixedStates = computed(() => {
  const v = variable.value;
  const evidence = props.study.snapshot.evidence[v.id];
  return evidence === undefined
    ? v.states.map((_, i) => i)
    : allowedStates(v, evidence);
});
watch([onlyRetained, () => rows.value.length], () => {
  page.value = 0;
});

function fit() {
  nextTick(() => requestAnimationFrame(() => flow.fitView({ padding: 0.16 })));
}
function inspect(id: string) {
  if (
    picking.value &&
    available.value.some((v) => v.id === id) &&
    !props.busy
  ) {
    updatePredictor(id, !predictors.value.includes(id));
    return;
  }
  picking.value = false;
  selected.value = id;
}
function change(patch: Partial<StudyNode>) {
  if (props.busy) return;
  Object.assign(node.value, patch);
  st.touch("display");
}
function role(event: Event) {
  const next = (event.target as HTMLSelectElement).value as StudyNode["role"];
  picking.value = false;
  change({ role: next });
  if (next === "fixed" && node.value.value === undefined) {
    const states = fixedStates.value;
    if (isCategorical(variable.value))
      change({ value: variable.value.states[states[0]] });
    else if (!variable.value.binning)
      change({ value: Number(variable.value.states[states[0]]) });
    else if (states.length === 1) {
      const bound = statesBounds(variable.value, states[0]);
      if ("min" in bound) {
        const min = Math.max(bound.min, node.value.min!),
          max = Math.min(bound.max, node.value.max!);
        if (min <= max) change({ value: min / 2 + max / 2 });
      }
    }
  }
}
function number(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  return Number.isFinite(value) ? value : undefined;
}
function list(
  field: "categories" | "predictors",
  value: string,
  checked: boolean,
  current: string[],
) {
  change({
    [field]: checked
      ? [...current, value]
      : current.filter((item) => item !== value),
  });
}
function setCoverage(event: Event) {
  const value = number(event);
  if (value !== undefined && value > 0 && value <= 100) {
    props.study.coverage = value / 100;
    st.touch("display");
  }
  (event.target as HTMLInputElement).value = String(props.study.coverage * 100);
}
function percent(value: number) {
  return probabilityPercent(value, st.project.probabilityDecimalPlaces);
}
function regionBound(region: StudyRegion, index: number) {
  const v = targets.value[index],
    bounds = region.bounds[v.id];
  if (!bounds || "values" in bounds) return stateLabel(v, region.states[index]);
  const format = (x: number) => Number(x.toPrecision(7));
  const upperCut = v.binning!.cuts[region.states[index]];
  const upper =
    upperCut !== undefined &&
    bounds.max === statesBoundsMax(v, region.states[index]);
  return (
    "[" +
    format(bounds.min) +
    ", " +
    format(upper ? upperCut : bounds.max) +
    (upper ? ")" : "]")
  );
}
function statesBoundsMax(v: typeof variable.value, state: number) {
  const bounds = statesBounds(v, state);
  return "max" in bounds ? bounds.max : undefined;
}
</script>

<template>
  <section class="study-regions">
    <div class="study-toolbar">
      <label
        >Posterior coverage (%)
        <input
          type="number"
          min="0.01"
          max="100"
          step="any"
          :value="study.coverage * 100"
          :disabled="busy"
          @change="setCoverage"
        />
      </label>
      <strong
        >{{ percent(selection.achieved) }} retained mass ·
        {{ selection.retained.length }} retained regions</strong
      >
      <span class="muted"
        >{{ selection.regions.length }} joint combinations</span
      >
      <button :disabled="busy" @click="emit('diagnostic')">
        Evaluate requirement probability
      </button>
    </div>
    <p class="tiny muted">
      The study ranks eligible joint query cells by posterior probability. It
      keeps whole cells until their cumulative mass reaches the requested
      coverage, including cells tied at the cutoff. Clipping a cell to your
      study bounds keeps its original probability. Coverage guides where the
      study searches. Candidate designs still have to satisfy the constraints.
      {{ percent(selection.available) }} of the posterior mass is eligible.
    </p>
    <p v-if="diagnostic" class="tiny muted">
      The probability diagnostic uses the saved Bayesian query requirements.
      Candidate constraints are evaluated during search.
    </p>
    <p v-if="selection.available + 1e-12 < study.coverage" class="field-error">
      {{
        selection.retained.length
          ? percent(selection.available) + " available at these bounds."
          : "No eligible region."
      }}
      <span v-if="selection.exclusions.length"
        >Check {{ selection.exclusions.join(", ") }}.</span
      >
    </p>
    <details
      :open="diagnostic ? true : undefined"
      @toggle="($event.target as HTMLDetailsElement).open && emit('counts')"
    >
      <summary>Review joint design regions</summary>
      <div class="study-toolbar">
        <label class="check"
          ><input type="checkbox" v-model="onlyRetained" />Retained regions
          only</label
        >
        <button :disabled="page === 0" @click="page--">Previous</button>
        <span
          >{{ rows.length ? page * pageSize + 1 : 0 }}–{{
            Math.min((page + 1) * pageSize, rows.length)
          }}
          of {{ rows.length }}</span
        >
        <button
          :disabled="(page + 1) * pageSize >= rows.length"
          @click="page++"
        >
          Next
        </button>
      </div>
      <div class="study-table">
        <table>
          <thead>
            <tr>
              <th>Region</th>
              <th v-for="v in targets" :key="v.id">{{ v.label }}</th>
              <th>Posterior</th>
              <th>Observed rows</th>
              <th v-if="diagnostic">
                P(requirements met | region, conditions)
              </th>
              <th>Search bounds</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="region in visibleRows" :key="region.index">
              <th scope="row">{{ region.index + 1 }}</th>
              <td v-for="(v, i) in targets" :key="v.id">
                {{ regionBound(region, i) }}
              </td>
              <td>{{ percent(region.probability) }}</td>
              <td>{{ counts?.[region.index] ?? "—" }}</td>
              <td v-if="diagnostic">
                {{
                  diagnostic[region.index] == null
                    ? "—"
                    : percent(diagnostic[region.index]!)
                }}
              </td>
              <td>
                {{
                  region.exclusions.length
                    ? "Excluded · " + region.exclusions.join(", ")
                    : region.clipped.length
                      ? "Clipped · " + region.clipped.join(", ")
                      : "Whole cell"
                }}<span v-if="region.retained"> · Retained</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>

  <section class="study-config">
    <div class="study-canvas">
      <div class="study-toolbar">
        <h3>Study variables</h3>
        <button @click="fit">Fit view</button>
        <label
          >Inspect
          <select
            :value="selected"
            @change="
              picking = false;
              selected = ($event.target as HTMLSelectElement).value;
            "
          >
            <option v-for="v in variables" :key="v.id" :value="v.id">
              {{ v.label }}
            </option>
          </select>
        </label>
      </div>
      <div class="study-graph">
        <VueFlow
          id="study-graph"
          :nodes="graphNodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :edges-updatable="false"
          :delete-key-code="null"
          :min-zoom="0.1"
          @nodes-initialized="fit"
          @node-click="(e) => inspect(e.node.id)"
        >
          <template #node-study="{ data }">
            <Handle
              v-for="side in sides"
              :key="side"
              :id="side"
              type="source"
              :position="side"
              :connectable="false"
            />
            <div
              class="network-node study-node"
              :class="{
                'study-node-current': data.selected,
                'study-node-predictor': data.predictor,
                'study-node-eligible': data.eligible,
              }"
            >
              <small
                >{{ data.role
                }}<template v-if="data.predictor"> · Predictor</template></small
              >
              <strong>{{ data.label }}</strong>
              <small v-if="data.objective || data.constraint"
                >{{
                  data.objective === "min"
                    ? "Minimise"
                    : data.objective === "max"
                      ? "Maximise"
                      : ""
                }}{{ data.objective && data.constraint ? " · " : ""
                }}{{ data.constraint ? "Constraint" : "" }}</small
              >
            </div>
          </template>
        </VueFlow>
      </div>
    </div>
    <aside class="study-inspector">
      <h3>{{ variable.label }}</h3>
      <fieldset :disabled="busy">
        <label
          >Study role
          <select :value="node.role" @change="role">
            <option
              v-for="(label, value) in nodeRoles"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select>
        </label>
        <template v-if="node.role === 'input'">
          <div
            v-if="isCategorical(variable)"
            class="study-options"
            aria-label="Allowed categories"
          >
            <label
              v-for="(value, i) in variable.states"
              :key="value"
              class="check"
            >
              <input
                type="checkbox"
                :checked="node.categories?.includes(value)"
                @change="
                  list(
                    'categories',
                    value,
                    ($event.target as HTMLInputElement).checked,
                    node.categories ?? [],
                  )
                "
              />{{ stateLabel(variable, i) }}
            </label>
          </div>
          <template v-else>
            <label
              >Lower design bound
              <input
                type="number"
                step="any"
                :value="node.min"
                @change="change({ min: number($event) })"
            /></label>
            <label
              >Upper design bound
              <input
                type="number"
                step="any"
                :value="node.max"
                @change="change({ max: number($event) })"
            /></label>
          </template>
        </template>
        <template v-else-if="node.role === 'fixed'">
          <p
            v-if="study.snapshot.evidence[variable.id] !== undefined"
            class="tiny muted"
          >
            Query permits
            {{ fixedStates.map((i) => stateLabel(variable, i)).join(", ") }}
          </p>
          <label
            >Exact operating value
            <select
              v-if="!variable.binning"
              :value="node.value"
              @change="
                change({
                  value: isCategorical(variable)
                    ? ($event.target as HTMLSelectElement).value
                    : Number(($event.target as HTMLSelectElement).value),
                })
              "
            >
              <option value="" disabled>Choose a value</option>
              <option
                v-for="i in fixedStates"
                :key="i"
                :value="variable.states[i]"
              >
                {{ stateLabel(variable, i) }}
              </option>
            </select>
            <input
              v-else
              type="number"
              step="any"
              :value="node.value"
              @change="change({ value: number($event) })"
            />
          </label>
        </template>
        <template v-else-if="modelled">
          <label v-if="node.role === 'response' && !isCategorical(variable)"
            >Objective
            <select
              :value="node.objective ?? ''"
              @change="
                change({
                  objective: (($event.target as HTMLSelectElement).value ||
                    undefined) as StudyNode['objective'],
                })
              "
            >
              <option value="">None</option>
              <option value="min">Minimise</option>
              <option value="max">Maximise</option>
            </select>
          </label>
          <label class="field"
            >Predictor structure
            <select
              :value="mode"
              @change="
                (e) =>
                  change({
                    predictorMode: (e.target as HTMLSelectElement)
                      .value as StudyNode['predictorMode'],
                  })
              "
            >
              <option value="direct">Direct from inputs</option>
              <option value="parents">Use graph parents</option>
            </select>
          </label>
          <label class="field"
            >Estimator
            <select
              :value="node.estimator ?? 'forest'"
              @change="
                (e) =>
                  change({
                    estimator: (e.target as HTMLSelectElement)
                      .value as StudyNode['estimator'],
                  })
              "
            >
              <option value="forest">{{ estimatorLabels.forest }}</option>
              <template v-if="!isCategorical(variable)">
                <option value="linear">{{ estimatorLabels.linear }}</option>
                <option value="quadratic">
                  {{ estimatorLabels.quadratic }}
                </option>
                <option
                  v-if="variable.representation === 'discretised'"
                  value="gaussian-process"
                >
                  {{ estimatorLabels["gaussian-process"] }}
                </option>
              </template>
            </select>
          </label>
          <p v-if="node.estimator === 'gaussian-process'" class="tiny muted">
            Fits up to {{ GP_TRAINING_LIMIT }} seeded training rows, with up to
            {{ GP_FEATURE_LIMIT }} encoded predictors and
            {{ GP_DATASET_LIMIT.toLocaleString() }} data rows. Constraints use
            the predicted mean. Review interval coverage on the holdout.
          </p>
          <ul v-if="predictors.length" class="tiny">
            <li v-for="id in predictors" :key="id">
              {{ predictorLabel(id) }} · {{ predictorSource(id) }}
            </li>
          </ul>
          <h4>Predictors</h4>
          <button :aria-pressed="picking" @click="picking = !picking">
            {{ picking ? "Done picking on graph" : "Pick predictors on graph" }}
          </button>
          <div class="study-options">
            <label v-for="v in available" :key="v.id" class="check">
              <input
                type="checkbox"
                :checked="predictors.includes(v.id)"
                :disabled="mode === 'parents' && graphParents.includes(v.id)"
                @change="
                  (e) =>
                    updatePredictor(
                      v.id,
                      (e.target as HTMLInputElement).checked,
                    )
                "
              />{{ v.label }}
            </label>
          </div>
          <button
            v-if="mode === 'direct' && node.predictors"
            @click="change({ predictors: undefined })"
          >
            Use suggested predictors
          </button>
        </template>
        <button
          v-if="rules.length < 200"
          type="button"
          @click="editor?.openFor(selected)"
        >
          Add constraint for {{ variable.label }}
        </button>
        <button
          v-for="rule in rules.filter(
            (rule) => 'variableId' in rule && rule.variableId === selected,
          )"
          :key="rule.id"
          type="button"
          @click="editor?.edit(rule)"
        >
          Edit constraint · {{ constraintLabel(study, rule) }}
        </button>
      </fieldset>
    </aside>
  </section>
  <section class="study-summary">
    <h3>Problem summary</h3>
    <ul>
      <li v-for="v in summary" :key="v.id">
        <strong>{{ v.label }}</strong> · {{ roleLabel(v.id) }}
        <template v-if="study.nodes[v.id].role === 'fixed'">
          · {{ study.nodes[v.id].value ?? "Choose a value" }}</template
        >
        <template v-if="study.nodes[v.id].role === 'response'">
          <template v-if="study.nodes[v.id].objective">
            ·
            {{
              study.nodes[v.id].objective === "min" ? "Minimise" : "Maximise"
            }}</template
          >
        </template>
      </li>
    </ul>
    <div class="study-toolbar">
      <label class="field"
        >Validation seed
        <input
          type="number"
          min="0"
          max="4294967295"
          step="1"
          :value="study.validationSeed ?? defaultValidationSeed"
          :disabled="busy"
          @change="
            (e) => {
              const input = e.target as HTMLInputElement;
              const value = input.valueAsNumber;
              if (
                Number.isInteger(value) &&
                value >= 0 &&
                value <= 0xffffffff
              ) {
                study.validationSeed = value;
                st.touch('display');
              } else
                input.value = String(
                  study.validationSeed ?? defaultValidationSeed,
                );
            }
          "
        />
      </label>
      <label class="field"
        >Group repeated designs by
        <select
          :value="study.designIdColumn ?? ''"
          :disabled="busy"
          @change="
            (e) => {
              const value = (e.target as HTMLSelectElement).value;
              study.designIdColumn = value === '' ? undefined : Number(value);
              st.touch('display');
            }
          "
        >
          <option value="">Each row is a separate design</option>
          <option
            v-for="(header, i) in study.snapshot.dataset?.headers"
            :key="i"
            :value="i"
          >
            {{ header }}
          </option>
        </select>
      </label>
    </div>
    <StudyConstraints
      ref="editor"
      :study="study"
      :busy="busy"
      @changed="st.touch('display')"
    />
    <p v-if="blocked" class="field-error">{{ blocked }}</p>
    <button class="primary" :disabled="busy || !!blocked" @click="emit('next')">
      Review and fit surrogates
    </button>
  </section>
</template>
