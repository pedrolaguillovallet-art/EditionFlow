import { h, icon, btn, modal, toast } from '../ui.js';
import { api } from '../api.js';

export async function openNewProject(prefill = {}) {
  const { app, navigate, refreshStatus } = await import('../main.js');
  let styles;
  try {
    styles = (await api.styles()).styles;
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  let voiceFile = null;
  let voiceSeconds = null;

  const title = h('input', { class: 'input', placeholder: 'Cómo el Pac-Man llevó la Game Boy al límite', value: prefill.title || '' });
  const styleSel = h('select', { class: 'select' }, styles.map((s) => h('option', { value: s.id }, s.name)));
  const lookSel = h('select', { class: 'select' });
  const length = h('input', { class: 'input', value: '2:00', placeholder: 'm:ss' });
  const hint = h('div', { class: 'hint' });
  const topic = h('input', { class: 'input', placeholder: 'p. ej. Por qué la PS2 hacía tanto con 32 MB de RAM' });
  const script = h('textarea', { class: 'textarea', rows: 4, placeholder: 'Pega el texto exacto de la narración. Se convierte en la transcripción, así que los tiempos coinciden palabra por palabra.' });
  const direction = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Tono, personajes, qué enfatizar, estilo de cámara…' });
  const autoBuild = h('input', { type: 'checkbox', checked: true });

  if (prefill.style) styleSel.value = prefill.style;
  const fillLooks = () => {
    const s = styles.find((x) => x.id === styleSel.value);
    lookSel.replaceChildren(...s.looks.map((l) => h('option', { value: l.id }, l.name)));
    if (prefill.look && s.looks.some((l) => l.id === prefill.look)) lookSel.value = prefill.look;
    fillHint();
  };
  const fillHint = () => {
    const s = styles.find((x) => x.id === styleSel.value);
    const l = s.looks.find((x) => x.id === lookSel.value) || s.looks[0];
    hint.textContent = `${l.hint || s.description} · ${l.width}×${l.height}`;
  };
  styleSel.addEventListener('change', fillLooks);
  lookSel.addEventListener('change', fillHint);
  fillLooks();

  const fileInput = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a', class: 'hidden' });
  const fileLabel = h('span', { class: 'muted' }, 'o suéltalo aquí');
  const setFile = (f) => {
    if (!f) return;
    voiceFile = f;
    fileLabel.textContent = f.name;
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      voiceSeconds = a.duration;
      const m = Math.floor(a.duration / 60);
      const s = Math.round(a.duration % 60);
      length.value = `${m}:${String(s).padStart(2, '0')}`;
      fileLabel.textContent = `${f.name} · ${length.value}`;
      URL.revokeObjectURL(a.src);
    };
    a.src = URL.createObjectURL(f);
  };
  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  const drop = h(
    'div',
    {
      class: 'dropzone',
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); },
    },
    btn('Elegir audio…', { icon: 'wave', onClick: () => fileInput.click() }),
    fileLabel,
    fileInput
  );

  const claudeOk = app.status?.claude?.ok;
  const create = async () => {
    if (!title.value.trim()) {
      title.focus();
      toast('Ponle un título', 'error');
      return;
    }
    createBtn.disabled = true;
    try {
      const { id } = await api.createProject({
        title: title.value,
        style: styleSel.value,
        look: lookSel.value,
        length: length.value,
        topic: topic.value,
        script: script.value,
        direction: direction.value,
        voiceoverSeconds: voiceSeconds,
      });
      if (voiceFile) await api.uploadVoiceover(id, voiceFile);
      if (claudeOk && autoBuild.checked) sessionStorage.setItem(`ef:build:${id}`, '1');
      m.close();
      refreshStatus();
      navigate(`/editor/${id}`);
    } catch (err) {
      toast(err.message, 'error');
      createBtn.disabled = false;
    }
  };
  const createBtn = btn('Crear proyecto', { icon: 'sparkles', variant: 'primary', onClick: create });

  const m = modal(
    'Nuevo proyecto',
    [
      field('Título', null, title),
      field('Voz en off', null, drop, 'WAV, MP3, M4A. También puedes añadirla después. Los tiempos salen de la voz, así que las escenas se construyen tras ella.'),
      h('div', { class: 'grid-3' }, field('Estilo', null, styleSel), field('Look', null, lookSel), field('Duración', null, length)),
      hint,
      field('Tema', '(opcional: Claude lo investiga y escribe el guion)', topic),
      field('Guion', '(opcional: pega el tuyo en lugar de un tema)', script),
      field('Dirección para Claude', '(opcional)', direction),
      claudeOk
        ? h('label', { class: 'switch' }, autoBuild, h('span', {}, 'Que Claude construya el vídeo al abrir el proyecto'))
        : h('div', { class: 'row muted' }, icon('alert', 16), 'Claude Code no está disponible: se creará el proyecto con la plantilla del estilo.'),
    ],
    { width: 760, footer: [btn('Cancelar', { variant: 'ghost', onClick: () => m.close() }), createBtn] }
  );
}

function field(label, em, control, hintText) {
  return h(control.tagName === 'DIV' ? 'div' : 'label', { class: 'field' },h('span', { class: 'label' }, label, em ? h('em', {}, ' ' + em) : null), control, hintText ? h('span', { class: 'hint' }, hintText) : null);
}
