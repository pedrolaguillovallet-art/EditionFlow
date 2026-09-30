import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HttpError, copyDir, exists, readJson, safeJoin, slugify, writeJson } from './util.js';
import { commitAll, initRepo } from './git.js';
import { resolveLook } from './presets.js';
import { claudeMd, copyTemplate, defaultTimeline, timelineFromScript } from './scaffold.js';

const PROJECT_GITIGNORE = `renders/\n.editionflow/snapshots/\n.editionflow/thumb.png\n.editionflow/chat.json\n*.tmp\n`;
const STATUSES = ['draft', 'editing', 'ready'];

export function projectDir(ws, id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HttpError(400, 'Id de proyecto inválido');
  return safeJoin(ws, id);
}

async function requireProject(ws, id) {
  const dir = projectDir(ws, id);
  if (!(await exists(path.join(dir, 'project.json')))) throw new HttpError(404, 'Proyecto no encontrado');
  return dir;
}

export async function readMeta(dir) {
  return readJson(path.join(dir, 'project.json'));
}

export async function readTimeline(dir) {
  const tl = await readJson(path.join(dir, 'timeline.json'), null);
  return normalizeTimeline(tl);
}

export function normalizeTimeline(tl) {
  tl = tl && typeof tl === 'object' ? tl : {};
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const shots = (Array.isArray(tl.shots) ? tl.shots : []).map((s, i) => ({
    ...s,
    id: String(s.id || `s${i + 1}`),
    title: String(s.title ?? ''),
    start: num(s.start),
    duration: Math.max(0.1, num(s.duration, 3)),
    scene: String(s.scene || ''),
    params: s.params && typeof s.params === 'object' ? s.params : {},
    transition: s.transition || 'cut',
  }));
  shots.sort((a, b) => a.start - b.start);
  return {
    ...tl,
    version: 1,
    fps: num(tl.fps, 30),
    subtitles: Boolean(tl.subtitles),
    shots,
    narration: Array.isArray(tl.narration) ? tl.narration : [],
    cards: Array.isArray(tl.cards) ? tl.cards : [],
    cues: Array.isArray(tl.cues) ? tl.cues : [],
    ambience: Array.isArray(tl.ambience) ? tl.ambience : [],
  };
}

function durationOf(tl) {
  return tl.shots.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
}

export async function listProjects(ws) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(ws, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(ws, e.name);
    const meta = await readJson(path.join(dir, 'project.json'), null);
    if (!meta) continue;
    const tl = await readTimeline(dir);
    const { style, look } = await resolveLook(ws, meta.style, meta.look);
    out.push({
      id: e.name,
      title: meta.title,
      status: meta.status || 'draft',
      style: style.id,
      styleName: style.name,
      look: look.id,
      lookName: look.name,
      shots: tl.shots.length,
      duration: durationOf(tl),
      updated: meta.updated || meta.created,
      created: meta.created,
      hasThumb: await exists(path.join(dir, '.editionflow', 'thumb.png')),
    });
  }
  out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return out;
}

export async function getProject(ws, id) {
  const dir = await requireProject(ws, id);
  const meta = await readMeta(dir);
  const timeline = await readTimeline(dir);
  const { style, look } = await resolveLook(ws, meta.style, meta.look);
  const scenes = await listFiles(dir, 'scenes', '.js');
  const script = await fs.readFile(path.join(dir, 'script.md'), 'utf8').catch(() => '');
  return { id, dir, meta, timeline, style, look, scenes, script };
}

async function listFiles(dir, sub, ext) {
  try {
    const files = await fs.readdir(path.join(dir, sub));
    return files.filter((f) => f.endsWith(ext)).map((f) => `${sub}/${f}`).sort();
  } catch {
    return [];
  }
}

async function uniqueId(ws, title) {
  const base = slugify(title);
  let id = base;
  for (let i = 2; await exists(path.join(ws, id)); i++) id = `${base}-${i}`;
  return id;
}

