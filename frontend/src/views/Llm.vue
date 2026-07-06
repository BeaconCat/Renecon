<script setup>
import { ref, onMounted, reactive, watch } from 'vue';
import { useConfigStore } from '../store/config.js';
import { useUiStore } from '../store/ui.js';
import { api } from '../api/client.js';
import { useI18n } from 'vue-i18n';
import Icon from '../components/Icon.vue';

const cfg = useConfigStore();
const ui = useUiStore();
const { t } = useI18n();

const form = reactive({
  provider: 'openai',
  temperature: 0.2,
  openai: { baseUrl: '', apiKey: '', model: '' },
  claude: { baseUrl: '', apiKey: '', model: '' },
  mimo: { baseUrl: '', apiKey: '', model: '', thinking: true },
  vision: { enabled: false, maxImages: 6 },
});
const testing = ref(false);
const testReply = ref('');
const models = ref([]);       // fetched model ids for the active provider
const fetchingModels = ref(false);

function load() {
  const l = cfg.config.llm;
  form.provider = l.provider;
  form.temperature = l.temperature;
  form.openai = { ...l.openai };
  form.claude = { ...l.claude };
  form.mimo = { ...(l.mimo || { baseUrl: '', apiKey: '', model: '', thinking: true }) };
  form.vision = { ...(l.vision || { enabled: false, maxImages: 6 }) };
}

// Model list is provider-specific; drop it when the provider changes.
watch(() => form.provider, () => { models.value = []; });

async function save() {
  try {
    await cfg.saveSection('llm', JSON.parse(JSON.stringify(form)));
    ui.notify(t('toast.saveOk'), 'ok');
  } catch (e) {
    ui.notify(t('toast.saveErr', { msg: e.message }), 'err');
  }
}

async function fetchModels() {
  fetchingModels.value = true;
  try {
    await save(); // persist creds so the backend can query with them
    const r = await api.getLlmModels();
    models.value = r.models || [];
    ui.notify(t('toast.modelsOk', { n: models.value.length }), 'ok');
  } catch (e) {
    ui.notify(t('toast.modelsErr', { msg: e.message }), 'err');
  } finally {
    fetchingModels.value = false;
  }
}

async function test() {
  testing.value = true;
  testReply.value = '';
  try {
    await save();
    const r = await api.testLlm();
    testReply.value = r.reply;
    ui.notify(t('toast.testOk'), 'ok');
  } catch (e) {
    ui.notify(t('toast.testErr', { msg: e.message }), 'err');
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  if (!cfg.loaded) await cfg.load();
  load();
});
</script>

