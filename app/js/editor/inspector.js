import { h, icon, btn, toast, modal, fmtTime } from '../ui.js';
import { api } from '../api.js';

const SFX = ['none', 'blip', 'tick', 'hit', 'whoosh', 'rise'];
const AMB = ['pad', 'wind', 'crowd', 'hum', 'rain'];
const TRANSITIONS = [['cut', 'Corte'], ['fade', 'Fundido desde negro'], ['flash', 'Flash'], ['wipe', 'Barrido']];
const POSITIONS = [['top-left', 'Arriba izquierda'], ['top', 'Arriba'], ['center', 'Centro'], ['bottom', 'Abajo'], ['lower-third', 'Rótulo inferior']];

export function buildInspector(ed) {
  const sel = ed.selection;
  const item = sel ? ed.itemOf(sel.type, sel.index) : null;
  if (!item) return projectInspector(ed);
  const set = (patch, msg) => ed.updateItem(sel.type, sel.index, patch, msg);
  const locked = ed.locked();
  const wrap = (title, ...children) =>
    h('div', { class: 'inspector' }, h('div', { class: 'row' }, h('h4', {}, title), h('span', { class: 'grow' }), btn('Proyecto', { size: 'sm', variant: 'ghost', icon: 'settings', onClick: () => ed.select(null, { inspect: true }) })), locked ? h('div', { class: 'msg-note stopped' }, icon('alert', 15), 'Claude está trabajando: la edición está bloqueada.') : null, ...children);

  if (sel.type === 'shot') {
    const scenes = [...new Set([...ed.project.scenes, item.scene].filter(Boolean))];
    const params = h('textarea', { class: 'textarea mono', rows: 6, value: JSON.stringify(item.params || {}, null, 2) });
    params.addEventListener('change', () => {
      try {
        set({ params: JSON.parse(params.value || '{}') }, 'Parámetros del plano');
      } catch {
        toast('Los parámetros deben ser JSON válido', 'error');
      }
    });
    return wrap(
      `Plano ${sel.index + 1}`,
      input('Título', item.title, (v) => set({ title: v })),
      h('div', { class: 'grid-2' }, readonly('Inicio', fmtTime(item.start, true)), number('Duración (s)', item.duration, (v) => ed.setShotDuration(sel.index, v), 0.1)),
      select('Escena', item.scene, scenes.map((s) => [s, s]), (v) => set({ scene: v }, 'Escena cambiada')),
      select('Transición de entrada', item.transition || 'cut', TRANSITIONS, (v) => set({ transition: v })),
      field('Parámetros (JSON)', params, 'Se pasan a la escena como ctx.params'),
      h('div', { class: 'row wrap' },
        btn('Código de la escena', { size: 'sm', icon: 'code', onClick: () => editScene(ed, item.scene) }),
        btn('Dividir en el cabezal', { size: 'sm', icon: 'editor', onClick: () => ed.splitShot(sel.index) }),
        btn('Duplicar', { size: 'sm', icon: 'copy', onClick: () => ed.duplicateShot(sel.index) }),
        btn('Eliminar', { size: 'sm', icon: 'trash', variant: 'danger', onClick: () => ed.deleteSelected() })),
      ed.renderer.errors.get(item.id)
        ? h('div', { class: 'col' }, h('div', { class: 'msg-note error' }, icon('alert', 15), ed.renderer.errors.get(item.id)), btn('Pedir a Claude que lo arregle', { size: 'sm', variant: 'claude', icon: 'sparkles', onClick: () => ed.fixError(item) }))
        : null
    );
  }
  if (sel.type === 'card') {
    return wrap(
      'Tarjeta de texto',
      input('Texto', item.text, (v) => set({ text: v })),
      input('Subtítulo', item.sub || '', (v) => set({ sub: v })),
      h('div', { class: 'grid-2' }, number('Inicio (s)', item.start, (v) => set({ start: v }), 0.05), number('Duración (s)', item.duration ?? 2.5, (v) => set({ duration: Math.max(0.2, v) }), 0.1)),
      select('Posición', item.position || 'top-left', POSITIONS, (v) => set({ position: v })),
      h('div', { class: 'grid-2' }, input('Color (opcional)', item.color || '', (v) => set({ color: v || undefined })), number('Tamaño (fracción de alto)', item.size ?? 0.1, (v) => set({ size: v }), 0.01)),
      btn('Eliminar tarjeta', { size: 'sm', icon: 'trash', variant: 'danger', onClick: () => ed.deleteSelected() })
    );
  }
  if (sel.type === 'cue') {
    return wrap(
      'Cue',
      input('Etiqueta', item.label || '', (v) => set({ label: v })),
      h('div', { class: 'grid-2' }, number('Tiempo (s)', item.t, (v) => set({ t: v }), 0.05), select('Sonido', item.sfx || 'none', SFX.map((s) => [s, s]), (v) => set({ sfx: v }))),
      number('Volumen (dB)', item.db ?? -12, (v) => set({ db: v }), 1),
      h('div', { class: 'row' },
        btn('Probar', { size: 'sm', icon: 'play', onClick: () => { const a = ed.audio; a.ensure(); a.sfx(item.sfx || 'blip', a.ctx.currentTime + 0.02, item.db); } }),
        btn('Eliminar', { size: 'sm', icon: 'trash', variant: 'danger', onClick: () => ed.deleteSelected() }))
    );
  }
  if (sel.type === 'ambience') {
    return wrap(
      'Ambiente',
      select('Tipo', item.type || 'pad', AMB.map((s) => [s, s]), (v) => set({ type: v })),
      h('div', { class: 'grid-2' }, number('Inicio (s)', item.start, (v) => set({ start: v }), 0.1), number('Fin (s)', item.end, (v) => set({ end: v }), 0.1)),
      number('Volumen (dB)', item.db ?? -33, (v) => set({ db: v }), 1),
      btn('Eliminar', { size: 'sm', icon: 'trash', variant: 'danger', onClick: () => ed.deleteSelected() })
    );
  }
  if (sel.type === 'narration') {
    const ta = h('textarea', { class: 'textarea', rows: 4, value: item.text || '' });
    ta.addEventListener('change', () => set({ text: ta.value }));
    return wrap(
      'Narración',
      field('Texto hablado', ta),
      h('div', { class: 'grid-2' }, number('Inicio (s)', item.start, (v) => set({ start: v }), 0.05), number('Fin (s)', item.end, (v) => set({ end: v }), 0.05)),
      btn('Eliminar', { size: 'sm', icon: 'trash', variant: 'danger', onClick: () => ed.deleteSelected() })
    );
  }
  return projectInspector(ed);
}

