<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Bell, Edit2, X } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import announcementsData from '@/data/announcements.json'
import type { Announcement } from '@/types'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Local mutable copy. Phase 2 swaps for `supabase.from('content_blocks')`
// queries with `type = 'announcement'`.
const announcements = ref<Announcement[]>(JSON.parse(JSON.stringify(announcementsData)))

const composing = ref(false)
const draft = ref({
  tag: 'Operations',
  title: '',
  body: '',
})

function startCompose() {
  composing.value = true
  draft.value = { tag: 'Operations', title: '', body: '' }
}

function publish() {
  if (!draft.value.title.trim()) return
  announcements.value = [
    {
      id: crypto.randomUUID(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      tag: draft.value.tag,
      title: draft.value.title.trim(),
      body: draft.value.body.trim(),
      authorName: auth.appUser?.fullName ?? 'Admin',
      publishedAt: new Date().toISOString(),
    },
    ...announcements.value,
  ]
  composing.value = false
}

function remove(id: string) {
  announcements.value = announcements.value.filter((a) => a.id !== id)
}
</script>

<template>
  <AppCard class="announcements-card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <Eyebrow>Announcements</Eyebrow>
      <button v-if="auth.isAdmin && !composing" class="announcements-card__new" @click="startCompose">
        <Plus :size="11" :stroke-width="2" /> New
      </button>
    </div>

    <!-- Compose form (admin only) -->
    <form v-if="composing" class="announcements-card__compose" @submit.prevent="publish">
      <input
        v-model="draft.title"
        type="text"
        placeholder="Headline"
        class="announcements-card__input"
        required
      />
      <select v-model="draft.tag" class="announcements-card__select">
        <option>Operations</option>
        <option>Protocol</option>
        <option>Education</option>
        <option>Recognition</option>
        <option>Outreach</option>
      </select>
      <textarea
        v-model="draft.body"
        placeholder="Body (optional)"
        class="announcements-card__textarea"
        rows="3"
      />
      <div class="announcements-card__compose-actions">
        <button type="button" class="btn btn-ghost" @click="composing = false">Cancel</button>
        <button type="submit" class="btn btn-primary">Publish</button>
      </div>
    </form>

    <!-- Empty state -->
    <div v-if="announcements.length === 0 && !composing" class="announcements-card__empty">
      <Bell :size="20" :stroke-width="1.5" class="announcements-card__empty-icon" />
      <div class="announcements-card__empty-title">No current announcements</div>
      <p v-if="auth.isAdmin" class="announcements-card__empty-sub">
        Tap <strong>+ New</strong> to post an update for the team.
      </p>
      <p v-else class="announcements-card__empty-sub">
        Updates from operations, protocols, and education will appear here.
      </p>
    </div>

    <!-- List -->
    <div v-else-if="announcements.length > 0" class="space-y-3">
      <article
        v-for="(a, i) in announcements"
        :key="a.id"
        class="announcements-card__row"
        :class="{ 'announcements-card__row--last': i === announcements.length - 1 }"
      >
        <div class="flex items-center gap-2 mb-1.5 flex-wrap">
          <AppChip variant="brand">{{ a.tag }}</AppChip>
          <span class="font-mono text-[10.5px]" style="color: var(--color-muted)">
            {{ a.date }}
          </span>
          <span class="ml-auto flex items-center gap-2">
            <button v-if="auth.isAdmin" class="announcements-card__edit" aria-label="Edit">
              <Edit2 :size="11" />
            </button>
            <button
              v-if="auth.isAdmin"
              class="announcements-card__edit"
              aria-label="Remove"
              @click="remove(a.id)"
            >
              <X :size="11" />
            </button>
          </span>
        </div>
        <h4 class="announcements-card__title display">{{ a.title }}</h4>
        <p v-if="a.body" class="announcements-card__body">{{ a.body }}</p>
        <div class="announcements-card__by">— {{ a.authorName }}</div>
      </article>
    </div>
  </AppCard>
</template>

<style scoped>
.announcements-card {
  padding: 20px;
}
.announcements-card__new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.announcements-card__new:hover {
  background: var(--color-brand-100);
}

.announcements-card__compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  margin-bottom: 12px;
}
.announcements-card__input,
.announcements-card__select,
.announcements-card__textarea {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
  width: 100%;
}
.announcements-card__input:focus,
.announcements-card__select:focus,
.announcements-card__textarea:focus {
  border-color: var(--color-brand-500);
}
.announcements-card__textarea {
  resize: vertical;
  font-family: var(--font-sans);
}
.announcements-card__compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.announcements-card__empty {
  text-align: center;
  padding: 12px 8px 4px;
}
.announcements-card__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 8px;
}
.announcements-card__empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.announcements-card__empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.5;
}

.announcements-card__row {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-line);
}
.announcements-card__row--last {
  padding-bottom: 0;
  border-bottom: none;
}
.announcements-card__title {
  font-size: 16px;
  line-height: 1.25;
  color: var(--color-ink);
  margin-top: 4px;
}
.announcements-card__body {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.announcements-card__by {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
}
.announcements-card__edit {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px 4px;
  border-radius: 4px;
}
.announcements-card__edit:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}
</style>
