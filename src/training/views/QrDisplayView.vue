<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { qrDataUrl } from '@/training/lib/qr'

type Kind = 'checkin' | 'eval' | 'quiz' | 'engage'
const route = useRoute()
const rawKind = String(route.query.kind || 'checkin')
const kind: Kind =
  rawKind === 'eval'
    ? 'eval'
    : rawKind === 'quiz'
      ? 'quiz'
      : rawKind === 'engage'
        ? 'engage'
        : 'checkin'
const token = (route.query.token as string) || ''
// Engagement is keyed by session id (single shared link for virtual
// attendees), unlike the per-token kinds.
const session = (route.query.session as string) || ''
const course = (route.query.course as string) || ''
const qr = ref('')
const url = ref('')

const headingByKind: Record<Kind, string> = {
  checkin: 'Check-In',
  eval: 'Evaluation',
  quiz: 'Course Quiz',
  engage: 'Virtual Engagement',
}
const instructionByKind: Record<Kind, string> = {
  checkin: 'Scan to Check In',
  eval: 'Scan to Submit Evaluation',
  quiz: 'Scan to Take the Quiz',
  engage: 'Virtual Attendees — Scan to Join',
}

onMounted(async () => {
  const origin = window.location.origin
  url.value =
    kind === 'checkin'
      ? `${origin}/checkin?t=${token}`
      : kind === 'eval'
        ? `${origin}/eval?t=${token}`
        : kind === 'quiz'
          ? `${origin}/quiz?t=${token}`
          : `${origin}/engage?session=${session}`
  qr.value = await qrDataUrl(url.value, 460)
})
</script>

<template>
  <div class="disp">
    <div class="box">
      <h1>WCEMS Training {{ headingByKind[kind] }}</h1>
      <div class="course">{{ course }}</div>
      <img :src="qr" alt="QR Code" />
      <div class="instruction">{{ instructionByKind[kind] }}</div>
      <div class="url">{{ url }}</div>
      <div class="logo">Waller County EMS Training System</div>
    </div>
  </div>
</template>

<style scoped>
.disp {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 40px;
  background: linear-gradient(135deg, #f8fafc, #e2e8f0);
}
.box {
  background: #fff;
  border-radius: 24px;
  padding: 48px 64px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
  text-align: center;
  max-width: 640px;
}
h1 {
  color: var(--color-brand-700);
  font-size: 28px;
  margin: 0 0 8px;
  font-family: var(--font-display);
}
.course {
  color: var(--color-muted);
  font-size: 20px;
  margin-bottom: 28px;
}
img {
  display: block;
  margin: 0 auto 24px;
  border-radius: 12px;
}
.instruction {
  color: var(--color-brand-700);
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 14px;
}
.url {
  color: var(--color-muted-soft);
  font-size: 14px;
  word-break: break-all;
}
.logo {
  margin-top: 30px;
  color: var(--color-muted);
  font-size: 14px;
}
</style>
