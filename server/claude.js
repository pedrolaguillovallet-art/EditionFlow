import { execFile, spawn } from 'node:child_process';
import path from 'node:path';

const isWin = process.platform === 'win32';
// On Windows `claude` is a .cmd shim, so it has to go through the shell; quote paths with spaces.
const cmdFor = (p) => (isWin && /\s/.test(p) && !p.startsWith('"') ? `"${p}"` : p);

/** Is Claude Code installed? Returns { ok, version, error }. */
export function detectClaude(claudePath) {
  return new Promise((resolve) => {
    execFile(cmdFor(claudePath), ['--version'], { timeout: 15000, shell: isWin, windowsHide: true }, (err, stdout) => {
      if (err) resolve({ ok: false, error: err.code === 'ENOENT' ? 'No se encontró el comando de Claude Code' : err.message });
      else resolve({ ok: true, version: String(stdout).trim().split(/\s+/)[0] });
    });
  });
}

function rel(dir, p) {
  if (!p) return '';
  const r = path.relative(dir, String(p));
  return r && !r.startsWith('..') ? r.split(path.sep).join('/') : String(p);
}

function short(s, n = 70) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function describeTool(dir, name, input = {}) {
  switch (name) {
    case 'Read': return `Leyendo ${rel(dir, input.file_path)}`;
    case 'Write': return `Escribiendo ${rel(dir, input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editando ${rel(dir, input.file_path)}`;
    case 'Glob': return `Buscando archivos ${short(input.pattern)}`;
    case 'Grep': return `Buscando ${short(input.pattern)}`;
    case 'WebSearch': return `Investigando: ${short(input.query)}`;
    case 'WebFetch': return `Leyendo ${short(input.url)}`;
    case 'TodoWrite': return 'Planificando los pasos';
    case 'Task':
    case 'Agent': return `Subtarea: ${short(input.description)}`;
    default: return name;
  }
}

/**
 * Run one Claude Code turn in `dir`, streaming events to `onEvent`.
 * Uses the account Claude Code is logged into — i.e. the user's normal Claude plan.
 */
export function runClaude({ dir, prompt, sessionId, config, onEvent }) {
  const tools = ['Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep', 'TodoWrite'];
  if (config.allowWeb) tools.push('WebSearch', 'WebFetch');
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', config.permissionMode || 'acceptEdits',
    '--allowedTools', tools.join(','),
    '--disallowedTools', 'Bash',
  ];
  if (config.model) args.push('--model', config.model);
  if (sessionId && /^[\w-]+$/.test(sessionId)) args.push('--resume', sessionId);

  // If EditionFlow itself was started from inside a Claude Code terminal, don't let the
  // child think it is a nested session of that one.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(cmdFor(config.claudePath || 'claude'), args, {
    cwd: dir,
    shell: isWin,
    detached: !isWin,
    windowsHide: true,
    env,
  });

  let buffer = '';
  let session = sessionId || null;
  let finalText = '';
  let finished = false;
  let stopped = false;
  const stderr = [];

  const done = new Promise((resolve) => {
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        handle(msg);
      }
    });
    child.stderr.on('data', (c) => stderr.push(c.toString('utf8')));
    child.on('error', (err) => {
      onEvent({ kind: 'error', text: err.code === 'ENOENT' ? 'No se encontró Claude Code. Instálalo y ejecuta `claude` una vez para iniciar sesión.' : err.message });
      finish({ ok: false, session, text: finalText });
    });
    child.on('close', (code) => {
      if (stopped) {
        onEvent({ kind: 'stopped' });
        finish({ ok: false, stopped: true, session, text: finalText });
        return;
      }
      if (code !== 0 && !finished) {
        const err = stderr.join('').trim() || `Claude Code terminó con código ${code}`;
        onEvent({ kind: 'error', text: short(err, 600) });
      }
      finish({ ok: code === 0, session, text: finalText });
    });

    function handle(msg) {
      if (msg.session_id) session = msg.session_id;
      if (msg.type === 'system' && msg.subtype === 'init') {
        onEvent({ kind: 'init', session, model: msg.model });
      } else if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text?.trim()) {
            finalText = block.text;
            onEvent({ kind: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            onEvent({ kind: 'tool', id: block.id, name: block.name, label: describeTool(dir, block.name, block.input), file: rel(dir, block.input?.file_path) });
          }
        }
      } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.is_error) {
            onEvent({ kind: 'tool_error', id: block.tool_use_id, text: short(typeof block.content === 'string' ? block.content : JSON.stringify(block.content), 200) });
          }
        }
      } else if (msg.type === 'result') {
        if (msg.result && msg.result !== finalText) finalText = msg.result;
        onEvent({
          kind: 'result',
          ok: !msg.is_error,
          text: finalText,
          session,
          cost: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          turns: msg.num_turns,
        });
      }
    }
  });

  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  const stop = () => {
    if (finished || stopped) return;
    stopped = true;
    try {
      if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  };

  return { done, stop };
}

/** Compose the message Claude receives from the editor's scope selector. */
export function composePrompt({ message, scope, shot, selection, snapshot, timelineDuration }) {
  const lines = [];
  if (scope === 'shot' && shot) {
    lines.push(
      `[Alcance: PLANO ${shot.index + 1} — id "${shot.id}", escena ${shot.scene}, ${shot.start.toFixed(2)}s → ${(shot.start + shot.duration).toFixed(2)}s]`,
      shot.narration ? `Narración de este plano: "${shot.narration}"` : '',
      'Cambia solo este plano salvo que sea imprescindible tocar otro. Si su escena la comparten otros planos, usa params o crea una escena nueva para no romperlos.'
    );
  } else if (scope === 'selection' && selection) {
    const parts = [];
    if (selection.range) parts.push(`rango de tiempo ${selection.range[0].toFixed(2)}s → ${selection.range[1].toFixed(2)}s`);
    if (selection.point) parts.push(`punto (${selection.point.x}, ${selection.point.y}) en coordenadas internas W×H en el instante ${selection.time.toFixed(2)}s`);
    if (selection.item) parts.push(`elemento de la línea de tiempo: ${selection.item}`);
    lines.push(`[Alcance: SELECCIÓN — ${parts.join('; ') || 'ver captura'}]`);
    if (shot) lines.push(`Está dentro del plano ${shot.index + 1} (id "${shot.id}", escena ${shot.scene}).`);
    lines.push('Limita los cambios a lo seleccionado.');
  } else {
    lines.push(`[Alcance: VÍDEO COMPLETO — duración actual ${timelineDuration.toFixed(1)}s]`);
  }
  if (snapshot) lines.push(`Captura del preview en ese momento: ${snapshot} (ábrela con Read para verla).`);
  lines.push('', message);
  return lines.filter((l) => l !== '').join('\n');
}
