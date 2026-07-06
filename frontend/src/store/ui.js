import { defineStore } from 'pinia';

/** Theme + toast notifications. */
export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: localStorage.getItem('renecon.theme') || 'dark',
    toasts: [],
    seq: 0,
    // Global confirm dialog. _resolve is the pending promise resolver.
    dialog: { open: false, title: '', message: '', danger: false },
    _resolve: null,
  }),
  actions: {
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.theme);
    },
    setTheme(theme) {
      this.theme = theme;
      localStorage.setItem('renecon.theme', theme);
      this.applyTheme();
    },
    toggleTheme() {
      this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },
    notify(message, type = 'ok') {
      const id = ++this.seq;
      this.toasts.push({ id, message, type });
      setTimeout(() => this.dismiss(id), 3500);
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
    /**
     * Show a modal confirm. Returns a promise resolving to true/false.
     * @param {{title?, message, danger?}} opts
     */
    confirm(opts) {
      this.dialog = {
        open: true,
        title: opts.title || '',
        message: opts.message || '',
        danger: !!opts.danger,
      };
      return new Promise((resolve) => { this._resolve = resolve; });
    },
    resolveDialog(value) {
      this.dialog = { ...this.dialog, open: false };
      if (this._resolve) { this._resolve(value); this._resolve = null; }
    },
  },
});
