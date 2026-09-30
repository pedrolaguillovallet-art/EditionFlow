// Per-look post-processing on the low-resolution canvas:
// palette quantization + ordered dithering (pixel looks), grain / sepia / vignette / scanlines.

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

function hexToRgb(h) {
  const n = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class PostFX {
  constructor(look) {
    this.look = look;
    this.pixel = Boolean(look.pixel);
    this.post = look.post || {};
    this.colors = (look.colors || []).map(hexToRgb);
    this.dither = Number(look.dither) || 0;
    this.lut = null;
    if (this.pixel && this.colors.length) this.buildLut();
    this.vignette = null;
  }

  // 5 bits per channel lookup table -> palette index
  buildLut() {
    const lut = new Uint8Array(32768);
    const cols = this.colors;
    for (let r = 0; r < 32; r++) {
      for (let g = 0; g < 32; g++) {
        for (let b = 0; b < 32; b++) {
          const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4;
          let best = 0, bd = Infinity;
          for (let i = 0; i < cols.length; i++) {
            const c = cols[i];
            // weighted distance approximates perceived difference
            const dr = R - c[0], dg = G - c[1], db = B - c[2];
            const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          lut[(r << 10) | (g << 5) | b] = best;
        }
      }
    }
    this.lut = lut;
  }

  apply(g, W, H, time = 0) {
    const p = this.post;
    // overlays first so pixel looks quantize them to the palette too
    if (p.scanlines) {
      g.fillStyle = `rgba(0,0,0,${p.scanlines})`;
      const step = this.pixel ? 2 : 3;
      for (let y = 0; y < H; y += step) g.fillRect(0, y, W, 1);
    }
    if (p.vignette) {
      if (!this.vignette || this.vignette.w !== W) {
        const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(0,0,0,${p.vignette})`);
        this.vignette = { w: W, grad };
      }
      g.fillStyle = this.vignette.grad;
      g.fillRect(0, 0, W, H);
    }
    const needsPixels = this.lut || p.grain || p.sepia;
    if (needsPixels) {
      const img = g.getImageData(0, 0, W, H);
      const d = img.data;
      const lut = this.lut, cols = this.colors;
      const dither = this.dither * 48;
      const grain = (p.grain || 0) * 255;
      const sepia = p.sepia || 0;
      let seed = (Math.floor(time * 24) * 9301 + 49297) % 233280;
      for (let y = 0, i = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i += 4) {
          let r = d[i], gg = d[i + 1], b = d[i + 2];
          if (sepia) {
            const sr = r * 0.393 + gg * 0.769 + b * 0.189;
            const sg = r * 0.349 + gg * 0.686 + b * 0.168;
            const sb = r * 0.272 + gg * 0.534 + b * 0.131;
            r += (sr - r) * sepia;
            gg += (sg - gg) * sepia;
            b += (sb - b) * sepia;
          }
          if (grain) {
            seed = (seed * 9301 + 49297) % 233280;
            const n = (seed / 233280 - 0.5) * grain;
            r += n;
            gg += n;
            b += n;
          }
          if (lut) {
            if (dither) {
              const o = BAYER4[((y & 3) << 2) | (x & 3)] * dither;
              r += o;
              gg += o;
              b += o;
            }
            const ri = r < 0 ? 0 : r > 255 ? 31 : r >> 3;
            const gi = gg < 0 ? 0 : gg > 255 ? 31 : gg >> 3;
            const bi = b < 0 ? 0 : b > 255 ? 31 : b >> 3;
            const c = cols[lut[(ri << 10) | (gi << 5) | bi]];
            d[i] = c[0];
            d[i + 1] = c[1];
            d[i + 2] = c[2];
          } else {
            d[i] = r;
            d[i + 1] = gg;
            d[i + 2] = b;
          }
          d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    }
  }
}
