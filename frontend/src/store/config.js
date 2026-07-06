import { defineStore } from 'pinia';
import { api } from '../api/client.js';

/** Holds the full backend config plus live runtime status. */
export const useConfigStore = defineStore('config', {
  state: () => ({
    config: null,
    status: null,
    loaded: false,
  }),
  actions: {
    async load() {
      this.config = await api.getConfig();
      this.loaded = true;
    },
    async refreshStatus() {
      this.status = await api.getStatus();
    },
    async saveSection(section, value) {
      const saved = await api.saveSection(section, value);
      if (this.config) this.config[section] = saved;
      return saved;
    },
  },
});
