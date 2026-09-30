import { h, icon, btn, toast } from '../ui.js';
import { api } from '../api.js';
import { refreshStatus } from '../main.js';

export async function render(root) {
  const [cfg, status] = await Promise.all([api.config(), api.status()]);
  const f = {
    claudePath: h('input', { class: 'input mono', value: cfg.claudePath }),
    model: h('input', { class: 'input', value: cfg.model || '', placeholder: 'Por defecto de Claude Code', list: 'ef-models' }),
    permissionMode: h('select', { class: 'select' }, [['acceptEdits', 'acceptEdits — edita archivos sin preguntar (recomendado)'], ['default', 'default — Claude Code decide'], ['plan', 'plan — solo propone, no edita']].map(([v, l]) => h('option', { value: v }, l))),
    allowWeb: h('input', { type: 'checkbox', checked: cfg.allowWeb }),
    workspace: h('input', { class: 'input mono', value: cfg.workspace }),
    ffmpegPath: h('input', { class: 'input mono', value: cfg.ffmpegPath }),
    convertToMp4: h('input', { type: 'checkbox', checked: cfg.convertToMp4 }),
    autoCommit: h('input', { type: 'checkbox', checked: cfg.autoCommit }),
  };
  f.permissionMode.value = cfg.permissionMode;
  const models = h('datalist', { id: 'ef-models' }, ['sonnet', 'opus', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5'].map((m) => h('option', { value: m })));

  const lab = (t, c, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, t), c, hint ? h('span', { class: 'hint' }, hint) : null);
  const sw = (c, t) => h('label', { class: 'switch' }, c, h('span', {}, t));
  const stat = (ok, title, text) => h('div', { class: `check ${ok ? 'ok' : 'bad'}` }, icon(ok ? 'check' : 'alert', 18), h('div', {}, h('b', {}, title), h('small', {}, text)));

  root.append(
    h('div', { class: 'page', style: { maxWidth: '980px' } },
      h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Ajustes'), h('p', {}, `Configuración guardada en ${status.configFile}`))),
      h('section', { class: 'card checklist' },
        h('b', {}, 'Conexión con Claude'),
        stat(status.claude.ok, status.claude.ok ? `Claude Code v${status.claude.version}` : 'Claude Code no encontrado', status.claude.ok ? 'EditionFlow ejecuta Claude Code con la cuenta con la que hayas iniciado sesión (tu plan Pro/Max o tu API key). No hace falta configurar nada más.' : status.claude.error || ''),
        !status.claude.ok
          ? h('div', { class: 'col', style: { fontSize: '13.5px', color: 'var(--text-2)' } },
              h('span', {}, '1. Instala Claude Code:'), h('code', { class: 'mono' }, 'npm install -g @anthropic-ai/claude-code'),
              h('span', {}, '2. Ejecuta ', h('code', {}, 'claude'), ' una vez en un terminal e inicia sesión con tu cuenta de Claude.'),
              h('span', {}, '3. Vuelve aquí y pulsa "Comprobar de nuevo".'))
          : null,
        stat(status.git, 'git', status.git ? 'Historial y restauración de versiones activados' : 'Instala git para tener historial por proyecto'),
        stat(status.ffmpeg.ok, 'ffmpeg', status.ffmpeg.ok ? `v${status.ffmpeg.version}: exportación a MP4` : 'Opcional. Sin él, las exportaciones quedan en WebM'),
        h('div', {}, btn('Comprobar de nuevo', { size: 'sm', icon: 'refresh', onClick: () => location.reload() }))),
      h('div', { class: 'section-title' }, 'Claude Code'),
      h('section', { class: 'card', style: { padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' } },
        lab('Comando', f.claudePath, 'Normalmente "claude". Usa una ruta absoluta si no está en el PATH.'),
        lab('Modelo', f.model, 'Vacío = el modelo por defecto de tu cuenta. Acepta alias (sonnet, opus) o un id completo.'),
        models,
        lab('Modo de permisos', f.permissionMode),
        sw(f.allowWeb, 'Permitir búsqueda web (para investigar temas y datos)')),
      h('div', { class: 'section-title' }, 'Proyectos y exportación'),
      h('section', { class: 'card', style: { padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' } },
        lab('Carpeta del workspace', f.workspace, 'Cada proyecto es una subcarpeta con su repositorio git.'),
        lab('Comando ffmpeg', f.ffmpegPath),
        sw(f.convertToMp4, 'Convertir exportaciones a MP4 (H.264 + AAC) si ffmpeg está disponible'),
        sw(f.autoCommit, 'Guardar cada cambio como commit de git')),
      h('div', { class: 'row', style: { marginTop: '22px' } }, h('span', { class: 'grow' }),
        btn('Guardar ajustes', {
          variant: 'primary',
          icon: 'check',
          onClick: async () => {
            try {
              await api.saveConfig({
                claudePath: f.claudePath.value.trim() || 'claude',
                model: f.model.value.trim(),
                permissionMode: f.permissionMode.value,
                allowWeb: f.allowWeb.checked,
                workspace: f.workspace.value.trim(),
                ffmpegPath: f.ffmpegPath.value.trim() || 'ffmpeg',
                convertToMp4: f.convertToMp4.checked,
                autoCommit: f.autoCommit.checked,
              });
              toast('Ajustes guardados', 'ok');
              refreshStatus();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        })))
  );
}