function projectInspector(ed) {
  const { meta } = ed.project;
  const tl = ed.timeline;
  const voiceInput = h('input', { type: 'file', accept: 'audio/*', class: 'hidden' });
  voiceInput.addEventListener('change', async () => {
    const f = voiceInput.files[0];
    if (!f) return;
    toast('Subiendo voz en off…');
    await api.uploadVoiceover(ed.id, f);
    await ed.reload();
    toast('Voz en off añadida', 'ok');
  });
  const direction = h('textarea', { class: 'textarea', rows: 3, value: meta.direction || '', placeholder: 'Tono, personajes, cámara… (se incluye en CLAUDE.md)' });
  direction.addEventListener('change', () => api.patchProject(ed.id, { direction: direction.value }).then((m) => (ed.project.meta = m)));
  return h(
    'div',
    { class: 'inspector' },
    h('h4', {}, 'Proyecto'),
    h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Selecciona un elemento de la línea de tiempo (doble clic) para editarlo aquí.'),
    h('div', { class: 'grid-2' }, readonly('Duración', fmtTime(ed.duration(), true)), readonly('Planos', String(tl.shots.length))),
    h('div', { class: 'grid-2' },
      select('FPS de exportación', String(tl.fps || 30), [['24', '24'], ['30', '30'], ['60', '60']], (v) => { tl.fps = Number(v); ed.commit('FPS cambiados'); }),
      field('Subtítulos', h('label', { class: 'switch' }, (() => { const c = h('input', { type: 'checkbox', checked: Boolean(tl.subtitles) }); c.addEventListener('change', () => { tl.subtitles = c.checked; ed.player.subtitles = c.checked; ed.commit('Subtítulos ' + (c.checked ? 'activados' : 'desactivados')); }); return c; })(), h('span', {}, 'Quemar narración')))
    ),
    field('Voz en off', h('div', { class: 'row' }, h('span', { class: 'muted', style: { flex: 1, fontSize: '13px' } }, meta.voiceover ? `${meta.voiceover} · ${fmtTime(ed.audio.voiceDuration, true)}` : 'Sin voz en off'), btn(meta.voiceover ? 'Reemplazar' : 'Subir', { size: 'sm', icon: 'upload', onClick: () => voiceInput.click() }), voiceInput)),
    meta.voiceover && Math.abs(ed.audio.voiceDuration - ed.duration()) > 0.5
      ? h('div', { class: 'col' }, h('div', { class: 'msg-note stopped' }, icon('alert', 15), `La voz dura ${fmtTime(ed.audio.voiceDuration, true)} y los planos ${fmtTime(ed.duration(), true)}.`), btn('Ajustar planos a la voz', { size: 'sm', icon: 'wave', onClick: () => ed.fitShotsToVoice() }))
      : null,
    field('Dirección para Claude', direction),
    h('div', { class: 'row wrap' },
      btn('Guion', { size: 'sm', icon: 'script', onClick: () => editText(ed, 'script.md', 'Guion (script.md)') }),
      btn('Notas', { size: 'sm', icon: 'edit', onClick: () => editText(ed, 'NOTES.md', 'Notas del proyecto (NOTES.md)') }),
      btn('Añadir plano', { size: 'sm', icon: 'plus', onClick: () => ed.addShot() }))
  );
}

