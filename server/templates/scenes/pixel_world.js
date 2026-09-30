// Pixel world: sky, far mountains, perspective grid floor, voxel blocks and a headline.
// Colours are picked by role with lib.near(), so the scene works with any palette.
// params: { text, kicker, mood: 'day' | 'night' | 'dusk', seed, blocks }
const MOODS = {
  night: { sky: ['#0d0b1e', '#1b2346', '#3a4a7a'], stars: true, far: '#26305a', near: '#3a4466', floor: '#181830', grid: '#2f7fd8' },
  dusk: { sky: ['#2a1b3d', '#8a3b6b', '#f28a3c'], stars: false, far: '#5a2f55', near: '#3e2a4a', floor: '#241a30', grid: '#e0507a' },
  day: { sky: ['#1e88e5', '#5cc3f5', '#c8ecff'], stars: false, far: '#5a86b0', near: '#3e6e5a', floor: '#3e8948', grid: '#63c74d' },
};
const BLOCKS = ['#e43b44', '#feae34', '#2ce8f5', '#b55088', '#63c74d', '#f77622'];

export default {
  draw(g, ctx) {
    const { t, W, H, lib, params } = ctx;
    const m = MOODS[params.mood] || MOODS.night;
    const c = (hex) => lib.near(hex);
    const seed = params.seed ?? 7;
    const horizon = Math.round(H * 0.56);

    // 1. Sky
    lib.sky(g, 0, 0, W, horizon, m.sky.map(c));
    if (m.stars) lib.stars(g, { seed, count: Math.round(W / 6), W, H: horizon, t, color: c('#ffffff') });

    // 2. Far mountains (slow parallax)
    const pan = t * 4;
    for (let layer = 0; layer < 2; layer++) {
      const pts = [[0, horizon]];
      const step = 24 + layer * 10;
      for (let x = -step; x <= W + step; x += step) {
        const n = lib.noise((x + pan * (layer + 1)) / 90, seed + layer);
        pts.push([x, Math.round(horizon - 18 - layer * 10 - n * (H * 0.11 - layer * 14))]);
      }
      pts.push([W, horizon]);
      lib.poly(g, pts, c(layer === 0 ? m.far : m.near));
    }

    // 3. Floor with a moving perspective grid
    lib.rect(g, 0, horizon, W, H - horizon, c(m.floor));
    lib.grid3d(g, { W, H, horizon, color: c(m.grid), spacing: Math.round(W / 22), speed: 18, t });

    // 4. Voxel blocks drifting across the floor
    const rnd = lib.rng(seed);
    const count = params.blocks ?? 6;
    const span = W * 1.4;
    for (let i = 0; i < count; i++) {
      const bx = (((rnd() * span - t * (10 + i * 2)) % span) + span) % span - W * 0.2;
      const by = horizon + 30 + rnd() * (H - horizon - 50);
      const size = (10 + rnd() * 14) * (W / 640);
      const hgt = size * (1 + rnd() * 2) * lib.ease.outBack(lib.win(t, 0.1 * i, 0.6));
      const base = c(BLOCKS[i % BLOCKS.length]);
      lib.isoBox(g, Math.round(bx), Math.round(by), size, size, hgt, { top: lib.shade(base, 0.3), left: base, right: lib.shade(base, -0.35) });
    }

    // 5. Floating particles
    lib.particles(g, { seed: seed + 3, count: 24, t, x: 0, y: 0, w: W, h: H, color: c('#feae34'), size: 1, speed: 8 });

    // 6. Headline
    if (params.kicker) {
      lib.text(g, lib.typewriter(params.kicker, t, 30), Math.round(W * 0.025), Math.round(H * 0.05), { size: Math.round(H / 26), color: c('#2ce8f5'), font: ctx.fonts.body, outline: 2, outlineColor: c('#000000') });
    }
    if (params.text) {
      const s = lib.ease.outBack(lib.win(t, 0.15, 0.5));
      lib.textBlock(g, params.text, W / 2, Math.round(H * 0.2), {
        size: Math.round((H / 9) * s + 1),
        color: c('#ffffff'),
        align: 'center',
        maxWidth: W * 0.86,
        outline: Math.max(2, Math.round(H / 120)),
        outlineColor: c('#000000'),
        font: ctx.fonts.display,
        weight: 'bold',
      });
    }
  },
};
