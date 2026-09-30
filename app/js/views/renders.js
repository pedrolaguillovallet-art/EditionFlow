import { h, icon, iconBtn, toast, timeAgo, fmtBytes, confirmDialog } from '../ui.js';
import { api } from '../api.js';

export async function render(root) {
  const grid = h('div', { class: 'render-grid' });
  const load = async () => {
    const list = await api.renders();
    if (!list.length) {
      grid.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, icon('renders', 30), h('h3', {}, 'Aún no hay renders'), h('p', {}, 'Exporta un vídeo desde el editor y aparecerá aquí.')));
      return;
    }
    grid.replaceChildren(
      ...list.map((r) =>
        h('article', { class: 'card render-card' },
          h('video', { src: api.fileUrl(r.project, r.file), controls: true, preload: 'metadata' }),
          h('div', { class: 'pbody' },
            h('h3', { style: { fontSize: '16px' } }, r.title),
            h('div', { class: 'meta mono', style: { fontSize: '12px' } }, r.file.replace('renders/', '')),
            h('div', { class: 'pfoot' },
              h('span', { class: 'ago', style: { marginLeft: 0 } }, `${timeAgo(r.time)} · ${fmtBytes(r.size)}`),
              h('a', { class: 'icon-btn', href: api.fileUrl(r.project, r.file), download: r.file.split('/').pop(), title: 'Descargar' }, icon('download', 17)),
              iconBtn('folder', 'Abrir carpeta', () => api.reveal(r.project, 'renders')),
              iconBtn('editor', 'Abrir proyecto', () => (location.hash = `/editor/${r.project}`)),
              iconBtn('trash', 'Eliminar', async () => {
                if (!(await confirmDialog('Eliminar render', 'Se borra el archivo de vídeo del disco.', { danger: true, okLabel: 'Eliminar' }))) return;
                await api.deleteRender(r.project, r.file);
                toast('Render eliminado');
                load();
              }, 'danger'))))
      )
    );
  };
  root.append(h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Renders'), h('p', {}, 'Todas las exportaciones de tus proyectos.'))), grid));
  await load();
}
