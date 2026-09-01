<script setup lang="ts">
defineProps<{ subtitle?: string }>()
</script>

<template>
  <div class="pub">
    <div class="pub-wrap">
      <header class="pub-head">
        <div class="pub-brand">WCEMS Training</div>
        <div v-if="subtitle" class="pub-sub">{{ subtitle }}</div>
      </header>
      <slot />
      <footer class="pub-foot">Waller County EMS Training System</footer>
    </div>
  </div>
</template>

<style scoped>
.pub {
  min-height: 100dvh;
  background: var(--color-canvas);
  padding: 24px 16px 48px;
}
.pub-wrap {
  max-width: 520px;
  margin: 0 auto;
}
.pub-head {
  text-align: center;
  margin-bottom: 22px;
}
.pub-brand {
  font-family: var(--font-display);
  font-size: 26px;
  color: var(--color-brand-700);
  letter-spacing: -0.01em;
}
.pub-sub {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--color-muted);
}
.pub-foot {
  text-align: center;
  margin-top: 26px;
  font-size: 12px;
  color: var(--color-muted);
}
</style>
