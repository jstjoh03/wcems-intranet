<script setup lang="ts">
const year = new Date().getFullYear()
</script>

<template>
  <footer class="footer">
    <div class="footer__inner">
      <div class="footer__brand">
        <img src="/wcems-patch.png" alt="" class="footer__patch" width="32" height="32" />
        <div class="footer__brand-text">
          Waller County EMS · Hempstead, TX · Est. 1996
        </div>
      </div>
      <div class="footer__links">
        <span class="font-mono text-[10.5px]" style="color: var(--color-muted)">v0.1.0 · {{ year }}</span>
        <a class="footer__link" href="mailto:justin.stjohn@wallercountyems.com?subject=WCEMS%20Intranet%20-%20Issue%20report">
          Report an issue
        </a>
        <a class="footer__link" href="mailto:justin.stjohn@wallercountyems.com?subject=WCEMS%20Intranet%20-%20Suggest%20a%20link">
          Suggest a link
        </a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  margin-top: 56px;
  border-top: 1px solid var(--color-line);
}
.footer__inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 32px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
@media (min-width: 768px) {
  .footer__inner {
    padding: 32px 40px;
  }
}
.footer__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.footer__patch {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.footer__brand-text {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-ink-soft);
}
.footer__links {
  display: flex;
  align-items: center;
  gap: 20px;
}
.footer__link {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.footer__link:hover {
  text-decoration: underline;
}
</style>
