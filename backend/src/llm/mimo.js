/**
 * Xiaomi MiMo adapter.
 *
 * MiMo speaks the OpenAI /chat/completions schema with two differences we care
 * about:
 *   - a `thinking: { type: 'enabled' | 'disabled' }` field toggling the deep
 *     reasoning chain (returned separately as reasoning_content, which we
 *     ignore — only the final `content` is used).
 *   - it uses `max_completion_tokens` (bounds thinking + answer combined), so
 *     we set it generously to avoid truncating the answer after long thinking.
 *
 * With thinking enabled MiMo forces temperature/top_p to its defaults, so we
 * omit temperature in that case.
 */

const MAX_COMPLETION_TOKENS = 8192;

/**
 * @param {object} cfg  llm.mimo config { baseUrl, apiKey, model, thinking }
 * @param {object} req  { system, user, temperature, images }
 * @returns {Promise<string>} assistant text (final answer only)
 */
export async function mimoChat(cfg, { system, user, temperature, images }) {
  if (!cfg.apiKey) throw new Error('MiMo apiKey not configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const thinkingOn = cfg.thinking !== false;

  const userContent = images && images.length
    ? [
      { type: 'text', text: user },
      ...images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      })),
    ]
    : user;

  const body = {
    model: cfg.model,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    thinking: { type: thinkingOn ? 'enabled' : 'disabled' },
  };
  // Temperature is only honoured when thinking is disabled.
  if (!thinkingOn) body.temperature = temperature ?? 0.2;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // MiMo accepts either the OpenAI-style bearer or an api-key header; send
      // both so it works regardless of gateway.
      Authorization: `Bearer ${cfg.apiKey}`,
      'api-key': cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`MiMo HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('MiMo returned no content');
  return text;
}

/**
 * List available models via GET /models.
 * @param {object} cfg { baseUrl, apiKey }
 * @returns {Promise<string[]>} model ids
 */
export async function mimoModels(cfg) {
  if (!cfg.apiKey) throw new Error('MiMo apiKey not configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'api-key': cfg.apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MiMo HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => m.id).filter(Boolean).sort();
}
