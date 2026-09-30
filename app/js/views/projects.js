import { h, icon, btn, toast, promptDialog } from '../ui.js';
import { api } from '../api.js';
import { projectCard } from './common.js';
import { openNewProject } from './newProject.js';
import { refreshStatus } from '../main.js';

export async function render(root) {
  let filter = 'all';
  let query = '';
  let projects = [];

  const grid = h('div', { class: 'project-grid' });
  const seg = h('div', { class: 'segmented' });
  const search = h('input', { placeholder: 'Buscar proyectos', oninput: (e) => { query = e.target.value.toLowerCase(); draw(); } });

  const filters = [['all', 'Todos'], ['draft', 'Borrador'], ['editing', 'Editando'], ['ready', 'Listo']];
  const drawSeg = () =>
    seg.replaceChildren(...filters.map(([id, label]) => h('button', { class: filter === id ? 'on' : '', onclick: () => { filter = id; drawSeg(); draw(); } }, label)));

  function draw() {
    const list = projects.filter((p) => (filter === 'all' || p.status === filter) && (!query || p.title.toLowerCase().includes(query)));
    if (!projects.length) {
      grid.replaceChildren(
        h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, icon('editor', 30), h('h3', {}, 'Todavía no hay proyectos'), h('p', {}, 'Crea uno con un tema o un guion y Claude construirá el vídeo.'), btn('Nuevo proyecto', { icon: 'plus', variant: 'primary', onClick: () => openNewProject() }))
      );
      return;
    }
    grid.replaceChildren(...list.map((p) => projectCard(p, { onChange: load })));
    if (!list.length) grid.append(h('p', { class: 'muted' }, 'Ningún proyecto coincide.'));
  }

  async function load() {
    projects = await api.projects();
    draw();
    refreshStatus();
  }

  root.append(
    h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Proyectos'), h('p', {}, 'Cada proyecto es una carpeta en tu workspace con su propio historial.')),
        h(
          'div',
          { class: 'actions' },
          btn('Importar carpeta', {
            icon: 'upload',
            onClick: async () => {
              const path = await promptDialog('Importar carpeta', 'Ruta de una carpeta de proyecto de EditionFlow');
              if (!path) return;
              try {
                const { id } = await api.importFolder(path);
                toast('Proyecto importado', 'ok');
                location.hash = `/editor/${id}`;
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }),
          btn('Nuevo proyecto', { icon: 'plus', variant: 'primary', onClick: () => openNewProject() })
        )
      ),
      h('div', { class: 'toolbar' }, h('label', { class: 'search-box' }, icon('search', 19), search), seg),
      grid
    )
  );
  drawSeg();
  await load();
}
