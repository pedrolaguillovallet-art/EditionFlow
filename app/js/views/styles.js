import { h, btn, modal, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { createLib } from '../engine/lib.js';
import { PostFX } from '../engine/post.js';
import { openNewProject } from './newProject.js';

const SAMPLE = {
  pixel_world: { text: 'NIVEL 1', kicker: '> PRESS START', mood: 'night' },
  paper_doc: { text: '1873', headline: 'Letters patent', kicker: 'the story goes…' },
  flat_shapes: { text: 'El 72 % de los datos', kicker: 'Motion flat', values: [3, 7, 5, 9], labels: ['A', 'B', 'C', 'D'] },
};

export async function render(root) {
  const { styles, palettes } = await api.styles();
  const previews = [];
  let raf = 0;
  let hovered = null;

  const page = h('div', { class: 'page' });
  page.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Estilos'), h('p', {}, 'Presets de estilo y look. Cada look fija resolución, paleta, post-proceso y las reglas que Claude sigue al programar escenas.')),
      h('div', { class: 'actions' }, btn('Nuevo estilo', { icon: 'plus', variant: 'primary', onClick: () => editStyle(null, palettes, () => location.reload()) })))
  );

  for (const style of styles) {
    const mod = await import(`/api/templates/${style.template || 'flat_shapes'}.js`).catch(() => null);
    const cards = style.looks.map((look) => {
      const colors = Array.isArray(look.palette) ? look.palette : palettes[look.palette] || [];
      const full = { ...look, colors };
      const canvas = h('canvas', { width: look.pixel ? look.width : 640, height: look.pixel ? look.height : 360, class: look.pixel ? '' : 'smooth' });
      const low = document.createElement('canvas');
      low.width = look.width;
      low.height = look.height;
      const g = low.getContext('2d', { willReadFrequently: true });
      const lib = createLib(full);
      const fx = new PostFX(full);
      const pv = { canvas, low, g, lib, fx, look: full, mod, t: 2.2, template: style.template };
      previews.push(pv);
      drawPreview(pv);
      canvas.addEventListener('mouseenter', () => { hovered = pv; pv.t0 = performance.now(); loop(); });
      canvas.addEventListener('mouseleave', () => { hovered = null; });
      return h('article', { class: 'card look-card' },
        canvas,
        h('div', { class: 'row' }, h('h4', {}, look.name), h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `${look.width}×${look.height}${look.pixel ? ' · pixel' : ''}`)),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, look.hint || ''),
        h('div', { class: 'swatches' }, colors.map((c) => h('i', { style: { background: c }, title: c }))),
        h('div', { class: 'row' }, btn('Nuevo proyecto con este look', { size: 'sm', icon: 'plus', onClick: () => openNewProject({ style: style.id, look: look.id }) })));
    });
    page.append(
      h('section', { class: 'style-block' },
        h('header', {},
          h('h2', {}, style.name),
          h('span', { class: 'muted' }, style.description),
          h('span', { class: 'grow' }),
          style.builtin ? h('span', { class: 'badge draft' }, 'integrado') : h('div', { class: 'row' },
            btn('Editar', { size: 'sm', icon: 'edit', onClick: () => editStyle(style, palettes, () => location.reload()) }),
            btn('Eliminar', { size: 'sm', icon: 'trash', variant: 'danger', onClick: async () => {
              if (!(await confirmDialog('Eliminar estilo', `¿Eliminar "${style.name}"? Los proyectos que lo usan volverán al estilo por defecto.`, { danger: true, okLabel: 'Eliminar' }))) return;
              await api.deleteStyle(style.id);
              location.reload();
            } }))),
        style.rules?.length ? h('ul', { class: 'rules', style: { marginBottom: '16px' } }, style.rules.map((r) => h('li', {}, r))) : null,
        h('div', { class: 'style-grid' }, cards))
    );
  }
  page.append(h('p', { class: 'muted' }, 'Pasa el ratón por una vista previa para animarla.'));
  root.append(page);

  function loop() {
    cancelAnimationFrame(raf);
    if (!hovered) return;
    hovered.t = (performance.now() - hovered.t0) / 1000;
    drawPreview(hovered);
    raf = requestAnimationFrame(loop);
  }
  return () => cancelAnimationFrame(raf);
}

