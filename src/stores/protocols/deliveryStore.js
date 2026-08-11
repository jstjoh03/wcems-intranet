import { ref, reactive } from 'vue'

export const deliveryStore = {
  form: reactive({
    birthTime: '',
    birthDate: '',
    placentaTime: '',
    placentaDate: '',
    notes: '',
  }),
  complications: reactive([
    { id: 1, label: 'Breech Presentation', checked: false },
    { id: 2, label: 'Meconium', checked: false },
    { id: 3, label: 'Prolapsed Cord', checked: false },
    { id: 4, label: 'Uncontrolled Bleeding', checked: false },
    { id: 5, label: 'Shoulder Dystocia', checked: false },
    { id: 6, label: 'Multiple Gestation', checked: false },
  ]),
  apgar1: reactive({ appearance: null, pulse: null, grimace: null, activity: null, respiration: null }),
  apgar5: reactive({ appearance: null, pulse: null, grimace: null, activity: null, respiration: null }),
}