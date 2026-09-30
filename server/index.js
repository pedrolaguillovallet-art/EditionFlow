#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HttpError, mimeFor, readBody, readJsonBody, safeJoin, sendJson } from './util.js';
import { loadConfig, saveConfig, configPath } from './config.js';
import { hasGit, log as gitLog, restore as gitRestore, show as gitShow, commitAll } from './git.js';
import { listStyles, saveCustomStyle, deleteCustomStyle } from './presets.js';
import { detectClaude, runClaude, composePrompt } from './claude.js';
import { detectFfmpeg, webmToMp4 } from './media.js';
import * as P from './projects.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'app');
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';

const jobs = new Map(); // projectId -> { stop, startedAt, message }

/* ------------------------------------------------------------------ */
/* routing                                                             */
/* ------------------------------------------------------------------ */

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:(\w+)(\*)?/g, (_, k, star) => {
        keys.push(k);
        return star ? '/(.+)' : '/([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, re, keys, handler });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      const cfg = await loadConfig();
      const result = await r.handler({ req, res, params, query: url.searchParams, cfg, ws: cfg.workspace });
      if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
      return;
    }
    throw new HttpError(404, 'Ruta no encontrada');
  }
  return serveStatic(req, res, pathname);
}

async function serveStatic(req, res, pathname) {
  let file = safeJoin(APP_DIR, pathname === '/' ? 'index.html' : pathname);
  let stat = await fsp.stat(file).catch(() => null);
  if (!stat || stat.isDirectory()) {
    file = path.join(APP_DIR, 'index.html');
    stat = await fsp.stat(file);
  }
  res.writeHead(200, { 'Content-Type': mimeFor(file), 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function sendFile(req, res, file) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) throw new HttpError(404, 'Archivo no encontrado');
  const type = mimeFor(file);
  const range = req.headers.range;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : stat.size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, stat.size - Number(m[2]));
      end = stat.size - 1;
    }
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}

/* ------------------------------------------------------------------ */
/* app / settings                                                      */
/* ------------------------------------------------------------------ */

route('GET', '/api/status', async ({ cfg }) => {
  const [claude, git, ffmpeg] = await Promise.all([detectClaude(cfg.claudePath), hasGit(), detectFfmpeg(cfg.ffmpegPath)]);
  return { claude, git, ffmpeg, workspace: cfg.workspace, configFile: configPath(), platform: process.platform, running: [...jobs.keys()] };
});

route('GET', '/api/config', ({ cfg }) => cfg);
route('PUT', '/api/config', async ({ req }) => saveConfig(await readJsonBody(req)));

route('GET', '/api/styles', ({ ws }) => listStyles(ws));
route('POST', '/api/styles', async ({ req, ws }) => saveCustomStyle(ws, await readJsonBody(req)));
route('DELETE', '/api/styles/:id', async ({ params, ws }) => {
  await deleteCustomStyle(ws, params.id);
  return { ok: true };
});

route('GET', '/api/templates/:name', async ({ req, res, params }) => {
  if (!/^[a-z_]+\.js$/.test(params.name)) throw new HttpError(404, 'Plantilla no encontrada');
  await sendFile(req, res, path.join(ROOT, 'server', 'templates', 'scenes', params.name));
});

route('GET', '/api/memory',async ({ ws }) => ({ text: await P.readMemory(ws) }));
route('PUT', '/api/memory', async ({ req, ws }) => {
  const { text } = await readJsonBody(req);
  await P.writeMemory(ws, text);
  return { ok: true };
});

route('GET', '/api/renders', ({ ws }) => P.listRenders(ws));

/* ------------------------------------------------------------------ */
/* projects                                                            */
/* ------------------------------------------------------------------ */

route('GET', '/api/projects', ({ ws }) => P.listProjects(ws));

route('POST', '/api/projects', async ({ req, ws }) => {
  const body = await readJsonBody(req);
  const id = await P.createProject(ws, body, await P.readMemory(ws));
  return { id };
});

route('POST', '/api/projects/import', async ({ req, ws }) => {
  const { path: src } = await readJsonBody(req);
  return { id: await P.importFolder(ws, src) };
});

route('GET', '/api/projects/:id', async ({ params, ws }) => {
  const p = await P.getProject(ws, params.id);
  delete p.dir;
  p.running = jobs.has(params.id);
  return p;
});

route('PATCH', '/api/projects/:id', async ({ req, params, ws, cfg }) => {
  const patch = await readJsonBody(req);
  const meta = await P.updateMeta(ws, params.id, patch);
  if ('style' in patch || 'look' in patch) {
    await P.refreshClaudeMd(ws, params.id, await P.readMemory(ws));
    if (cfg.autoCommit) await commitAll(P.projectDir(ws, params.id), `Estilo cambiado a ${meta.style} · ${meta.look}`);
  }
  return meta;
});