export async function createProject(ws, input, memory) {
  const title = String(input.title || 'Proyecto sin título').trim().slice(0, 140);
  const id = await uniqueId(ws, title);
  const dir = path.join(ws, id);
  const { style, look } = await resolveLook(ws, input.style, input.look);
  await fs.mkdir(path.join(dir, 'scenes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  await fs.mkdir(path.join(dir, 'renders'), { recursive: true });
  await fs.mkdir(path.join(dir, '.editionflow', 'snapshots'), { recursive: true });

  const now = Date.now();
  const meta = {
    title,
    style: style.id,
    look: look.id,
    status: 'draft',
    created: now,
    updated: now,
    lengthSeconds: parseLength(input.length),
    topic: String(input.topic || '').trim(),
    direction: String(input.direction || '').trim(),
    voiceover: null,
    claudeSession: null,
  };

  const template = style.template || 'flat_shapes';
  const sceneFile = `scenes/${template}.js`;
  await copyTemplate(dir, template, sceneFile);

  let timeline = defaultTimeline({ title, sceneFile, lengthSeconds: meta.lengthSeconds });
  const script = String(input.script || '').trim();
  if (script) {
    await fs.writeFile(path.join(dir, 'script.md'), script + '\n');
    const built = timelineFromScript(script, { totalSeconds: Number(input.voiceoverSeconds) || null, sceneFile });
    if (built) {
      timeline.shots = built.shots;
      timeline.narration = built.narration;
      const end = durationOf(timeline);
      timeline.ambience = [{ start: 0, end, type: 'pad', db: -33 }];
    }
  }
  await writeJson(path.join(dir, 'project.json'), meta);
  await writeJson(path.join(dir, 'timeline.json'), timeline);
  await fs.writeFile(path.join(dir, '.gitignore'), PROJECT_GITIGNORE);
  await fs.writeFile(path.join(dir, 'NOTES.md'), `# Notas de ${title}\n\n`);
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), claudeMd({ meta, style, look, memory }));
  await initRepo(dir);
  await commitAll(dir, 'Proyecto creado');
  return id;
}

export function parseLength(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    return (m || 0) * 60 + (sec || 0);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function updateMeta(ws, id, patch) {
  const dir = await requireProject(ws, id);
  const meta = await readMeta(dir);
  const allowed = ['title', 'status', 'style', 'look', 'topic', 'direction', 'lengthSeconds', 'claudeSession'];
  for (const k of allowed) if (k in patch) meta[k] = patch[k];
  if (!STATUSES.includes(meta.status)) meta.status = 'draft';
  meta.updated = Date.now();
  await writeJson(path.join(dir, 'project.json'), meta);
  return meta;
}

export async function touch(dir) {
  const meta = await readMeta(dir);
  meta.updated = Date.now();
  if (meta.status === 'draft') meta.status = 'editing';
  await writeJson(path.join(dir, 'project.json'), meta);
}

export async function saveTimeline(ws, id, timeline, message, autoCommit = true) {
  const dir = await requireProject(ws, id);
  const tl = normalizeTimeline(timeline);
  await writeJson(path.join(dir, 'timeline.json'), tl);
  await touch(dir);
  if (autoCommit) await commitAll(dir, message || 'Edición en la línea de tiempo');
  return tl;
}

export async function refreshClaudeMd(ws, id, memory) {
  const dir = await requireProject(ws, id);
  const meta = await readMeta(dir);
  const { style, look } = await resolveLook(ws, meta.style, meta.look);
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), claudeMd({ meta, style, look, memory }));
}

export async function deleteProject(ws, id) {
  const dir = await requireProject(ws, id);
  const trash = path.join(ws, '.trash');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(dir, path.join(trash, `${id}-${Date.now()}`));
}

export async function duplicateProject(ws, id) {
  const dir = await requireProject(ws, id);
  const meta = await readMeta(dir);
  const newId = await uniqueId(ws, meta.title + ' copia');
  const dest = path.join(ws, newId);
  await copyDir(dir, dest, (from) => !from.includes(`${path.sep}renders${path.sep}`) && !from.endsWith(`${path.sep}renders`));
  await fs.mkdir(path.join(dest, 'renders'), { recursive: true });
  const m = { ...meta, title: meta.title + ' (copia)', created: Date.now(), updated: Date.now(), claudeSession: null };
  await writeJson(path.join(dest, 'project.json'), m);
  await fs.rm(path.join(dest, '.editionflow', 'chat.json'), { force: true });
  await commitAll(dest, 'Duplicado desde ' + id);
  return newId;
}

export async function importFolder(ws, source) {
  const src = path.resolve(String(source || ''));
  if (!(await exists(path.join(src, 'project.json'))) || !(await exists(path.join(src, 'timeline.json')))) {
    throw new HttpError(400, 'La carpeta no parece un proyecto de EditionFlow (faltan project.json / timeline.json)');
  }
  const meta = await readMeta(src);
  const id = await uniqueId(ws, meta.title || path.basename(src));
  const dest = path.join(ws, id);
  await copyDir(src, dest);
  if (!(await exists(path.join(dest, '.git')))) await initRepo(dest);
  await commitAll(dest, 'Importado');
  return id;
}

export async function revealProject(ws, id, sub = '') {
  const dir = safeJoin(await requireProject(ws, id), sub);
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return dir;
}

/* ---------- files ---------- */

const WRITABLE = /^(scenes\/[\w.-]+\.js|NOTES\.md|script\.md)$/;

