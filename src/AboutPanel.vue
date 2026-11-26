<script setup lang="ts">
import MarkdownIt from "markdown-it";
import { ref } from "vue";
import content from "../doc/about.md?raw";

const dialog = ref<HTMLDialogElement>();
const html = ref("");
const error = ref("");
function show() {
  dialog.value?.showModal();
  if (html.value) return;
  error.value = "";
  try {
    html.value = new MarkdownIt({ html: false }).render(content);
  } catch {
    error.value =
      "Could not load About content. Close the panel and try again.";
  }
}
</script>

<template>
  <button aria-haspopup="dialog" @click="show">About</button>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog about-dialog"
      aria-labelledby="about-title"
    >
      <header class="workspace-dialog-heading">
        <h2 id="about-title">About PDOPT</h2>
        <form method="dialog"><button autofocus>Close</button></form>
      </header>
      <p v-if="error" class="tutorial-content" role="alert">{{ error }}</p>
      <article
        v-else
        class="tutorial-content"
        tabindex="0"
        v-html="html"
      ></article>
    </dialog>
  </Teleport>
</template>
