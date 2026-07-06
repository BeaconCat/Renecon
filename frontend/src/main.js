import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { i18n } from './i18n/index.js';
import { useUiStore } from './store/ui.js';
import './styles/theme.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);

// Apply persisted theme before first paint.
useUiStore().applyTheme();

app.mount('#app');
