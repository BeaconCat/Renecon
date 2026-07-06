/**
 * NapCatQQ forward-WebSocket client (OneBot 11 protocol).
 *
 * Renecon connects OUT to NapCat's forward WS server. Two jobs:
 *   1. Receive group message events and archive the ones from monitored groups.
 *   2. Call OneBot actions (e.g. get_group_list) and await their echo reply so
 *      the WebGUI can list groups to pick from.
 *
 * Reconnects automatically with capped backoff. Reacts to config changes by
 * reconnecting when the URL/token changes.
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { insertMessage } from '../db/index.js';
import { downloadAll } from '../media/store.js';
import { getConfig, onConfigChange } from '../config/store.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('napcat');

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;
const CALL_TIMEOUT = 10000;

class NapCatClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.status = 'disconnected'; // disconnected | connecting | connected
    this.reconnectDelay = RECONNECT_MIN;
    this.reconnectTimer = null;
    this.manualClose = false;
    this.pendingCalls = new Map(); // echo -> {resolve, reject, timer}
    this.callSeq = 0;
    this.lastError = null;
    this.currentUrl = null;
    this.currentToken = null;
  }

  start() {
    this.manualClose = false;
    this.connect();
    // Reconnect if the operator changes NapCat connection settings.
    onConfigChange((cfg, section) => {
      if (section !== 'napcat' && section !== '*') return;
      if (cfg.napcat.url !== this.currentUrl || cfg.napcat.accessToken !== this.currentToken) {
        log.info('NapCat settings changed, reconnecting.');
        this.reconnectNow();
      }
    });
  }

  setStatus(status) {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  getState() {
    return {
      status: this.status,
      url: this.currentUrl,
      lastError: this.lastError,
    };
  }

  connect() {
    const { url, accessToken } = getConfig().napcat;
    this.currentUrl = url;
    this.currentToken = accessToken;
    if (!url) {
      log.warn('No NapCat URL configured, skipping connect.');
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('connecting');
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    log.info('Connecting to NapCat at', url);

    let ws;
    try {
      ws = new WebSocket(url, { headers });
    } catch (err) {
      this.lastError = String(err.message || err);
      log.error('WS construction failed:', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = RECONNECT_MIN;
      this.lastError = null;
      this.setStatus('connected');
      log.info('Connected to NapCat.');
    });

    ws.on('message', (data) => this.handleMessage(data));

    ws.on('close', (code) => {
      this.setStatus('disconnected');
      log.warn('NapCat connection closed, code', code);
      this.rejectAllPending(new Error('connection closed'));
      if (!this.manualClose) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.lastError = String(err.message || err);
      log.error('NapCat WS error:', err.message || err);
      // 'close' fires after 'error'; reconnect handled there.
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose) return;
    log.info(`Reconnecting in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX);
  }

  reconnectNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = RECONNECT_MIN;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch { /* ignore */ }
      this.ws = null;
    }
    this.connect();
  }

  stop() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
  }

  handleMessage(data) {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }

    // Action reply (has echo matching a pending call).
    if (payload.echo != null && this.pendingCalls.has(payload.echo)) {
      const pending = this.pendingCalls.get(payload.echo);
      this.pendingCalls.delete(payload.echo);
      clearTimeout(pending.timer);
      if (payload.status === 'ok' || payload.retcode === 0) {
        pending.resolve(payload.data);
      } else {
        pending.reject(new Error(payload.message || payload.wording || 'OneBot action failed'));
      }
      return;
    }

    if (payload.post_type === 'message' && payload.message_type === 'group') {
      this.handleGroupMessage(payload);
    }
  }

  async handleGroupMessage(evt) {
    const groupId = String(evt.group_id);
    const monitored = getConfig().groups.find(
      (g) => String(g.id) === groupId && g.enabled !== false,
    );
    if (!monitored) return; // not a selected group

    const content = extractText(evt.message, evt.raw_message);
    const imageUrls = extractImages(evt.message);
    // Skip only if there is neither text nor any image.
    if (!content.trim() && !imageUrls.length) return;

    // Download images now so they survive QQ URL expiry. Each becomes
    // { file, url }; file is null if the download failed.
    let images;
    if (imageUrls.length) {
      images = await downloadAll(imageUrls);
      const ok = images.filter((i) => i.file).length;
      log.info(`Archived ${ok}/${images.length} image(s) locally.`);
    }

    try {
      insertMessage({
        messageId: evt.message_id != null ? String(evt.message_id) : null,
        groupId,
        groupName: monitored.name || null,
        senderId: evt.user_id,
        senderName: evt.sender?.card || evt.sender?.nickname || null,
        content,
        images,
        raw: evt,
        msgTime: evt.time || Math.floor(Date.now() / 1000),
      });
      this.emit('message', { groupId, content });
    } catch (err) {
      log.error('Failed to archive message:', err);
    }
  }

  /**
   * Invoke a OneBot action over the WS and await its echo reply.
   * @param {string} action e.g. 'get_group_list'
   * @param {object} [params]
   */
  callApi(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('NapCat not connected'));
        return;
      }
      const echo = `renecon-${++this.callSeq}`;
      const timer = setTimeout(() => {
        this.pendingCalls.delete(echo);
        reject(new Error(`Action ${action} timed out`));
      }, CALL_TIMEOUT);
      this.pendingCalls.set(echo, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ action, params, echo }));
    });
  }

  rejectAllPending(err) {
    for (const [, p] of this.pendingCalls) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pendingCalls.clear();
  }
}

/**
 * Flatten a OneBot message (array segments or CQ string) into plain text.
 * Non-text segments are rendered as compact placeholders so the LLM still sees
 * that an image/at/etc. occurred without the binary noise.
 */
export function extractText(message, rawMessage) {
  if (Array.isArray(message)) {
    return message
      .map((seg) => {
        switch (seg.type) {
          case 'text':
            return seg.data?.text ?? '';
          case 'at':
            return `@${seg.data?.qq ?? ''}`;
          case 'face':
            return '[表情]';
          case 'image':
            return '[图片]';
          case 'reply':
            return '';
          default:
            return '';
        }
      })
      .join('');
  }
  if (typeof message === 'string') return message;
  return rawMessage || '';
}

/**
 * Collect image URLs from a OneBot message's segments.
 * @returns {string[]}
 */
export function extractImages(message) {
  if (!Array.isArray(message)) return [];
  return message
    .filter((seg) => seg.type === 'image' && (seg.data?.url || seg.data?.file))
    .map((seg) => seg.data.url || seg.data.file)
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
}

export const napcatClient = new NapCatClient();
