import { h, icon } from './ui.js';
import { api } from './api.js';

// Ctrl+K command palette: jump to projects or run app commands.
export async function openPalette() {
  if (document.querySelector('.palette')) return;
  const { navigate } = await import('./main.js');
  const { openNewProject } = await import('./views/newProject.js');
  const commands = [
    { label: 'Nuevo proyecto', icon: 'plus', run: () => openNewProject() },
    { label: 'Ir a Inicio', icon: 'home', run: () => navigate('/home') },
    { label: 'Ir a Proyectos', icon: 'projects', run: () => navigate('/projects') },
    { label: 'Abrir el editor', icon: 'editor', run: () => navigate('/editor') },
    { label: 'Estilos y presets', icon: 'styles', run: () => navigate('/styles') },
    { label: 'Memoria de Claude', icon: 'memory', run: () => navigate('/memory') },
    { label: 'Renders', icon: 'renders', run: () => navigate('/renders') },
    { label: 'Ajustes', icon: 'settings', run: () => navigate('/settings') },
  ];
  let projects = [];
  try {
    projects = (await api.projects()).map((p) => ({ label: p.title, hint: `${p.shots} planos · ${p.lookName}`, icon: 'editor', run: () => navigate(`/editor/${p.id}`) }));
  } catch {
    /* offline */
  }
  const all = [...projects, ...commands];
  let sel = 0;
  let items = all;
  const input = h('input', { class: 'palette-input', placeholder: 'Busca proyectos o comandos…' });
  const list = h('div', { class: 'palette-list' });
  const close = () => backdrop.remove();
  const draw = () => {
    list.replaceChildren(
      ...items.slice(0, 40).map((c, i) =>
        h('button', { class: `palette-item ${i === sel ? 'sel' : ''}`, onmousemove: () => { if (sel !== i) { sel = i; draw(); } }, onclick: () => { close(); c.run(); } }, icon(c.icon, 16), h('span', {}, c.label), c.hint ? h('small', {}, c.hint) : null)
      )
    );
    if (!items.length) list.append(h('div', { class: 'muted pad' }, 'Sin resultados'));
  };
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    items = all.filter((c) => c.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
    sel = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); }
    else if (e.key === 'Escape') close();
  });
  const backdrop = h('div', { class: 'backdrop top', onmousedown: (e) => e.target === backdrop && close() }, h('div', { class: 'palette' }, h('div', { class: 'palette-search' }, icon('search', 18), input), list));
  document.body.append(backdrop);
  draw();
  input.focus();
}
