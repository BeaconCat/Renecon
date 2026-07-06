/**
 * Thin fetch wrapper for the Renecon REST API. All paths are relative to /api
 * (proxied to the backend in dev, same-origin in production).
 */

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  getStatus: () => request('GET', '/status'),
  getConfig: () => request('GET', '/config'),
  saveSection: (section, value) => request('PUT', `/config/${section}`, value),

  getLiveGroups: () => request('GET', '/groups/live'),

  getMessages: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/messages?${q}`);
  },
  getMessageStats: () => request('GET', '/messages/stats'),
  deleteMessages: (ids) => request('POST', '/messages/delete', { ids }),
  imageUrl: (url) => `/api/image?url=${encodeURIComponent(url)}`,

  getDigests: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/digests?${q}`);
  },

  runPipeline: (minutes) => request('POST', '/pipeline/run', { minutes }),
  getLlmModels: () => request('GET', '/llm/models'),
  testLlm: (prompt) => request('POST', '/test/llm', { prompt }),
  testFeishu: (text) => request('POST', '/test/feishu', { text }),
  getLogs: (limit = 200) => request('GET', `/logs?limit=${limit}`),
};
