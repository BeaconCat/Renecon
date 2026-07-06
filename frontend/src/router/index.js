import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/groups', name: 'groups', component: () => import('../views/Groups.vue') },
  { path: '/llm', name: 'llm', component: () => import('../views/Llm.vue') },
  { path: '/feishu', name: 'feishu', component: () => import('../views/Feishu.vue') },
  { path: '/pipeline', name: 'pipeline', component: () => import('../views/Pipeline.vue') },
  { path: '/messages', name: 'messages', component: () => import('../views/Messages.vue') },
  { path: '/digests', name: 'digests', component: () => import('../views/Digests.vue') },
  { path: '/logs', name: 'logs', component: () => import('../views/Logs.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue') },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
