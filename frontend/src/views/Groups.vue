<script setup>
import { ref, onMounted, computed } from 'vue';
import { useConfigStore } from '../store/config.js';
import { useUiStore } from '../store/ui.js';
import { api } from '../api/client.js';
import { useI18n } from 'vue-i18n';
import Icon from '../components/Icon.vue';

const cfg = useConfigStore();
const ui = useUiStore();
const { t } = useI18n();

const liveGroups = ref([]);
const fetching = ref(false);
const manualId = ref('');
const manualName = ref('');

// Working copy of monitored groups.
const groups = ref([]);

function syncFromConfig() {
  groups.value = (cfg.config?.groups || []).map((g) => ({ ...g }));
}

const monitoredIds = computed(() => new Set(groups.value.map((g) => String(g.id))));

async function fetchLive() {
  fetching.value = true;
  try {
    liveGroups.value = await api.getLiveGroups();
  } catch (e) {
    ui.notify(t('toast.fetchErr', { msg: e.message }), 'err');
  } finally {
    fetching.value = false;
  }
}

function toggleLive(g) {
  const id = String(g.id);
  if (monitoredIds.value.has(id)) {
    groups.value = groups.value.filter((x) => String(x.id) !== id);
  } else {
    groups.value.push({ id, name: g.name, enabled: true });
  }
}

function addManual() {
  const id = manualId.value.trim();
  if (!id || monitoredIds.value.has(id)) return;
  groups.value.push({ id, name: manualName.value.trim() || id, enabled: true });
  manualId.value = '';
  manualName.value = '';
}

function remove(id) {
  groups.value = groups.value.filter((g) => String(g.id) !== String(id));
}

async function save() {
  try {
    await cfg.saveSection('groups', groups.value);
    ui.notify(t('toast.saveOk'), 'ok');
  } catch (e) {
    ui.notify(t('toast.saveErr', { msg: e.message }), 'err');
  }
}

onMounted(async () => {
  if (!cfg.loaded) await cfg.load();
  syncFromConfig();
});
</script>

<template>
  <div>
  <div class="card">
    <h3 class="card__title">{{ $t('groups.title') }}</h3>
    <p class="card__desc">{{ $t('groups.desc') }}</p>

    <div class="toolbar">
      <button class="btn" :disabled="fetching" @click="fetchLive">
        <Icon name="refresh" :size="15" /> {{ $t('groups.fetchLive') }}
      </button>
    </div>

    <div v-if="liveGroups.length" class="live-list">
      <label v-for="g in liveGroups" :key="g.id" class="live-item">
        <input
          type="checkbox"
          :checked="monitoredIds.has(String(g.id))"
          @change="toggleLive(g)"
        />
        <span class="live-item__name">{{ g.name }}</span>
        <span class="live-item__meta">{{ g.id }} · {{ g.memberCount }} 人</span>
      </label>
    </div>
    <p v-else class="hint">{{ $t('groups.noLive') }}</p>
  </div>

  <div class="card" style="margin-top: var(--gap)">
    <h3 class="card__title">{{ $t('groups.monitored') }}</h3>

    <div class="manual">
      <input v-model="manualId" class="input" :placeholder="$t('groups.id')" style="max-width: 160px" />
      <input v-model="manualName" class="input" :placeholder="$t('groups.name')" style="max-width: 220px" />
      <button class="btn" @click="addManual"><Icon name="plus" :size="15" /> {{ $t('common.add') }}</button>
    </div>

    <table class="table" v-if="groups.length">
      <thead>
        <tr>
          <th>{{ $t('groups.id') }}</th>
          <th>{{ $t('groups.name') }}</th>
          <th style="width: 90px">{{ $t('common.enabled') }}</th>
          <th style="width: 80px">{{ $t('groups.action') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in groups" :key="g.id">
          <td class="mono">{{ g.id }}</td>
          <td>{{ g.name }}</td>
          <td>
            <label class="switch">
              <input type="checkbox" v-model="g.enabled" />
              <span class="switch__track" />
            </label>
          </td>
          <td>
            <button class="btn btn--ghost btn--danger" style="padding: 5px 8px" @click="remove(g.id)">
              <Icon name="trash" :size="15" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint">{{ $t('common.empty') }}</p>

    <div class="actions">
      <button class="btn btn--primary" @click="save">
        <Icon name="check" :size="16" /> {{ $t('common.save') }}
      </button>
    </div>
  </div>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 16px; }
.live-list {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;
  max-height: 300px; overflow-y: auto;
}
.live-item {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  cursor: pointer; transition: border-color var(--transition);
}
.live-item:hover { border-color: var(--border-strong); }
.live-item__name { font-size: 13px; font-weight: 500; }
.live-item__meta { margin-left: auto; font-size: 11px; color: var(--text-faint); }
.manual { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.mono { font-family: var(--mono); color: var(--text-dim); }
.hint { color: var(--text-faint); font-size: 13px; }
.actions { margin-top: 18px; display: flex; justify-content: flex-end; }
</style>