<template>
  <div class="card">
    <h3 class="card__title">{{ $t('llm.title') }}</h3>
    <p class="card__desc">{{ $t('llm.desc') }}</p>

    <div class="row">
      <div class="field" style="flex: 1">
        <label class="field__label">{{ $t('llm.provider') }}</label>
        <select v-model="form.provider" class="select">
          <option value="openai">OpenAI 兼容</option>
          <option value="claude">Anthropic Claude</option>
          <option value="mimo">小米 MiMo</option>
        </select>
      </div>
      <div class="field" style="width: 160px">
        <label class="field__label">{{ $t('llm.temperature') }}</label>
        <input v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" class="input" />
      </div>
    </div>

    <!-- Shared datalist populated by the model fetcher. -->
    <datalist id="model-options">
      <option v-for="m in models" :key="m" :value="m" />
    </datalist>

    <fieldset v-if="form.provider === 'openai'" class="provider">
      <legend>OpenAI 兼容</legend>
      <div class="field">
        <label class="field__label">{{ $t('llm.baseUrl') }}</label>
        <input v-model="form.openai.baseUrl" class="input" placeholder="https://api.openai.com/v1" />
      </div>
      <div class="row">
        <div class="field" style="flex: 2">
          <label class="field__label">{{ $t('llm.apiKey') }}</label>
          <input v-model="form.openai.apiKey" type="password" class="input" placeholder="sk-..." />
        </div>
        <div class="field" style="flex: 1">
          <label class="field__label">{{ $t('llm.model') }}</label>
          <div class="model-row">
            <input v-model="form.openai.model" list="model-options" class="input" placeholder="gpt-4o-mini" />
            <button class="btn" :disabled="fetchingModels" @click="fetchModels">
              <Icon name="refresh" :size="14" /> {{ $t('llm.fetchModels') }}
            </button>
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset v-else-if="form.provider === 'claude'" class="provider">
      <legend>Anthropic Claude</legend>
      <div class="field">
        <label class="field__label">{{ $t('llm.baseUrl') }}</label>
        <input v-model="form.claude.baseUrl" class="input" placeholder="https://api.anthropic.com" />
      </div>
      <div class="row">
        <div class="field" style="flex: 2">
          <label class="field__label">{{ $t('llm.apiKey') }}</label>
          <input v-model="form.claude.apiKey" type="password" class="input" placeholder="sk-ant-..." />
        </div>
        <div class="field" style="flex: 1">
          <label class="field__label">{{ $t('llm.model') }}</label>
          <div class="model-row">
            <input v-model="form.claude.model" list="model-options" class="input" placeholder="claude-sonnet-5" />
            <button class="btn" :disabled="fetchingModels" @click="fetchModels">
              <Icon name="refresh" :size="14" /> {{ $t('llm.fetchModels') }}
            </button>
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset v-else-if="form.provider === 'mimo'" class="provider">
      <legend>小米 MiMo</legend>
      <div class="field">
        <label class="field__label">{{ $t('llm.baseUrl') }}</label>
        <input v-model="form.mimo.baseUrl" class="input" placeholder="https://api.xiaomimimo.com/v1" />
      </div>
      <div class="row">
        <div class="field" style="flex: 2">
          <label class="field__label">{{ $t('llm.apiKey') }}</label>
          <input v-model="form.mimo.apiKey" type="password" class="input" />
        </div>
        <div class="field" style="flex: 1">
          <label class="field__label">{{ $t('llm.model') }}</label>
          <div class="model-row">
            <input v-model="form.mimo.model" list="model-options" class="input" placeholder="mimo-v2.5-pro" />
            <button class="btn" :disabled="fetchingModels" @click="fetchModels">
              <Icon name="refresh" :size="14" /> {{ $t('llm.fetchModels') }}
            </button>
          </div>
        </div>
      </div>
      <div class="think-field">
        <div>
          <span class="think-field__title">{{ $t('llm.thinking') }}</span>
          <p class="think-field__desc">{{ $t('llm.thinkingDesc') }}</p>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="form.mimo.thinking" />
          <span class="switch__track" />
        </label>
      </div>
    </fieldset>

    <div class="vision">
      <div class="vision__head">
        <div>
          <span class="vision__title">{{ $t('llm.vision') }}</span>
          <p class="vision__desc">{{ $t('llm.visionDesc') }}</p>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="form.vision.enabled" />
          <span class="switch__track" />
        </label>
      </div>
      <div v-if="form.vision.enabled" class="field" style="max-width: 200px; margin-top: 12px">
        <label class="field__label">{{ $t('llm.maxImages') }}</label>
        <input v-model.number="form.vision.maxImages" type="number" min="1" max="20" class="input" />
      </div>
    </div>

    <div v-if="testReply" class="reply">
      <span class="reply__label">{{ $t('llm.testReply') }}</span>
      <pre>{{ testReply }}</pre>
    </div>

    <div class="actions">
      <button class="btn" :disabled="testing" @click="test">
        <Icon name="link" :size="15" /> {{ $t('common.test') }}
      </button>
      <button class="btn btn--primary" @click="save">
        <Icon name="check" :size="16" /> {{ $t('common.save') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; gap: 14px; }
.model-row { display: flex; gap: 8px; }
.model-row .input { flex: 1; min-width: 0; }
.model-row .btn { flex-shrink: 0; }
.provider {
  border: 1px solid color-mix(in srgb, var(--glow-blue) 40%, var(--border));
  border-radius: var(--radius-sm);
  padding: 16px 16px 4px; margin: 8px 0 4px;
}
.provider legend { padding: 0 8px; font-size: 12px; color: var(--text-dim); font-weight: 600; }
.think-field {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
  padding: 12px 0 4px; margin-top: 4px; border-top: 1px solid var(--border);
}
.think-field__title { font-size: 13px; font-weight: 600; }
.think-field__desc { margin: 3px 0 0; font-size: 11.5px; color: var(--text-dim); }
.vision {
  margin-top: 12px; padding: 16px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.vision__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.vision__title { font-size: 13.5px; font-weight: 600; }
.vision__desc { margin: 4px 0 0; font-size: 12px; color: var(--text-dim); }
.reply { margin-top: 14px; }
.reply__label { font-size: 12px; color: var(--text-dim); }
.reply pre {
  margin: 6px 0 0; background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 12px; font-family: var(--mono);
  font-size: 12.5px; white-space: pre-wrap; word-break: break-word;
}
.actions { margin-top: 18px; display: flex; justify-content: flex-end; gap: 10px; }
</style>
