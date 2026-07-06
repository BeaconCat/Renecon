/**
 * LLM orchestration.
 *
 * Exposes:
 *   - chat(): low-level provider-agnostic call (used by the connectivity test).
 *   - runStructured(): feedback extraction that FORCES a validated JSON shape,
 *     retrying with the validation error fed back to the model.
 *   - runMarkdown(): free-form markdown digest.
 */

import { z } from 'zod';
import { openaiChat, openaiModels } from './openai.js';
import { claudeChat, claudeModels } from './claude.js';
import { mimoChat, mimoModels } from './mimo.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('llm');

/** Fallback field set when no schema is configured. */
const DEFAULT_FIELDS = [
  { key: 'product', label: '相关产品名', type: 'string', required: true, enum: [] },
  { key: 'category', label: '分类', type: 'enum', required: true, enum: ['bug', 'feedback', 'suggestion', 'question', 'other'] },
  { key: 'summary', label: '一句话概括', type: 'string', required: true, enum: [] },
  { key: 'quote', label: '原始消息摘录', type: 'string', required: true, enum: [] },
  { key: 'sender', label: '发言人', type: 'string', required: false, enum: [] },
  { key: 'severity', label: '严重度', type: 'enum', required: false, enum: ['low', 'medium', 'high'] },
];

/** Build a zod validator for one item + the items[] wrapper from field defs. */
function buildResultSchema(fields) {
  const shape = {};
  for (const f of fields) {
    let v;
    if (f.type === 'enum' && Array.isArray(f.enum) && f.enum.length) {
      v = z.enum(f.enum);
    } else if (f.type === 'number') {
      v = z.number();
    } else {
      v = z.string();
    }
    shape[f.key] = f.required ? v : v.optional();
  }
  return z.object({ items: z.array(z.object(shape)) });
}

/** Render a human-readable JSON shape hint from field defs. */
function buildShapeText(fields) {
  const lines = fields.map((f) => {
    const type = f.type === 'enum' && f.enum?.length
      ? f.enum.join(' | ')
      : (f.type === 'number' ? 'number' : 'string');
    const notes = [f.label, f.required ? null : '可选'].filter(Boolean).join(', ');
    return `      "${f.key}": "${type}${notes ? `  // ${notes}` : ''}"`;
  });
  return `{\n  "items": [\n    {\n${lines.join(',\n')}\n    }\n  ]\n}`;
}

/** Dispatch to the configured provider. */
export async function chat(llmCfg, { system, user, images }) {
  const req = { system, user, temperature: llmCfg.temperature, images };
  if (llmCfg.provider === 'claude') return claudeChat(llmCfg.claude, req);
  if (llmCfg.provider === 'mimo') return mimoChat(llmCfg.mimo, req);
  return openaiChat(llmCfg.openai, req);
}

/** List models for the configured provider. */
export async function listModels(llmCfg) {
  if (llmCfg.provider === 'claude') return claudeModels(llmCfg.claude);
  if (llmCfg.provider === 'mimo') return mimoModels(llmCfg.mimo);
  return openaiModels(llmCfg.openai);
}

/** Strip ```json fences and grab the outermost JSON object. */
function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in response');
  return t.slice(start, end + 1);
}

/**
 * Extract structured feedback items, validating against FeedbackResult and
 * retrying up to maxRetries. On each retry the parse/validation error is fed
 * back so the model can self-correct.
 *
 * @returns {Promise<{items: Array}>}
 */
export async function runStructured(llmCfg, { prompt, transcript, maxRetries = 3, images, fields, extraFields }) {
  const base = Array.isArray(fields) && fields.length ? fields : DEFAULT_FIELDS;
  const activeFields = Array.isArray(extraFields) && extraFields.length
    ? [...base, ...extraFields]
    : base;
  const resultSchema = buildResultSchema(activeFields);
  const shapeText = buildShapeText(activeFields);

  const system = '你是严谨的数据抽取引擎。只输出符合要求的 JSON，不要输出任何解释性文字或 markdown 说明。';
  const baseUser = [
    prompt,
    '',
    '请严格按以下 JSON 结构输出（不要包裹 markdown 代码块，不要额外文字）：',
    shapeText,
    '',
    '如果没有任何相关条目，返回 {"items": []}。',
    '',
    '=== 群聊消息 ===',
    transcript,
  ].join('\n');

  let lastError = null;
  let user = baseUser;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const raw = await chat(llmCfg, { system, user, images });
    try {
      const parsed = JSON.parse(extractJson(raw));
      const validated = resultSchema.parse(parsed);
      log.info(`Structured extraction ok (attempt ${attempt}), ${validated.items.length} items.`);
      return validated;
    } catch (err) {
      lastError = err;
      log.warn(`Attempt ${attempt} failed validation: ${err.message}`);
      // Feed the error back for self-correction on the next attempt.
      user = [
        baseUser,
        '',
        `你上一次的输出无法通过校验，错误：${err.message}`,
        '请重新输出，务必是合法且符合结构的 JSON。',
      ].join('\n');
    }
  }
  throw new Error(`Structured extraction failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Free-form markdown digest.
 * @returns {Promise<string>} markdown
 */
export async function runMarkdown(llmCfg, { prompt, transcript, images }) {
  const system = '你是产品社区运营助手，擅长把群聊内容整理成简洁的 Markdown 汇总报告。';
  const user = [
    prompt,
    '',
    '请输出一份结构清晰的 Markdown 汇总（含标题、分类、要点列表）。',
    images && images.length ? '附带的图片为群内截图，请结合图片内容一并分析。' : '',
    '',
    '=== 群聊消息 ===',
    transcript,
  ].join('\n');
  return chat(llmCfg, { system, user, images });
}
