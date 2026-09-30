import { h, icon, iconBtn, btn, toast, modal, confirmDialog, promptDialog, fmtTime, debounce } from '../ui.js';
import { api } from '../api.js';
import { app, setLastProject, refreshStatus } from '../main.js';
import { Renderer } from '../engine/renderer.js';
import { AudioEngine } from '../engine/audio.js';
import { Player } from '../engine/player.js';
import { Timeline } from '../editor/timeline.js';
import { ClaudePanel } from '../editor/claudePanel.js';
import { openExport } from '../editor/exporter.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const r2 = (n) => Math.round(n * 100) / 100;

export async function render(root, id) {
  let project;
  try {
    project = await api.project(id);
  } catch (err) {
    root.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, icon('alert', 28), h('h3', {}, 'Proyecto no encontrado'), h('p', {}, err.message), btn('Ver proyectos', { onClick: () => (location.hash = '/projects') }))));
    if (app.lastProject === id) setLastProject('');
    return;
  }
  setLastProject(id);
  const config = await api.config().catch(() => ({}));
  const ed = new Editor(root, project, config);
  await ed.init();
  return () => ed.destroy();
}

class Editor {
  constructor(root, project, config) {
    this.root = root;
    this.id = project.id;
    this.project = project;
    this.config = config;
    this.timeline = project.timeline;
    this.look = project.look;
    this.style = project.style;
    this.selection = null;
    this.range = null;
    this.point = null;
    this.scope = 'whole';
    this.running = false;
    this.pendingSnapshot = null;
    this.pendingSnapshotUrl = null;
    this.undoStack = [];
    this.redoStack = [];
    this.snapshot = JSON.stringify(this.timeline);
    this.saveState = 'saved';
    this.saveDebounced = debounce((msg) => this.save(msg), 700);
    this.reloadDebounced = debounce(() => this.reload({ quiet: true }), 350);
    this.onKey = this.onKey.bind(this);
  }

  /* ------------------------------------------------------------ setup */

  async init() {
    this.renderer = new Renderer(this.id);
    this.renderer.setLook(this.look);
    this.renderer.setTimeline(this.timeline);
    this.renderer.onError = debounce(() => {
      this.renderShots();
      this.timelineUI.render();
    }, 200);
    this.audio = new AudioEngine();

    this.canvas = h('canvas', { class: 'preview' });
    this.sizeCanvas();
    this.player = new Player({ renderer: this.renderer, audio: this.audio, canvas: this.canvas, getTimeline: () => this.timeline, getDuration: () => this.duration() });
    this.player.subtitles = Boolean(this.timeline.subtitles);

    this.timelineUI = new Timeline(this);
    this.panel = new ClaudePanel(this);
    this.buildLayout();

    await this.renderer.loadScenes();
    if (this.project.meta.voiceover) {
      await this.audio.loadVoiceover(api.fileUrl(this.id, this.project.meta.voiceover) + `?t=${this.project.meta.updated}`).catch((e) => toast(e.message, 'error'));
    }
    this.player.onTime((t, info) => this.onTime(t, info));
    // open a little into the first shot so the preview isn't a black fade-in frame
    const first = this.timeline.shots[0];
    this.player.time = first ? first.start + Math.min(1.2, first.duration * 0.4) : 0;
    this.player.render();
    this.renderAll();
    await this.panel.load();
    document.addEventListener('keydown', this.onKey);
    this.saveThumb();

    if (sessionStorage.getItem(`ef:build:${this.id}`)) {
      sessionStorage.removeItem(`ef:build:${this.id}`);
      this.runClaude({ build: true });
    } else if (this.project.running) {
      toast('Claude ya está trabajando en este proyecto (en otra pestaña).');
    }
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    this.player?.destroy();
    this.audio?.ctx?.close();
    if (this.saveState === 'dirty') this.save('Edición en la línea de tiempo');
  }

  sizeCanvas() {
    const { width, height, pixel } = this.look;
    const k = pixel ? Math.max(1, Math.ceil(1280 / width)) : 1;
    this.canvas.width = pixel ? width * k : 1280;
    this.canvas.height = pixel ? height * k : 720;
    this.canvas.style.imageRendering = pixel ? 'pixelated' : 'auto';
  }

