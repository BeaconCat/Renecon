<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '../api/client.js';
import Icon from '../components/Icon.vue';

const logs = ref([]);
let timer = null;

async function load() {
  logs.value = await api.getLogs(300);
}

function levelClass(l) {
  return { error: 'lvl--err', warn: 'lvl--warn', info: 'lvl--info', debug: 'lvl--debug' }[l] || '';
}

onMounted(() => {
  load();
  timer = setInterval(load, 4000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="card">
    <div class="head">
      <div>
        <h3 class="card__title">{{ $t('logs.title') }}</h3>
        <p class="card__desc" style="margin: 0">{{ $t('logs.desc') }}</p>
      </div>
      <button class="btn btn--ghost" @click="load"><Icon name="refresh" :size="16" /></button>
    </div>

    <div class="console">
      <div v-for="(l, i) in logs" :key="i" class="line">
        <span class="line__time">{{ new Date(l.time).toLocaleTimeString() }}</span>
        <span class="line__lvl" :class="levelClass(l.level)">{{ l.level.toUpperCase() }}</span>
        <span class="line__scope">{{ l.scope }}</span>
        <span class="line__msg">{{ l.message }}</span>
      </div>
      <p v-if="!logs.length" class="hint">{{ $t('common.empty') }}</p>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.console {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 12px; font-family: var(--mono); font-size: 12px; line-height: 1.7;
  max-height: 68vh; overflow-y: auto;
}
.line { display: flex; gap: 10px; white-space: pre-wrap; word-break: break-word; }
.line__time { color: var(--text-faint); flex-shrink: 0; }
.line__lvl { flex-shrink: 0; width: 44px; font-weight: 700; }
.line__scope { color: var(--glow-blue); flex-shrink: 0; }
.line__msg { color: var(--text-dim); }
.lvl--err { color: var(--glow-red); }
.lvl--warn { color: var(--glow-amber); }
.lvl--info { color: var(--text); }
.lvl--debug { color: var(--text-faint); }
.hint { color: var(--text-faint); }
</style>
