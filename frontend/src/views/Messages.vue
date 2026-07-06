<script setup>
import { ref, onMounted, computed } from 'vue';
import { useConfigStore } from '../store/config.js';
import { useUiStore } from '../store/ui.js';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client.js';
import Icon from '../components/Icon.vue';

const cfg = useConfigStore();
const ui = useUiStore();
const { t } = useI18n();
const items = ref([]);
const total = ref(0);
const selected = ref(new Set());
const groupId = ref('');
const keyword = ref('');
const sender = ref('');
const offset = ref(0);
const limit = 50;
let debounce = null;

const groups = computed(() => cfg.config?.groups || []);
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)));
const page = computed(() => Math.floor(offset.value / limit) + 1);

async function load() {
  const params = { limit, offset: offset.value };
  if (groupId.value) params.groupId = groupId.value;
  if (keyword.value.trim()) params.keyword = keyword.value.trim();
  if (sender.value.trim()) params.sender = sender.value.trim();
  const r = await api.getMessages(params);
  items.value = r.items;
  total.value = r.total;
  selected.value = new Set(); // clear selection on any (re)load
}

const allChecked = computed(() => items.value.length > 0 && selected.value.size === items.value.length);

function toggle(id) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  selected.value = s;
}
function toggleAll() {
  selected.value = allChecked.value ? new Set() : new Set(items.value.map((m) => m.id));
}

async function removeIds(ids) {
  if (!ids.length) return;
  const ok = await ui.confirm({
    title: t('common.deleteTitle'),
    message: t('messages.confirmDelete', { n: ids.length }),
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await api.deleteMessages(ids);
    ui.notify(t('messages.deleted', { n: r.deleted }), 'ok');
    // If the current page emptied out, step back a page.
    if (offset.value > 0 && r.deleted >= items.value.length) offset.value -= limit;
    await load();
  } catch (e) {
    ui.notify(t('toast.saveErr', { msg: e.message }), 'err');
  }
}
function removeOne(id) { removeIds([id]); }
function removeSelected() { removeIds([...selected.value]); }

function reload() { offset.value = 0; load(); }
function changeGroup() { reload(); }
// Debounced reload while typing in the search boxes.
function onSearch() {
  clearTimeout(debounce);
  debounce = setTimeout(reload, 350);
}
function resetFilters() {
  groupId.value = ''; keyword.value = ''; sender.value = '';
  reload();
}
function prev() { if (offset.value > 0) { offset.value -= limit; load(); } }
function next() { if (offset.value + limit < total.value) { offset.value += limit; load(); } }

function fmt(ts) { return new Date(ts * 1000).toLocaleString(); }
function imgs(m) {
  if (!m.images) return [];
  try { return JSON.parse(m.images); } catch { return []; }
}
// Prefer the locally-stored copy; fall back to proxying the original URL.
function src(it) {
  if (typeof it === 'string') return api.imageUrl(it);
  if (it.file) return `/api/media/${it.file}`;
  return it.url ? api.imageUrl(it.url) : '';
}

const lightbox = ref('');
function open(url) { lightbox.value = url; }
function close() { lightbox.value = ''; }

onMounted(async () => {
  if (!cfg.loaded) await cfg.load();
  load();
});
</script>

<template>
  <div class="card">
    <div class="head">
      <div>
        <h3 class="card__title">{{ $t('messages.title') }}</h3>
        <p class="card__desc" style="margin: 0">{{ $t('messages.desc') }}</p>
      </div>
      <div class="head__actions">
        <input v-model="keyword" class="input" style="width: 180px" :placeholder="$t('messages.keyword')" @input="onSearch" />
        <input v-model="sender" class="input" style="width: 130px" :placeholder="$t('messages.sender')" @input="onSearch" />
        <select v-model="groupId" class="select" style="width: 160px" @change="changeGroup">
          <option value="">{{ $t('messages.all') }}</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name || g.id }}</option>
        </select>
        <button
          v-if="selected.size"
          class="btn btn--danger"
          @click="removeSelected"
        >
          <Icon name="trash" :size="15" /> {{ $t('messages.deleteSelected', { n: selected.size }) }}
        </button>
        <button class="btn btn--ghost" :title="$t('messages.reset')" @click="resetFilters"><Icon name="close" :size="16" /></button>
        <button class="btn btn--ghost" @click="load"><Icon name="refresh" :size="16" /></button>
      </div>
    </div>

    <table class="table" v-if="items.length">
      <thead>
        <tr>
          <th style="width: 36px">
            <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          </th>
          <th style="width: 160px">{{ $t('messages.time') }}</th>
          <th style="width: 140px">{{ $t('messages.group') }}</th>
          <th style="width: 140px">{{ $t('messages.sender') }}</th>
          <th>{{ $t('messages.content') }}</th>
          <th style="width: 50px"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in items" :key="m.id" :class="{ 'row--sel': selected.has(m.id) }">
          <td>
            <input type="checkbox" :checked="selected.has(m.id)" @change="toggle(m.id)" />
          </td>
          <td class="dim">{{ fmt(m.msg_time) }}</td>
          <td>{{ m.group_name || m.group_id }}</td>
          <td>{{ m.sender_name || m.sender_id }}</td>
          <td>
            <span v-if="m.content">{{ m.content }}</span>
            <div v-if="imgs(m).length" class="thumbs">
              <img
                v-for="(it, k) in imgs(m)"
                :key="k"
                :src="src(it)"
                class="thumb"
                loading="lazy"
                alt="图片"
                @click="open(src(it))"
              />
            </div>
          </td>
          <td>
            <button class="btn btn--ghost btn--danger" style="padding: 4px 6px" :title="$t('common.remove')" @click="removeOne(m.id)">
              <Icon name="trash" :size="14" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint">{{ $t('common.empty') }}</p>

    <div class="pager" v-if="total > limit">
      <span class="dim">{{ $t('common.total', { n: total }) }}</span>
      <div class="pager__ctrl">
        <button class="btn" :disabled="page <= 1" @click="prev">‹</button>
        <span>{{ page }} / {{ pages }}</span>
        <button class="btn" :disabled="page >= pages" @click="next">›</button>
      </div>
    </div>

    <div v-if="lightbox" class="lightbox" @click="close">
      <img :src="lightbox" class="lightbox__img" alt="图片" />
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.head__actions { display: flex; gap: 10px; flex-wrap: wrap; }
.dim { color: var(--text-dim); }
.hint { color: var(--text-faint); }
.row--sel td { background: color-mix(in srgb, var(--glow-blue) 10%, transparent) !important; }
.thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.thumb {
  width: 60px; height: 60px; object-fit: cover;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  cursor: pointer; background: var(--bg); transition: border-color var(--transition);
}
.thumb:hover { border-color: var(--glow-blue); }
.lightbox {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center;
  padding: 40px; cursor: zoom-out;
}
.lightbox__img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: var(--radius); }
.pager { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
.pager__ctrl { display: flex; align-items: center; gap: 12px; }
</style>