  buildLayout() {
    this.titleEl = h('h1', { title: 'Renombrar', onclick: () => this.rename() });
    this.savedEl = h('span', { class: 'saved' });
    this.lookPill = h('button', { class: 'look-pill', onclick: () => this.chooseLook() });
    const top = h(
      'header',
      { class: 'ed-top' },
      this.titleEl,
      this.savedEl,
      h('span', { class: 'grow' }),
      this.lookPill,
      iconBtn('script', 'Guion', () => { this.select(null, { inspect: true }); }),
      iconBtn('keyboard', 'Atajos de teclado', () => shortcutsHelp()),
      iconBtn('help', 'Cómo trabajar con Claude', () => this.panel.help()),
      iconBtn('folder', 'Abrir carpeta del proyecto', () => api.reveal(this.id).then((r) => toast(r.path))),
      btn('Exportar', { icon: 'download', variant: 'primary', onClick: () => openExport(this) })
    );

    this.shotsList = h('div', { class: 'shots-list' });
    this.shotsCount = h('span', {});
    const shots = h('section', { class: 'shots' }, h('div', { class: 'shots-head' }, h('span', {}, 'Planos '), h('span', { style: { marginLeft: '6px' } }, this.shotsCount), h('span', { class: 'grow' }), iconBtn('plus', 'Añadir plano', () => this.addShot())), this.shotsList);

    this.marker = h('div', { class: 'pick-marker hidden' });
    this.stageBadge = h('div', { class: 'stage-badge hidden' });
    this.canvas.addEventListener('click', (e) => this.pickPoint(e));
    const stage = h('div', { class: 'stage' }, h('div', { class: 'stage-inner' }, this.canvas, this.marker, this.stageBadge));

    this.playBtn = iconBtn('play', 'Reproducir (Espacio)', () => this.player.toggle());
    this.timeEl = h('span', { class: 'time' });
    this.shotLabel = h('span', { class: 'shot-label' });
    this.muteBtn = iconBtn('volume', 'Silenciar (M)', () => this.toggleMute());
    this.loopBtn = iconBtn('repeat', 'Repetir (L) — usa el rango si hay uno', () => this.toggleLoop());
    this.rates = h('div', { class: 'rate-group' });
    const transport = h(
      'div',
      { class: 'transport' },
      iconBtn('skipBack', 'Plano anterior', () => this.jumpShot(-1)),
      this.playBtn,
      iconBtn('skipForward', 'Plano siguiente', () => this.jumpShot(1)),
      this.timeEl,
      this.shotLabel,
      iconBtn('camera', 'Adjuntar este fotograma a Claude', () => this.attachFrame()),
      this.muteBtn,
      this.loopBtn,
      this.rates
    );
    this.renderRates();

    const center = h('section', { class: 'center' }, stage, transport, this.timelineUI.el);
    this.root.append(h('div', { class: 'editor' }, top, shots, center, this.panel.el));
  }

  /* ------------------------------------------------------------ rendering */

  renderAll() {
    this.renderTop();
    this.renderShots();
    this.timelineUI.render();
    this.panel.render();
  }

  renderTop() {
    this.titleEl.textContent = this.project.meta.title;
    this.lookPill.replaceChildren(icon('palette', 16), `${this.style.name} · ${this.look.name}`);
    const states = {
      saved: [icon('check', 14), 'Guardado en local · historial git'],
      dirty: [icon('edit', 14), 'Cambios sin guardar…'],
      saving: [icon('refresh', 14), 'Guardando…'],
      running: [h('span', { class: 'spinner', style: { width: '12px', height: '12px', border: '2px solid #d9775755', borderTopColor: 'var(--claude)', borderRadius: '50%', animation: 'spin .8s linear infinite', display: 'inline-block' } }), 'Claude está editando…'],
    };
    const st = this.running ? 'running' : this.saveState;
    this.savedEl.className = `saved ${st === 'dirty' ? 'dirty' : ''}`;
    this.savedEl.replaceChildren(...states[st]);
  }

