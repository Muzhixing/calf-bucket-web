import { createRouter, createWebHistory } from 'vue-router'
import DotGridEditor from '@/views/DotGridEditor.vue'
import WebRTCViewer from '@/views/WebRTCViewer.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: DotGridEditor
    },
    {
      path: '/viewer',
      component: WebRTCViewer
    }
  ]
})
