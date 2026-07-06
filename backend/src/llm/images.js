/**
 * Image fetching for vision.
 *
 * QQ image URLs often require the original request context or expire quickly,
 * so instead of handing raw URLs to the LLM we download them server-side and
 * inline them as base64. Failures are swallowed (returns null) so one bad
 * image never breaks a digest run.
 */

import { createLogger } from '../util/logger.js';

const log = createLogger('images');

const FETCH_TIMEOUT = 12000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Download one image and return { mediaType, base64 }, or null on any failure.
 * @param {string} url
 */
export async function fetchImageAsBase64(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.warn(`Image fetch HTTP ${res.status}: ${url}`);
      return null;
    }
    let mediaType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      log.warn(`Image too large (${buf.length} bytes), skipping: ${url}`);
      return null;
    }
    if (!ALLOWED.has(mediaType)) {
      // Fall back to sniffing common magic numbers when the header lies.
      mediaType = sniff(buf) || mediaType;
      if (!ALLOWED.has(mediaType)) {
        log.warn(`Unsupported image type "${mediaType}", skipping: ${url}`);
        return null;
      }
    }
    return { mediaType, base64: buf.toString('base64') };
  } catch (err) {
    log.warn(`Image fetch failed (${err.name || 'error'}): ${url}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sniff media type from magic bytes. */
function sniff(buf) {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Download a list of URLs concurrently, dropping failures.
 * @param {string[]} urls
 * @returns {Promise<Array<{mediaType, base64}>>}
 */
export async function fetchImages(urls) {
  const results = await Promise.all(urls.map(fetchImageAsBase64));
  return results.filter(Boolean);
}
