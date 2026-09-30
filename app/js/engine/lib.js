// Drawing & animation helpers handed to every scene as `ctx.lib`.
// Keep this in sync with the "lib" section of server/scaffold.js (CLAUDE.md).

export function createLib(look) {
  const palette = look.colors?.length ? look.colors : ['#000000', '#ffffff'];
  const fonts = {
    display: look.fonts?.display || 'Arial Black, sans-serif',
    body: look.fonts?.body || 'Arial, sans-serif',
  };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outBack: (t) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    outBounce: (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
  };

  function rng(seed = 1) {
    let a = (Number(seed) * 2654435761) >>> 0 || 1;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(i, seed = 0) {
    let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function noise(x, seed = 0) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(hash(i, seed), hash(i + 1, seed), u);
  }

  /* ---------- color ---------- */
  function parse(c) {
    if (Array.isArray(c)) return c;
    c = String(c).trim();
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    return [0, 0, 0, 1];
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const pal = (i) => palette[((Math.round(i) % palette.length) + palette.length) % palette.length];
  // nearest palette colour to any hex: lets scenes work with every palette
  const nearCache = new Map();
  const palRgb = palette.map((c) => parse(c));
  const near = (c) => {
    if (nearCache.has(c)) return nearCache.get(c);
    const [r, g, b] = parse(c);
    let best = palette[0], bd = Infinity;
    palRgb.forEach((p, i) => {
      const d = 2 * (r - p[0]) ** 2 + 4 * (g - p[1]) ** 2 + 3 * (b - p[2]) ** 2;
      if (d < bd) { bd = d; best = palette[i]; }
    });
    nearCache.set(c, best);
    return best;
  };
  const mix = (c1, c2, t) => {
    const a = parse(c1), b = parse(c2);
    return toHex(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
  };
  const shade = (c, amt) => (amt >= 0 ? mix(c, '#ffffff', amt) : mix(c, '#000000', -amt));
  const alpha = (c, a) => {
    const p = parse(c);
    return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
  };

  /* ---------- shapes ---------- */
  const clear = (g, c = '#000') => {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = c;
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.restore();
  };
  const rect = (g, x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const rrect = (g, x, y, w, h, r, c) => {
    g.fillStyle = c;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    else g.rect(x, y, w, h);
    g.fill();
  };
  const circle = (g, x, y, r, c) => {
    if (r <= 0) return;
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const ring = (g, x, y, r, width, c) => {
    if (r <= 0) return;
    g.strokeStyle = c;
    g.lineWidth = width;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
  };
  const line = (g, x1, y1, x2, y2, c, w = 1) => {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const poly = (g, pts, c) => {
    if (!pts.length) return;
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
  };
  const vgrad = (g, x, y, w, h, stops) => {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  };

  /* ---------- world ---------- */
  const sky = (g, x, y, w, h, colors) => {
    // banded gradient: reads as pixel art even before quantization
    const bands = Math.max(3, Math.round(h / 10));
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const seg = t * (colors.length - 1);
      const k = Math.min(colors.length - 2, Math.floor(seg));
      g.fillStyle = mix(colors[k], colors[k + 1], seg - k);
      const y0 = Math.round(y + (h * i) / bands);
      g.fillRect(x, y0, w, Math.ceil(h / bands) + 1);
    }
  };
  const stars = (g, { seed = 1, count = 80, W, H, t = 0, color = '#fff' }) => {
    const r = rng(seed);
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(r() * W), y = Math.floor(r() * H);
      const tw = Math.sin(t * (1 + r() * 3) + i) > 0.6 ? 0.35 : 1;
      g.globalAlpha = tw * (0.5 + r() * 0.5);
      g.fillRect(x, y, 1, 1);
    }
    g.globalAlpha = 1;
  };
  const grid3d = (g, { W, H, horizon, color = '#29adff', spacing = 24, speed = 0, t = 0, lines = 24 }) => {
    const depth = H - horizon;
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    // horizontal lines receding (perspective spacing)
    const off = ((t * speed) % spacing) / spacing;
    for (let i = 0; i < 40; i++) {
      const z = (i + 1 - off) * 0.5;
      const y = Math.round(horizon + depth / z / 2);
      if (y > H || y < horizon) continue;
      g.moveTo(0, y + 0.5);
      g.lineTo(W, y + 0.5);
    }
    // vertical lines converging to the vanishing point
    const cx = W / 2;
    for (let i = -lines; i <= lines; i++) {
      const bx = cx + i * spacing * 3;
      g.moveTo(cx + i * spacing * 0.2, horizon);
      g.lineTo(bx, H);
    }
    g.stroke();
  };
  const isoBox = (g, x, y, w, d, h, { top, left, right }) => {
    // (x, y) = bottom front corner on the ground; classic 2:1 isometric
    const hw = w / 2, hd = d / 2;
    poly(g, [[x, y], [x - hw, y - hw / 2], [x - hw, y - hw / 2 - h], [x, y - h]], left);
    poly(g, [[x, y], [x + hd, y - hd / 2], [x + hd, y - hd / 2 - h], [x, y - h]], right);
    poly(g, [[x, y - h], [x - hw, y - hw / 2 - h], [x - hw + hd, y - hw / 2 - hd / 2 - h], [x + hd, y - hd / 2 - h]], top);
  };
  const particles = (g, { seed = 1, count = 30, t = 0, x = 0, y = 0, w = 100, h = 100, color = '#fff', size = 1, speed = 10, gravity = 0 }) => {
    const r = rng(seed);
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const px = x + ((r() * w + Math.sin(t * 0.7 + i) * 6) % w);
      const vy = speed * (0.4 + r());
      let py = y + ((((r() * h - t * vy + 0.5 * gravity * t * t) % h) + h) % h);
      const s = Math.max(1, Math.round(size * (0.6 + r() * 0.8)));
      g.fillRect(Math.round(px), Math.round(py), s, s);
    }
  };
  const sprite = (g, rows, x, y, scale = 1, colors = {}) => {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        const c = colors[ch];
        if (!c || ch === '.' || ch === ' ') continue;
        g.fillStyle = c;
        g.fillRect(Math.round(x + i * scale), Math.round(y + j * scale), scale, scale);
      }
    }
  };

  /* ---------- paper ---------- */
  const paper = (g, x, y, w, h, { color = '#f3e9d2', seed = 1, lines = 0 } = {}) => {
    rect(g, x, y, w, h, color);
    const r = rng(seed);
    for (let i = 0; i < (w * h) / 900; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(90,60,30,0.05)' : 'rgba(255,255,255,0.06)';
      g.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1);
    }
    const edge = g.createLinearGradient(x, y, x + w, y + h);
    edge.addColorStop(0, 'rgba(120,80,40,0.10)');
    edge.addColorStop(0.5, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(120,80,40,0.14)');
    g.fillStyle = edge;
    g.fillRect(x, y, w, h);
    for (let i = 0; i < lines; i++) line(g, x + w * 0.08, y + h * (0.2 + i * 0.06), x + w * 0.92, y + h * (0.2 + i * 0.06), 'rgba(60,40,20,0.15)', 1);
  };
  const highlight = (g, x, y, w, h, p, color = 'rgba(255,220,0,0.55)') => {
    if (p <= 0) return;
    g.save();
    g.globalCompositeOperation = 'multiply';
    rect(g, x, y, w * clamp(p), h, color);
    g.restore();
  };
  const underline = (g, x1, y, x2, p, color = '#d63a2f', width = 3) => {
    if (p <= 0) return;
    line(g, x1, y, lerp(x1, x2, clamp(p)), y, color, width);
  };

  /* ---------- text ---------- */
  function font(o) {
    return `${o.weight || 'normal'} ${Math.max(1, Math.round(o.size || 16))}px ${o.font || fonts.body}`;
  }
  function text(g, str, x, y, o = {}) {
    str = String(str ?? '');
    g.save();
    g.font = font(o);
    g.textAlign = o.align || 'left';
    g.textBaseline = o.baseline || 'top';
    if ('letterSpacing' in g && o.letterSpacing) g.letterSpacing = `${o.letterSpacing}px`;
    const w = g.measureText(str).width;
    if (o.shadow) {
      g.fillStyle = o.shadow === true ? 'rgba(0,0,0,0.6)' : o.shadow;
      const d = Math.max(1, Math.round((o.size || 16) / 14));
      g.fillText(str, x + d, y + d);
    }
    if (o.outline) {
      g.strokeStyle = o.outlineColor || '#000';
      g.lineWidth = o.outline * 2;
      g.lineJoin = 'round';
      g.strokeText(str, x, y);
    }
    g.fillStyle = o.color || '#fff';
    g.fillText(str, x, y);
    g.restore();
    return w;
  }
  function wrap(g, str, maxWidth, o = {}) {
    g.save();
    g.font = font(o);
    const words = String(str ?? '').split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (g.measureText(test).width > maxWidth && cur) {
        out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
    g.restore();
    return out;
  }
  function textBlock(g, str, x, y, o = {}) {
    const lines = wrap(g, str, o.maxWidth || 1e9, o);
    const lh = (o.size || 16) * (o.lineHeight || 1.15);
    lines.forEach((l, i) => text(g, l, x, y + i * lh, o));
    return lines.length * lh;
  }
  const typewriter = (str, t, cps = 24) => String(str ?? '').slice(0, Math.max(0, Math.floor(t * cps)));

  /* ---------- ui ---------- */
  const panel = (g, x, y, w, h, { fill = 'rgba(0,0,0,0.6)', border = null, radius = 0, shadow = false } = {}) => {
    if (shadow) rrect(g, x + 3, y + 4, w, h, radius, 'rgba(0,0,0,0.35)');
    rrect(g, x, y, w, h, radius, fill);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 1;
      g.beginPath();
      if (g.roundRect && radius) g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
      else g.rect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.stroke();
    }
  };
  const bar = (g, x, y, w, h, value, { fill = '#e43b44', back = 'rgba(255,255,255,0.15)', border = null } = {}) => {
    rect(g, x, y, w, h, back);
    rect(g, x, y, Math.round(w * clamp(value)), h, fill);
    if (border) {
      g.strokeStyle = border;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  };

  /* ---------- camera / misc ---------- */
  const camera = (g, { W, H, x = 0, y = 0, zoom = 1, rot = 0 }, fn) => {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(rot);
    g.scale(zoom, zoom);
    g.translate(-W / 2 - x, -H / 2 - y);
    try {
      fn();
    } finally {
      g.restore();
    }
  };
  const shake = (t, amount = 2, seed = 1) => ({
    x: (noise(t * 25, seed) - 0.5) * 2 * amount,
    y: (noise(t * 25, seed + 9) - 0.5) * 2 * amount,
  });
  const win = (t, start, dur) => clamp((t - start) / Math.max(1e-6, dur));
  const map = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a || 1e-6));
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a || 1e-6));
    return t * t * (3 - 2 * t);
  };
  const counter = (from, to, p, decimals = 0) => {
    const v = lerp(from, to, clamp(p));
    return v.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  return {
    palette, fonts, clamp, lerp, ease, rng, noise, hash, win, map, smooth, counter, shake,
    pal, near, mix, shade, alpha, parse,
    clear, rect, rrect, circle, ring, line, poly, vgrad,
    sky, stars, grid3d, isoBox, particles, sprite,
    paper, highlight, underline,
    text, wrap, textBlock, typewriter,
    panel, bar, camera,
  };
}
