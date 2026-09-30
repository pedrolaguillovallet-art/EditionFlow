import { h, icon, fmtTime } from '../ui.js';

const TRACKS = [
  { key: 'shots', label: 'Planos', icon: 'editor' },
  { key: 'narration', label: 'Narración', icon: 'mic' },
  { key: 'cues', label: 'Cues', icon: 'anchor' },
  { key: 'audio', label: 'Audio', icon: 'wave' },
  { key: 'cards', label: 'Tarjetas', icon: 'diamond' },
  { key: 'ambience', label: 'Ambiente', icon: 'wind' },
];

/**
 * Timeline UI. Click to select · drag to scrub (with sound) · Shift+drag for a range ·
 * Ctrl+wheel to zoom · drag block edges to change durations.
 */
export class Timeline {
  constructor(ed) {
    this.ed = ed;
    this.pps = 12; // pixels per second
    this.fitted = false;
    this.el = h('section', { class: 'timeline' });
    this.scroll = h('div', { class: 'tl-scroll' });
    this.canvas = h('div', { class: 'tl-canvas' });
    this.playhead = h('div', { class: 'tl-playhead' });
    this.rangeEl = h('div', { class: 'tl-range hidden' });
    this.scroll.append(this.canvas);
    this.build();
    this.scroll.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => {
      if (!this.fitted && this.scroll.clientWidth > 0) {
        this.fit();
        this.fitted = true;
      }
    }).observe(this.scroll);
  }

  build() {
    const add = (kind, title) => h('button', { class: 'icon-btn', style: { width: '22px', height: '22px', marginLeft: 'auto', marginRight: '6px' }, title, onclick: () => this.ed.addItem(kind) }, icon('plus', 13));
    const labels = h(
      'div',
      { class: 'tl-labels' },
      TRACKS.map((t) =>
        h('div', { class: 'tl-label' }, icon(t.icon, 15), t.label, ['cards', 'cues', 'ambience', 'narration'].includes(t.key) ? add(t.key, `Añadir en el cabezal`) : null)
      )
    );
    this.el.append(
      h(
        'div',
        { class: 'tl-head' },
        h('b', {}, 'Línea de tiempo'),
        h('span', {}, 'Clic para seleccionar · arrastra para buscar (con sonido) · Shift+arrastrar para un rango · Ctrl+rueda para zoom'),
        h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn', title: 'Alejar', onclick: () => this.zoom(1 / 1.4) }, icon('zoomOut', 16)),
        h('button', { class: 'icon-btn', title: 'Acercar', onclick: () => this.zoom(1.4) }, icon('zoomIn', 16)),
        h('button', { class: 'icon-btn', title: 'Ajustar a la ventana', onclick: () => this.fit() }, icon('fit', 16))
      ),
      h('div', { class: 'tl-body' }, labels, this.scroll)
    );
  }

  get duration() {
    return Math.max(1, this.ed.duration());
  }

  fit() {
    const w = this.scroll.clientWidth - 30;
    if (w > 0) this.pps = Math.max(2, w / this.duration);
    this.render();
  }

  zoom(f, anchorX) {
    const old = this.pps;
    this.pps = Math.max(2, Math.min(600, this.pps * f));
    const ax = anchorX ?? this.scroll.clientWidth / 2;
    const t = (this.scroll.scrollLeft + ax) / old;
    this.render();
    this.scroll.scrollLeft = t * this.pps - ax;
  }

  onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = this.scroll.getBoundingClientRect();
      this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      this.scroll.scrollLeft += e.deltaY;
    }
  }

  x(t) {
    return t * this.pps;
  }

  timeAt(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(this.duration, (clientX - rect.left) / this.pps));
  }

  render() {
    const ed = this.ed;
    const tl = ed.timeline;
    const width = Math.ceil(this.x(this.duration)) + 40;
    this.canvas.style.width = width + 'px';

    // ruler
    const ruler = h('div', { class: 'tl-ruler' });
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * this.pps >= 70) || 600;
    for (let t = 0; t <= this.duration + 0.001; t += step) {
      ruler.append(h('span', { class: 'tick', style: { left: this.x(t) + 'px' } }, step < 1 ? fmtTime(t, true).replace(/0$/, '') : fmtTime(t)));
    }
    this.bindScrub(ruler);

    const sel = ed.selection;
    const isSel = (type, i) => sel && sel.type === type && sel.index === i;
    const tracks = {};
    for (const t of TRACKS) {
      tracks[t.key] = h('div', { class: 'tl-track', 'data-track': t.key });
      this.bindScrub(tracks[t.key]);
    }

    tl.shots.forEach((s, i) => {
      const err = ed.renderer.errors.has(s.id);
      const b = h('div', { class: `tl-block ${isSel('shot', i) ? 'sel' : ''} ${err ? 'err' : ''}`, style: { left: this.x(s.start) + 'px', width: Math.max(3, this.x(s.duration) - 2) + 'px' }, title: `${i + 1}. ${s.title}` }, `${i + 1} ${s.title || ''}`);
      this.bindBlock(b, 'shot', i, { resize: true });
      tracks.shots.append(b);
    });
    tl.narration.forEach((n, i) => {
      const b = h('div', { class: `tl-block nar ${isSel('narration', i) ? 'sel' : ''}`, style: { left: this.x(n.start) + 'px', width: Math.max(3, this.x(n.end - n.start) - 2) + 'px' }, title: n.text }, n.text);
      this.bindBlock(b, 'narration', i, { resize: true, move: true });
      tracks.narration.append(b);
    });
    tl.cues.forEach((c, i) => {
      const b = h('div', { class: `tl-cue ${isSel('cue', i) ? 'sel' : ''}`, style: { left: this.x(c.t) + 'px' }, title: `${c.label || 'cue'} · ${c.sfx || 'sin sonido'} · ${fmtTime(c.t, true)}` });
      this.bindBlock(b, 'cue', i, { move: true });
      tracks.cues.append(b);
    });
    tl.cards.forEach((c, i) => {
      const b = h('div', { class: `tl-block card ${isSel('card', i) ? 'sel' : ''}`, style: { left: this.x(c.start) + 'px', width: Math.max(8, this.x(c.duration || 2.5) - 2) + 'px' }, title: `${c.text}${c.sub ? ' — ' + c.sub : ''}` }, '◆ ' + (c.text || ''));
      this.bindBlock(b, 'card', i, { resize: true, move: true });
      tracks.cards.append(b);
    });
    tl.ambience.forEach((a, i) => {
      const b = h('div', { class: `tl-block amb ${a.type} ${isSel('ambience', i) ? 'sel' : ''}`, style: { left: this.x(a.start) + 'px', width: Math.max(3, this.x(a.end - a.start) - 2) + 'px' } }, `${a.type} ${a.db ?? -30} dB`);
      this.bindBlock(b, 'ambience', i, { resize: true, move: true });
      tracks.ambience.append(b);
    });

    // waveform
    const peaks = ed.audio.buffer ? ed.audio.peaks(Math.min(8000, Math.max(200, Math.round(this.x(ed.audio.voiceDuration) / 3)))) : null;
    if (peaks) {
      const wpx = Math.max(1, Math.round(this.x(ed.audio.voiceDuration)));
      const cw = Math.min(wpx, 16000);
      const c = h('canvas', { class: 'tl-wave', width: cw, height: 56, style: { width: wpx + 'px' } });
      const g = c.getContext('2d');
      g.fillStyle = '#7d8a86';
      const bw = cw / peaks.length;
      for (let i = 0; i < peaks.length; i++) {
        const v = Math.min(1, peaks[i] * 1.4) * 26;
        g.fillRect(i * bw, 28 - v, Math.max(1, bw - 0.6), v * 2 || 1);
      }
      tracks.audio.append(c);
    } else {
      tracks.audio.append(h('span', { class: 'tl-empty-hint' }, 'Sin voz en off · añádela en el inspector del proyecto'));
    }
    if (!tl.cards.length) tracks.cards.append(h('span', { class: 'tl-empty-hint' }, 'Tarjetas de texto en pantalla'));
    if (!tl.cues.length) tracks.cues.append(h('span', { class: 'tl-empty-hint' }, 'Marcadores y efectos de sonido'));

    this.canvas.replaceChildren(ruler, ...TRACKS.map((t) => tracks[t.key]), this.rangeEl, this.playhead);
    this.updateRange();
    this.updatePlayhead(ed.player?.time || 0);
  }

  updateSelection() {
    const sel = this.ed.selection;
    for (const el of this.canvas.querySelectorAll('[data-type]')) {
      el.classList.toggle('sel', Boolean(sel && sel.type === el.dataset.type && sel.index === Number(el.dataset.index)));
    }
  }

  updatePlayhead(t, follow = false) {
    const x = this.x(t);
    this.playhead.style.left = x + 'px';
    if (follow) {
      const sl = this.scroll.scrollLeft, w = this.scroll.clientWidth;
      if (x > sl + w - 40 || x < sl) this.scroll.scrollLeft = x - 60;
    }
  }

  updateRange() {
    const r = this.ed.range;
    this.rangeEl.classList.toggle('hidden', !r);
    if (r) {
      this.rangeEl.style.left = this.x(r[0]) + 'px';
      this.rangeEl.style.width = this.x(r[1] - r[0]) + 'px';
    }
  }

  bindScrub(el) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target !== el) return;
      const ed = this.ed;
      const t0 = this.timeAt(e.clientX);
      if (e.shiftKey) {
        const move = (ev) => {
          const t = this.timeAt(ev.clientX);
          ed.setRange([Math.min(t0, t), Math.max(t0, t)]);
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          const t = this.timeAt(ev.clientX);
          if (Math.abs(t - t0) < 0.05) ed.setRange(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return;
      }
      ed.select(null);
      ed.player.seek(t0, { scrub: true });
      let last = 0;
      const move = (ev) => {
        const now = performance.now();
        const scrub = now - last > 70;
        if (scrub) last = now;
        ed.player.seek(this.timeAt(ev.clientX), { scrub });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  bindBlock(el, type, index, { resize = false, move = false } = {}) {
    let grip = null;
    if (resize) {
      grip = h('div', { class: 'grip', title: 'Arrastra para cambiar la duración' });
      el.append(grip);
    }
    el.dataset.type = type;
    el.dataset.index = index;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const ed = this.ed;
      const item = ed.itemOf(type, index);
      if (!item) return;
      // manual double-click: the block may be re-rendered between clicks
      const key = `${type}:${index}`;
      const dbl = this.lastDown && this.lastDown.key === key && performance.now() - this.lastDown.at < 380;
      this.lastDown = { key, at: performance.now() };
      ed.select({ type, index }, { inspect: dbl });
      if (type === 'shot') ed.player.seek(item.start + 0.001);
      else if (type === 'cue') ed.player.seek(item.t);
      else ed.player.seek(item.start);
      if (ed.locked()) return;
      const mode = e.target === grip ? 'resize' : move ? 'move' : null;
      if (!mode) return;
      const startX = e.clientX;
      const orig = JSON.parse(JSON.stringify(item));
      let changed = false;
      const onMove = (ev) => {
        const dt = (ev.clientX - startX) / this.pps;
        if (Math.abs(ev.clientX - startX) < 3 && !changed) return;
        changed = true;
        ed.dragEdit(type, index, orig, mode, dt, ev.altKey);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (changed) ed.commit(mode === 'resize' ? 'Duración ajustada' : 'Elemento movido');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
}
