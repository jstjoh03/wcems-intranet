<template>
  <div class="pdf-viewer">
    <iframe
      class="pdf-iframe"
      :src="iframeSrc"
      title="PDF viewer"
      allow="fullscreen"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
})

const iframeSrc = computed(() => {
  const file = encodeURIComponent(props.src)
  return `/pdfjs/web/viewer.html?file=${file}&openFind=1`
})
</script>

<style scoped>
.pdf-viewer {
  height: 70vh;
  margin: -16px -20px;
  display: flex;
}

.pdf-iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: #525659;
}
</style>
