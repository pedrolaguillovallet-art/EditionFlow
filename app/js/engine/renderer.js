import { createLib } from './lib.js';
import { PostFX } from './post.js';

/**
 * Renders any instant of a timeline: scene -> cards -> transition -> post-FX (low-res),
 * then upscales to a target canvas and draws subtitles at full resolution.
 */
export class Renderer {
  constructor(projectId) {
    this.projectId = projectId;
    this.modules = new Map(); // path -> { mod, error }
    this.states = new Map(); // shot.id -> { state, setup: bool, mod }
    this.version = Date.now();
    this.timeline = { shots: [], cards: [], narration: [] };
    this.onError = null;
    this.errors = new Map(); // shot.id -> message
  }

  setLook(look) {
    this.look = look;
    this.W = look.width;
    this.H = look.height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.g.imageSmoothingEnabled = !look.pixel;
    this.lib = createLib(look);
    this.fx = new PostFX(look);
    this.states.clear();
  }

  setTimeline(tl) {
    this.timeline = tl;
    this.duration = tl.shots.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
  }

  async loadScenes(force = false) {
    if (force) {
      this.version = Date.now();
      this.modules.clear();
      this.states.clear();
    }
    const paths = [...new Set(this.timeline.shots.map((s) => s.scene).filter(Boolean))];
    await Promise.all(
      paths.map(async (p) => {
        if (this.modules.has(p)) return;
        try {
          const url = `/api/projects/${this.projectId}/files/${p.split('/').map(encodeURIComponent).join('/')}?v=${this.version}`;
          const mod = await import(url);
          const scene = mod.default || mod;
          if (!scene || typeof scene.draw !== 'function') throw new Error('La escena no exporta { draw(g, ctx) }');
          this.modules.set(p, { mod: scene });
        } catch (err) {
          this.modules.set(p, { error: cleanError(err) });
        }
      })
    );
  }

  shotIndexAt(time) {
    const shots = this.timeline.shots;
    for (let i = shots.length - 1; i >= 0; i--) if (time >= shots[i].start) return time < shots[i].start + shots[i].duration || i === shots.length - 1 ? i : -1;
    return shots.length ? 0 : -1;
  }

