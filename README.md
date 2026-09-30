# EditionFlow

Estudio local para crear **vídeos animados con código dirigidos por Claude**.
Eliges un estilo, pegas un guion (o solo un tema) y Claude programa cada escena. Tú editas en
una línea de tiempo, seleccionas lo que quieres cambiar y pides retoques plano a plano.

EditionFlow no usa ninguna API key propia: lanza **Claude Code** en la carpeta del proyecto, así
que funciona con **tu cuenta normal de Claude** (Pro / Max, o la que tengas en `claude login`).

```
┌──────────┬──────────────────────────────────────┬──────────────────┐
│ Planos   │  Preview (canvas, pixel-perfect)      │ Claude           │
│ 1 ▣ ...  │                                       │  Chat · Historial│
│ 2 ▣ ...  │  ◀ ▶ ▶▶  0:54.11 / 1:51.0   📷 🔊 ⟳ 1× │  · Inspector     │
│ 3 ▣ ...  ├──────────────────────────────────────┤                  │
│          │ Planos    │1│ 2 │ 3 │  4  │ 5 │ ...   │ [Selección|Plano │
│          │ Narración │▭│ ▭ │ ▭ │  ▭  │ ▭ │       │  |Vídeo completo]│
│          │ Cues      ╽ ╽  ╽╽   ╽   ╽            │  Aplicar ▶       │
│          │ Audio     ▁▃▅▇▅▃▁▂▅▇▆▃▁ (waveform)     │                  │
│          │ Tarjetas    ◆        ◆      ◆          │                  │
│          │ Ambiente  pad -33 dB │ wind -33 dB     │                  │
└──────────┴──────────────────────────────────────┴──────────────────┘
```

## Requisitos

| | |
|---|---|
| **Node.js 18+** | Para el servidor local (sin dependencias: no hace falta `npm install`). |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` y ejecuta `claude` una vez para iniciar sesión. |
| **git** | Historial de versiones por proyecto (muy recomendado). |
| **Chrome / Edge** | Preview y exportación (MediaRecorder + WebAudio). |
| ffmpeg *(opcional)* | Convierte las exportaciones WebM a MP4 (H.264 + AAC). |

## Arrancar

```bash
npm start            # o: node server/index.js
```

En Windows puedes hacer doble clic en `EditionFlow.cmd`; en macOS/Linux, `./editionflow.sh`.
Se abre `http://127.0.0.1:4317`. Los proyectos se guardan en `~/EditionFlow Projects`
(se cambia en **Ajustes**).

Variables útiles: `PORT`, `EDITIONFLOW_WORKSPACE`, `EDITIONFLOW_CLAUDE` (ruta al comando `claude`),
`--no-open` (no abrir el navegador).

## Flujo de trabajo

1. **Nuevo proyecto**: título, voz en off (opcional), **estilo + look**, duración, y un **tema**
   (Claude investiga y escribe el guion) o tu **guion** exacto, más dirección creativa.
2. **Claude construye**: divide la narración en planos, escribe `scenes/*.js` siguiendo las
   reglas del estilo y añade tarjetas, cues con efectos de sonido y ambiente. Verás cada paso
   ("Leyendo scenes/s1_open.js", "Editando timeline.json"…) y el preview se recarga solo.
3. **Edita**:
   - Arrastra el borde de un plano para cambiar su duración (los siguientes se desplazan; con
     `Alt` no se desplazan). Mueve tarjetas, cues, ambiente y narración.
   - Doble clic en cualquier bloque → **Inspector** (texto, tiempos, transición, parámetros,
     código de la escena, dividir/duplicar/eliminar).
   - `Ctrl Z` / `Ctrl Shift Z` para deshacer/rehacer.
4. **Pide cambios a Claude** con un alcance:
   - **Selección**: clic en el preview (marca un punto x/y + adjunta la captura del fotograma) o
     `Shift`+arrastrar en la línea de tiempo (rango).
   - **Plano**: el plano seleccionado o el que está bajo el cabezal, con su narración.
   - **Vídeo completo**: revisiones globales.
   Las **acciones rápidas** (presets de instrucciones) se configuran en **Memoria**.
5. **Historial**: cada edición tuya y cada respuesta de Claude es un commit de git. Puedes ver el
   diff y restaurar cualquier versión.
