import { createRouter, createWebHistory } from 'vue-router'
import DotGridEditor from '@/views/DotGridEditor.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: DotGridEditor
    }
  ]
})
