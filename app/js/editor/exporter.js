import { h, icon, btn, modal, toast, fmtTime } from '../ui.js';
import { api } from '../api.js';
import { Renderer } from '../engine/renderer.js';
import { AudioEngine } from '../engine/audio.js';

const RESOLUTIONS = [
  ['1080', '1080p (1920×1080)', 1920, 1080],
  ['720', '720p (1280×720)', 1280, 720],
  ['1440', '1440p (2560×1440)', 2560, 1440],
  ['vertical', 'Vertical 1080×1920 (recorte centrado)', 1080, 1920],
];

function pickMime() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4'];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

export function openExport(ed) {
  const res = h('select', { class: 'select' }, RESOLUTIONS.map(([id, label]) => h('option', { value: id }, label)));
  const fps = h('select', { class: 'select' }, ['30', '60', '24'].map((f) => h('option', { value: f }, `${f} fps`)));
  fps.value = String(ed.timeline.fps || 30);
  const subs = h('input', { type: 'checkbox', checked: Boolean(ed.timeline.subtitles) });
  const onlyRange = h('input', { type: 'checkbox', checked: false, disabled: !ed.range });
  const bar = h('i');
  const status = h('div', { class: 'muted', style: { fontSize: '13px' } }, 'La exportación se hace en tiempo real en esta pestaña: mantenla visible hasta que termine.');
  let job = null;

  const start = async () => {
    const [, , w, hgt] = RESOLUTIONS.find((r) => r[0] === res.value);
    startBtn.disabled = true;
    job = { cancelled: false };
    try {
      const range = onlyRange.checked && ed.range ? ed.range : [0, ed.duration()];
      const result = await exportVideo(ed, { width: w, height: hgt, fps: Number(fps.value), subtitles: subs.checked, range, job }, (p, t) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        status.textContent = `Grabando ${fmtTime(t)} / ${fmtTime(range[1])}…`;
      }, (msg) => (status.textContent = msg));
      if (!result) return;
      bar.style.width = '100%';
      status.replaceChildren(icon('check', 15), ` Guardado en ${result.file}${result.note ? ' · ' + result.note : ''}`);
      toast('Exportación terminada', 'ok');
      startBtn.replaceChildren(h('span', {}, 'Abrir carpeta'));
      startBtn.disabled = false;
      startBtn.onclick = () => api.reveal(ed.id, 'renders');
    } catch (err) {
      console.error(err);
      status.textContent = 'Error: ' + err.message;
      startBtn.disabled = false;
    }
  };
  const startBtn = btn('Exportar', { variant: 'primary', icon: 'download', onClick: start });
  const m = modal(
    'Exportar vídeo',
    [
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'label' }, 'Resolución'), res), h('label', { class: 'field' }, h('span', { class: 'label' }, 'Fotogramas'), fps)),
      h('label', { class: 'switch' }, subs, h('span', {}, 'Quemar subtítulos de la narración')),
      h('label', { class: 'switch' }, onlyRange, h('span', {}, ed.range ? `Solo el rango seleccionado (${fmtTime(ed.range[0], true)} – ${fmtTime(ed.range[1], true)})` : 'Solo el rango seleccionado (Shift+arrastra en la línea de tiempo)')),
      h('div', { class: 'export-progress' }, bar),
      status,
    ],
    {
      width: 560,
      onClose: () => job && (job.cancelled = true),
      footer: [btn('Cerrar', { variant: 'ghost', onClick: () => m.close() }), startBtn],
    }
  );
}

async function exportVideo(ed, { width, height, fps, subtitles, range, job }, onProgress, onStatus) {
  const mime = pickMime();
  if (!mime) throw new Error('Este navegador no soporta MediaRecorder. Usa Chrome o Edge.');
  ed.player.pause();

  const renderer = new Renderer(ed.id);
  renderer.setLook(ed.look);
  renderer.setTimeline(ed.timeline);
  await renderer.loadScenes(true);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const out = canvas.getContext('2d');
  const vertical = height > width;
  // For vertical output we render 16:9 then crop the centre.
  let src = out;
  if (vertical) {
    const c = document.createElement('canvas');
    c.width = Math.round((height * 16) / 9);
    c.height = height;
    src = c.getContext('2d');
  }

  const audio = new AudioEngine();
  audio.ensure();
  audio.buffer = ed.audio.buffer;
  const aStream = audio.captureStream();
  const vStream = canvas.captureStream(fps);
  const stream = new MediaStream([...vStream.getVideoTracks(), ...aStream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(width * height * fps * 0.18), audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  const draw = (t) => {
    renderer.renderTo(src, t, { subtitles });
    if (vertical) {
      out.fillStyle = '#000';
      out.fillRect(0, 0, width, height);
      out.drawImage(src.canvas, (src.canvas.width - width) / 2, 0, width, height, 0, 0, width, height);
    }
  };
  draw(range[0]);
  rec.start(1000);
  const t0 = audio.start(range[0], 1, ed.timeline);
  const [a, b] = range;
  await new Promise((resolve) => {
    const frame = () => {
      if (job.cancelled) return resolve();
      const t = a + Math.max(0, audio.ctx.currentTime - t0);
      if (t >= b) {
        draw(b - 0.001);
        return resolve();
      }
      draw(t);
      onProgress((t - a) / (b - a), t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await new Promise((r) => setTimeout(r, 250));
  rec.stop();
  audio.stop();
  await stopped;
  audio.ctx.close();
  if (job.cancelled) {
    toast('Exportación cancelada');
    return null;
  }
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  onStatus(`Guardando ${(blob.size / 1024 / 1024).toFixed(1)} MB${ext === 'webm' ? ' (y convirtiendo a MP4 si hay ffmpeg)' : ''}…`);
  return api.uploadRender(ed.id, blob, ext);
}
