<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { stateLabel, type DesignConstraint, type Study } from "./domain";
import { columnReference } from "./formula";
import {
  comparisonLabels,
  compileConstraint,
  constraintDefinitions,
  constraintLabel,
} from "./study-constraints";

const props = defineProps<{ study: Study; busy: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const dialog = ref<HTMLDialogElement>();
const id = ref(""),
  variableId = ref(""),
  limit = ref(""),
  expression = ref("");
const kind = ref<DesignConstraint["kind"]>("numeric");
const operator = ref<keyof typeof comparisonLabels>("lte");
const states = ref<number[]>([]);
const error = ref("");
const rules = computed(() => constraintDefinitions(props.study));
const variables = computed(() => props.study.snapshot.variables);
const choices = computed(() =>
  variables.value.filter((v) =>
    kind.value === "numeric"
      ? v.representation !== "categorical"
      : kind.value === "categories"
        ? v.representation === "categorical"
        : true,
  ),
);
const variable = computed(() =>
  choices.value.find((v) => v.id === variableId.value),
);

watch([kind, variableId, limit, expression, operator, states], () => {
  error.value = "";
});
function open(
  nextKind: DesignConstraint["kind"],
  selected?: string,
  edit?: DesignConstraint,
) {
  kind.value = nextKind;
  id.value = edit?.id ?? "";
  variableId.value = selected ?? choices.value[0]?.id ?? "";
  operator.value = edit?.kind === "numeric" ? edit.operator : "lte";
  limit.value = edit?.kind === "numeric" ? String(edit.value) : "";
  expression.value = edit?.kind === "expression" ? edit.expression : "";
  const v = variable.value;
  states.value =
    edit?.kind === "states"
      ? [...edit.states]
      : edit?.kind === "categories" && v
        ? edit.values.map((value) => v.states.indexOf(value))
        : [];
  error.value = "";
  dialog.value?.showModal();
}
function openFor(selected: string) {
  const v = variables.value.find((v) => v.id === selected);
  if (v)
    open(
      v.representation === "categorical" ? "categories" : "numeric",
      selected,
    );
}
defineExpose({ openFor, edit });
function edit(rule: DesignConstraint) {
  open(rule.kind, "variableId" in rule ? rule.variableId : undefined, rule);
}
function save() {
  const base = { id: id.value || crypto.randomUUID() };
  let rule: DesignConstraint;
  if (kind.value === "expression")
    rule = { ...base, kind: "expression", expression: expression.value.trim() };
  else if (!variable.value) {
    error.value = "Choose a variable.";
    return;
  } else if (kind.value === "numeric") {
    if (!String(limit.value).trim() || !Number.isFinite(Number(limit.value))) {
      error.value = "Enter a finite numerical limit.";
      return;
    }
    rule = {
      ...base,
      kind: "numeric",
      operator: operator.value,
      value: Number(limit.value),
      variableId: variableId.value,
    };
  } else if (kind.value === "categories") {
    rule = {
      ...base,
      kind: "categories",
      variableId: variableId.value,
      values: states.value.map((i) => variable.value!.states[i]),
    };
  } else
    rule = {
      ...base,
      kind: "states",
      variableId: variableId.value,
      states: [...states.value],
    };
  try {
    compileConstraint(props.study, rule);
    props.study.constraints = id.value
      ? rules.value.map((item) => (item.id === id.value ? rule : item))
      : [...rules.value, rule];
    emit("changed");
    dialog.value?.close();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
function remove(id: string) {
  props.study.constraints = rules.value.filter((rule) => rule.id !== id);
  emit("changed");
}
function source(rule: DesignConstraint) {
  try {
    const { references } = compileConstraint(props.study, rule);
    const roles = references.map((id) => props.study.nodes[id].role);
    return roles.every((role) => role === "input" || role === "fixed")
      ? "Inputs and operating conditions"
      : "Requires prediction";
  } catch {
    return "Check definition";
  }
}
</script>

<template>
  <section
    class="study-constraints"
    aria-labelledby="design-constraints-heading"
  >
    <div class="study-toolbar">
      <h3 id="design-constraints-heading">Design constraints</h3>
      <button :disabled="busy || rules.length >= 200" @click="open('numeric')">
        Add numerical constraint
      </button>
      <button
        :disabled="busy || rules.length >= 200"
        @click="open('expression')"
      >
        Add relationship
      </button>
      <button
        :disabled="
          busy ||
          rules.length >= 200 ||
          !variables.some((v) => v.representation === 'categorical')
        "
        @click="open('categories')"
      >
        Add accepted categories
      </button>
    </div>
    <p class="tiny muted">
      The query defines the search regions. Every design must pass these
      constraints to enter the predicted feasible set.
    </p>
    <div v-if="rules.length" class="study-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Evaluated from</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td>{{ constraintLabel(study, rule) }}</td>
            <td>{{ source(rule) }}</td>
            <td class="study-actions">
              <button :disabled="busy" @click="edit(rule)">Edit</button>
              <button :disabled="busy" @click="remove(rule.id)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="tiny muted">No design constraints.</p>
    <Teleport to="body">
      <dialog
        ref="dialog"
        class="workspace-dialog study-constraint-dialog"
        :aria-label="id ? 'Edit design constraint' : 'Add design constraint'"
      >
        <form @submit.prevent="save">
          <header class="workspace-dialog-heading">
            <h2 id="design-constraint-editor">
              {{ id ? "Edit design constraint" : "Add design constraint" }}
            </h2>
            <button type="button" @click="dialog?.close()">Cancel</button>
          </header>
          <div class="study-constraint-fields">
            <template v-if="kind === 'expression'">
              <label class="field"
                >Relationship
                <textarea
                  v-model="expression"
                  maxlength="2000"
                  rows="3"
                  placeholder="[Depth (mm)] >= 1.5 * [Width (mm)]"
                />
              </label>
              <label class="field"
                >Insert variable
                <select
                  @change="
                    (e) => {
                      const select = e.target as HTMLSelectElement;
                      if (select.value)
                        expression += columnReference(select.value);
                      select.value = '';
                    }
                  "
                >
                  <option value="">Choose a variable reference</option>
                  <option v-for="v in variables" :key="v.id" :value="v.label">
                    {{ v.label }}
                  </option>
                </select>
              </label>
            </template>
            <template v-else>
              <label class="field"
                >Variable
                <select v-model="variableId" @change="states = []">
                  <option v-for="v in choices" :key="v.id" :value="v.id">
                    {{ v.label }}
                  </option>
                </select>
              </label>
              <template v-if="kind === 'numeric'">
                <label class="field"
                  >Operator
                  <select v-model="operator">
                    <option
                      v-for="(label, op) in comparisonLabels"
                      :key="op"
                      :value="op"
                    >
                      {{ label }}
                    </option>
                  </select>
                </label>
                <label class="field"
                  >Limit<input
                    v-model="limit"
                    type="number"
                    step="any"
                    required
                /></label>
              </template>
              <fieldset v-else-if="variable">
                <legend>
                  {{
                    kind === "categories"
                      ? "Accepted categories"
                      : "Accepted states"
                  }}
                </legend>
                <label class="check" v-for="(_, i) in variable.states" :key="i">
                  <input type="checkbox" v-model="states" :value="i" />{{
                    stateLabel(variable, i)
                  }}
                </label>
              </fieldset>
            </template>
            <p v-if="error" role="alert" class="field-error">{{ error }}</p>
            <button class="primary" type="submit">Save constraint</button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>
