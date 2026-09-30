import path from 'node:path';
import { readJson, writeJson, slugify } from './util.js';

export const PALETTES = {
  endesga32: ['#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633', '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e', '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466', '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'],
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  synthwave: ['#0d0221', '#0f084b', '#26408b', '#3d1e6d', '#8d3b72', '#ff2a6d', '#ff6c11', '#ffd319', '#05d9e8', '#01c5c4', '#d1f7ff', '#ffffff', '#1b1b3a', '#693668', '#a74482', '#f84aa7'],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  archive: ['#f3e9d2', '#e6d5b0', '#c9ae7c', '#9c7a4d', '#6b4f2f', '#3b2a1a', '#1d140c', '#a8322d', '#7a1f1b', '#2f3e46'],
  editorial: ['#f7f3ea', '#ffffff', '#141414', '#2b2b2b', '#6f6f6f', '#c8c2b4', '#d63a2f', '#1f4e79', '#e9b949'],
  newsroom: ['#ffffff', '#f2f4f7', '#0b1b33', '#1f3a60', '#2f6fed', '#e5484d', '#ffb224', '#6b7280', '#111827'],
  flat: ['#0f172a', '#1e293b', '#334155', '#f8fafc', '#38bdf8', '#a78bfa', '#f472b6', '#facc15', '#34d399', '#fb7185'],
};

/**
 * A style is a family of looks. A look fixes the internal render resolution, palette,
 * post-processing and the rules Claude must follow when writing scenes.
 */
