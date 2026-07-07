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

const form = reactive({
  enabled: false,
  intervalMinutes: 15,
  mode: 'structured',
  maxRetries: 3,
  cardTitle: '',
  prompt: '',
  schema: [],
  dedup: { enabled: false, keepTopics: 5 },
  rollingContext: { enabled: false, runs: 4 },
});
const runMinutes = ref(15);
const running = ref(false);

function addField() {
  form.schema.push({ key: '', label: '', type: 'string', required: false, enum: [] });
}
function removeField(i) {
  form.schema.splice(i, 1);
}
function enumStr(f) {
  return (f.enum || []).join(', ');
}
function setEnum(f, val) {
  f.enum = val.split(',').map((s) => s.trim()).filter(Boolean);
}

async function save() {
  try {
    await cfg.saveSection('pipeline', { ...form });
    ui.notify(t('toast.saveOk'), 'ok');
  } catch (e) {
    ui.notify(t('toast.saveErr', { msg: e.message }), 'err');
  }
}

async function runNow() {
  running.value = true;
  try {
    await save();
    const r = await api.runPipeline(runMinutes.value);
    ui.notify(t('toast.runOk', { status: r.status }), r.status === 'error' ? 'err' : 'ok');
  } catch (e) {
    ui.notify(t('toast.runErr', { msg: e.message }), 'err');
  } finally {
    running.value = false;
  }
}

onMounted(async () => {
  if (!cfg.loaded) await cfg.load();
  Object.assign(form, JSON.parse(JSON.stringify(cfg.config.pipeline)));
  if (!Array.isArray(form.schema)) form.schema = [];
  if (!form.dedup) form.dedup = { enabled: false, keepTopics: 5 };
  if (!form.rollingContext) form.rollingContext = { enabled: false, runs: 4 };
  runMinutes.value = form.intervalMinutes;
});
</script>

