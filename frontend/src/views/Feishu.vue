<script setup>
import { ref, onMounted, reactive } from 'vue';
import { useConfigStore } from '../store/config.js';
import { useUiStore } from '../store/ui.js';
import { api } from '../api/client.js';
import { useI18n } from 'vue-i18n';
import Icon from '../components/Icon.vue';

const cfg = useConfigStore();
const ui = useUiStore();
const { t } = useI18n();

const form = reactive({ webhookUrl: '', secret: '' });
const testText = ref('Renecon 飞书连通性测试消息。');
const testing = ref(false);

async function save() {
  try {
    await cfg.saveSection('feishu', { ...form });
    ui.notify(t('toast.saveOk'), 'ok');
  } catch (e) {
    ui.notify(t('toast.saveErr', { msg: e.message }), 'err');
  }
}

async function test() {
  testing.value = true;
  try {
    await save();
    await api.testFeishu(testText.value);
    ui.notify(t('toast.testOk'), 'ok');
  } catch (e) {
    ui.notify(t('toast.testErr', { msg: e.message }), 'err');
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  if (!cfg.loaded) await cfg.load();
  Object.assign(form, cfg.config.feishu);
});
</script>

<template>
  <div class="card">
    <h3 class="card__title">{{ $t('feishu.title') }}</h3>
    <p class="card__desc">{{ $t('feishu.desc') }}</p>

    <div class="field">
      <label class="field__label">{{ $t('feishu.webhookUrl') }}</label>
      <input v-model="form.webhookUrl" class="input" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
    </div>
    <div class="field">
      <label class="field__label">{{ $t('feishu.secret') }}</label>
      <input v-model="form.secret" type="password" class="input" />
    </div>
    <div class="field">
      <label class="field__label">{{ $t('feishu.testText') }}</label>
      <input v-model="testText" class="input" />
    </div>

    <div class="actions">
      <button class="btn" :disabled="testing" @click="test">
        <Icon name="send" :size="15" /> {{ $t('common.test') }}
      </button>
      <button class="btn btn--primary" @click="save">
        <Icon name="check" :size="16" /> {{ $t('common.save') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.actions { margin-top: 8px; display: flex; justify-content: flex-end; gap: 10px; }
</style>
