import { h, icon, iconBtn, btn, toast, modal, confirmDialog, timeAgo } from '../ui.js';
import { api } from '../api.js';
import { app } from '../main.js';
import { buildInspector } from './inspector.js';

const SCOPES = [
  ['selection', 'Selección'],
  ['shot', 'Plano'],
  ['whole', 'Vídeo completo'],
];

export class ClaudePanel {
  constructor(ed) {
    this.ed = ed;
    this.tab = 'chat';
    this.chat = [];
    this.live = null; // { steps: [], text, status }
    this.el = h('aside', { class: 'claude' });
    this.body = h('div', { class: 'claude-body' });
    this.suggest = h('div', { class: 'suggestions' });
    this.textarea = h('textarea', { class: 'textarea', placeholder: 'Describe un cambio, o haz clic en algo del preview primero…' });
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.send();
      }
      e.stopPropagation();
    });
    this.chip = h('div', { class: 'context-chip hidden' });
    this.scopeEl = h('div', { class: 'segmented sm' });
    this.sendBtn = h('button', { class: 'btn sm primary', onclick: () => (this.ed.running ? this.stop() : this.send()) });
    this.tabsEl = h('div', { class: 'tabs' });
    this.composer = h('div', { class: 'composer' }, this.chip, this.textarea, h('div', { class: 'composer-foot' }, this.scopeEl, h('span', { class: 'grow' }), this.sendBtn));
    this.el.append(
      h('div', { class: 'claude-head' }, h('h3', {}, icon('sparkles', 18), 'Claude'), this.tabsEl, iconBtn('plus', 'Nueva conversación', () => this.newSession())),
      this.body,
      this.suggest,
      this.composer
    );
  }

  async load() {
    this.chat = await api.chat(this.ed.id).catch(() => []);
    this.render();
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  render() {
    const tabs = [['chat', 'chat', 'Chat'], ['history', 'history', 'Historial'], ['inspect', 'edit', 'Inspector']];
    this.tabsEl.replaceChildren(...tabs.map(([id, ic, label]) => h('button', { class: this.tab === id ? 'on' : '', onclick: () => this.setTab(id) }, icon(ic, 14), label)));
    const chatMode = this.tab === 'chat';
    this.suggest.classList.toggle('hidden', !chatMode);
    this.composer.classList.toggle('hidden', !chatMode);
    if (this.tab === 'chat') this.renderChat();
    else if (this.tab === 'history') this.renderHistory();
    else this.renderInspector();
    this.renderComposer();
  }

  /* ---------------- chat ---------------- */

  renderChat() {
    const nodes = [];
    if (!this.chat.length && !this.live) {
      nodes.push(
        h('div', { class: 'empty', style: { padding: '34px 16px' } },
          icon('sparkles', 26),
          h('h3', {}, 'Dirige a Claude'),
          h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } }, 'Elige el alcance: haz clic en el preview (selección), selecciona un plano, o habla del vídeo completo. Claude edita las escenas y la línea de tiempo y el preview se recarga solo.'))
      );
    }
    for (const m of this.chat) nodes.push(...this.renderMessage(m));
    if (this.live) {
      nodes.push(...this.renderMessage({ role: 'assistant', ...this.live }, true));
    }
    this.body.replaceChildren(...nodes);
    this.body.scrollTop = this.body.scrollHeight;
  }

  renderMessage(m, live = false) {
    if (m.role === 'user') {
      return [h('div', { class: 'msg-user' }, h('div', {}, m.text), m.context ? h('div', { class: 'ctx' }, m.context) : null)];
    }
    const out = [];
    if (m.steps?.length) {
      out.push(h('div', { class: 'msg-steps' }, m.steps.map((s) => h('div', { title: s }, icon(stepIcon(s), 14), s))));
    }
    if (m.text) out.push(h('div', { class: 'msg-assistant', html: md(m.text) }));
    if (live && m.status === 'running') out.push(h('div', { class: 'thinking' }, h('span', { class: 'spinner' }), m.steps?.length ? 'Trabajando…' : 'Pensando…'));
    if (m.status === 'stopped') out.push(h('div', { class: 'msg-note stopped' }, icon('alert', 16), 'Detenido por ti.'));
    if (m.status === 'error') out.push(h('div', { class: 'msg-note error' }, icon('alert', 16), m.error || 'Algo salió mal.'));
    if (!live && m.time) {
      out.push(h('div', { class: 'msg-meta' }, timeAgo(m.time), m.ms ? `· ${Math.round(m.ms / 1000)} s` : null, m.commit ? h('span', { class: 'mono', title: 'Commit en el historial' }, `· ${m.commit}`) : null));
    }
    return out;
  }

  renderComposer() {
    const ed = this.ed;
    this.scopeEl.replaceChildren(...SCOPES.map(([id, label]) => h('button', { class: ed.scope === id ? 'on' : '', onclick: () => ed.setScope(id) }, label)));
    const ctx = ed.contextLabel();
    this.chip.classList.toggle('hidden', !ctx);
    if (ctx) {
      this.chip.replaceChildren(
        ed.pendingSnapshotUrl ? h('img', { src: ed.pendingSnapshotUrl }) : icon(ed.scope === 'shot' ? 'editor' : 'image', 14),
        h('span', { title: ctx }, ctx),
        iconBtn('x', 'Quitar', () => ed.clearContext())
      );
    }
    const running = ed.running;
    this.sendBtn.replaceChildren(icon(running ? 'stop' : 'send', 15), h('span', {}, running ? 'Detener' : 'Aplicar'));
    this.sendBtn.className = `btn sm ${running ? 'danger' : 'primary'}`;
    const claudeOk = app.status?.claude?.ok !== false;
    this.textarea.disabled = running;
    this.textarea.placeholder = claudeOk ? 'Describe un cambio, o haz clic en algo del preview primero…' : 'Claude Code no está disponible. Revisa Ajustes.';

    const actions = (ed.config?.quickActions || []).filter((a) => a.scope === ed.scope || (ed.scope === 'selection' && a.scope === 'shot'));
    this.suggest.replaceChildren(...actions.slice(0, 4).map((a) => h('button', { disabled: running, onclick: () => { this.textarea.value = a.label; this.send(); } }, a.label)));
    this.suggest.classList.toggle('hidden', this.tab !== 'chat' || !actions.length);
  }

  async send() {
    const ed = this.ed;
    const message = this.textarea.value.trim();
    if (!message || ed.running) return;
    this.textarea.value = '';
    await ed.runClaude({ message });
  }

  async stop() {
    await api.stopClaude(this.ed.id).catch(() => {});
  }

  async newSession() {
    if (this.ed.running) return;
    if (this.chat.length && !(await confirmDialog('Nueva conversación', 'Se borra el chat de este proyecto y Claude empieza sin el contexto anterior. El historial de cambios (git) se mantiene.', { okLabel: 'Empezar de cero' }))) return;
    await api.clearChat(this.ed.id);
    this.chat = [];
    this.setTab('chat');
  }

  help() {
    modal(
      'Cómo trabajar con Claude',
      h('div', { class: 'col', style: { color: 'var(--text-2)' } },
        h('p', {}, 'EditionFlow lanza ', h('b', {}, 'Claude Code'), ' en la carpeta del proyecto con tu cuenta habitual de Claude. Claude lee ', h('code', {}, 'CLAUDE.md'), ' (reglas del estilo, API de escenas y tu memoria) y edita ', h('code', {}, 'timeline.json'), ' y ', h('code', {}, 'scenes/*.js'), '.'),
        h('p', {}, h('b', {}, 'Selección:'), ' haz clic en el preview para marcar un punto, o Shift+arrastra en la línea de tiempo para un rango. Se adjunta una captura del fotograma.'),
        h('p', {}, h('b', {}, 'Plano:'), ' se envía el plano seleccionado (o el que está bajo el cabezal) con su narración.'),
        h('p', {}, h('b', {}, 'Vídeo completo:'), ' revisiones globales, estructura, ritmo…'),
        h('p', {}, 'Cada respuesta queda como un commit en ', h('b', {}, 'Historial'), ': puedes ver el diff y restaurar cualquier versión. ', h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, 'Enter'), ' envía.')
      ),
      { width: 560 }
    );
  }

  /* live events from the server stream */
  startLive(userEntry) {
    this.chat.push(userEntry);
    this.live = { steps: [], text: '', status: 'running' };
    this.setTab('chat');
  }

  onEvent(ev) {
    if (!this.live) return;
    if (ev.kind === 'tool') this.live.steps.push(ev.label);
    else if (ev.kind === 'text') this.live.text = ev.text;
    else if (ev.kind === 'result' && ev.text) this.live.text = ev.text;
    else if (ev.kind === 'error') {
      this.live.status = 'error';
      this.live.error = ev.text;
    } else if (ev.kind === 'stopped') this.live.status = 'stopped';
    else if (ev.kind === 'warning') toast(ev.text, 'error', 6000);
    if (this.tab === 'chat') this.renderChat();
  }

  async endLive() {
    this.live = null;
    await this.load();
  }

  /* ---------------- history ---------------- */

  async renderHistory() {
    this.body.replaceChildren(h('div', { class: 'muted' }, 'Cargando historial…'));
    const list = await api.history(this.ed.id).catch(() => []);
    if (this.tab !== 'history') return;
    if (!list.length) {
      this.body.replaceChildren(h('div', { class: 'empty' }, icon('git', 24), h('p', {}, 'Sin historial. ¿Está git instalado?')));
      return;
    }
    this.body.replaceChildren(
      h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Cada cambio (tuyo o de Claude) es un commit de git en la carpeta del proyecto.'),
      ...list.map((c, i) =>
        h('div', { class: 'history-item' },
          h('div', { class: 'top' }, icon(c.subject.startsWith('Claude') ? 'sparkles' : 'edit', 15), h('b', {}, c.subject), h('small', {}, timeAgo(c.time))),
          h('small', {}, `${c.short} · ${c.stat || ''}`),
          h('div', { class: 'row' },
            btn('Ver cambios', { size: 'sm', variant: 'ghost', icon: 'code', onClick: () => this.showDiff(c) }),
            i > 0 ? btn('Restaurar', { size: 'sm', variant: 'ghost', icon: 'history', onClick: () => this.restore(c) }) : h('small', {}, 'versión actual')))
      )
    );
  }

  async showDiff(c) {
    const { patch } = await api.commit(this.ed.id, c.hash);
    const pre = h('pre', { class: 'diff' });
    for (const line of patch.split('\n').slice(0, 4000)) {
      const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '';
      pre.append(h('span', { class: cls }, line + '\n'));
    }
    modal(c.subject, pre, { width: 900 });
  }

  async restore(c) {
    if (this.ed.running) return;
    if (!(await confirmDialog('Restaurar versión', `El proyecto volverá a como estaba en "${c.subject}". Se crea un commit nuevo, así que puedes deshacerlo.`, { okLabel: 'Restaurar' }))) return;
    await api.restore(this.ed.id, c.hash);
    toast('Versión restaurada', 'ok');
    await this.ed.reload();
    this.renderHistory();
  }

  /* ---------------- inspector ---------------- */

  renderInspector() {
    this.body.replaceChildren(buildInspector(this.ed));
  }
}

function stepIcon(s) {
  if (s.startsWith('Leyendo')) return 'script';
  if (s.startsWith('Editando') || s.startsWith('Escribiendo')) return 'edit';
  if (s.startsWith('Buscando') || s.startsWith('Investigando')) return 'search';
  return 'sparkles';
}

function md(text) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/^#+\s*(.+)$/gm, '<b>$1</b>');
}