export async function readProjectFile(ws, id, rel) {
  const dir = await requireProject(ws, id);
  return safeJoin(dir, rel);
}

export async function writeProjectFile(ws, id, rel, content, autoCommit = true) {
  if (!WRITABLE.test(rel)) throw new HttpError(403, 'Solo se pueden editar escenas, NOTES.md y script.md');
  const dir = await requireProject(ws, id);
  const file = safeJoin(dir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  await touch(dir);
  if (autoCommit) await commitAll(dir, `Editado ${rel}`);
}

export async function saveVoiceover(ws, id, buf, filename) {
  const dir = await requireProject(ws, id);
  const ext = (path.extname(filename || '').toLowerCase() || '.mp3').replace(/[^.a-z0-9]/g, '');
  if (!['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.aac', '.flac'].includes(ext)) throw new HttpError(400, 'Formato de audio no soportado');
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  for (const f of await fs.readdir(path.join(dir, 'audio'))) {
    if (f.startsWith('voiceover.')) await fs.rm(path.join(dir, 'audio', f));
  }
  const rel = `audio/voiceover${ext}`;
  await fs.writeFile(path.join(dir, rel), buf);
  const meta = await readMeta(dir);
  meta.voiceover = rel;
  meta.updated = Date.now();
  await writeJson(path.join(dir, 'project.json'), meta);
  await commitAll(dir, 'Voz en off añadida');
  return rel;
}

export async function saveSnapshot(ws, id, buf) {
  const dir = await requireProject(ws, id);
  const rel = `.editionflow/snapshots/snap-${Date.now()}.png`;
  await fs.mkdir(path.join(dir, '.editionflow', 'snapshots'), { recursive: true });
  await fs.writeFile(path.join(dir, rel), buf);
  // keep the 30 most recent
  const snaps = (await fs.readdir(path.join(dir, '.editionflow', 'snapshots'))).sort();
  for (const old of snaps.slice(0, -30)) await fs.rm(path.join(dir, '.editionflow', 'snapshots', old), { force: true });
  return rel;
}

export async function saveThumb(ws, id, buf) {
  const dir = await requireProject(ws, id);
  await fs.mkdir(path.join(dir, '.editionflow'), { recursive: true });
  await fs.writeFile(path.join(dir, '.editionflow', 'thumb.png'), buf);
}

/* ---------- renders ---------- */

export async function saveRender(ws, id, buf, ext) {
  const dir = await requireProject(ws, id);
  await fs.mkdir(path.join(dir, 'renders'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const rel = `renders/${id}-${stamp}.${ext === 'mp4' ? 'mp4' : 'webm'}`;
  await fs.writeFile(path.join(dir, rel), buf);
  const meta = await readMeta(dir);
  meta.status = 'ready';
  meta.updated = Date.now();
  await writeJson(path.join(dir, 'project.json'), meta);
  return { dir, rel };
}

export async function listRenders(ws) {
  const projects = await listProjects(ws);
  const out = [];
  for (const p of projects) {
    const dir = path.join(ws, p.id, 'renders');
    let files = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!/\.(webm|mp4)$/.test(f)) continue;
      const st = await fs.stat(path.join(dir, f));
      out.push({ project: p.id, title: p.title, file: `renders/${f}`, size: st.size, time: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.time - a.time);
}

export async function deleteRender(ws, id, rel) {
  if (!/^renders\/[\w.-]+\.(webm|mp4)$/.test(rel)) throw new HttpError(400, 'Render inválido');
  const dir = await requireProject(ws, id);
  await fs.rm(safeJoin(dir, rel), { force: true });
}

/* ---------- chat ---------- */

export async function readChat(ws, id) {
  const dir = await requireProject(ws, id);
  return readJson(path.join(dir, '.editionflow', 'chat.json'), []);
}

export async function appendChat(ws, id, entry) {
  const dir = await requireProject(ws, id);
  const file = path.join(dir, '.editionflow', 'chat.json');
  const chat = await readJson(file, []);
  chat.push(entry);
  await writeJson(file, chat.slice(-200));
}

export async function clearChat(ws, id) {
  const dir = await requireProject(ws, id);
  await writeJson(path.join(dir, '.editionflow', 'chat.json'), []);
  await updateMeta(ws, id, { claudeSession: null });
}

/* ---------- memory ---------- */

export async function readMemory(ws) {
  return fs.readFile(path.join(ws, '.editionflow', 'memory.md'), 'utf8').catch(() => '');
}

export async function writeMemory(ws, text) {
  await fs.mkdir(path.join(ws, '.editionflow'), { recursive: true });
  await fs.writeFile(path.join(ws, '.editionflow', 'memory.md'), String(text || ''));
}