  renderShots() {
    const shots = this.timeline.shots;
    this.shotsCount.textContent = shots.length;
    const cur = this.player ? this.renderer.shotIndexAt(this.player.time) : -1;
    this.shotCanvases = [];
    this.shotsList.replaceChildren(
      ...shots.map((s, i) => {
        const c = h('canvas', { width: 156, height: 88, class: this.look.pixel ? '' : 'smooth' });
        this.shotCanvases.push(c);
        const err = this.renderer.errors.get(s.id);
        return h(
          'div',
          {
            class: `shot-item ${i === cur ? 'active' : ''} ${this.selection?.type === 'shot' && this.selection.index === i ? 'selected' : ''} ${err ? 'err' : ''}`,
            onclick: () => {
              this.select({ type: 'shot', index: i });
              this.player.seek(s.start + 0.001);
            },
            ondblclick: () => this.select({ type: 'shot', index: i }, { inspect: true }),
            title: err || s.title,
          },
          h('span', { class: 'num' }, i + 1),
          c,
          h('div', {}, h('div', { class: 't' }, s.title || '(sin título)'), h('div', { class: 'm' }, err ? '⚠ ' + err : `${fmtTime(s.start, true)} · ${s.duration.toFixed(1)}s · ${s.scene.replace(/^scenes\//, '')}`))
        );
      })
    );
    this.drawThumbs();
  }

  drawThumbs() {
    const token = (this.thumbToken = {});
    const shots = this.timeline.shots;
    let i = 0;
    const next = () => {
      if (token !== this.thumbToken || i >= shots.length) {
        if (token === this.thumbToken) this.player.render();
        return;
      }
      const s = shots[i];
      const c = this.shotCanvases[i];
      if (c) {
        this.renderer.drawFrame(s.start + Math.min(s.duration * 0.6, 2.5));
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = !this.look.pixel;
        g.drawImage(this.renderer.canvas, 0, 0, c.width, c.height);
      }
      i++;
      setTimeout(next, 0);
    };
    setTimeout(next, 30);
  }

  onTime(t, info) {
    const dur = this.duration();
    this.timeEl.replaceChildren(fmtTime(t, true), h('span', {}, ` / ${fmtTime(dur, true).replace(/\d$/, '')}`));
    const idx = info?.index ?? -1;
    const s = this.timeline.shots[idx];
    this.shotLabel.textContent = s ? `Plano ${idx + 1} · ${s.title}` : '';
    this.timelineUI.updatePlayhead(t, this.player.playing);
    this.playBtn.replaceChildren(icon(this.player.playing ? 'pause' : 'play', 17));
    if (idx !== this.lastShotIdx) {
      this.lastShotIdx = idx;
      this.shotsList.querySelectorAll('.shot-item').forEach((el, i) => el.classList.toggle('active', i === idx));
      const active = this.shotsList.children[idx];
      if (active && this.player.playing) active.scrollIntoView({ block: 'nearest' });
      if (this.scope === 'shot' && this.selection?.type !== 'shot') this.panel.renderComposer();
    }
  }

  renderRates() {
    this.rates.replaceChildren(...[0.5, 1, 1.5, 2].map((r) => h('button', { class: this.player.rate === r ? 'on' : '', onclick: () => { this.player.setRate(r); this.renderRates(); } }, `${r}×`)));
  }

  /* ------------------------------------------------------------ model helpers */

  duration() {
    const shotsEnd = this.timeline.shots.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
    return Math.max(shotsEnd, this.audio?.voiceDuration || 0, 1);
  }

  locked() {
    return this.running;
  }

  listOf(type) {
    return { shot: this.timeline.shots, card: this.timeline.cards, cue: this.timeline.cues, ambience: this.timeline.ambience, narration: this.timeline.narration }[type];
  }

  itemOf(type, index) {
    return this.listOf(type)?.[index] || null;
  }

  currentShotIndex() {
    if (this.selection?.type === 'shot') return this.selection.index;
    return this.renderer.shotIndexAt(this.player.time);
  }

  /* ------------------------------------------------------------ selection & scope */

  select(sel, { inspect = false } = {}) {
    this.selection = sel;
    if (sel?.type === 'shot' && this.scope === 'whole') this.scope = 'shot';
    if (sel && sel.type !== 'shot') this.scope = 'selection';
    this.timelineUI.updateSelection();
    this.shotsList.querySelectorAll('.shot-item').forEach((el, i) => el.classList.toggle('selected', sel?.type === 'shot' && sel.index === i));
    if (inspect) this.panel.setTab('inspect');
    else if (this.panel.tab === 'inspect') this.panel.render();
    else this.panel.renderComposer();
  }

