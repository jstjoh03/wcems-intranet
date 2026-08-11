<template>
  <div v-if="show" class="overlay" @click.self="$emit('close')">
    <div class="sheet">
      <div class="sheet-hdr">
        <span class="sheet-title">{{ title }}</span>
        <button class="sheet-close" @click="$emit('close')">✕</button>
      </div>
      <div class="sheet-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({ show: Boolean, title: String })
defineEmits(['close'])
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}

.sheet {
  background: var(--navy-mid);
  border-radius: 20px 20px 0 0;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  border-top: 1px solid var(--border);
}

.sheet-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--navy-mid);
}

.sheet-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--white);
  letter-spacing: 0.05em;
}

.sheet-close {
  background: none;
  color: var(--text-muted);
  font-size: 16px;
  padding: 4px 8px;
}

.sheet-content {
  padding: 16px 20px;
}
</style>