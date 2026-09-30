// Paper document: a page centred on a dark desk, huge number/word, animated highlight.
// params: { text, headline, kicker, seed, stamp }
export default {
  draw(g, ctx) {
    const { t, W, H, lib, params } = ctx;
    const seed = params.seed ?? 3;

    lib.clear(g, '#161311');
    // vignette-ish desk light
    lib.vgrad(g, 0, 0, W, H, [[0, '#231d18'], [1, '#0e0b09']]);

    const zoom = 1 + 0.08 * lib.ease.inOutSine(Math.min(1, t / Math.max(1, ctx.dur)));
    lib.camera(g, { W, H, zoom, x: Math.sin(t * 0.3) * 6, rot: -0.01 }, () => {
      const pw = Math.round(H * 0.62);
      const ph = Math.round(H * 0.95);
      const px = Math.round(W / 2 - pw / 2);
      const py = Math.round(H / 2 - ph / 2 + (1 - lib.ease.outCubic(lib.win(t, 0, 0.8))) * H * 0.3);

      // shadow + paper
      lib.rect(g, px + 10, py + 14, pw, ph, 'rgba(0,0,0,0.45)');
      lib.paper(g, px, py, pw, ph, { color: lib.near('#f3e9d2'), seed, lines: 0 });

      // colours by role, so any palette works
      const ink = lib.near('#2a1d12');
      const accent = lib.near('#b0302a');
      lib.text(g, (params.kicker || 'the story goes…'), px + pw / 2, py + ph * 0.07, { size: Math.round(ph * 0.03), color: lib.near('#9c7a4d'), font: ctx.fonts.body, align: 'center' });

      // framed inner page
      g.strokeStyle = ink;
      g.lineWidth = 2;
      g.strokeRect(px + pw * 0.12, py + ph * 0.18, pw * 0.76, ph * 0.66);

      if (params.headline) {
        lib.textBlock(g, params.headline.toUpperCase(), px + pw / 2, py + ph * 0.24, { size: Math.round(ph * 0.028), color: ink, align: 'center', maxWidth: pw * 0.6, font: ctx.fonts.body, weight: 'bold' });
      }

      const big = params.text || '1873';
      const bigSize = Math.round(ph * (big.length > 6 ? 0.1 : 0.16));
      const reveal = lib.win(t, 0.4, 0.7);
      const hy = py + ph * 0.46;
      g.save();
      g.globalAlpha = reveal;
      const w = lib.text(g, big, px + pw / 2, hy, { size: bigSize, color: ink, align: 'center', baseline: 'middle', font: ctx.fonts.display, weight: 'bold' });
      g.restore();
      lib.underline(g, px + pw / 2 - w / 2, hy + bigSize * 0.6, px + pw / 2 + w / 2, lib.ease.outCubic(lib.win(t, 1.1, 0.6)), accent, Math.max(2, bigSize * 0.06));

      // body lines
      const rnd = lib.rng(seed);
      for (let i = 0; i < 8; i++) {
        const ly = py + ph * (0.62 + i * 0.022);
        const lw = pw * (0.5 - rnd() * 0.18);
        lib.rect(g, Math.round(px + pw / 2 - lw / 2), Math.round(ly), Math.round(lw), Math.max(1, Math.round(ph * 0.004)), 'rgba(59,42,26,0.45)');
      }

      if (params.stamp !== false) {
        const s = lib.ease.outBack(lib.win(t, 1.4, 0.4));
        if (s > 0) {
          lib.circle(g, px + pw * 0.76, py + ph * 0.8, ph * 0.045 * s, accent);
          lib.ring(g, px + pw * 0.76, py + ph * 0.8, ph * 0.052 * s, 2, accent);
        }
      }
    });
  },
};