  /** Draw the low-res frame for `time` into this.canvas. */
  drawFrame(time) {
    const { g, W, H, lib } = this;
    const shots = this.timeline.shots;
    const idx = this.shotIndexAt(time);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (idx < 0) {
      lib.clear(g, '#000');
      return null;
    }
    const shot = shots[idx];
    const t = Math.max(0, time - shot.start);
    const entry = this.modules.get(shot.scene);
    let error = null;
    if (!entry) error = shot.scene ? `Cargando ${shot.scene}…` : 'Este plano no tiene escena';
    else if (entry.error) error = entry.error;
    else {
      let st = this.states.get(shot.id);
      if (!st || st.mod !== entry.mod) {
        st = { mod: entry.mod, state: {}, setup: false };
        this.states.set(shot.id, st);
      }
      const ctx = {
        t,
        p: Math.min(1, t / shot.duration),
        dur: shot.duration,
        time,
        W,
        H,
        lib,
        params: shot.params || {},
        palette: lib.palette,
        fonts: lib.fonts,
        look: this.look,
        shot,
        index: idx,
        state: st.state,
        rng: lib.rng(hashStr(shot.id)),
      };
      try {
        g.save();
        if (!st.setup) {
          st.setup = true;
          entry.mod.setup?.(ctx);
        }
        entry.mod.draw(g, ctx);
      } catch (err) {
        error = cleanError(err);
      } finally {
        g.restore();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    }
    if (error) {
      this.drawError(error, shot, idx);
      if (this.errors.get(shot.id) !== error) {
        this.errors.set(shot.id, error);
        this.onError?.(shot, error);
      }
    } else if (this.errors.has(shot.id)) {
      this.errors.delete(shot.id);
      this.onError?.(shot, null);
    }

    this.drawCards(time);
    this.drawTransition(shot, t);
    this.fx.apply(g, W, H, time);
    return { shot, index: idx, t };
  }

  drawError(msg, shot, idx) {
    const { g, W, H, lib } = this;
    lib.clear(g, '#2a0f14');
    for (let x = -H; x < W; x += 24) lib.line(g, x, H, x + H, 0, 'rgba(255,80,90,0.08)', 8);
    const s = Math.max(8, Math.round(H / 24));
    lib.text(g, `Plano ${idx + 1} · error en ${shot.scene || 'escena'}`, 16, 16, { size: s, color: '#ff8a90', weight: 'bold', font: 'monospace' });
    lib.textBlock(g, msg, 16, 16 + s * 1.8, { size: Math.round(s * 0.8), color: '#ffd9dc', font: 'monospace', maxWidth: W - 32 });
  }

  drawCards(time) {
    const { g, W, H, lib } = this;
    for (const c of this.timeline.cards || []) {
      const start = Number(c.start) || 0;
      const dur = Number(c.duration) || 2.5;
      if (time < start || time > start + dur) continue;
      const t = time - start;
      const kIn = lib.ease.outBack(lib.win(t, 0, 0.3));
      const kOut = 1 - lib.ease.inQuad(lib.win(t, dur - 0.25, 0.25));
      const k = Math.min(kIn, kOut);
      const size = Math.round(H * (c.size || (this.look.pixel ? 0.1 : 0.07)));
      const sub = Math.round(size * 0.45);
      const pos = c.position || 'top-left';
      let x = W * 0.06, y = H * 0.1, align = 'left';
      if (pos === 'center') { x = W / 2; y = H / 2 - size; align = 'center'; }
      if (pos === 'top') { x = W / 2; align = 'center'; }
      if (pos === 'bottom') { x = W / 2; y = H * 0.72; align = 'center'; }
      if (pos === 'lower-third') { y = H * 0.7; }
      const accent = c.color || lib.near(this.look.pixel ? '#feae34' : '#d63a2f');
      g.save();
      g.globalAlpha = Math.max(0, k);
      const dx = (1 - kIn) * (align === 'left' ? -W * 0.1 : 0);
      if (pos === 'lower-third') {
        g.font = `bold ${size}px ${lib.fonts.display}`;
        const w = Math.max(g.measureText(c.text || '').width, sub * 10) + size;
        lib.panel(g, x - size * 0.4 + dx, y - size * 0.25, w, size * 1.5 + (c.sub ? sub * 1.3 : 0), { fill: 'rgba(0,0,0,0.65)' });
        lib.rect(g, x - size * 0.4 + dx, y - size * 0.25, Math.max(2, size * 0.08), size * 1.5 + (c.sub ? sub * 1.3 : 0), accent);
      }
      if (this.look.pixel) {
        // chunky outlined arcade title
        lib.text(g, c.text || '', x + dx, y, { size, color: accent, font: lib.fonts.display, weight: 'bold', align, outline: Math.max(1, Math.round(size / 12)), outlineColor: '#000', shadow: true });
        if (c.sub) lib.text(g, c.sub, x + dx + (align === 'left' ? size * 0.05 : 0), y + size * 1.05, { size: sub, color: '#fff', font: lib.fonts.body, weight: 'bold', align, outline: Math.max(1, Math.round(sub / 8)), outlineColor: '#000' });
      } else if (pos !== 'lower-third') {
        // clean editorial label on a dark card
        g.font = `bold ${size}px ${lib.fonts.display}`;
        const tw = g.measureText(c.text || '').width;
        g.font = `600 ${sub}px ${lib.fonts.body}`;
        const sw = c.sub ? g.measureText(c.sub).width : 0;
        const pad = size * 0.35;
        const bw = Math.max(tw, sw) + pad * 2;
        const bh = size * 1.2 + (c.sub ? sub * 1.4 : 0) + pad * 0.6;
        const bx = align === 'center' ? x - bw / 2 : x - pad;
        lib.panel(g, bx + dx, y - pad * 0.5, bw, bh, { fill: 'rgba(16,16,16,0.86)', radius: Math.round(size * 0.18), shadow: true });
        lib.rect(g, bx + dx, y - pad * 0.5, Math.max(3, size * 0.07), bh, accent);
        lib.text(g, c.text || '', x + dx + (align === 'left' ? pad * 0.4 : 0), y, { size, color: '#ffffff', font: lib.fonts.display, weight: 'bold', align });
        if (c.sub) lib.text(g, c.sub, x + dx + (align === 'left' ? pad * 0.4 : 0), y + size * 1.15, { size: sub, color: accent, font: lib.fonts.body, weight: '600', align });
      } else {
        lib.text(g, c.text || '', x + dx, y, { size, color: '#ffffff', font: lib.fonts.display, weight: 'bold', align });
        if (c.sub) lib.text(g, c.sub, x + dx, y + size * 1.05, { size: sub, color: accent, font: lib.fonts.body, weight: '600', align });
      }
      g.restore();
    }
  }

  drawTransition(shot, t) {
    const { g, W, H } = this;
    const tr = shot.transition;
    if (tr === 'fade' && t < 0.4) {
      g.fillStyle = `rgba(0,0,0,${1 - t / 0.4})`;
      g.fillRect(0, 0, W, H);
    } else if (tr === 'flash' && t < 0.3) {
      g.fillStyle = `rgba(255,255,255,${1 - t / 0.3})`;
      g.fillRect(0, 0, W, H);
    } else if (tr === 'wipe' && t < 0.45) {
      const k = t / 0.45;
      g.fillStyle = '#000';
      g.fillRect(Math.round(W * k), 0, W, H);
    }
  }

  /** Render `time` and blit into an output 2D context of any size. */
  renderTo(out, time, { subtitles = false } = {}) {
    const info = this.drawFrame(time);
    const ow = out.canvas.width, oh = out.canvas.height;
    out.save();
    out.imageSmoothingEnabled = !this.look.pixel;
    out.imageSmoothingQuality = 'high';
    out.drawImage(this.canvas, 0, 0, ow, oh);
    out.restore();
    if (subtitles) this.drawSubtitle(out, time);
    return info;
  }

  drawSubtitle(out, time) {
    const seg = (this.timeline.narration || []).find((n) => time >= n.start && time < n.end);
    if (!seg?.text) return;
    const ow = out.canvas.width, oh = out.canvas.height;
    const size = Math.round(oh * 0.042);
    out.save();
    out.font = `600 ${size}px "Segoe UI", Arial, sans-serif`;
    out.textAlign = 'center';
    out.textBaseline = 'bottom';
    const lines = this.lib.wrap(out, seg.text, ow * 0.8, { size, weight: '600', font: '"Segoe UI", Arial, sans-serif' });
    const lh = size * 1.25;
    lines.slice(-2).forEach((l, i, arr) => {
      const y = oh - oh * 0.06 - (arr.length - 1 - i) * lh;
      const w = out.measureText(l).width;
      out.fillStyle = 'rgba(0,0,0,0.62)';
      out.fillRect(ow / 2 - w / 2 - size * 0.4, y - lh + size * 0.1, w + size * 0.8, lh);
      out.fillStyle = '#fff';
      out.fillText(l, ow / 2, y);
    });
    out.restore();
  }
}

function cleanError(err) {
  const msg = err?.message || String(err);
  return msg.replace(/https?:\/\/[^/]+\/api\/projects\/[^/]+\/files\//g, '').replace(/\?v=\d+/g, '');
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
