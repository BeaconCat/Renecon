<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api/client.js';
import Icon from '../components/Icon.vue';

const items = ref([]);
const expanded = ref(null);

function fmt(ts) { return new Date(ts * 1000).toLocaleString(); }
function fmtWindow(a, b) {
  const f = (t) => new Date(t * 1000).toLocaleTimeString();
  return `${f(a)} - ${f(b)}`;
}
function statusClass(s) {
  return { success: 'pill--ok', empty: 'pill--warn', error: 'pill--err' }[s] || 'pill--warn';
}

async function load() {
  const r = await api.getDigests({ limit: 50 });
  items.value = r.items;
}

function toggle(id) { expanded.value = expanded.value === id ? null : id; }

onMounted(load);
</script>

<template>
  <div class="card">
    <div class="head">
      <div>
        <h3 class="card__title">{{ $t('digests.title') }}</h3>
        <p class="card__desc" style="margin: 0">{{ $t('digests.desc') }}</p>
      </div>
      <button class="btn btn--ghost" @click="load"><Icon name="refresh" :size="16" /></button>
    </div>

    <table class="table" v-if="items.length">
      <thead>
        <tr>
          <th style="width: 160px">{{ $t('digests.time') }}</th>
          <th style="width: 140px">{{ $t('digests.window') }}</th>
          <th style="width: 110px">{{ $t('digests.mode') }}</th>
          <th style="width: 80px">{{ $t('digests.count') }}</th>
          <th style="width: 100px">{{ $t('digests.result') }}</th>
          <th style="width: 90px">{{ $t('digests.pushed') }}</th>
          <th style="width: 70px"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="d in items" :key="d.id">
          <tr>
            <td class="dim">{{ fmt(d.created_at) }}</td>
            <td class="dim">{{ fmtWindow(d.window_start, d.window_end) }}</td>
            <td>{{ d.mode }}</td>
            <td>{{ d.msg_count }}</td>
            <td>
              <span class="pill" :class="statusClass(d.status)">
                <span class="pill__dot" />{{ $t(`digests.${d.status === 'empty' ? 'emptyStatus' : d.status}`) }}
              </span>
            </td>
            <td>{{ d.pushed ? $t('common.yes') : $t('common.no') }}</td>
            <td>
              <button v-if="d.result || d.error" class="btn btn--ghost" style="padding: 4px 8px" @click="toggle(d.id)">
                {{ $t('digests.view') }}
              </button>
            </td>
          </tr>
          <tr v-if="expanded === d.id">
            <td colspan="7">
              <pre class="detail">{{ d.error || d.result }}</pre>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-else class="hint">{{ $t('common.empty') }}</p>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.dim { color: var(--text-dim); }
.hint { color: var(--text-faint); }
.detail {
  margin: 0; background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px; font-family: var(--mono);
  font-size: 12.5px; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto;
}
</style>