6. **Exportar**: 720p / 1080p / 1440p / vertical 9:16, 24/30/60 fps, subtítulos quemados, todo o
   solo el rango seleccionado. Se graba en tiempo real en la pestaña (mantenla visible) y se
   guarda en `renders/` del proyecto (MP4 si hay ffmpeg).

## Estilos y presets

Un **estilo** es una familia de **looks**. Cada look fija resolución interna, paleta,
post-proceso (cuantización a paleta, dithering, grano, sepia, viñeta, scanlines) y las **reglas**
que Claude debe seguir. Integrados:

- **Pixel art**: Crisp 640, Hi-detail 480, Chunky 320 (PICO-8), Arcade synthwave, Handheld 4 tonos.
- **Papel y archivo**: Archive, Editorial, Newsroom.
- **Motion flat**: Clean 720, Neon night.

En **Estilos** ves previews animadas y puedes crear estilos propios (paleta personalizada,
resolución, efectos y reglas). En **Memoria** escribes preferencias globales que Claude recibe en
todos los proyectos.

## Cómo se conecta con Claude

Por cada petición el servidor:

1. Regenera `CLAUDE.md` en el proyecto (estilo, paleta, reglas, formato de `timeline.json`, API de
   escenas y tu memoria). Claude Code lo lee automáticamente.
2. Ejecuta `claude -p --output-format stream-json --verbose --permission-mode acceptEdits
   --allowedTools Read,Edit,MultiEdit,Write,Glob,Grep,TodoWrite[,WebSearch,WebFetch]
   --disallowedTools Bash` con el mensaje por stdin (y `--resume` para mantener la conversación).
3. Traduce el stream a pasos legibles en el panel, valida `timeline.json` al terminar y hace commit.

Claude **no puede ejecutar comandos** (Bash desactivado): solo lee y edita archivos del proyecto.
El botón **Detener** mata el proceso.

## Estructura de un proyecto

```
mi-proyecto/
  project.json        título, estilo, look, estado, sesión de Claude
  timeline.json       planos, narración, tarjetas, cues, ambiente
  scenes/*.js         una escena = un módulo ES con draw(g, ctx)
  script.md           guion
  audio/voiceover.*   voz en off
  CLAUDE.md           instrucciones generadas para Claude
  NOTES.md            notas persistentes (tuyas o de Claude)
  renders/            exportaciones (fuera de git)
  .editionflow/       chat, capturas y miniatura (fuera de git)
```

Una escena mínima:

```js
export default {
  draw(g, { t, W, H, lib, params }) {
    lib.clear(g, lib.near('#101020'));
    const k = lib.ease.outBack(lib.win(t, 0.2, 0.5));
    lib.text(g, params.text, W / 2, H / 2, { size: 40 * k, color: lib.near('#ffffff'), align: 'center', baseline: 'middle', outline: 2 });
  },
};
```

El dibujo es **determinista** (depende solo de `t` y `params`), así que el scrub hacia atrás, las
miniaturas y la exportación son exactos. La API completa de `lib` está en `app/js/engine/lib.js` y
documentada en el `CLAUDE.md` que se genera.

## Atajos

`Espacio` reproducir · `←/→` fotograma (`Shift`: 1 s) · `↑/↓` plano · `S` dividir · `Supr` eliminar ·
`L` bucle · `M` silencio · `+/−` zoom · `Ctrl K` paleta de comandos · `Ctrl Enter` enviar a Claude ·
`Esc` limpiar selección.

## Arquitectura

- `server/` — Node sin dependencias: API REST, proyectos en disco, git, presets, `CLAUDE.md`,
  ejecución de Claude Code en streaming (NDJSON), renders y conversión con ffmpeg.
- `app/` — HTML + JS modules sin build:
  - `engine/` renderer (escena → tarjetas → transición → post-FX a baja resolución → escalado),
    `lib` de dibujo, post-proceso por paleta, audio (voz + ambientes procedurales + SFX) y player.
  - `editor/` línea de tiempo, panel de Claude, inspector y exportador.
  - `views/` inicio, proyectos, editor, estilos, memoria, renders y ajustes.

## Limitaciones conocidas

- La temporización inicial con guion es una **estimación** (~2,6 palabras/s escalada a la duración
  de la voz). Claude o tú la afináis después; no hay transcripción automática de audio.
- La exportación es en tiempo real y necesita la pestaña visible.
- Importar `.zip` no está implementado (sí "Importar carpeta").

```bash
npm run check   # comprueba la sintaxis de todos los módulos
```
