import { h, icon, btn } from '../ui.js';
import { api } from '../api.js';
import { app, navigate } from '../main.js';
import { projectCard } from './common.js';
import { openNewProject } from './newProject.js';

export async function render(root) {
  const [status, projects] = await Promise.all([api.status().catch(() => null), api.projects().catch(() => [])]);
  const hour = new Date().getHours();
  const greet = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  const check = (ok, title, okText, badText) =>
    h('div', { class: `check ${ok ? 'ok' : 'bad'}` }, icon(ok ? 'check' : 'alert', 18), h('div', {}, h('b', {}, title), h('small', {}, ok ? okText : badText)));

  const recent = projects.slice(0, 4);
  root.append(
    h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'hero' },
        h(
          'section',
          { class: 'card hero-card' },
          h('span', { class: 'muted' }, greet),
          h('h1', {}, 'Vídeos animados con código, dirigidos por Claude.'),
          h('p', { class: 'muted', style: { margin: 0, fontSize: '15px', maxWidth: '620px' } },
            'Elige un estilo, pega un guion o un tema y Claude escribe las escenas. Tú ajustas en la línea de tiempo, seleccionas lo que quieres cambiar y pides retoques plano a plano.'),
          h('div', { class: 'row wrap', style: { marginTop: '8px' } },
            btn('Nuevo proyecto', { icon: 'plus', variant: 'primary', onClick: () => openNewProject() }),
            app.lastProject ? btn('Continuar editando', { icon: 'editor', onClick: () => navigate(`/editor/${app.lastProject}`) }) : null,
            btn('Ver estilos', { icon: 'styles', variant: 'ghost', onClick: () => navigate('/styles') }))
        ),
        h(
          'section',
          { class: 'card checklist' },
          h('b', {}, 'Tu estudio'),
          check(status?.claude?.ok, 'Claude Code', `Conectado con tu cuenta de Claude (v${status?.claude?.version})`, 'No encontrado: instala Claude Code y ejecuta `claude` para iniciar sesión.'),
          check(status?.git, 'Historial git', 'Cada cambio queda guardado y se puede restaurar', 'Instala git para tener historial y deshacer cambios de Claude'),
          check(status?.ffmpeg?.ok, 'ffmpeg (opcional)', 'Las exportaciones se convierten a MP4', 'Sin ffmpeg se exporta en WebM'),
          h('small', { class: 'muted mono' }, status?.workspace || '')
        )
      ),
      h('div', { class: 'section-title' }, 'Flujo de trabajo'),
      h(
        'div',
        { class: 'steps' },
        step(1, 'Estilo y guion', 'Elige estilo y look (pixel art, papel, motion). Sube la voz en off y pega el guion o solo el tema.'),
        step(2, 'Claude construye', 'Claude Code investiga, divide la narración en planos y programa cada escena siguiendo las reglas del estilo.'),
        step(3, 'Edita y exporta', 'Ajusta tiempos, textos, sonido y tarjetas en la línea de tiempo. Selecciona algo en el preview y pídele cambios. Exporta a vídeo.')
      ),
      recent.length ? h('div', { class: 'section-title' }, 'Recientes') : null,
      recent.length ? h('div', { class: 'project-grid' }, recent.map((p) => projectCard(p, { onChange: () => navigate('/home') }))) : null
    )
  );
}

function step(n, title, text) {
  return h('div', { class: 'card step' }, h('div', { class: 'n' }, n), h('h4', {}, title), h('p', {}, text));
}
