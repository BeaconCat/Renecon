/**
 * Anthropic Claude Messages API adapter.
 */

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * @param {object} cfg  llm.claude config { baseUrl, apiKey, model }
 * @param {object} req  { system, user, temperature, images }
 * @returns {Promise<string>} assistant text
 */
export async function claudeChat(cfg, { system, user, temperature, images }) {
  if (!cfg.apiKey) throw new Error('Claude apiKey not configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`;
  // With images (base64 objects), use content blocks with base64 source.
  const userContent = images && images.length
    ? [
      { type: 'text', text: user },
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      })),
    ]
    : user;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      temperature: temperature ?? 0.2,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  // content is an array of blocks; concatenate text blocks.
  const text = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    : null;
  if (!text) throw new Error('Claude returned no text content');
  return text;
}

/**
 * List available models via GET /v1/models.
 * @param {object} cfg { baseUrl, apiKey }
 * @returns {Promise<string[]>} model ids
 */
export async function claudeModels(cfg) {
  if (!cfg.apiKey) throw new Error('Claude apiKey not configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/models`;
  const res = await fetch(url, {
    headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => m.id).filter(Boolean);
}
