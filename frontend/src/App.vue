<script setup>
import { onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUiStore } from './store/ui.js';
import { useConfigStore } from './store/config.js';
import Icon from './components/Icon.vue';

const ui = useUiStore();
const cfg = useConfigStore();
const route = useRoute();

const navItems = [
  { name: 'dashboard', icon: 'dashboard' },
  { name: 'groups', icon: 'groups' },
  { name: 'llm', icon: 'cpu' },
  { name: 'feishu', icon: 'send' },
  { name: 'pipeline', icon: 'doc' },
  { name: 'messages', icon: 'chat' },
  { name: 'digests', icon: 'list' },
  { name: 'logs', icon: 'terminal' },
  { name: 'settings', icon: 'settings' },
];

const napcatStatus = computed(() => cfg.status?.napcat?.status || 'disconnected');
const napcatPill = computed(() => ({
  connected: 'pill--ok',
  connecting: 'pill--warn',
  disconnected: 'pill--err',
}[napcatStatus.value] || 'pill--err'));

async function poll() {
  try {
    await cfg.refreshStatus();
  } catch { /* backend may be starting */ }
}

onMounted(() => {
  poll();
  setInterval(poll, 5000);
});
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand__logo"><Icon name="logo" :size="22" /></span>
        <div class="brand__text">
          <span class="brand__name">{{ $t('app.name') }}</span>
          <span class="brand__tag">{{ $t('app.tagline') }}</span>
        </div>
      </div>
      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="`/${item.name}`"
          class="nav__item"
          active-class="nav__item--active"
        >
          <Icon :name="item.icon" :size="17" />
          <span>{{ $t(`nav.${item.name}`) }}</span>
        </RouterLink>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <h1 class="topbar__title">{{ $t(`nav.${route.name}`) }}</h1>
        <div class="topbar__right">
          <span class="pill" :class="napcatPill">
            <span class="pill__dot" />
            NapCat · {{ $t(`status.${napcatStatus}`) }}
          </span>
          <button class="btn btn--ghost topbar__icon" @click="ui.toggleTheme()">
            <Icon :name="ui.theme === 'dark' ? 'sun' : 'moon'" :size="18" />
          </button>
        </div>
      </header>

      <main class="content">
        <RouterView v-slot="{ Component, route: r }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="r.name" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <div class="toast-wrap">
      <TransitionGroup name="toast">
        <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="`toast--${t.type}`">
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>

    <Transition name="overlay">
      <div v-if="ui.dialog.open" class="modal-mask" @click.self="ui.resolveDialog(false)">
        <Transition name="pop" appear>
          <div class="modal" role="dialog" aria-modal="true">
            <h3 v-if="ui.dialog.title" class="modal__title">{{ ui.dialog.title }}</h3>
            <p class="modal__msg">{{ ui.dialog.message }}</p>
            <div class="modal__actions">
              <button class="btn" @click="ui.resolveDialog(false)">{{ $t('common.cancel') }}</button>
              <button
                class="btn"
                :class="ui.dialog.danger ? 'btn--danger' : 'btn--primary'"
                @click="ui.resolveDialog(true)"
              >{{ $t('common.confirm') }}</button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100%; }

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
}

.brand { display: flex; align-items: center; gap: 11px; padding: 6px 10px 20px; }
.brand__logo { color: var(--glow-blue); display: flex; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--glow-blue) 60%, transparent)); }
.brand__text { display: flex; flex-direction: column; line-height: 1.25; }
.brand__name { font-size: 17px; font-weight: 700; letter-spacing: 0.5px; }
.brand__tag { font-size: 11px; color: var(--text-faint); }

.nav { display: flex; flex-direction: column; gap: 2px; }
.nav__item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 12px; border-radius: var(--radius-sm);
  color: var(--text-dim); font-size: 13.5px; font-weight: 500;
  transition: all var(--transition);
}
.nav__item:hover { background: var(--bg-hover); color: var(--text); }
.nav__item--active {
  background: color-mix(in srgb, var(--glow-blue) 14%, transparent);
  color: var(--glow-blue);
  box-shadow: inset 3px 0 0 var(--glow-blue), inset 6px 0 12px -6px var(--glow-blue);
}

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.topbar {
  height: var(--topbar-h);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  background: color-mix(in srgb, var(--bg-elev) 60%, transparent);
  backdrop-filter: blur(8px);
}
.topbar__title { margin: 0; font-size: 17px; font-weight: 600; }
.topbar__right { display: flex; align-items: center; gap: 14px; }
.topbar__icon { padding: 8px; }

.content { flex: 1; overflow-y: auto; padding: 24px; }

/* Modal */
.modal-mask {
  position: fixed; inset: 0; z-index: 1500;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.modal {
  width: 100%; max-width: 400px;
  background: var(--bg-elev); border: 1px solid var(--border-strong);
  border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 24px;
}
.modal__title { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
.modal__msg { margin: 0 0 22px; color: var(--text-dim); font-size: 13.5px; line-height: 1.6; }
.modal__actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
