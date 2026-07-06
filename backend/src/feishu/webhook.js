/**
 * Feishu (Lark) custom-bot webhook client.
 *
 * Supports optional signed requests (when a secret is configured) and two
 * payload shapes: plain text and an interactive markdown card.
 */

import crypto from 'node:crypto';
import { createLogger } from '../util/logger.js';

const log = createLogger('feishu');

/**
 * Feishu signature: HMAC-SHA256 where the KEY is `${timestamp}\n${secret}`
 * signing an empty string, base64 encoded.
 */
function sign(timestamp, secret) {
  const key = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', key).update('').digest('base64');
}

const HR_LINE = '━━━━━━━━━━';

/** Parse a "| a | b |" row into trimmed cells. */
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

/**
 * Rewrite markdown to what Feishu's `markdown` element actually renders.
 * Feishu supports bold/italic/strike/list/ordered-list/code/link/image, but
 * NOT headings (#), blockquotes (>), horizontal rules (---), or GFM tables.
 * Unsupported constructs are converted to supported equivalents.
 */
export function toFeishuMarkdown(md) {
  const lines = String(md || '').split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // GFM table: header row + separator row + data rows -> per-row list block.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headers = tableCells(line);
      i += 2; // skip header + separator
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = tableCells(lines[i]);
        // First column as the bold title, the rest as "header: value" lines.
        out.push(`**${cells[0] || ''}**`);
        for (let c = 1; c < headers.length; c++) {
          if (cells[c]) out.push(`- ${headers[c]}: ${cells[c]}`);
        }
        out.push('');
        i++;
      }
      i--; // step back; outer loop will advance
      continue;
    }

    // Horizontal rule -> visible separator line.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push(HR_LINE); continue; }
    // Heading -> bold.
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) { out.push(`**${h[1].trim()}**`); continue; }
    // Blockquote -> strip the marker.
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { out.push(q[1]); continue; }

    out.push(line);
  }

  return out.join('\n');
}

async function post(webhookUrl, secret, body) {
  if (!webhookUrl) throw new Error('Feishu webhookUrl not configured');
  const payload = { ...body };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = sign(timestamp, secret);
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  // Feishu returns { code: 0 } on success (or StatusCode 0 on legacy bots).
  if (data.code && data.code !== 0) {
    throw new Error(`Feishu error ${data.code}: ${data.msg || 'unknown'}`);
  }
  if (data.StatusCode && data.StatusCode !== 0) {
    throw new Error(`Feishu error: ${data.StatusMessage || 'unknown'}`);
  }
  log.info('Pushed to Feishu.');
  return data;
}

export function sendText(cfg, text) {
  return post(cfg.webhookUrl, cfg.secret, {
    msg_type: 'text',
    content: { text },
  });
}

/**
 * Send a markdown body as an interactive card.
 *
 * Uses the `markdown` component element (not `div` + `lark_md`), which renders
 * the full markdown spec — headings, lists, blockquotes, code blocks, tables,
 * links, images. `lark_md` only supports a tiny inline subset (bold/italic/
 * link/at) and shows headings/quotes/code as literal text.
 *
 * @param {object} cfg { webhookUrl, secret }
 * @param {string} title
 * @param {string} markdown
 */
export function sendMarkdownCard(cfg, title, markdown) {
  return post(cfg.webhookUrl, cfg.secret, {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: toFeishuMarkdown(markdown) },
      ],
    },
  });
}