route('DELETE', '/api/projects/:id', async ({ params, ws }) => {
  if (jobs.has(params.id)) throw new HttpError(409, 'Claude está trabajando en este proyecto');
  await P.deleteProject(ws, params.id);
  return { ok: true };
});

route('POST', '/api/projects/:id/duplicate', async ({ params, ws }) => ({ id: await P.duplicateProject(ws, params.id) }));

route('POST', '/api/projects/:id/reveal', async ({ req, params, ws }) => {
  const { sub } = await readJsonBody(req);
  return { path: await P.revealProject(ws, params.id, sub || '') };
});

route('PUT', '/api/projects/:id/timeline', async ({ req, params, ws, cfg }) => {
  const { timeline, message } = await readJsonBody(req);
  return P.saveTimeline(ws, params.id, timeline, message, cfg.autoCommit);
});

route('GET', '/api/projects/:id/files/:rel*', async ({ req, res, params, ws }) => {
  const file = await P.readProjectFile(ws, params.id, params.rel);
  await sendFile(req, res, file);
});

route('PUT', '/api/projects/:id/files/:rel*', async ({ req, params, ws, cfg }) => {
  if (jobs.has(params.id)) throw new HttpError(409, 'Espera a que Claude termine');
  const body = await readBody(req, 5 * 1024 * 1024);
  await P.writeProjectFile(ws, params.id, params.rel, body, cfg.autoCommit);
  return { ok: true };
});

route('PUT', '/api/projects/:id/voiceover', async ({ req, params, query, ws }) => {
  const buf = await readBody(req, 500 * 1024 * 1024);
  return { path: await P.saveVoiceover(ws, params.id, buf, query.get('name') || 'voiceover.mp3') };
});

route('POST', '/api/projects/:id/snapshot', async ({ req, params, ws }) => {
  const buf = await readBody(req, 30 * 1024 * 1024);
  return { path: await P.saveSnapshot(ws, params.id, buf) };
});

route('PUT', '/api/projects/:id/thumb', async ({ req, params, ws }) => {
  await P.saveThumb(ws, params.id, await readBody(req, 10 * 1024 * 1024));
  return { ok: true };
});

route('POST', '/api/projects/:id/renders', async ({ req, params, query, ws, cfg }) => {
  const buf = await readBody(req, 4 * 1024 * 1024 * 1024);
  const ext = query.get('ext') === 'mp4' ? 'mp4' : 'webm';
  const { dir, rel } = await P.saveRender(ws, params.id, buf, ext);
  let file = rel;
  let converted = false;
  let note = '';
  if (ext === 'webm' && cfg.convertToMp4 && (await detectFfmpeg(cfg.ffmpegPath)).ok) {
    const mp4 = rel.replace(/\.webm$/, '.mp4');
    try {
      await webmToMp4(cfg.ffmpegPath, path.join(dir, rel), path.join(dir, mp4));
      await fsp.rm(path.join(dir, rel), { force: true });
      file = mp4;
      converted = true;
    } catch (err) {
      note = 'No se pudo convertir a MP4: ' + err.message;
    }
  }
  return { file, converted, note };
});

route('DELETE', '/api/projects/:id/renders', async ({ params, query, ws }) => {
  await P.deleteRender(ws, params.id, query.get('file') || '');
  return { ok: true };
});

/* ---------- history (git) ---------- */

route('GET', '/api/projects/:id/history', async ({ params, ws }) => gitLog(P.projectDir(ws, params.id)));
route('GET', '/api/projects/:id/history/:hash', async ({ params, ws }) => ({ patch: await gitShow(P.projectDir(ws, params.id), params.hash) }));
route('POST', '/api/projects/:id/history/:hash/restore', async ({ params, ws }) => {
  if (jobs.has(params.id)) throw new HttpError(409, 'Espera a que Claude termine');
  return { commit: await gitRestore(P.projectDir(ws, params.id), params.hash) };
});

/* ---------- Claude ---------- */

route('GET', '/api/projects/:id/chat', ({ params, ws }) => P.readChat(ws, params.id));
route('DELETE', '/api/projects/:id/chat', async ({ params, ws }) => {
  await P.clearChat(ws, params.id);
  return { ok: true };
});

route('POST', '/api/projects/:id/claude/stop', ({ params }) => {
  jobs.get(params.id)?.stop();
  return { ok: true };
});