  setRange(r) {
    this.range = r;
    this.player.range = r;
    if (r) this.scope = 'selection';
    this.timelineUI.updateRange();
    this.panel.renderComposer();
  }

  setScope(s) {
    this.scope = s;
    this.panel.renderComposer();
  }

  clearContext() {
    this.point = null;
    this.marker.classList.add('hidden');
    this.stageBadge.classList.add('hidden');
    this.setPendingSnapshot(null);
    this.setRange(null);
    this.selection = null;
    this.scope = 'whole';
    this.timelineUI.render();
    this.panel.render();
  }

  contextLabel() {
    if (this.scope === 'shot') {
      const i = this.currentShotIndex();
      const s = this.timeline.shots[i];
      return s ? `Plano ${i + 1}: ${s.title}` : null;
    }
    if (this.scope === 'selection') {
      const parts = [];
      if (this.point) parts.push(`Punto (${this.point.x}, ${this.point.y}) en ${fmtTime(this.point.time, true)}`);
      if (this.range) parts.push(`Rango ${fmtTime(this.range[0], true)} – ${fmtTime(this.range[1], true)}`);
      const item = this.selectionItemLabel();
      if (item) parts.push(item);
      if (!parts.length && this.pendingSnapshot) parts.push(`Fotograma en ${fmtTime(this.player.time, true)}`);
      return parts.join(' · ') || 'Haz clic en el preview o Shift+arrastra en la línea de tiempo';
    }
    return null;
  }

  selectionItemLabel() {
    const s = this.selection;
    if (!s || s.type === 'shot') return '';
    const it = this.itemOf(s.type, s.index);
    if (!it) return '';
    if (s.type === 'card') return `Tarjeta "${it.text}" (${fmtTime(it.start, true)})`;
    if (s.type === 'cue') return `Cue "${it.label || it.sfx}" (${fmtTime(it.t, true)})`;
    if (s.type === 'ambience') return `Ambiente ${it.type} ${fmtTime(it.start)}–${fmtTime(it.end)}`;
    if (s.type === 'narration') return `Narración "${it.text.slice(0, 40)}…"`;
    return '';
  }

  pickPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    this.point = { x: Math.round(fx * this.look.width), y: Math.round(fy * this.look.height), time: this.player.time };
    this.marker.style.left = `${fx * 100}%`;
    this.marker.style.top = `${fy * 100}%`;
    this.marker.classList.remove('hidden');
    this.stageBadge.textContent = `x ${this.point.x} · y ${this.point.y} · ${fmtTime(this.point.time, true)}`;
    this.stageBadge.classList.remove('hidden');
    this.scope = 'selection';
    this.captureFrame().then((b) => this.setPendingSnapshot(b));
    this.panel.setTab('chat');
    this.panel.textarea.focus();
  }

  async attachFrame() {
    this.setPendingSnapshot(await this.captureFrame());
    if (this.scope === 'whole') this.scope = 'selection';
    this.panel.setTab('chat');
    toast('Fotograma adjuntado para Claude', 'ok');
  }

  setPendingSnapshot(blob) {
    if (this.pendingSnapshotUrl) URL.revokeObjectURL(this.pendingSnapshotUrl);
    this.pendingSnapshot = blob;
    this.pendingSnapshotUrl = blob ? URL.createObjectURL(blob) : null;
    this.panel.renderComposer();
  }

  captureFrame() {
    this.player.render();
    return new Promise((r) => this.canvas.toBlob(r, 'image/png'));
  }

  /* ------------------------------------------------------------ editing */

  commit(message) {
    this.timeline.shots.sort((a, b) => a.start - b.start);
    const now = JSON.stringify(this.timeline);
    if (now === this.snapshot) return;
    this.undoStack.push(this.snapshot);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.snapshot = now;
    this.afterChange(message);
  }

  afterChange(message) {
    this.renderer.setTimeline(this.timeline);
    this.renderer.loadScenes().then(() => this.player.render());
    this.saveState = 'dirty';
    this.renderTop();
    this.renderShots();
    this.timelineUI.render();
    if (this.panel.tab === 'inspect') this.panel.render();
    this.player.render();
    this.saveDebounced(message);
  }

  async save(message) {
    if (this.running) return;
    this.saveState = 'saving';
    this.renderTop();
    try {
      await api.saveTimeline(this.id, this.timeline, message);
      this.saveState = 'saved';
    } catch (err) {
      this.saveState = 'dirty';
      toast('No se pudo guardar: ' + err.message, 'error');
    }
    this.renderTop();
  }

  undo() {
    if (!this.undoStack.length || this.running) return;
    this.redoStack.push(this.snapshot);
    this.snapshot = this.undoStack.pop();
    this.timeline = JSON.parse(this.snapshot);
    this.fixSelection();
    this.afterChange('Deshacer');
  }

  redo() {
    if (!this.redoStack.length || this.running) return;
    this.undoStack.push(this.snapshot);
    this.snapshot = this.redoStack.pop();
    this.timeline = JSON.parse(this.snapshot);
    this.fixSelection();
    this.afterChange('Rehacer');
  }

  fixSelection() {
    if (this.selection && !this.itemOf(this.selection.type, this.selection.index)) this.selection = null;
  }

  updateItem(type, index, patch, message) {
    if (this.locked()) return toast('Espera a que Claude termine', 'error');
    const it = this.itemOf(type, index);
    if (!it) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete it[k];
      else it[k] = v;
    }
    this.commit(message || 'Propiedades editadas');
  }

  setShotDuration(index, d) {
    if (this.locked()) return;
    const shots = this.timeline.shots;
    const s = shots[index];
    const nd = Math.max(0.2, r2(d));
    const delta = nd - s.duration;
    s.duration = nd;
    for (let i = index + 1; i < shots.length; i++) shots[i].start = r2(shots[i].start + delta);
    this.commit('Duración del plano');
  }

  /** Live edit while dragging in the timeline (committed on pointerup). */
  dragEdit(type, index, orig, mode, dt, noRipple) {
    const it = this.itemOf(type, index);
    if (!it) return;
    if (type === 'shot' && mode === 'resize') {
      const shots = this.timeline.shots;
      const nd = Math.max(0.2, r2(orig.duration + dt));
      const delta = nd - it.duration;
      it.duration = nd;
      if (!noRipple) for (let i = index + 1; i < shots.length; i++) shots[i].start = r2(shots[i].start + delta);
    } else if (type === 'cue') {
      it.t = Math.max(0, r2(orig.t + dt));
    } else if (type === 'card') {
      if (mode === 'resize') it.duration = Math.max(0.2, r2((orig.duration ?? 2.5) + dt));
      else it.start = Math.max(0, r2(orig.start + dt));
    } else if (type === 'ambience' || type === 'narration') {
      if (mode === 'resize') it.end = Math.max(orig.start + 0.2, r2(orig.end + dt));
      else {
        const len = orig.end - orig.start;
        it.start = Math.max(0, r2(orig.start + dt));
        it.end = r2(it.start + len);
      }
    }
    this.renderer.setTimeline(this.timeline);
    this.timelineUI.render();
    this.player.render();
  }

  nextShotId() {
    const n = this.timeline.shots.reduce((m, s) => Math.max(m, Number(String(s.id).replace(/\D/g, '')) || 0), 0);
    return `s${n + 1}`;
  }

  addShot() {
    if (this.locked()) return;
    const shots = this.timeline.shots;
    const last = shots[shots.length - 1];
    const start = last ? r2(last.start + last.duration) : 0;
    shots.push({ id: this.nextShotId(), title: 'Nuevo plano', start, duration: 3, scene: last?.scene || this.project.scenes[0] || '', params: { text: 'NUEVO PLANO' }, transition: 'cut' });
    this.commit('Plano añadido');
    this.select({ type: 'shot', index: shots.length - 1 }, { inspect: true });
    this.player.seek(start + 0.01);
  }

  splitShot(index) {
    if (this.locked()) return;
    const shots = this.timeline.shots;
    const i = index ?? this.renderer.shotIndexAt(this.player.time);
    const s = shots[i];
    const t = this.player.time;
    if (!s || t <= s.start + 0.1 || t >= s.start + s.duration - 0.1) return toast('Coloca el cabezal dentro del plano para dividirlo', 'error');
    const b = clone(s);
    b.id = this.nextShotId();
    b.start = r2(t);
    b.duration = r2(s.start + s.duration - t);
    b.transition = 'cut';
    s.duration = r2(t - s.start);
    shots.splice(i + 1, 0, b);
    this.commit('Plano dividido');
  }

  duplicateShot(index) {
    if (this.locked()) return;
    const shots = this.timeline.shots;
    const s = shots[index];
    const b = clone(s);
    b.id = this.nextShotId();
    b.start = r2(s.start + s.duration);
    for (let i = index + 1; i < shots.length; i++) shots[i].start = r2(shots[i].start + s.duration);
    shots.splice(index + 1, 0, b);
    this.commit('Plano duplicado');
  }

  async deleteSelected() {
    const sel = this.selection;
    if (!sel || this.locked()) return;
    const list = this.listOf(sel.type);
    if (sel.type === 'shot') {
      const s = list[sel.index];
      if (!(await confirmDialog('Eliminar plano', `¿Eliminar el plano ${sel.index + 1} "${s.title}"? Los siguientes se desplazan.`, { okLabel: 'Eliminar', danger: true }))) return;
      for (let i = sel.index + 1; i < list.length; i++) list[i].start = r2(list[i].start - s.duration);
    }
    list.splice(sel.index, 1);
    this.selection = null;
    this.commit('Elemento eliminado');
  }

  addItem(kind) {
    if (this.locked()) return;
    const t = r2(this.player.time);
    const tl = this.timeline;
    if (kind === 'cards') tl.cards.push({ id: `c${Date.now().toString(36)}`, start: t, duration: 2.5, text: 'TÍTULO', sub: '', position: 'top-left' });
    if (kind === 'cues') tl.cues.push({ t, label: 'cue', sfx: 'blip' });
    if (kind === 'ambience') tl.ambience.push({ start: t, end: r2(Math.min(this.duration(), t + 10)), type: 'pad', db: -33 });
    if (kind === 'narration') tl.narration.push({ start: t, end: r2(t + 3), text: 'Texto hablado' });
    const type = { cards: 'card', cues: 'cue', ambience: 'ambience', narration: 'narration' }[kind];
    this.commit('Elemento añadido');
    this.select({ type, index: this.listOf(type).length - 1 }, { inspect: true });
  }

  fitShotsToVoice() {
    const voice = this.audio.voiceDuration;
    const shots = this.timeline.shots;
    const end = shots.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
    if (!voice || !end) return;
    const k = voice / end;
    for (const s of shots) {
      s.start = r2(s.start * k);
      s.duration = r2(s.duration * k);
    }
    for (const n of this.timeline.narration) {
      n.start = r2(n.start * k);
      n.end = r2(n.end * k);
    }
    this.commit('Planos ajustados a la voz');
  }

  fixError(shot) {
    const err = this.renderer.errors.get(shot.id);
    const i = this.timeline.shots.indexOf(shot);
    this.scope = 'shot';
    this.selection = { type: 'shot', index: i };
    this.runClaude({ message: `La escena ${shot.scene} da este error en el preview: "${err}". Arréglalo sin cambiar lo que se ve.` });
  }

  /* ------------------------------------------------------------ transport */

  jumpShot(dir) {
    const shots = this.timeline.shots;
    const i = this.renderer.shotIndexAt(this.player.time);
    const s = shots[i];
    let target;
    if (dir < 0) target = s && this.player.time - s.start > 0.3 ? s.start : shots[Math.max(0, i - 1)]?.start;
    else target = shots[Math.min(shots.length - 1, i + 1)]?.start;
    if (target != null) this.player.seek(target + 0.001);
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.muteBtn.replaceChildren(icon(this.audio.muted ? 'mute' : 'volume', 17));
  }

  toggleLoop() {
    this.player.loop = !this.player.loop;
    this.loopBtn.classList.toggle('on', this.player.loop);
  }

  onKey(e) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.backdrop')) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (k === ' ') { e.preventDefault(); this.player.toggle(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? this.player.seek(this.player.time - 1) : this.player.step(-1); }
    else if (k === 'ArrowRight') { e.preventDefault(); e.shiftKey ? this.player.seek(this.player.time + 1) : this.player.step(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); this.jumpShot(-1); }
    else if (k === 'ArrowDown') { e.preventDefault(); this.jumpShot(1); }
    else if (k === 'Home') this.player.seek(0);
    else if (k === 'End') this.player.seek(this.duration());
    else if ((k === 'Delete' || k === 'Backspace') && this.selection) { e.preventDefault(); this.deleteSelected(); }
    else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if (k === 'Escape') this.clearContext();
    else if (!mod && k.toLowerCase() === 'l') this.toggleLoop();
    else if (!mod && k.toLowerCase() === 'm') this.toggleMute();
    else if (!mod && k.toLowerCase() === 's') this.splitShot();
    else if (!mod && (k === '+' || k === '=')) this.timelineUI.zoom(1.4);
    else if (!mod && k === '-') this.timelineUI.zoom(1 / 1.4);
  }

  /* ------------------------------------------------------------ project ops */

  async rename() {
    const title = await promptDialog('Renombrar proyecto', 'Título', this.project.meta.title);
    if (!title?.trim()) return;
    this.project.meta = await api.patchProject(this.id, { title: title.trim() });
    this.renderTop();
  }

  async chooseLook() {
    const { styles, palettes } = await api.styles();
    let chosen = { style: this.style.id, look: this.look.id };
    const adapt = h('input', { type: 'checkbox', checked: app.status?.claude?.ok });
    const list = h('div', { class: 'col' });
    const draw = () =>
      list.replaceChildren(
        ...styles.map((s) =>
          h('div', { class: 'col', style: { gap: '6px' } },
            h('b', {}, s.name),
            h('div', { class: 'row wrap' },
              s.looks.map((l) => {
                const colors = Array.isArray(l.palette) ? l.palette : palettes[l.palette] || [];
                const on = chosen.style === s.id && chosen.look === l.id;
                return h('button', { class: `btn sm ${on ? 'primary' : ''}`, title: l.hint, onclick: () => { chosen = { style: s.id, look: l.id }; draw(); } },
                  h('span', { class: 'swatches' }, colors.slice(0, 6).map((c) => h('i', { style: { background: c, width: '9px', height: '9px' } }))),
                  l.name);
              })))
        )
      );
    draw();
    const m = modal('Estilo y look', [list, h('label', { class: 'switch' }, adapt, h('span', {}, 'Pedir a Claude que adapte las escenas al nuevo estilo'))], {
      width: 640,
      footer: [
        btn('Cancelar', { variant: 'ghost', onClick: () => m.close() }),
        btn('Aplicar', {
          variant: 'primary',
          onClick: async () => {
            m.close();
            if (chosen.style === this.style.id && chosen.look === this.look.id) return;
            const prevStyle = this.style.id;
            await api.patchProject(this.id, chosen);
            await this.reload();
            if (adapt.checked && !this.running) {
              this.scope = 'whole';
              this.runClaude({ message: `He cambiado el look a "${this.style.name} · ${this.look.name}" (${this.look.width}×${this.look.height}).${prevStyle !== this.style.id ? ' El estilo es distinto al anterior: rehaz las escenas siguiendo las nuevas reglas de CLAUDE.md.' : ''} Adapta todas las escenas a la nueva resolución y paleta para que nada quede cortado ni ilegible.` });
            }
          },
        }),
      ],
    });
  }

  async reload({ quiet = false } = {}) {
    const p = await api.project(this.id);
    const lookChanged = p.look.id !== this.look.id || p.style.id !== this.style.id || p.look.width !== this.look.width;
    const voiceChanged = p.meta.voiceover !== this.project.meta.voiceover || p.meta.updated !== this.project.meta.updated;
    this.project = p;
    this.timeline = p.timeline;
    this.style = p.style;
    if (lookChanged) {
      this.look = p.look;
      this.renderer.setLook(p.look);
      this.sizeCanvas();
    }
    this.snapshot = JSON.stringify(this.timeline);
    if (!quiet) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.fixSelection();
    this.renderer.setTimeline(this.timeline);
    this.player.subtitles = Boolean(this.timeline.subtitles);
    await this.renderer.loadScenes(true);
    if (voiceChanged && p.meta.voiceover) {
      await this.audio.loadVoiceover(api.fileUrl(this.id, p.meta.voiceover) + `?t=${p.meta.updated}`).catch(() => {});
    }
    this.saveState = 'saved';
    this.player.render();
    this.renderAll();
  }

  async reloadScenes() {
    await this.renderer.loadScenes(true);
    this.player.render();
    this.renderShots();
    this.timelineUI.render();
  }

  async saveThumb() {
    try {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d');
      const s = this.timeline.shots[Math.min(1, this.timeline.shots.length - 1)];
      if (!s) return;
      this.renderer.drawFrame(s.start + Math.min(s.duration * 0.6, 2.5));
      g.imageSmoothingEnabled = !this.look.pixel;
      g.drawImage(this.renderer.canvas, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await api.thumb(this.id, blob);
      this.player.render();
    } catch {
      /* non critical */
    }
  }

  /* ------------------------------------------------------------ Claude */

  async runClaude({ message = '', build = false }) {
    if (this.running) return;
    if (app.status && !app.status.claude?.ok) {
      toast('Claude Code no está disponible. Revisa Ajustes.', 'error');
      return;
    }
    if (this.saveState !== 'saved') await this.save('Edición en la línea de tiempo');
    this.player.pause();
    const scope = build ? 'whole' : this.scope;
    const body = { message, build, scope, contextLabel: build ? '' : this.contextLabel() || '' };

    if (!build && scope !== 'whole') {
      const i = this.selection?.type === 'shot' ? this.selection.index : this.renderer.shotIndexAt(this.point?.time ?? this.range?.[0] ?? this.player.time);
      const s = this.timeline.shots[i];
      if (s) {
        const narration = this.timeline.narration.filter((n) => n.end > s.start && n.start < s.start + s.duration).map((n) => n.text).join(' ');
        body.shot = { index: i, id: s.id, scene: s.scene, start: s.start, duration: s.duration, narration };
      }
      if (scope === 'selection') {
        body.selection = { range: this.range, point: this.point, time: this.point?.time ?? this.player.time, item: this.selectionItemLabel() };
      }
      try {
        const blob = this.pendingSnapshot || (await this.captureFrame());
        body.snapshot = (await api.snapshot(this.id, blob)).path;
      } catch {
        /* snapshot is optional */
      }
    }

    this.running = true;
    this.renderTop();
    this.panel.startLive({ role: 'user', text: build ? 'Construye el vídeo completo' : message, context: body.contextLabel, time: Date.now() });
    let editedSinceReload = false;
    try {
      await api.runClaude(this.id, body, (ev) => {
        this.panel.onEvent(ev);
        if (ev.kind === 'tool' && /^(Edit|MultiEdit|Write)$/.test(ev.name)) editedSinceReload = true;
        else if (editedSinceReload && (ev.kind === 'tool' || ev.kind === 'text')) {
          // the previous edit has been applied: hot-reload the preview
          editedSinceReload = false;
          this.reloadDebounced();
        }
      });
    } catch (err) {
      this.panel.onEvent({ kind: 'error', text: err.message });
      toast(err.message, 'error');
    } finally {
      this.running = false;
      await this.reload({ quiet: true }).catch(() => {});
      await this.panel.endLive();
      this.setPendingSnapshot(null);
      this.renderTop();
      this.saveThumb();
      refreshStatus();
    }
  }
}

