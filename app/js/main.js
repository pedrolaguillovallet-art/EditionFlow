import { h, icon, toast } from './ui.js';
import { api } from './api.js';
import { openPalette } from './palette.js';
import { openNewProject } from './views/newProject.js';

export const app = {
  status: null,
  projectCount: 0,
  lastProject: localStorageGet('ef:lastProject'),
};

const VIEWS = {
  home: () => import('./views/home.js'),
  projects: () => import('./views/projects.js'),
  editor: () => import('./views/editor.js'),
  styles: () => import('./views/styles.js'),
  memory: () => import('./views/memory.js'),
  renders: () => import('./views/renders.js'),
  settings: () => import('./views/settings.js'),
};

const NAV = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'projects', label: 'Proyectos', icon: 'projects', count: true },
  { id: 'editor', label: 'Editor', icon: 'editor' },
  { section: 'Workspace' },
  { id: 'styles', label: 'Estilos', icon: 'styles' },
  { id: 'memory', label: 'Memoria', icon: 'memory' },
  { id: 'renders', label: 'Renders', icon: 'renders' },
];

let cleanup = null;
let current = null;

export function navigate(path) {
  if (location.hash !== '#' + path) location.hash = path;
  else route();
}

function parse() {
  const [, name = 'home', ...rest] = (location.hash.replace(/^#/, '') || '/home').split('/');
  return { name: VIEWS[name] ? name : 'home', param: rest.join('/') };
}

async function route() {
  const { name, param } = parse();
  if (name === 'editor' && !param) {
    if (app.lastProject) return navigate(`/editor/${app.lastProject}`);
    return navigate('/projects');
  }
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (e) {
      console.error(e);
    }
  }
  cleanup = null;
  current = name;
  document.getElementById('app').classList.toggle('rail', name === 'editor');
  renderSidebar();
  const view = document.getElementById('view');
  view.replaceChildren();
  view.className = `view view-${name}`;
  try {
    const mod = await VIEWS[name]();
    cleanup = await mod.render(view, param);
  } catch (err) {
    console.error(err);
    view.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty' }, icon('alert', 28), h('h3', {}, 'No se pudo abrir esta vista'), h('p', { class: 'muted' }, err.message))));
  }
}

export function setLastProject(id) {
  app.lastProject = id;
  try {
    localStorage.setItem('ef:lastProject', id);
  } catch {
    /* private mode */
  }
}

function localStorageGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const rail = current === 'editor';
  const collapsed = document.getElementById('app').classList.contains('collapsed');
  const st = app.status;
  const claudeOk = st?.claude?.ok;

  const item = (n) =>
    h(
      'a',
      { class: `nav-item ${current === n.id ? 'active' : ''}`, href: `#/${n.id}`, title: n.label },
      icon(n.icon, 19),
      h('span', { class: 'nav-label' }, n.label),
      n.count && app.projectCount ? h('span', { class: 'nav-count' }, app.projectCount) : null
    );

  sb.replaceChildren(
    h(
      'div',
      { class: 'brand' },
      h('a', { class: 'logo', href: '#/home', title: 'EditionFlow' }, icon('logo', 22)),
      h('div', { class: 'brand-name' }, h('b', {}, 'EditionFlow'), h('span', {}, 'Studio')),
      rail
        ? null
        : h('button', {
            class: 'icon-btn collapse-btn',
            title: collapsed ? 'Expandir' : 'Contraer',
            onclick: () => {
              document.getElementById('app').classList.toggle('collapsed');
              renderSidebar();
            },
          }, icon('sidebar', 17))
    ),
    h('button', { class: 'search-pill', onclick: () => openPalette(), title: 'Buscar o ejecutar (Ctrl K)' }, icon('search', 17), h('span', { class: 'nav-label' }, 'Buscar o ejecutar…'), h('kbd', { class: 'nav-label' }, 'Ctrl K')),
    h(
      'nav',
      { class: 'nav' },
      NAV.map((n) => (n.section ? h('div', { class: 'nav-section' }, n.section) : item(n)))
    ),
    h('div', { class: 'grow' }),
    h('button', { class: 'nav-item', onclick: () => openNewProject(), title: 'Nuevo proyecto' }, icon('plus', 19), h('span', { class: 'nav-label' }, 'Nuevo proyecto')),
    item({ id: 'settings', label: 'Ajustes', icon: 'settings' }),
    h(
      'a',
      { class: `claude-status ${claudeOk ? 'ok' : st ? 'bad' : ''}`, href: '#/settings', title: claudeOk ? `Claude Code ${st.claude.version}` : 'Claude Code no detectado' },
      h('span', { class: 'dot' }),
      h(
        'div',
        { class: 'nav-label' },
        h('b', {}, !st ? 'Comprobando Claude…' : claudeOk ? 'Claude conectado' : 'Claude no detectado'),
        h('small', {}, claudeOk ? `Tu cuenta de Claude · v${st.claude.version}` : st ? 'Instala Claude Code y haz login' : '')
      )
    )
  );
}

export async function refreshStatus() {
  try {
    const [status, projects] = await Promise.all([api.status(), api.projects()]);
    app.status = status;
    app.projectCount = projects.length;
  } catch (err) {
    toast('No hay conexión con el servidor local: ' + err.message, 'error');
  }
  renderSidebar();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  }
});

window.addEventListener('hashchange', route);
route();
refreshStatus();