function drawPreview(pv) {
  const { g, low, lib, fx, look, mod, canvas } = pv;
  const W = look.width, H = look.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  try {
    mod?.default.draw(g, { t: pv.t, p: Math.min(1, pv.t / 6), dur: 6, time: pv.t, W, H, lib, params: SAMPLE[pv.template] || {}, palette: lib.palette, fonts: lib.fonts, look, state: {}, rng: lib.rng(1) });
  } catch (err) {
    lib.clear(g, '#300');
    lib.text(g, err.message, 8, 8, { size: 12, color: '#fff' });
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  fx.apply(g, W, H, pv.t);
  const out = canvas.getContext('2d');
  out.imageSmoothingEnabled = !look.pixel;
  out.drawImage(low, 0, 0, canvas.width, canvas.height);
}

function editStyle(style, palettes, done) {
  const s = style ? JSON.parse(JSON.stringify(style)) : { name: '', description: '', template: 'pixel_world', rules: [], looks: [{ name: 'Look 1', width: 480, height: 270, pixel: true, palette: 'endesga32', dither: 0.2, hint: '', post: {} }] };
  const name = h('input', { class: 'input', value: s.name, placeholder: 'p. ej. Cómic retro' });
  const desc = h('input', { class: 'input', value: s.description || '' });
  const tpl = h('select', { class: 'select' }, [['pixel_world', 'Mundo pixel'], ['paper_doc', 'Documento de papel'], ['flat_shapes', 'Formas planas']].map(([v, l]) => h('option', { value: v }, l)));
  tpl.value = s.template || 'pixel_world';
  const rules = h('textarea', { class: 'textarea', rows: 5, value: (s.rules || []).join('\n'), placeholder: 'Una regla por línea. Ej: Siempre contorno negro de 1 px en personajes.' });
  const looksBox = h('div', { class: 'col' });
  const lookRows = [];

  const addLook = (l) => {
    const paletteSel = h('select', { class: 'select' }, [...Object.keys(palettes).map((p) => h('option', { value: p }, p)), h('option', { value: '__custom' }, 'Personalizada…')]);
    const custom = h('input', { class: 'input', placeholder: '#101010, #ff0044, #ffffff…' });
    if (Array.isArray(l.palette)) {
      paletteSel.value = '__custom';
      custom.value = l.palette.join(', ');
    } else paletteSel.value = l.palette || 'flat';
    const toggleCustom = () => custom.classList.toggle('hidden', paletteSel.value !== '__custom');
    paletteSel.addEventListener('change', toggleCustom);
    toggleCustom();
    const row = {
      name: h('input', { class: 'input', value: l.name }),
      width: h('input', { class: 'input', type: 'number', value: l.width }),
      height: h('input', { class: 'input', type: 'number', value: l.height }),
      pixel: h('input', { type: 'checkbox', checked: Boolean(l.pixel) }),
      dither: h('input', { class: 'input', type: 'number', step: '0.05', min: 0, max: 1, value: l.dither || 0 }),
      grain: h('input', { class: 'input', type: 'number', step: '0.01', value: l.post?.grain || 0 }),
      vignette: h('input', { class: 'input', type: 'number', step: '0.05', value: l.post?.vignette || 0 }),
      scanlines: h('input', { class: 'input', type: 'number', step: '0.05', value: l.post?.scanlines || 0 }),
      hint: h('input', { class: 'input', value: l.hint || '', placeholder: 'Descripción corta del look' }),
      paletteSel,
      custom,
      id: l.id,
      fonts: l.fonts,
    };
    lookRows.push(row);
    const lab = (t, c) => h('label', { class: 'field' }, h('span', { class: 'label' }, t), c);
    looksBox.append(
      h('div', { class: 'card', style: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'grid-3' }, lab('Nombre', row.name), lab('Ancho', row.width), lab('Alto', row.height)),
        h('div', { class: 'grid-2' }, lab('Paleta', paletteSel), lab('Dither (0–1)', row.dither)),
        custom,
        h('div', { class: 'grid-3' }, lab('Grano', row.grain), lab('Viñeta', row.vignette), lab('Scanlines', row.scanlines)),
        lab('Descripción', row.hint),
        h('label', { class: 'switch' }, row.pixel, h('span', {}, 'Pixel art (escalado nítido + cuantizar a la paleta)')))
    );
  };
  (s.looks || []).forEach(addLook);

  const m = modal(style ? `Editar ${style.name}` : 'Nuevo estilo', [
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Nombre'), name),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Descripción'), desc),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Escena plantilla inicial'), tpl),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Reglas para Claude'), rules),
    h('div', { class: 'row' }, h('b', {}, 'Looks'), h('span', { class: 'grow' }), btn('Añadir look', { size: 'sm', icon: 'plus', onClick: () => addLook({ name: `Look ${lookRows.length + 1}`, width: 1280, height: 720, pixel: false, palette: 'flat' }) })),
    looksBox,
  ], {
    width: 760,
    footer: [
      btn('Cancelar', { variant: 'ghost', onClick: () => m.close() }),
      btn('Guardar estilo', {
        variant: 'primary',
        icon: 'check',
        onClick: async () => {
          try {
            await api.saveStyle({
              id: style?.id,
              name: name.value,
              description: desc.value,
              template: tpl.value,
              rules: rules.value.split('\n').map((r) => r.trim()).filter(Boolean),
              looks: lookRows.map((r, i) => ({
                id: r.id || `look${i + 1}`,
                name: r.name.value,
                width: Number(r.width.value),
                height: Number(r.height.value),
                pixel: r.pixel.checked,
                palette: r.paletteSel.value === '__custom' ? r.custom.value.split(/[\s,]+/).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)) : r.paletteSel.value,
                dither: Number(r.dither.value),
                hint: r.hint.value,
                fonts: r.fonts,
                post: { grain: Number(r.grain.value) || 0, vignette: Number(r.vignette.value) || 0, scanlines: Number(r.scanlines.value) || 0 },
              })),
            });
            toast('Estilo guardado', 'ok');
            m.close();
            done();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      }),
    ],
  });
}

