// Flat motion: headline + staggered shapes + optional bar chart.
// params: { text, kicker, values: [numbers], labels: [strings], seed }
export default {
  draw(g, ctx) {
    const { t, W, H, lib, params, palette } = ctx;
    // colours by role, so any palette works
    const bg = lib.near('#0f172a');
    const fg = lib.near('#f8fafc');
    const muted = lib.near('#94a3b8');
    const accents = palette.filter((c) => {
      const [r, g2, b] = lib.parse(c);
      const max = Math.max(r, g2, b), min = Math.min(r, g2, b);
      return max - min > 90 && max > 120;
    });
    const acc = (i) => accents[i % accents.length] || fg;
    lib.clear(g, bg);

    // drifting background shapes
    const rnd = lib.rng(params.seed ?? 11);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * W + Math.sin(t * 0.4 + i) * 20;
      const y = rnd() * H + Math.cos(t * 0.3 + i) * 20;
      const r = 20 + rnd() * 80;
      const s = lib.ease.outBack(lib.win(t, i * 0.08, 0.6));
      g.globalAlpha = 0.14;
      lib.circle(g, x, y, r * s, acc(i));
      g.globalAlpha = 1;
    }

    const accent = acc(0);
    if (params.kicker) {
      const k = lib.ease.outCubic(lib.win(t, 0.05, 0.4));
      g.globalAlpha = k;
      lib.text(g, params.kicker.toUpperCase(), W * 0.08, H * 0.2 - (1 - k) * 20, { size: H * 0.035, color: accent, font: ctx.fonts.body, weight: 'bold', letterSpacing: 3 });
      g.globalAlpha = 1;
    }
    if (params.text) {
      const k = lib.ease.outBack(lib.win(t, 0.15, 0.55));
      g.globalAlpha = Math.min(1, k);
      lib.textBlock(g, params.text, W * 0.08, H * 0.27 + (1 - k) * 30, { size: H * 0.085, color: fg, font: ctx.fonts.display, weight: '800', maxWidth: W * 0.7, lineHeight: 1.1 });
      g.globalAlpha = 1;
    }

    const values = params.values || [];
    if (values.length) {
      const max = Math.max(...values);
      const bw = (W * 0.5) / values.length;
      values.forEach((v, i) => {
        const k = lib.ease.outElastic(lib.win(t, 0.6 + i * 0.1, 0.9));
        const h = (v / max) * H * 0.35 * k;
        const x = W * 0.45 + i * bw;
        lib.rrect(g, x, H * 0.88 - h, bw * 0.7, h, 8, acc(i));
        lib.text(g, lib.counter(0, v, k), x + bw * 0.35, H * 0.88 - h - 12, { size: H * 0.03, color: fg, align: 'center', font: ctx.fonts.body, weight: 'bold' });
        if (params.labels?.[i]) lib.text(g, params.labels[i], x + bw * 0.35, H * 0.93, { size: H * 0.025, color: muted, align: 'center', font: ctx.fonts.body });
      });
    }
  },
};
