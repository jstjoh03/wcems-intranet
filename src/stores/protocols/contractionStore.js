import { ref } from 'vue'

export const contractionStore = {
  contractions: ref([]),
  isActive: ref(false),
  currentStart: ref(null)
}