export const BUILTIN_STYLES = [
  {
    id: 'pixel',
    name: 'Pixel art',
    description: 'Mundos de píxel con paleta limitada, rejillas en perspectiva, vóxeles isométricos y HUDs retro.',
    template: 'pixel_world',
    looks: [
      {
        id: 'crisp640', name: 'Crisp 640', width: 640, height: 360, pixel: true, palette: 'endesga32', dither: 0,
        hint: 'Pixel art fino a 640×360 para escenas detalladas y objetos pequeños. Más pesado para la GPU.',
        fonts: { display: '"Arial Black", Impact, sans-serif', body: '"Courier New", monospace' },
        post: { scanlines: 0 },
      },
      {
        id: 'hidetail480', name: 'Hi-detail 480', width: 480, height: 270, pixel: true, palette: 'endesga32', dither: 0.25,
        hint: 'Equilibrio entre detalle y píxel visible. Ideal para mundos con personajes.',
        fonts: { display: '"Arial Black", Impact, sans-serif', body: '"Courier New", monospace' },
        post: { scanlines: 0 },
      },
      {
        id: 'chunky320', name: 'Chunky 320', width: 320, height: 180, pixel: true, palette: 'pico8', dither: 0.4,
        hint: 'Píxel gordo estilo 8 bits, paleta PICO-8. Muy legible y rápido.',
        fonts: { display: '"Arial Black", Impact, sans-serif', body: '"Courier New", monospace' },
        post: { scanlines: 0.15 },
      },
      {
        id: 'arcade', name: 'Arcade synthwave', width: 480, height: 270, pixel: true, palette: 'synthwave', dither: 0.2,
        hint: 'Neones, rejilla azul infinita y cielo nocturno. Perfecto para historia de videojuegos.',
        fonts: { display: '"Arial Black", Impact, sans-serif', body: '"Courier New", monospace' },
        post: { scanlines: 0.25 },
      },
      {
        id: 'handheld', name: 'Handheld 4 tonos', width: 320, height: 180, pixel: true, palette: 'gameboy', dither: 0.5,
        hint: 'Cuatro verdes de consola portátil clásica. Ideal para piezas nostálgicas.',
        fonts: { display: '"Arial Black", Impact, sans-serif', body: '"Courier New", monospace' },
        post: { scanlines: 0.1 },
      },
    ],
    rules: [
      'Todo se dibuja a la resolución interna del look (W×H). Trabaja en píxeles enteros: redondea posiciones con Math.round para evitar bordes borrosos.',
      'Usa solo colores de la paleta (`lib.pal(i)` o `ctx.palette`). El post-proceso cuantiza a la paleta igualmente, así que los degradados suaves se convierten en bandas.',
      'Construye profundidad con capas: cielo → fondo lejano → medio → primer plano → HUD/texto. Usa `lib.grid3d` y `lib.isoBox` para suelos y bloques vóxel.',
      'Movimiento: cámara lenta y constante (paneos, zoom sutil) + elementos secundarios vivos (partículas, parpadeos, nubes).',
      'Texto en pantalla: grande, con contorno oscuro (`outline`), máximo 5–6 palabras por línea.',
    ],
  },
  {
    id: 'paper',
    name: 'Papel y archivo',
    description: 'Documentos, recortes y tipografía editorial sobre papel. Ideal para historia y explicadores.',
    template: 'paper_doc',
    looks: [
      {
        id: 'archive', name: 'Archive', width: 1280, height: 720, pixel: false, palette: 'archive', dither: 0,
        hint: 'Documentos antiguos, sepia, grano de película y viñeta.',
        fonts: { display: 'Georgia, "Times New Roman", serif', body: 'Georgia, serif' },
        post: { grain: 0.07, vignette: 0.45, sepia: 0.35 },
      },
      {
        id: 'editorial', name: 'Editorial', width: 1280, height: 720, pixel: false, palette: 'editorial', dither: 0,
        hint: 'Revista financiera: papel crema, negro, un acento rojo, números enormes.',
        fonts: { display: 'Georgia, "Times New Roman", serif', body: '"Helvetica Neue", Arial, sans-serif' },
        post: { grain: 0.035, vignette: 0.25 },
      },
      {
        id: 'newsroom', name: 'Newsroom', width: 1280, height: 720, pixel: false, palette: 'newsroom', dither: 0,
        hint: 'Limpio y periodístico: fondos claros, azul marino, subrayados y recortes.',
        fonts: { display: '"Helvetica Neue", Arial, sans-serif', body: '"Helvetica Neue", Arial, sans-serif' },
        post: { grain: 0.02, vignette: 0.15 },
      },
    ],
    rules: [
      'La composición gira alrededor de un objeto de papel (documento, página, recorte, ticket) centrado con sombra suave.',
      'Cámara: zoom lento (1.0 → 1.08) y ligeros desplazamientos; nada de movimientos bruscos.',
      'Tipografía serif para titulares, sans para datos. Resalta una sola palabra o número por plano con el color de acento.',
      'Usa `lib.paper` para texturas y `lib.highlight` / subrayados animados para dirigir la mirada al dato hablado.',
    ],
  },
  {
    id: 'flat',
    name: 'Motion flat',
    description: 'Formas planas, iconografía y gráficos animados. Rápido de leer, ideal para datos.',
    template: 'flat_shapes',
    looks: [
      {
        id: 'clean', name: 'Clean 720', width: 1280, height: 720, pixel: false, palette: 'flat', dither: 0,
        hint: 'Fondo oscuro azulado, colores vivos, formas redondeadas y easing elástico.',
        fonts: { display: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif' },
        post: {},
      },
      {
        id: 'neon', name: 'Neon night', width: 1280, height: 720, pixel: false, palette: 'synthwave', dither: 0,
        hint: 'Líneas brillantes sobre negro, glow y rejilla retro.',
        fonts: { display: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif' },
        post: { scanlines: 0.12, vignette: 0.3 },
      },
    ],
    rules: [
      'Formas geométricas simples con esquinas redondeadas; cada elemento entra con easing (`lib.ease.outBack`) y escalonado 60–120 ms.',
      'Máximo 3 colores de acento por plano. Los gráficos (barras, líneas) se animan hasta el valor mencionado en la narración.',
    ],
  },
];

function customFile(workspace) {
  return path.join(workspace, '.editionflow', 'styles.json');
}

export async function listStyles(workspace) {
  const custom = await readJson(customFile(workspace), []);
  return {
    palettes: PALETTES,
    styles: [...BUILTIN_STYLES.map((s) => ({ ...s, builtin: true })), ...custom.map((s) => ({ ...s, builtin: false }))],
  };
}

export async function saveCustomStyle(workspace, style) {
  const custom = await readJson(customFile(workspace), []);
  const id = style.id || 'custom-' + slugify(style.name) + '-' + Date.now().toString(36).slice(-4);
  const clean = {
    id,
    name: String(style.name || 'Estilo propio').slice(0, 60),
    description: String(style.description || '').slice(0, 300),
    template: ['pixel_world', 'paper_doc', 'flat_shapes'].includes(style.template) ? style.template : 'flat_shapes',
    looks: (style.looks || []).map((l, i) => ({
      id: l.id || `look${i + 1}`,
      name: String(l.name || `Look ${i + 1}`).slice(0, 40),
      width: clampInt(l.width, 160, 1920, 1280),
      height: clampInt(l.height, 90, 1080, 720),
      pixel: Boolean(l.pixel),
      palette: Array.isArray(l.palette) ? l.palette.slice(0, 64) : PALETTES[l.palette] ? l.palette : 'flat',
      dither: Math.max(0, Math.min(1, Number(l.dither) || 0)),
      hint: String(l.hint || '').slice(0, 200),
      fonts: l.fonts || { display: 'Georgia, serif', body: 'Arial, sans-serif' },
      post: l.post || {},
    })),
    rules: (style.rules || []).map(String).filter(Boolean).slice(0, 20),
  };
  if (!clean.looks.length) throw new Error('Un estilo necesita al menos un look');
  const idx = custom.findIndex((s) => s.id === id);
  if (idx >= 0) custom[idx] = clean;
  else custom.push(clean);
  await writeJson(customFile(workspace), custom);
  return clean;
}

export async function deleteCustomStyle(workspace, id) {
  const custom = await readJson(customFile(workspace), []);
  await writeJson(customFile(workspace), custom.filter((s) => s.id !== id));
}

export async function resolveLook(workspace, styleId, lookId) {
  const { styles } = await listStyles(workspace);
  const style = styles.find((s) => s.id === styleId) || styles[0];
  const look = style.looks.find((l) => l.id === lookId) || style.looks[0];
  const palette = Array.isArray(look.palette) ? look.palette : PALETTES[look.palette] || [];
  return { style, look: { ...look, colors: palette } };
}

function clampInt(v, min, max, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
}
