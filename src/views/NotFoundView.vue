<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="not-found">
    <div class="not-found__inner">
      <div class="not-found__code display">404</div>
      <h1 class="not-found__title display">Page not found</h1>
      <p class="not-found__sub">
        The page you were looking for doesn't exist on the WCEMS intranet.
      </p>
      <RouterLink to="/" class="btn btn-primary">Back to dashboard</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 60dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}
.not-found__inner {
  text-align: center;
  max-width: 480px;
}
.not-found__code {
  font-size: 96px;
  letter-spacing: -0.02em;
  color: var(--color-brand-600);
  line-height: 1;
}
.not-found__title {
  margin-top: 8px;
  font-size: 28px;
  color: var(--color-ink);
}
.not-found__sub {
  margin: 12px 0 24px;
  color: var(--color-ink-soft);
  font-size: 14px;
}
</style>
