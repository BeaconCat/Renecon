/**
 * OpenAI-compatible chat adapter.
 *
 * Works against any endpoint that speaks the /chat/completions schema
 * (OpenAI, Azure-compatible proxies, most domestic model gateways).
 */

/**
 * @param {object} cfg  llm.openai config { baseUrl, apiKey, model }
 * @param {object} req  { system, user, temperature, images }
 * @returns {Promise<string>} assistant text
 */
export async function openaiChat(cfg, { system, user, temperature, images }) {
  if (!cfg.apiKey) throw new Error('OpenAI apiKey not configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  // With images (base64 objects), the user turn becomes a multimodal content
  // array using inline data URLs.
  const userContent = images && images.length
    ? [
      { type: 'text', text: user },
      ...images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      })),
    ]
    : user;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: temperature ?? 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('OpenAI returned no content');
  return text;
}

/**
 * List available models via GET /models.
 * @param {object} cfg { baseUrl, apiKey }
 * @returns {Promise<string[]>} model ids
 */
export async function openaiModels(cfg) {
  if (!cfg.apiKey) throw new Error('OpenAI apiKey not configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/models`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => m.id).filter(Boolean).sort();
}
