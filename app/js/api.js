async function req(method, url, body, raw) {
  const opts = { method, headers: {} };
  if (raw) {
    opts.body = raw;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

const P = (id) => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  status: () => req('GET', '/api/status'),
  config: () => req('GET', '/api/config'),
  saveConfig: (patch) => req('PUT', '/api/config', patch),
  styles: () => req('GET', '/api/styles'),
  saveStyle: (s) => req('POST', '/api/styles', s),
  deleteStyle: (id) => req('DELETE', `/api/styles/${encodeURIComponent(id)}`),
  memory: () => req('GET', '/api/memory'),
  saveMemory: (text) => req('PUT', '/api/memory', { text }),
  renders: () => req('GET', '/api/renders'),

  projects: () => req('GET', '/api/projects'),
  createProject: (data) => req('POST', '/api/projects', data),
  importFolder: (path) => req('POST', '/api/projects/import', { path }),
  project: (id) => req('GET', P(id)),
  patchProject: (id, patch) => req('PATCH', P(id), patch),
  deleteProject: (id) => req('DELETE', P(id)),
  duplicate: (id) => req('POST', `${P(id)}/duplicate`),
  reveal: (id, sub) => req('POST', `${P(id)}/reveal`, { sub }),
  saveTimeline: (id, timeline, message) => req('PUT', `${P(id)}/timeline`, { timeline, message }),
  fileUrl: (id, rel) => `${P(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`,
  readFile: async (id, rel) => {
    const r = await fetch(`${P(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`);
    if (!r.ok) throw new Error('No se pudo leer ' + rel);
    return r.text();
  },
  writeFile: (id, rel, content) => req('PUT', `${P(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, undefined, content),
  uploadVoiceover: (id, file) => req('PUT', `${P(id)}/voiceover?name=${encodeURIComponent(file.name)}`, undefined, file),
  snapshot: (id, blob) => req('POST', `${P(id)}/snapshot`, undefined, blob),
  thumb: (id, blob) => req('PUT', `${P(id)}/thumb`, undefined, blob),
  uploadRender: (id, blob, ext) => req('POST', `${P(id)}/renders?ext=${ext}`, undefined, blob),
  deleteRender: (id, file) => req('DELETE', `${P(id)}/renders?file=${encodeURIComponent(file)}`),
  history: (id) => req('GET', `${P(id)}/history`),
  commit: (id, hash) => req('GET', `${P(id)}/history/${hash}`),
  restore: (id, hash) => req('POST', `${P(id)}/history/${hash}/restore`),
  chat: (id) => req('GET', `${P(id)}/chat`),
  clearChat: (id) => req('DELETE', `${P(id)}/chat`),
  stopClaude: (id) => req('POST', `${P(id)}/claude/stop`),

  /** Streams NDJSON events from a Claude Code run. */
  async runClaude(id, body, onEvent) {
    const res = await fetch(`${P(id)}/claude`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          try {
            onEvent(JSON.parse(line));
          } catch {
            /* ignore partial */
          }
        }
      }
    }
  },
};