<template>
  <div class="card">
    <h3 class="card__title">{{ $t('pipeline.title') }}</h3>
    <p class="card__desc">{{ $t('pipeline.desc') }}</p>

    <div class="field toggle-field">
      <div>
        <label class="field__label" style="margin: 0">{{ $t('pipeline.enabled') }}</label>
      </div>
      <label class="switch">
        <input type="checkbox" v-model="form.enabled" />
        <span class="switch__track" />
      </label>
    </div>

    <div class="row">
      <div class="field" style="flex: 1">
        <label class="field__label">{{ $t('pipeline.interval') }}</label>
        <input v-model.number="form.intervalMinutes" type="number" min="1" class="input" />
      </div>
      <div class="field" style="flex: 1">
        <label class="field__label">{{ $t('pipeline.mode') }}</label>
        <select v-model="form.mode" class="select">
          <option value="structured">{{ $t('pipeline.modeStructured') }}</option>
          <option value="compact">{{ $t('pipeline.modeCompact') }}</option>
          <option value="markdown">{{ $t('pipeline.modeMarkdown') }}</option>
        </select>
      </div>
      <div class="field" style="flex: 1">
        <label class="field__label">{{ $t('pipeline.maxRetries') }}</label>
        <input v-model.number="form.maxRetries" type="number" min="0" max="10" class="input" />
      </div>
    </div>

    <div class="field">
      <label class="field__label">{{ $t('pipeline.cardTitle') }}</label>
      <input v-model="form.cardTitle" class="input" placeholder="产品反馈汇总（{count} 条）" />
      <p class="hint">{{ $t('pipeline.cardTitleDesc') }}</p>
    </div>

    <div class="field">
      <label class="field__label">{{ $t('pipeline.prompt') }}</label>
      <textarea v-model="form.prompt" class="textarea" rows="6" />
    </div>

    <div v-if="form.mode !== 'markdown'" class="schema">
      <div class="schema__head">
        <div>
          <span class="schema__title">{{ $t('pipeline.schema') }}</span>
          <p class="schema__desc">{{ $t('pipeline.schemaDesc') }}</p>
        </div>
        <button class="btn" @click="addField"><Icon name="plus" :size="14" /> {{ $t('pipeline.addField') }}</button>
      </div>

      <table class="table schema__table" v-if="form.schema.length">
        <thead>
          <tr>
            <th style="width: 150px">{{ $t('pipeline.fieldKey') }}</th>
            <th style="width: 150px">{{ $t('pipeline.fieldLabel') }}</th>
            <th style="width: 110px">{{ $t('pipeline.fieldType') }}</th>
            <th>{{ $t('pipeline.fieldEnum') }}</th>
            <th style="width: 70px">{{ $t('pipeline.fieldRequired') }}</th>
            <th style="width: 50px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(f, i) in form.schema" :key="i">
            <td><input v-model="f.key" class="input input--sm" placeholder="product" /></td>
            <td><input v-model="f.label" class="input input--sm" placeholder="相关产品名" /></td>
            <td>
              <select v-model="f.type" class="select input--sm">
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="enum">enum</option>
              </select>
            </td>
            <td>
              <input
                v-if="f.type === 'enum'"
                :value="enumStr(f)"
                @input="setEnum(f, $event.target.value)"
                class="input input--sm"
                placeholder="bug, feedback, other"
              />
              <span v-else class="dim">—</span>
            </td>
            <td style="text-align: center">
              <label class="switch switch--sm">
                <input type="checkbox" v-model="f.required" />
                <span class="switch__track" />
              </label>
            </td>
            <td>
              <button class="btn btn--ghost btn--danger" style="padding: 4px 6px" @click="removeField(i)">
                <Icon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="dim" style="font-size: 13px">{{ $t('common.empty') }}</p>
    </div>

    <div v-if="form.mode !== 'markdown'" class="schema" style="margin-top: 14px">
      <div class="schema__head" style="margin-bottom: 0">
        <div>
          <span class="schema__title">{{ $t('pipeline.dedup') }}</span>
          <p class="schema__desc">{{ $t('pipeline.dedupDesc') }}</p>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="form.dedup.enabled" />
          <span class="switch__track" />
        </label>
      </div>
      <div v-if="form.dedup.enabled" class="field" style="max-width: 220px; margin-top: 14px">
        <label class="field__label">{{ $t('pipeline.keepTopics') }}</label>
        <input v-model.number="form.dedup.keepTopics" type="number" min="1" max="50" class="input" />
      </div>
    </div>

    <div class="schema" style="margin-top: 14px">
      <div class="schema__head" style="margin-bottom: 0">
        <div>
          <span class="schema__title">{{ $t('pipeline.rollingContext') }}</span>
          <p class="schema__desc">{{ $t('pipeline.rollingContextDesc') }}</p>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="form.rollingContext.enabled" />
          <span class="switch__track" />
        </label>
      </div>
      <div v-if="form.rollingContext.enabled" class="field" style="max-width: 220px; margin-top: 14px">
        <label class="field__label">{{ $t('pipeline.rollingRuns') }}</label>
        <input v-model.number="form.rollingContext.runs" type="number" min="1" max="20" class="input" />
      </div>
    </div>

    <div class="actions">
      <div class="run-inline">
        <label class="field__label" style="margin: 0">{{ $t('pipeline.runMinutes') }}</label>
        <input v-model.number="runMinutes" type="number" min="1" class="input" style="width: 90px" />
        <button class="btn" :disabled="running" @click="runNow">
          <Icon name="play" :size="15" /> {{ $t('common.runNow') }}
        </button>
      </div>
      <button class="btn btn--primary" @click="save">
        <Icon name="check" :size="16" /> {{ $t('common.save') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; gap: 14px; }
.toggle-field { display: flex; align-items: center; justify-content: space-between; }
.actions { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.run-inline { display: flex; align-items: center; gap: 10px; }
.schema {
  margin-top: 4px; padding: 16px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.schema__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.schema__title { font-size: 13.5px; font-weight: 600; }
.schema__desc { margin: 4px 0 0; font-size: 12px; color: var(--text-dim); }
.schema__table td { padding: 6px 8px; }
.input--sm { padding: 6px 9px; font-size: 12.5px; }
.switch--sm { width: 36px; height: 20px; }
.switch--sm .switch__track::before { height: 14px; width: 14px; }
.switch--sm input:checked + .switch__track::before { transform: translateX(16px); }
.dim { color: var(--text-faint); }
.hint { margin: 6px 0 0; font-size: 11.5px; color: var(--text-faint); }
</style>