route('POST', '/api/projects/:id/claude', async ({ req, res, params, ws, cfg }) => {
  const id = params.id;
  if (jobs.has(id)) throw new HttpError(409, 'Claude ya está trabajando en este proyecto');
  const body = await readJsonBody(req);
  const project = await P.getProject(ws, id);
  const memory = await P.readMemory(ws);
  await P.refreshClaudeMd(ws, id, memory);

  const duration = project.timeline.shots.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
  const userMessage = String(body.message || '').trim();
  const prompt = body.build
    ? buildPrompt(project)
    : composePrompt({ message: userMessage, scope: body.scope, shot: body.shot, selection: body.selection, snapshot: body.snapshot, timelineDuration: duration });
  if (!prompt.trim()) throw new HttpError(400, 'Mensaje vacío');

  const started = Date.now();
  const display = body.build ? 'Construye el vídeo completo' : userMessage;
  await P.appendChat(ws, id, { role: 'user', text: display, scope: body.scope || 'whole', context: body.contextLabel || '', time: started });

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const send = (ev) => {
    if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n');
  };

  const steps = [];
  let lastText = '';
  let error = '';
  const job = runClaude({
    dir: path.join(ws, id),
    prompt,
    sessionId: body.newSession ? null : project.meta.claudeSession,
    config: cfg,
    onEvent: (ev) => {
      if (ev.kind === 'tool') steps.push(ev.label);
      if (ev.kind === 'text') lastText = ev.text;
      if (ev.kind === 'error') error = ev.text;
      if (ev.kind === 'result' && ev.text) lastText = ev.text;
      send(ev);
    },
  });
  jobs.set(id, { stop: job.stop, startedAt: started, message: display });

  const outcome = await job.done;
  jobs.delete(id);

  if (outcome.session) await P.updateMeta(ws, id, { claudeSession: outcome.session });
  // Validate what Claude left behind, then snapshot it in git.
  let timelineOk = true;
  try {
    JSON.parse(await fsp.readFile(path.join(ws, id, 'timeline.json'), 'utf8'));
  } catch (err) {
    timelineOk = false;
    send({ kind: 'warning', text: 'timeline.json no es JSON válido: ' + err.message });
  }
  const commit = cfg.autoCommit ? await commitAll(path.join(ws, id), `Claude: ${display}`.slice(0, 200)) : null;
  await P.touch(path.join(ws, id));
  await P.appendChat(ws, id, {
    role: 'assistant',
    text: lastText,
    steps,
    status: outcome.stopped ? 'stopped' : error ? 'error' : 'ok',
    error,
    commit,
    time: Date.now(),
    ms: Date.now() - started,
  });
  send({ kind: 'end', commit, timelineOk, stopped: Boolean(outcome.stopped) });
  res.end();
});

function buildPrompt(project) {
  const { meta, script, timeline } = project;
  const len = meta.lengthSeconds ? `${Math.round(meta.lengthSeconds)} segundos` : 'unos 60–90 segundos';
  const hasVoice = Boolean(meta.voiceover);
  const lines = [
    '[Alcance: VÍDEO COMPLETO — construcción inicial]',
    `Construye el vídeo "${meta.title}" de principio a fin siguiendo CLAUDE.md.`,
  ];
  if (script.trim()) {
    lines.push('1. El guion ya está en script.md: úsalo palabra por palabra como narración (no lo reescribas).');
    if (timeline.narration.length) lines.push('   timeline.json ya tiene un reparto aproximado de narración por planos: ajústalo si hace falta.');
  } else if (meta.topic) {
    lines.push(`1. Investiga el tema "${meta.topic}" (usa búsqueda web si está disponible, contrasta datos) y escribe un guion narrado, con gancho en la primera frase, de ${len}. Guárdalo en script.md.`);
  } else {
    lines.push(`1. Escribe un guion narrado breve sobre "${meta.title}" de ${len} y guárdalo en script.md.`);
  }
  lines.push(
    `2. Divide la narración en planos de 3–7 s en timeline.json (shots + narration con tiempos). ${hasVoice ? `Hay voz en off en ${meta.voiceover}: la duración total debe coincidir con ella.` : 'Calcula ~2,6 palabras por segundo.'}`,
    '3. Escribe las escenas en scenes/ (una por bloque temático; reutiliza escenas con params distintos). Estudia antes la plantilla que ya existe en scenes/ y respeta las reglas del estilo.',
    '4. Añade cards para 3–6 frases clave, cues con sfx en los momentos de impacto y ambience que acompañe cada parte.',
    '5. Quita del timeline la plantilla inicial si ya no la usa ningún plano.',
    'Al terminar, resume en 3–5 líneas lo que has construido.'
  );
  if (meta.direction) lines.push('', `Dirección del usuario: ${meta.direction}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Error' });
    else res.end();
  });
});

server.listen(PORT, HOST, async () => {
  const cfg = await loadConfig();
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  EditionFlow listo en ${url}`);
  console.log(`  Workspace: ${cfg.workspace}\n`);
  if (!process.argv.includes('--no-open') && !process.env.EDITIONFLOW_NO_OPEN) {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const job of jobs.values()) job.stop();
    process.exit(0);
  });
}
