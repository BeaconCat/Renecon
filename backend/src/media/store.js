/**
 * Local media store.
 *
 * QQ image URLs expire, so we download images at ingest time and keep a local
 * copy under data/images. Each archived image is recorded as { file, url }:
 *   - file: local filename (served via /api/media/:file), null if download failed
 *   - url:  original URL (fallback / provenance)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../util/logger.js';

const log = createLogger('media');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_DIR = path.resolve(__dirname, '../../data/images');

const FETCH_TIMEOUT = 12000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function ensureDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/**
 * Download one image URL to the local store.
 * @param {string} url
 * @returns {Promise<{file: string|null, url: string}>}
 */
export async function downloadAndStore(url) {
  ensureDir();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.warn(`Download HTTP ${res.status}: ${url}`);
      return { file: null, url };
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      log.warn(`Image too large (${buf.length}B), not stored: ${url}`);
      return { file: null, url };
    }
    const ext = EXT_BY_TYPE[type] || 'jpg';
    // Content-addressed name keeps duplicates deduped and paths predictable.
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
    const file = `${hash}.${ext}`;
    const dest = path.join(MEDIA_DIR, file);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
    return { file, url };
  } catch (err) {
    log.warn(`Download failed (${err.name || 'error'}): ${url}`);
    return { file: null, url };
  } finally {
    clearTimeout(timer);
  }
}

/** Download several URLs concurrently, preserving order. */
export function downloadAll(urls) {
  return Promise.all(urls.map(downloadAndStore));
}

/** Absolute path of a stored file, or null if missing. */
export function localPath(file) {
  if (!file) return null;
  const p = path.join(MEDIA_DIR, path.basename(file)); // basename guards traversal
  return fs.existsSync(p) ? p : null;
}

/** Read a stored file as { mediaType, base64 }, or null. */
export function readAsBase64(file) {
  const p = localPath(file);
  if (!p) return null;
  const ext = path.extname(p).slice(1).toLowerCase();
  const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return { mediaType, base64: fs.readFileSync(p).toString('base64') };
}
