import { h, btn, toast, iconBtn } from '../ui.js';
import { api } from '../api.js';

const EXAMPLE = `- Escribo para YouTube en español de España, tono cercano y con humor seco.
- El texto en pantalla nunca pasa de 5 palabras por línea y siempre es legible en un móvil.
- Prefiero cámaras lentas y constantes; nada de sacudidas salvo en impactos.
- Los números importantes aparecen grandes y en el color de acento.
- Cierra cada vídeo con un plano de 3 s con el título y "suscríbete" sutil.`;

export async function render(root) {
  const [{ text }, config] = await Promise.all([api.memory(), api.config()]);
  const ta = h('textarea', { class: 'textarea', rows: 14, value: text, placeholder: EXAMPLE });
  let actions = [...(config.quickActions || [])];
  const list = h('div', { class: 'col' });

  const drawActions = () =>
    list.replaceChildren(
      ...actions.map((a, i) => {
        const scope = h('select', { class: 'select', style: { width: '190px' } }, [['whole', 'Vídeo completo'], ['shot', 'Plano'], ['selection', 'Selección']].map(([v, l]) => h('option', { value: v }, l)));
        scope.value = a.scope;
        scope.addEventListener('change', () => (a.scope = scope.value));
        const label = h('input', { class: 'input', value: a.label });
        label.addEventListener('input', () => (a.label = label.value));
        return h('div', { class: 'row' }, scope, label, iconBtn('trash', 'Quitar', () => { actions.splice(i, 1); drawActions(); }, 'danger'));
      })
    );
  drawActions();

  root.append(
    h('div', { class: 'page', style: { maxWidth: '980px' } },
      h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Memoria'), h('p', {}, 'Lo que Claude debe recordar en todos tus proyectos. Se añade al CLAUDE.md de cada proyecto antes de cada ejecución.'))),
      h('section', { class: 'card', style: { padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('b', {}, 'Preferencias globales'),
        ta,
        h('div', { class: 'row' }, h('span', { class: 'muted grow', style: { fontSize: '13px' } }, 'Markdown libre. Sé concreto: tono, idioma, legibilidad, ritmo, cierres, cosas que no quieres.'),
          !text ? btn('Usar ejemplo', { variant: 'ghost', onClick: () => (ta.value = EXAMPLE) }) : null,
          btn('Guardar memoria', { variant: 'primary', icon: 'check', onClick: async () => { await api.saveMemory(ta.value); toast('Memoria guardada', 'ok'); } }))),
      h('div', { class: 'section-title' }, 'Acciones rápidas (presets de instrucciones)'),
      h('section', { class: 'card', style: { padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } }, 'Aparecen como botones encima del chat del editor según el alcance elegido.'),
        list,
        h('div', { class: 'row' },
          btn('Añadir acción', { icon: 'plus', variant: 'ghost', onClick: () => { actions.push({ scope: 'shot', label: '' }); drawActions(); } }),
          h('span', { class: 'grow' }),
          btn('Guardar acciones', { variant: 'primary', icon: 'check', onClick: async () => {
            actions = actions.filter((a) => a.label.trim());
            await api.saveConfig({ quickActions: actions });
            drawActions();
            toast('Acciones guardadas', 'ok');
          } })))
    )
  );
}
