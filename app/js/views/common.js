import { h, icon, iconBtn, fmtTime, timeAgo, STATUS_LABEL, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';

const NEXT_STATUS = { draft: 'editing', editing: 'ready', ready: 'draft' };

export function projectCard(p, { onChange } = {}) {
  const open = () => (location.hash = `/editor/${p.id}`);
  const thumb = h(
    'div',
    {
      class: `pthumb ${p.style === 'pixel' ? '' : 'smooth'}`,
      style: p.hasThumb ? { backgroundImage: `url("${api.fileUrl(p.id, '.editionflow/thumb.png')}?t=${p.updated}")` } : null,
    },
    p.hasThumb ? null : h('div', { class: 'placeholder' }, icon('logo', 46)),
    h('span', { class: 'dur' }, fmtTime(p.duration))
  );
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn(e);
  };
  const badge = h(
    'button',
    {
      class: `badge ${p.status}`,
      title: 'Cambiar estado',
      onclick: stop(async () => {
        await api.patchProject(p.id, { status: NEXT_STATUS[p.status] || 'draft' });
        onChange?.();
      }),
    },
    STATUS_LABEL[p.status] || p.status
  );
  return h(
    'article',
    { class: 'card pcard', onclick: open, title: p.title },
    thumb,
    h(
      'div',
      { class: 'pbody' },
      h('h3', {}, p.title),
      h('div', { class: 'meta' }, `${p.shots} ${p.shots === 1 ? 'plano' : 'planos'} · ${p.lookName}`),
      h(
        'div',
        { class: 'pfoot' },
        badge,
        h('span', { class: 'ago' }, timeAgo(p.updated)),
        iconBtn('folder', 'Abrir carpeta', stop(() => api.reveal(p.id).then((r) => toast('Carpeta: ' + r.path)))),
        iconBtn('copy', 'Duplicar', stop(async () => {
          await api.duplicate(p.id);
          toast('Proyecto duplicado', 'ok');
          onChange?.();
        })),
        iconBtn('box', 'Carpeta de renders', stop(() => api.reveal(p.id, 'renders'))),
        iconBtn('trash', 'Eliminar', stop(async () => {
          if (!(await confirmDialog('Eliminar proyecto', `"${p.title}" se moverá a la papelera del workspace (.trash).`, { okLabel: 'Eliminar', danger: true }))) return;
          await api.deleteProject(p.id);
          toast('Proyecto eliminado');
          onChange?.();
        }), 'danger')
      )
    )
  );
}
