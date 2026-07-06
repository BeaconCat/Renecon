<script setup>
import { useUiStore } from '../store/ui.js';
import { setLocale, i18n } from '../i18n/index.js';
import { ref } from 'vue';
import Icon from '../components/Icon.vue';

const ui = useUiStore();
const locale = ref(i18n.global.locale.value);

function onLocale() { setLocale(locale.value); }
</script>

<template>
  <div class="card" style="max-width: 520px">
    <h3 class="card__title">{{ $t('settings.title') }}</h3>

    <div class="field">
      <label class="field__label">{{ $t('settings.theme') }}</label>
      <div class="seg">
        <button class="seg__btn" :class="{ 'seg__btn--on': ui.theme === 'dark' }" @click="ui.setTheme('dark')">
          <Icon name="moon" :size="15" /> {{ $t('settings.dark') }}
        </button>
        <button class="seg__btn" :class="{ 'seg__btn--on': ui.theme === 'light' }" @click="ui.setTheme('light')">
          <Icon name="sun" :size="15" /> {{ $t('settings.light') }}
        </button>
      </div>
    </div>

    <div class="field">
      <label class="field__label">{{ $t('settings.language') }}</label>
      <select v-model="locale" class="select" @change="onLocale">
        <option value="zh-CN">简体中文</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.seg__btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; background: var(--bg-elev); border: none; color: var(--text-dim);
  cursor: pointer; font-family: inherit; font-size: 13px; transition: all var(--transition);
}
.seg__btn--on { background: color-mix(in srgb, var(--glow-blue) 16%, transparent); color: var(--glow-blue); }
</style>
