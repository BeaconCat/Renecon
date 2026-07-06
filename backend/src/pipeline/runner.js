/**
 * Pipeline runner: turn a time window of archived messages into a digest and
 * push it to Feishu.
 *
 * Flow: gather window messages -> build transcript -> LLM (structured JSON or
 * markdown) -> format -> Feishu push -> persist a digest row.
 */

import crypto from 'node:crypto';
import {
  getMessagesInWindow, insertDigest,
  findTopic, upsertTopic, pruneTopics,
} from '../db/index.js';
import { runStructured, runMarkdown } from '../llm/index.js';
import { fetchImageAsBase64 } from '../llm/images.js';
import { readAsBase64 } from '../media/store.js';
import { sendMarkdownCard } from '../feishu/webhook.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('pipeline');

/** Render the configured card title, substituting {count}. */
function renderTitle(template, count) {
  return String(template || '汇总').replace(/\{count\}/g, count);
}

// Extra fields forced into the schema when topic de-dup is on. The LLM must
// attribute each item to its source group and give a stable topic key.
const DEDUP_EXTRA_FIELDS = [
  { key: 'group', label: '来源群名（从消息前缀 #群名 原样复制）', type: 'string', required: true, enum: [] },
  { key: 'topic', label: '话题稳定标识：对同一件事必须给相同的英文短横线 key，如 maixcam-install-runtime-fail', type: 'string', required: true, enum: [] },
];

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-龥-]/g, '')
    .slice(0, 60);
}

/** Stable signature of an item's user-schema field values (excludes group/topic). */
function itemSignature(item, fields) {
  const keys = (fields && fields.length ? fields : Object.keys(item))
    .map((f) => (typeof f === 'string' ? f : f.key))
    .filter((k) => k !== 'group' && k !== 'topic');
  const payload = keys.map((k) => `${k}=${item[k] ?? ''}`).join('|');
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

/** One-line compact alert: [product] [Severity] [Category] (群名|群号):summary */
function compactLine(item, displayGroup) {
  const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : v);
  const tag = (v) => (v ? `[${v}] ` : '');
  const head = `${tag(item.product)}${tag(cap(item.severity))}${tag(cap(item.category))}`.trim();
  const loc = displayGroup ? `(${displayGroup})` : '';
  const summary = item.summary || item.quote || '';
  return `${head} ${loc}:${summary}`.trim();
}

/** Resolve an item's group field to a { id, display } using configured groups. */
function resolveGroup(groupField, groups) {
  const raw = String(groupField || '').trim();
  const g = groups.find((x) => x.name === raw || String(x.id) === raw)
    || groups.find((x) => raw && (raw.includes(x.name) || (x.name && x.name.includes(raw))));
  if (g) return { id: String(g.id), display: `${g.name}|${g.id}` };
  return { id: raw || 'unknown', display: raw };
}

/** Render one archived row as a transcript line. */
function formatLine(m) {
  const t = new Date(m.msg_time * 1000);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const who = m.sender_name || m.sender_id || '匿名';
  const grp = m.group_name ? `#${m.group_name}` : `#${m.group_id}`;
  return `[${hh}:${mm}] ${grp} ${who}: ${m.content}`;
}

/**
 * Convert validated structured items into a Feishu-friendly markdown block,
 * generically from the configured field defs. First field is the bold title;
 * remaining present fields render as labelled lines.
 */