function shortcutsHelp() {
  const rows = [
    ['Espacio', 'Reproducir / pausar'],
    ['← / →', 'Fotograma anterior / siguiente (Shift: 1 s)'],
    ['↑ / ↓', 'Plano anterior / siguiente'],
    ['S', 'Dividir plano en el cabezal'],
    ['Supr', 'Eliminar elemento seleccionado'],
    ['Ctrl Z / Ctrl Shift Z', 'Deshacer / rehacer'],
    ['L / M', 'Repetir / silenciar'],
    ['+ / −', 'Zoom de la línea de tiempo'],
    ['Shift + arrastrar', 'Seleccionar rango (para Claude, bucle y exportación)'],
    ['Alt + arrastrar borde', 'Cambiar duración sin desplazar los siguientes planos'],
    ['Clic en el preview', 'Marcar un punto para Claude'],
    ['Ctrl Enter', 'Enviar a Claude'],
    ['Esc', 'Limpiar selección'],
  ];
  modal('Atajos de teclado', h('div', { class: 'col', style: { gap: '8px' } }, rows.map(([k, d]) => h('div', { class: 'row' }, h('kbd', { style: { minWidth: '150px', textAlign: 'center' } }, k), h('span', { class: 'muted' }, d)))), { width: 560 });
}
