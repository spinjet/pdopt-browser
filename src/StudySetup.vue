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
  suggestPredictors,
  type StudyRegion,
} from "./study";
import { useProject } from "./store";

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
const predictors = computed(() =>
  node.value?.role === "response"
    ? (node.value.predictors ?? suggestPredictors(props.study, selected.value))
    : [],
);
const available = computed(() =>
  variables.value.filter(
    (v) =>
      v.columnId && ["input", "fixed"].includes(props.study.nodes[v.id].role),
  ),
);
const summary = computed(() =>
  variables.value.filter((v) => props.study.nodes[v.id].role !== "unused"),
);
const graphNodes = computed(() =>
  variables.value.map((v) => ({
    id: v.id,
    position: v.position,
    type: "study",
    data: {
      label: v.label,
      role: nodeRoles[props.study.nodes[v.id].role],
      objective: props.study.nodes[v.id].objective,
      constraint: !!props.study.nodes[v.id].constraint,
      selected: v.id === selected.value,
      predictor: predictors.value.includes(v.id),
      eligible:
        picking.value && available.value.some((item) => item.id === v.id),
    },
  })),
);
const sides = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const edges = computed(() =>
  props.study.snapshot.edges.map((e) => ({
    ...e,
    sourceHandle: e.sourceHandle ?? "right",
    targetHandle: e.targetHandle ?? "left",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#718599" },
    style: { stroke: "#718599", strokeWidth: 2 },
  })),
);
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
    list("predictors", id, !predictors.value.includes(id), predictors.value);
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
  if (next !== "input" && next !== "fixed") {
    for (const other of Object.values(props.study.nodes)) {
      if (other.predictors?.includes(selected.value))
        other.predictors = other.predictors.filter(
          (id) => id !== selected.value,
        );
    }
  }
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
function constraint(kind: string) {
  if (kind === "numeric")
    change({ constraint: { kind, operator: "lt", value: 0 } });
  else if (kind === "categories") change({ constraint: { kind, values: [] } });
  else if (kind === "states") change({ constraint: { kind, states: [] } });
  else change({ constraint: undefined });
}
function numericConstraint(patch: {
  value?: number;
  operator?: "lt" | "lte" | "gt" | "gte";
}) {
  if (node.value.constraint?.kind === "numeric")
    change({ constraint: { ...node.value.constraint, ...patch } });
}
function setConstraintState(i: number, checked: boolean) {
  const c = node.value.constraint;
  if (c?.kind === "categories") {
    const value = variable.value.states[i];
    change({
      constraint: {
        ...c,
        values: checked
          ? [...c.values, value]
          : c.values.filter((v) => v !== value),
      },
    });
  } else if (c?.kind === "states") {
    change({
      constraint: {
        ...c,
        states: checked ? [...c.states, i] : c.states.filter((v) => v !== i),
      },
    });
  }
}
function isConstraintState(i: number) {
  const c = node.value.constraint;
  return c?.kind === "states"
    ? c.states.includes(i)
    : c?.kind === "categories" && c.values.includes(variable.value.states[i]);
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
        <template v-else-if="node.role === 'response'">
          <label v-if="!isCategorical(variable)"
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
          <label
            >Constraint
            <select
              :value="node.constraint?.kind ?? ''"
              @change="constraint(($event.target as HTMLSelectElement).value)"
            >
              <option value="">None</option>
              <option v-if="!isCategorical(variable)" value="numeric">
                Numeric limit
              </option>
              <option
                :value="isCategorical(variable) ? 'categories' : 'states'"
              >
                Accepted states
              </option>
            </select>
          </label>
          <template v-if="node.constraint?.kind === 'numeric'">
            <label
              >Comparison
              <select
                :value="node.constraint.operator"
                @change="
                  numericConstraint({
                    operator: ($event.target as HTMLSelectElement).value as
                      'lt' | 'lte' | 'gt' | 'gte',
                  })
                "
              >
                <option value="lt">&lt;</option>
                <option value="lte">≤</option>
                <option value="gt">&gt;</option>
                <option value="gte">≥</option>
              </select>
            </label>
            <label
              >Limit
              <input
                type="number"
                step="any"
                :value="node.constraint.value"
                @change="
                  number($event) !== undefined
                    ? numericConstraint({ value: number($event) })
                    : (($event.target as HTMLInputElement).value = String(
                        node.constraint!.kind === 'numeric'
                          ? node.constraint!.value
                          : '',
                      ))
                "
            /></label>
          </template>
          <div v-else-if="node.constraint" class="study-options">
            <label v-for="(_, i) in variable.states" :key="i" class="check">
              <input
                type="checkbox"
                :checked="isConstraintState(i)"
                @change="
                  setConstraintState(
                    i,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />{{ stateLabel(variable, i) }}
            </label>
          </div>
          <h4>Predictors</h4>
          <button :aria-pressed="picking" @click="picking = !picking">
            {{ picking ? "Done picking on graph" : "Pick predictors on graph" }}
          </button>
          <div class="study-options">
            <label v-for="v in available" :key="v.id" class="check">
              <input
                type="checkbox"
                :checked="predictors.includes(v.id)"
                @change="
                  list(
                    'predictors',
                    v.id,
                    ($event.target as HTMLInputElement).checked,
                    predictors,
                  )
                "
              />{{ v.label }}
            </label>
          </div>
          <button
            v-if="node.predictors"
            @click="change({ predictors: undefined })"
          >
            Use suggested predictors
          </button>
        </template>
      </fieldset>
    </aside>
  </section>
  <section class="study-summary">
    <h3>Problem summary</h3>
    <ul>
      <li v-for="v in summary" :key="v.id">
        <strong>{{ v.label }}</strong> · {{ nodeRoles[study.nodes[v.id].role] }}
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
          <template v-if="study.nodes[v.id].constraint"> · Constraint</template>
        </template>
      </li>
    </ul>
    <p v-if="blocked" class="field-error">{{ blocked }}</p>
    <button class="primary" :disabled="busy || !!blocked" @click="emit('next')">
      Review and fit surrogates
    </button>
  </section>
</template>
