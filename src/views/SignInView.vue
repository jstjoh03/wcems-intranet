<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const submitting = ref(false)
const error = ref<string | null>(null)

/* If a real session is already in flight (the page just rendered after
   the OAuth callback came back), bounce to the destination. */
if (auth.isAuthenticated && !auth.usingDevStub) {
  const next = (route.query.next as string | undefined) ?? '/'
  router.replace(next)
}

async function signIn() {
  error.value = null
  submitting.value = true
  try {
    await auth.signInWithMicrosoft()
    /* `signInWithOAuth` redirects the page away — we won't usually get
       here. Anything past this point is an error path. */
  } catch (e) {
    submitting.value = false
    error.value =
      e instanceof Error
        ? e.message
        : 'Could not start the Microsoft sign-in flow.'
  }
}
</script>

<template>
  <main class="signin">
    <section class="signin__panel">
      <img
        src="/wcems-patch.png"
        alt=""
        width="72"
        height="72"
        class="signin__patch"
      />
      <div class="signin__eyebrow">Waller County EMS</div>
      <h1 class="signin__title display">Sign in to the intranet</h1>
      <p class="signin__sub">
        Use your <strong>@wallercountyems.com</strong> Microsoft account.
        Crew, supervisors, and admins all sign in here.
      </p>

      <button
        type="button"
        class="signin__btn"
        :disabled="submitting"
        @click="signIn"
      >
        <svg
          class="signin__ms-logo"
          aria-hidden="true"
          viewBox="0 0 21 21"
          width="18"
          height="18"
        >
          <rect x="1" y="1" width="9" height="9" fill="#f25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
          <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
        {{ submitting ? 'Redirecting…' : 'Sign in with Microsoft' }}
      </button>

      <p v-if="error" class="signin__error" role="alert">{{ error }}</p>

      <p class="signin__fineprint">
        Trouble signing in? Confirm with admin that your account exists in
        the WCEMS Microsoft tenant.
      </p>
    </section>
  </main>
</template>

<style scoped>
.signin {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background:
    radial-gradient(
      ellipse at 30% 0%,
      oklch(0.22 0.1 250 / 0.45) 0%,
      transparent 55%
    ),
    radial-gradient(
      ellipse at 80% 100%,
      oklch(0.22 0.1 250 / 0.35) 0%,
      transparent 55%
    ),
    var(--color-brand-950);
}

.signin__panel {
  width: 100%;
  max-width: 420px;
  padding: 36px 32px 28px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.signin__patch {
  width: 72px;
  height: 72px;
  object-fit: contain;
  filter:
    drop-shadow(0 1px 1px oklch(0.18 0.015 260 / 0.18))
    drop-shadow(0 6px 14px oklch(0.18 0.015 260 / 0.12));
  margin-bottom: 18px;
}

.signin__eyebrow {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.signin__title {
  font-size: 26px;
  line-height: 1.1;
  color: var(--color-ink);
  margin-top: 4px;
}
.signin__sub {
  margin-top: 10px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--color-ink-soft);
}

.signin__btn {
  margin-top: 22px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 11px 16px;
  background: var(--color-brand-900);
  color: white;
  border: 1px solid var(--color-brand-800);
  border-radius: 10px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.005em;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.06),
    0 1px 2px oklch(0.18 0.015 260 / 0.18),
    0 8px 22px oklch(0.18 0.015 260 / 0.18);
  transition: transform 160ms var(--ease-out),
    background 160ms var(--ease-out), box-shadow 160ms var(--ease-out);
}
.signin__btn:hover:not(:disabled) {
  background: var(--color-brand-800);
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.08),
    0 2px 4px oklch(0.18 0.015 260 / 0.22),
    0 14px 30px oklch(0.18 0.015 260 / 0.22);
}
.signin__btn:active:not(:disabled) {
  transform: translateY(0);
}
.signin__btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.signin__ms-logo {
  flex-shrink: 0;
}

.signin__error {
  margin-top: 14px;
  width: 100%;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 8px 12px;
  line-height: 1.4;
}
.signin__fineprint {
  margin-top: 22px;
  font-size: 11.5px;
  color: var(--color-muted);
  line-height: 1.5;
  max-width: 32ch;
}
</style>
