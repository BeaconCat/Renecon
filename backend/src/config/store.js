/**
 * Configuration store.
 *
 * The whole app is driven by a single JSON config file that the WebGUI edits.
 * We keep it in memory and persist atomically on every change. A tiny
 * subscriber list lets long-lived services (NapCat client, scheduler) react to
 * config changes without a restart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../util/logger.js';

const log = createLogger('config');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

/** Factory so callers never share a mutable default reference. */
function defaultConfig() {
  return {
    napcat: {
      url: 'ws://127.0.0.1:3001',
      accessToken: '',
    },
    // Groups the operator selected for monitoring. Only enabled group ids are
    // archived; everything else is dropped at ingest time.
    groups: [],
    llm: {
      provider: 'openai', // 'openai' | 'claude'
      temperature: 0.2,
      // Multimodal: when enabled, images in the window are sent to the (assumed
      // multimodal) model alongside the transcript.
      vision: {
        enabled: false,
        maxImages: 6,
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
      },
      claude: {
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        model: 'claude-sonnet-5',
      },
      mimo: {
        baseUrl: 'https://api.xiaomimimo.com/v1',
        apiKey: '',
        model: 'mimo-v2.5-pro',
        thinking: true, // deep-thinking chain of thought
      },
    },
    feishu: {
      webhookUrl: '',
      secret: '',
    },
    pipeline: {
      enabled: false,
      intervalMinutes: 15,
      mode: 'structured', // 'structured' | 'markdown'
      maxRetries: 3,
      // Feishu card title. {count} = item count (structured) / message count
      // (markdown).
      cardTitle: '产品反馈汇总（{count} 条）',
      // The task instruction fed to the LLM alongside the raw messages.
      prompt:
        '你是产品反馈分析助手。请从以下群聊消息中，找出所有关于 Sipeed 旗下产品'
        + '（如 NanoKVM、NanoKVM Go、LicheePi、Tang FPGA 等）的用户反馈、问题、'
        + '建议或 bug。忽略与产品无关的闲聊。',
      // Structured-mode output schema, editable from the WebGUI. Each field:
      //   { key, label, type: 'string'|'number'|'enum', required, enum: [] }
      schema: [
        { key: 'product', label: '相关产品名', type: 'string', required: true, enum: [] },
        { key: 'category', label: '分类', type: 'enum', required: true, enum: ['bug', 'feedback', 'suggestion', 'question', 'other'] },
        { key: 'summary', label: '一句话概括', type: 'string', required: true, enum: [] },
        { key: 'quote', label: '原始消息摘录', type: 'string', required: true, enum: [] },
        { key: 'sender', label: '发言人', type: 'string', required: false, enum: [] },
        { key: 'severity', label: '严重度', type: 'enum', required: false, enum: ['low', 'medium', 'high'] },
      ],
    },
  };
}

let config = defaultConfig();
const subscribers = new Set();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Shallow-merge persisted config over defaults so new fields get defaults. */
function mergeDefaults(loaded) {
  const base = defaultConfig();
  return {
    ...base,
    ...loaded,
    napcat: { ...base.napcat, ...loaded.napcat },
    llm: {
      ...base.llm,
      ...loaded.llm,
      openai: { ...base.llm.openai, ...(loaded.llm?.openai) },
      claude: { ...base.llm.claude, ...(loaded.llm?.claude) },
      mimo: { ...base.llm.mimo, ...(loaded.llm?.mimo) },
      vision: { ...base.llm.vision, ...(loaded.llm?.vision) },
    },
    feishu: { ...base.feishu, ...loaded.feishu },
    pipeline: { ...base.pipeline, ...loaded.pipeline },
    groups: Array.isArray(loaded.groups) ? loaded.groups : base.groups,
  };
}

export function loadConfig() {
  ensureDataDir();
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = mergeDefaults(JSON.parse(raw));
      log.info('Loaded config from disk.');
    } catch (err) {
      log.error('Failed to parse config, using defaults:', err);
      config = defaultConfig();
    }
  } else {
    log.info('No config found, writing defaults.');
    persist();
  }
  return config;
}

function persist() {
  ensureDataDir();
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

export function getConfig() {
  return config;
}

/**
 * Replace a top-level section (napcat/llm/feishu/pipeline/groups) and notify
 * subscribers. Returns the updated full config.
 * @param {string} section
 * @param {object} value
 */
export function updateSection(section, value) {
  if (!(section in config)) throw new Error(`Unknown config section: ${section}`);
  config = { ...config, [section]: value };
  persist();
  notify(section);
  return config;
}

/** Replace the entire config (used by import/restore). */
export function replaceConfig(next) {
  config = mergeDefaults(next);
  persist();
  notify('*');
  return config;
}

export function onConfigChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify(section) {
  for (const fn of subscribers) {
    try {
      fn(config, section);
    } catch (err) {
      log.error('Config subscriber threw:', err);
    }
  }
}

export { CONFIG_PATH, DATA_DIR };
