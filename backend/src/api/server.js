/**
 * REST API + static host for the WebGUI.
 *
 * All endpoints are namespaced under /api. In production the built frontend is
 * served from ../../frontend/dist so the whole app runs from one port.
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getConfig, updateSection, replaceConfig } from '../config/store.js';
import {
  queryMessages, countMessages, messageStatsByGroup, deleteMessages,
  queryDigests, countDigests,
} from '../db/index.js';
import { napcatClient } from '../napcat/client.js';
import { scheduler } from '../pipeline/scheduler.js';
import { chat, listModels } from '../llm/index.js';
import { sendText } from '../feishu/webhook.js';
import { getRecentLogs, createLogger } from '../util/logger.js';
import { MEDIA_DIR } from '../media/store.js';

const log = createLogger('api');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Wrap an async handler so rejections become 500s instead of crashes. */
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error(`${req.method} ${req.path} failed:`, err);
  res.status(500).json({ error: String(err.message || err) });
});

const EDITABLE_SECTIONS = new Set(['napcat', 'llm', 'feishu', 'pipeline', 'groups']);

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true }));

  // Aggregate status for the dashboard.
  api.get('/status', (req, res) => {
    res.json({
      napcat: napcatClient.getState(),
      scheduler: scheduler.getState(),
      messageCount: countMessages(),
      digestCount: countDigests(),
    });
  });

  /* ---------------------------------------------------------- config */
  api.get('/config', (req, res) => res.json(getConfig()));

  api.put('/config/:section', wrap(async (req, res) => {
    const { section } = req.params;
    if (!EDITABLE_SECTIONS.has(section)) {
      return res.status(400).json({ error: `Unknown section: ${section}` });
    }
    const updated = updateSection(section, req.body);
    res.json(updated[section]);
  }));

  api.put('/config', wrap(async (req, res) => {
    res.json(replaceConfig(req.body));
  }));

  /* ---------------------------------------------------------- groups */
  // Live group list pulled from NapCat so the operator can pick which to watch.
  api.get('/groups/live', wrap(async (req, res) => {
    const list = await napcatClient.callApi('get_group_list');
    const groups = (list || []).map((g) => ({
      id: String(g.group_id),
      name: g.group_name,
      memberCount: g.member_count,
    }));
    res.json(groups);
  }));

  /* -------------------------------------------------------- messages */
  api.get('/messages', (req, res) => {
    const filter = {
      groupId: req.query.groupId || undefined,
      keyword: req.query.keyword || undefined,
      sender: req.query.sender || undefined,
    };
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const offset = Number(req.query.offset) || 0;
    res.json({
      total: countMessages(filter),
      items: queryMessages({ ...filter, limit, offset }),
    });
  });

  api.get('/messages/stats', (req, res) => res.json(messageStatsByGroup()));

  // Bulk-delete messages by id.
  api.post('/messages/delete', wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const deleted = deleteMessages(ids);
    res.json({ deleted });
  }));

  /* --------------------------------------------------------- digests */
  api.get('/digests', (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;
    res.json({ total: countDigests(), items: queryDigests({ limit, offset }) });
  });

  /* -------------------------------------------------------- pipeline */
  api.post('/pipeline/run', wrap(async (req, res) => {
    const minutes = Number(req.body?.minutes) || undefined;
    const result = await scheduler.runNow(minutes);
    res.json(result);
  }));

  /* ------------------------------------------------------------ tests */
  api.get('/llm/models', wrap(async (req, res) => {
    const models = await listModels(getConfig().llm);
    res.json({ models });
  }));

  api.post('/test/llm', wrap(async (req, res) => {
    const cfg = getConfig().llm;
    const reply = await chat(cfg, {
      system: '你是一个连通性测试助手。',
      user: req.body?.prompt || '请回复“连接正常”。',
    });
    res.json({ ok: true, reply });
  }));

  api.post('/test/feishu', wrap(async (req, res) => {
    await sendText(getConfig().feishu, req.body?.text || 'Renecon 飞书连通性测试消息。');
    res.json({ ok: true });
  }));

  /* ------------------------------------------------------------ image */
  // Proxy an archived image URL so the WebGUI can display it without hitting
  // CORS or QQ's auth. Server-side fetch, streamed back with its content type.
  api.get('/image', wrap(async (req, res) => {
    const url = req.query.url;
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: 'invalid url' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const upstream = await fetch(url, { signal: controller.signal });
      if (!upstream.ok) return res.status(502).json({ error: `upstream ${upstream.status}` });
      const type = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('image/')) return res.status(415).json({ error: 'not an image' });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set('Content-Type', type);
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } finally {
      clearTimeout(timer);
    }
  }));

  /* ------------------------------------------------------------- logs */
  api.get('/logs', (req, res) => {
    const limit = Math.min(500, Number(req.query.limit) || 200);
    res.json(getRecentLogs(limit));
  });

  // Locally-stored archived images. express.static resolves within MEDIA_DIR
  // and rejects path traversal.
  app.use('/api/media', express.static(MEDIA_DIR, { maxAge: '7d' }));

  app.use('/api', api);

  // Serve the built frontend if present (single-port production mode).
  const distDir = path.resolve(__dirname, '../../../frontend/dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  return app;
}