/* ---------- editors ---------- */

export async function editScene(ed, rel) {
  if (!rel) return;
  let code = '';
  try {
    code = await api.readFile(ed.id, rel);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const ta = h('textarea', { class: 'textarea code-area', value: code, spellcheck: false, rows: 24 });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  });
  const save = async () => {
    try {
      await api.writeFile(ed.id, rel, ta.value);
      await ed.reloadScenes();
      toast(`${rel} guardado`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const m = modal(rel, [h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Edición directa del código. Ctrl+S guarda y recarga el preview. También puedes pedirle el cambio a Claude.'), ta], {
    width: 980,
    footer: [btn('Cerrar', { variant: 'ghost', onClick: () => m.close() }), btn('Guardar y recargar', { variant: 'primary', icon: 'check', onClick: save })],
  });
}

async function editText(ed, rel, title) {
  const text = await api.readFile(ed.id, rel).catch(() => '');
  const ta = h('textarea', { class: 'textarea', value: text, rows: 18 });
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  const m = modal(title, ta, {
    width: 820,
    footer: [
      btn('Cerrar', { variant: 'ghost', onClick: () => m.close() }),
      btn('Guardar', {
        variant: 'primary',
        icon: 'check',
        onClick: async () => {
          await api.writeFile(ed.id, rel, ta.value);
          toast('Guardado', 'ok');
          m.close();
        },
      }),
    ],
  });
}

/* ---------- field helpers ---------- */

function field(label, control, hint) {
  return h('div', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

function input(label, value, onChange) {
  const el = h('input', { class: 'input', value: value ?? '' });
  el.addEventListener('change', () => onChange(el.value));
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return field(label, el);
}

function number(label, value, onChange, step = 0.1) {
  const el = h('input', { class: 'input', type: 'number', step: String(step), value: String(Math.round((value ?? 0) * 1000) / 1000) });
  el.addEventListener('change', () => {
    const v = Number(el.value);
    if (Number.isFinite(v)) onChange(v);
  });
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return field(label, el);
}

function select(label, value, options, onChange) {
  const el = h('select', { class: 'select' }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return field(label, el);
}

function readonly(label, value) {
  return field(label, h('div', { class: 'input', style: { color: 'var(--muted)' } }, value));
}

