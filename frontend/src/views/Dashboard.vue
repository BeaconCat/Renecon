<script setup>
import { onMounted, ref, computed } from 'vue';
import { useConfigStore } from '../store/config.js';
import { useUiStore } from '../store/ui.js';
import { api } from '../api/client.js';
import { useI18n } from 'vue-i18n';
import Icon from '../components/Icon.vue';

const cfg = useConfigStore();
const ui = useUiStore();
const { t } = useI18n();
const running = ref(false);

const s = computed(() => cfg.status);

function fmtTime(ms) {
  if (!ms) return t('dashboard.never');
  return new Date(ms).toLocaleString();
}

const schedPill = computed(() => {
  if (!s.value?.scheduler?.enabled) return 'pill--warn';
  return s.value.scheduler.running ? 'pill--ok' : 'pill--ok';
});

async function runNow() {
  running.value = true;
  try {
    const r = await api.runPipeline();
    ui.notify(t('toast.runOk', { status: r.status }), r.status === 'error' ? 'err' : 'ok');
    await cfg.refreshStatus();
  } catch (e) {
    ui.notify(t('toast.runErr', { msg: e.message }), 'err');
  } finally {
    running.value = false;
  }
}

onMounted(() => cfg.refreshStatus());
</script>

<template>
  <div>
  <div class="grid stats">
    <div class="card stat">
      <span class="stat__label">{{ $t('dashboard.napcatStatus') }}</span>
      <span class="pill" :class="{
        'pill--ok': s?.napcat?.status === 'connected',
        'pill--warn': s?.napcat?.status === 'connecting',
        'pill--err': s?.napcat?.status === 'disconnected',
      }">
        <span class="pill__dot" />
        {{ $t(`status.${s?.napcat?.status || 'disconnected'}`) }}
      </span>
    </div>

    <div class="card stat">
      <span class="stat__label">{{ $t('dashboard.schedulerStatus') }}</span>
      <span class="pill" :class="schedPill">
        <span class="pill__dot" />
        {{ s?.scheduler?.enabled ? $t('status.running') : $t('status.idle') }}
      </span>
    </div>

    <div class="card stat">
      <span class="stat__label">{{ $t('dashboard.messageCount') }}</span>
      <span class="stat__value stat__value--blue">{{ s?.messageCount ?? 0 }}</span>
    </div>

    <div class="card stat">
      <span class="stat__label">{{ $t('dashboard.digestCount') }}</span>
      <span class="stat__value stat__value--amber">{{ s?.digestCount ?? 0 }}</span>
    </div>
  </div>

  <div class="card runbox">
    <div>
      <h3 class="card__title">{{ $t('dashboard.quickRun') }}</h3>
      <p class="card__desc" style="margin: 0">
        {{ $t('dashboard.lastRun') }}: {{ fmtTime(s?.scheduler?.lastRunAt) }}
        &nbsp;·&nbsp;
        {{ $t('dashboard.nextRun') }}: {{ fmtTime(s?.scheduler?.nextRunAt) }}
      </p>
    </div>
    <button class="btn btn--primary" :disabled="running" @click="runNow">
      <Icon name="play" :size="16" />
      {{ $t('common.runNow') }}
    </button>
  </div>
  </div>
</template>

<style scoped>
.stats { grid-template-columns: repeat(4, 1fr); margin-bottom: var(--gap); }
.stat { display: flex; flex-direction: column; gap: 14px; }
.stat__label { font-size: 12.5px; color: var(--text-dim); }
.stat__value { font-size: 32px; font-weight: 700; letter-spacing: -0.5px; }
.stat__value--blue { color: var(--glow-blue); }
.stat__value--amber { color: var(--glow-amber); }
.runbox { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
@media (max-width: 900px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>