export function itemsToMarkdown(items, fields) {
  if (!items.length) return '本时段无相关条目。';
  const defs = Array.isArray(fields) && fields.length ? fields : null;
  const keys = defs ? defs.map((f) => f.key) : Object.keys(items[0] || {});
  const labelOf = (k) => (defs?.find((f) => f.key === k)?.label) || k;
  const [titleKey, ...restKeys] = keys;

  return items
    .map((it, i) => {
      const lines = [`**${i + 1}. ${it[titleKey] ?? ''}**`];
      for (const k of restKeys) {
        const v = it[k];
        if (v === undefined || v === null || v === '') continue;
        lines.push(`- ${labelOf(k)}: ${v}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Classify extracted items against stored per-group topics.
 *   - new topic      -> full rendering
 *   - existing topic, content changed -> one-line compact alert
 *   - existing topic, unchanged       -> silenced
 * Updates the topic store (bump/insert + prune to keepTopics).
 * @returns {{ fresh: Array, updated: Array, body: string }}
 */
export function applyDedup(items, cfg) {
  const keep = Math.max(1, Number(cfg.pipeline.dedup?.keepTopics) || 5);
  const now = Math.floor(Date.now() / 1000);
  const fresh = [];
  const updated = [];

  for (const it of items) {
    const { id: groupId, display } = resolveGroup(it.group, cfg.groups);
    const topicKey = slug(it.topic || it.summary || it.product || '');
    if (!topicKey) { fresh.push({ it, display }); continue; }
    const signature = itemSignature(it, cfg.pipeline.schema);
    const prev = findTopic(groupId, topicKey);

    if (!prev) {
      fresh.push({ it, display });
    } else if (prev.signature !== signature) {
      updated.push({ it, display });
    } // else: unchanged -> silent

    upsertTopic({ groupId, topicKey, signature, summary: it.summary || '', ts: now });
    pruneTopics(groupId, keep);
  }

  const parts = [];
  if (fresh.length) {
    parts.push(itemsToMarkdown(fresh.map((f) => f.it), cfg.pipeline.schema));
  }
  if (updated.length) {
    parts.push(`**话题更新（${updated.length}）**\n${updated.map((u) => compactLine(u.it, u.display)).join('\n')}`);
  }
  return { fresh, updated, body: parts.join('\n\n---\n\n') };
}

/**
 * Run the pipeline for a given window.
 * @param {object} cfg full config
 * @param {number} windowStart unix seconds inclusive
 * @param {number} windowEnd   unix seconds exclusive
 * @param {object} [opts] { push = true }
 * @returns {Promise<object>} digest summary
 */
export async function runPipeline(cfg, windowStart, windowEnd, opts = {}) {
  const push = opts.push !== false;
  const groupIds = cfg.groups.filter((g) => g.enabled !== false).map((g) => g.id);
  const messages = getMessagesInWindow(windowStart, windowEnd, groupIds);

  const window = { windowStart, windowEnd, mode: cfg.pipeline.mode, msgCount: messages.length };
  log.info(`Window ${new Date(windowStart * 1000).toISOString()} .. ${new Date(windowEnd * 1000).toISOString()}: ${messages.length} messages.`);

  if (!messages.length) {
    insertDigest({ ...window, status: 'empty', result: null, pushed: 0, error: null });
    return { ...window, status: 'empty' };
  }

  const transcript = messages.map(formatLine).join('\n');

  // Collect images for vision (capped) as base64: prefer the locally-stored
  // copy, fall back to fetching the original URL. Handles both the new
  // { file, url } records and legacy string-URL records.
  let images;
  if (cfg.llm.vision?.enabled) {
    const max = Math.max(1, Number(cfg.llm.vision.maxImages) || 6);
    const refs = [];
    for (const m of messages) {
      if (!m.images) continue;
      try {
        for (const it of JSON.parse(m.images)) {
          if (refs.length >= max) break;
          refs.push(typeof it === 'string' ? { file: null, url: it } : it);
        }
      } catch { /* ignore malformed */ }
      if (refs.length >= max) break;
    }
    if (refs.length) {
      const resolved = await Promise.all(refs.map(async (r) => {
        const local = readAsBase64(r.file);
        if (local) return local;
        return r.url ? fetchImageAsBase64(r.url) : null;
      }));
      images = resolved.filter(Boolean);
      log.info(`Vision: ${images.length}/${refs.length} image(s) resolved.`);
    }
  }

  try {
    let resultText;
    let cardBody;
    let title;

    if (cfg.pipeline.mode === 'structured') {
      const dedup = cfg.pipeline.dedup?.enabled;
      const { items } = await runStructured(cfg.llm, {
        prompt: cfg.pipeline.prompt,
        transcript,
        maxRetries: cfg.pipeline.maxRetries,
        images,
        fields: cfg.pipeline.schema,
        extraFields: dedup ? DEDUP_EXTRA_FIELDS : undefined,
      });
      resultText = JSON.stringify(items, null, 2);

      if (dedup) {
        const built = applyDedup(items, cfg);
        if (!built.fresh.length && !built.updated.length) {
          insertDigest({ ...window, status: 'empty', result: resultText, pushed: 0, error: null });
          return { ...window, status: 'empty', items };
        }
        cardBody = built.body;
        title = renderTitle(cfg.pipeline.cardTitle, built.fresh.length + built.updated.length);
      } else {
        cardBody = itemsToMarkdown(items, cfg.pipeline.schema);
        title = renderTitle(cfg.pipeline.cardTitle, items.length);
        if (!items.length) {
          insertDigest({ ...window, status: 'empty', result: resultText, pushed: 0, error: null });
          return { ...window, status: 'empty', items };
        }
      }
    } else {
      const md = await runMarkdown(cfg.llm, { prompt: cfg.pipeline.prompt, transcript, images });
      resultText = md;
      cardBody = md;
      title = renderTitle(cfg.pipeline.cardTitle, messages.length);
    }

    let pushed = 0;
    if (push && cfg.feishu.webhookUrl) {
      await sendMarkdownCard(cfg.feishu, title, cardBody);
      pushed = 1;
    }

    insertDigest({ ...window, status: 'success', result: resultText, pushed, error: null });
    return { ...window, status: 'success', result: resultText, pushed };
  } catch (err) {
    log.error('Pipeline run failed:', err);
    insertDigest({ ...window, status: 'error', result: null, pushed: 0, error: String(err.message || err) });
    return { ...window, status: 'error', error: String(err.message || err) };
  }
}
