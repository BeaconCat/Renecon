import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN.js';

// Default locale is Chinese. Additional dictionaries (e.g. en-US) can be added
// to ./locales and registered here without touching call sites.
export const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('renecon.locale') || 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
  },
});

export function setLocale(locale) {
  i18n.global.locale.value = locale;
  localStorage.setItem('renecon.locale', locale);
}
