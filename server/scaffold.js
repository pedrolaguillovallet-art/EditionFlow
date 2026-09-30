import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', 'scenes');

export const TEMPLATE_NAMES = ['pixel_world', 'paper_doc', 'flat_shapes'];

export async function copyTemplate(projectDir, name, target) {
  const src = path.join(TEMPLATES, (TEMPLATE_NAMES.includes(name) ? name : 'flat_shapes') + '.js');
  const dest = path.join(projectDir, target);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

/** Split narration into sentences, then group them into shots of roughly 3–7 s. */
export function timelineFromScript(script, { totalSeconds, sceneFile }) {
  const clean = String(script || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const sentences = clean.match(/[^.!?…]+[.!?…]*["»”]?\s*/g)?.map((s) => s.trim()).filter(Boolean) || [clean];
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  const WPS = 2.6; // ~155 words per minute
  const groups = [];
  let cur = [];
  let curWords = 0;
  for (const s of sentences) {
    cur.push(s);
    curWords += words(s);
    if (curWords / WPS >= 3) {
      groups.push(cur.join(' '));
      cur = [];
      curWords = 0;
    }
  }
  if (cur.length) groups.push(cur.join(' '));

  const estimated = groups.map((g) => Math.max(2, words(g) / WPS + 0.35));
  const est = estimated.reduce((a, b) => a + b, 0);
  const scale = totalSeconds && totalSeconds > 5 ? totalSeconds / est : 1;
  let start = 0;
  const shots = [];
  const narration = [];
  groups.forEach((text, i) => {
    const duration = round(estimated[i] * scale);
    shots.push({
      id: `s${i + 1}`,
      title: text.length > 60 ? text.slice(0, 57) + '…' : text,
      start: round(start),
      duration,
      scene: sceneFile,
      params: { text: headlineFrom(text), seed: i * 17 + 3 },
      transition: i === 0 ? 'fade' : 'cut',
    });
    narration.push({ start: round(start), end: round(start + duration), text });
    start += duration;
  });
  return { shots, narration };
}

function headlineFrom(text) {
  const words = text.replace(/[.,;:!?¿¡"«»“”]/g, '').split(/\s+/).filter((w) => w.length > 3);
  return words.slice(0, 4).join(' ').toUpperCase();
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function defaultTimeline({ title, sceneFile, lengthSeconds }) {
  const d = Math.max(4, Math.min(lengthSeconds || 6, 8));
  return {
    version: 1,
    fps: 30,
    subtitles: false,
    shots: [
      {
        id: 's1',
        title: title,
        start: 0,
        duration: d,
        scene: sceneFile,
        params: { text: title.toUpperCase(), kicker: 'EditionFlow', seed: 7 },
        transition: 'fade',
      },
    ],
    narration: [],
    cards: [],
    cues: [],
    ambience: [{ start: 0, end: d, type: 'pad', db: -30 }],
  };
}

/**
 * CLAUDE.md is regenerated before every Claude run. Claude Code reads it automatically
 * because it is launched with the project folder as its working directory.
 */
export function claudeMd({ meta, style, look, memory }) {
  const pal = (look.colors || []).map((c, i) => `${i}:${c}`).join('  ');
  return `# EditionFlow · instrucciones para Claude

> Archivo generado por EditionFlow antes de cada ejecución. **No lo edites**: se sobrescribe.
> Si necesitas notas persistentes del proyecto, usa \`NOTES.md\`.

Estás dentro de un proyecto de vídeo de **EditionFlow**, un editor en el que los vídeos se
animan con código. El usuario ve el resultado en tiempo real en el editor en cuanto guardas
un archivo. Responde siempre en **español**, breve, y di qué has cambiado (planos y archivos).

## Proyecto
- Título: ${meta.title}
- Estilo: **${style.name} · ${look.name}** — ${look.hint || style.description || ''}
- Resolución interna: **${look.width}×${look.height}** ${look.pixel ? '(pixel art: se escala con vecino más cercano y se cuantiza a la paleta)' : '(se escala suavemente a 1080p)'}
- Paleta (${look.colors.length} colores, índice:hex): ${pal}
- Fuentes: display = \`${look.fonts?.display}\`, body = \`${look.fonts?.body}\`
${meta.topic ? `- Tema: ${meta.topic}\n` : ''}${meta.direction ? `- Dirección del usuario: ${meta.direction}\n` : ''}${meta.lengthSeconds ? `- Duración objetivo: ${fmt(meta.lengthSeconds)}\n` : ''}
## Reglas del estilo
${(style.rules || []).map((r) => `- ${r}`).join('\n') || '- (sin reglas extra)'}

## Estructura de archivos
- \`timeline.json\` — la línea de tiempo. **Fuente de verdad de la edición.**
- \`scenes/*.js\` — un módulo ES por escena. Varios planos pueden compartir escena con \`params\` distintos.
- \`script.md\` — guion / narración (si existe).
- \`audio/\` — voz en off (\`voiceover.*\`). La temporización sale de la voz.
- \`.editionflow/snapshots/*.png\` — capturas del preview que el usuario te adjunta. Ábrelas con Read para ver el fotograma.
- \`renders/\` — exportaciones. No las toques.

## timeline.json
\`\`\`jsonc
{
  "version": 1, "fps": 30, "subtitles": false,
  "shots": [ // planos, ordenados por start; normalmente contiguos
    { "id": "s1", "title": "texto corto del plano", "start": 0, "duration": 3.5,
      "scene": "scenes/s1_open.js", "params": { "text": "..." }, "transition": "cut" } // cut | fade | flash | wipe
  ],
  "narration": [ { "start": 0, "end": 3.5, "text": "frase hablada" } ],
  "cards":    [ { "id": "c1", "start": 14.6, "duration": 3, "text": "EACH OTHER", "sub": "nothing left to steal", "position": "top-left" } ], // top-left|top|center|bottom|lower-third
  "cues":     [ { "t": 1.2, "label": "impacto", "sfx": "hit" } ], // sfx: none|blip|hit|whoosh|tick|rise
  "ambience": [ { "start": 0, "end": 20, "type": "pad", "db": -33 } ] // pad|wind|crowd|hum|rain
}
\`\`\`
- Tiempos en segundos (2 decimales). Mantén el JSON válido: el editor lo recarga al terminar.
- Si cambias la duración de un plano, desplaza los siguientes para que sigan contiguos.
- Cada visual importante debe caer **en la palabra hablada** correspondiente (usa \`narration\`).

## API de escenas
\`\`\`js
// scenes/s1_open.js
export default {
  setup(ctx) {},               // opcional, una vez al cargar el plano (ctx.state es tuyo)
  draw(g, ctx) {               // cada fotograma; g = CanvasRenderingContext2D de W×H
    const { t, p, dur, W, H, lib, params, palette, fonts, state, time } = ctx;
    lib.clear(g, lib.pal(25));
    lib.text(g, params.text, W / 2, H / 2, { size: 32, color: lib.pal(19), align: 'center', outline: 2 });
  },
};
\`\`\`
- \`t\` segundos desde el inicio del plano · \`p\` progreso 0..1 · \`dur\` duración · \`time\` tiempo global.
- **Determinista**: el dibujo debe depender solo de \`t\`/params (el usuario hace scrub hacia atrás). Nada de \`Math.random()\`: usa \`lib.rng(seed)\` o \`ctx.rng\`.
- Sin imports, sin red, sin DOM. Todo lo necesario está en \`lib\`. Solo JavaScript del navegador.
- Dibuja siempre el fondo completo (el lienzo no se borra entre planos).

### lib
- Matemáticas: \`lerp(a,b,t)\`, \`clamp(v,a=0,b=1)\`, \`map(v,a,b,c,d)\`, \`smooth(a,b,x)\`, \`win(t,start,dur)\`→0..1, \`rng(seed)\`→()=>0..1, \`noise(x,seed)\`→0..1, \`shake(t,amount,seed)\`→{x,y}, \`counter(from,to,p,decimals)\`
- Easing: \`ease.linear|inQuad|outQuad|inOut|outCubic|inOutSine|outBack|outElastic|outBounce\`
- Color: \`pal(i)\` (índice de la paleta), \`near('#hex')\` (color de la paleta más cercano: úsalo para que la escena funcione con cualquier look), \`mix(c1,c2,t)\`, \`shade(c,amt -1..1)\`, \`alpha(c,a)\`
- Formas: \`clear(g,c)\`, \`rect(g,x,y,w,h,c)\`, \`rrect(g,x,y,w,h,r,c)\`, \`circle(g,x,y,r,c)\`, \`ring(g,x,y,r,width,c)\`, \`line(g,x1,y1,x2,y2,c,w)\`, \`poly(g,[[x,y],…],c)\`, \`vgrad(g,x,y,w,h,[[0,c],[1,c]])\`
- Mundo: \`sky(g,x,y,w,h,[c1,c2,c3])\` (bandas), \`stars(g,{seed,count,W,H,t,color})\`, \`grid3d(g,{W,H,horizon,color,spacing,speed,t})\`, \`isoBox(g,x,y,w,d,h,{top,left,right})\`, \`particles(g,{seed,count,t,x,y,w,h,color,size,speed,gravity})\`, \`sprite(g,rows,x,y,scale,colors)\` (rows = ["..11..", ".1221."], colors = {1:'#000',2:'#f00'})
- Papel: \`paper(g,x,y,w,h,{color,seed,lines})\`, \`highlight(g,x,y,w,h,p,color)\`, \`underline(g,x1,y,x2,p,color,width)\`
- Texto: \`text(g,str,x,y,{size,color,font,weight,align,baseline,outline,outlineColor,shadow,letterSpacing})\`→ancho, \`textBlock(g,str,x,y,{maxWidth,lineHeight,…})\`→alto, \`wrap(g,str,maxWidth,opts)\`→líneas, \`typewriter(str,t,cps)\`
- UI: \`panel(g,x,y,w,h,{fill,border,radius,shadow})\`, \`bar(g,x,y,w,h,value,{fill,back,border})\`
- Cámara: \`camera(g,{W,H,x,y,zoom,rot},()=>{…})\`

Tienes plantillas de ejemplo en \`scenes/\` al crear el proyecto; léelas antes de escribir escenas nuevas.

## Cómo trabajar
1. Lee \`timeline.json\` y la(s) escena(s) afectadas antes de cambiar nada.
2. Respeta el **alcance** indicado en el mensaje (selección / plano / vídeo completo).
3. Prefiere editar escenas existentes a crear archivos nuevos; nombra las nuevas \`scenes/sNN_nombre.js\`.
4. Tras editar, repasa mentalmente el fotograma: ¿se lee el texto en un móvil? ¿hay capas de profundidad? ¿cae en su palabra?
5. No ejecutes comandos ni instales nada: el editor recarga solo.
${memory?.trim() ? `\n## Memoria del usuario (preferencias globales)\n${memory.trim()}\n` : ''}`;
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
