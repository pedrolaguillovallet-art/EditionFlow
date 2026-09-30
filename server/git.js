import { execFile } from 'node:child_process';

let gitAvailable = null;

function run(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else resolve(stdout);
    });
  });
}

export async function hasGit() {
  if (gitAvailable !== null) return gitAvailable;
  try {
    await run(process.cwd(), ['--version']);
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

const IDENTITY = ['-c', 'user.name=EditionFlow', '-c', 'user.email=editionflow@localhost', '-c', 'commit.gpgsign=false'];

export async function initRepo(dir) {
  if (!(await hasGit())) return false;
  await run(dir, ['init', '-q']);
  return true;
}

/** Stage everything and commit. Returns the new hash, or null when nothing changed. */
export async function commitAll(dir, message) {
  if (!(await hasGit())) return null;
  try {
    await run(dir, ['add', '-A']);
    const status = await run(dir, ['status', '--porcelain']);
    if (!status.trim()) return null;
    await run(dir, [...IDENTITY, 'commit', '-q', '-m', message.slice(0, 400)]);
    return (await run(dir, ['rev-parse', '--short', 'HEAD'])).trim();
  } catch (err) {
    console.warn('[git] commit falló:', err.stderr || err.message);
    return null;
  }
}

export async function log(dir, limit = 80) {
  if (!(await hasGit())) return [];
  try {
    const out = await run(dir, ['log', `-n${limit}`, '--pretty=format:%h%x1f%H%x1f%ct%x1f%s', '--shortstat']);
    const entries = [];
    let last = null;
    for (const line of out.split('\n')) {
      if (line.includes('\x1f')) {
        const [short, hash, ts, subject] = line.split('\x1f');
        last = { short, hash, time: Number(ts) * 1000, subject, stat: '' };
        entries.push(last);
      } else if (line.trim() && last) {
        last.stat = line.trim();
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export async function restore(dir, hash) {
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Hash inválido');
  await run(dir, ['checkout', hash, '--', '.']);
  // Remove files that did not exist at that point (scenes Claude added later).
  const added = await run(dir, ['diff', '--name-only', '--diff-filter=A', hash, 'HEAD']);
  for (const f of added.split('\n').filter(Boolean)) {
    await run(dir, ['rm', '-q', '--cached', '--ignore-unmatch', f]).catch(() => {});
    await import('node:fs/promises').then((fs) => fs.rm(`${dir}/${f}`, { force: true }));
  }
  return commitAll(dir, `Restaurado a ${hash.slice(0, 7)}`);
}

export async function show(dir, hash) {
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Hash inválido');
  return run(dir, ['show', '--stat', '--patch', '--format=%s%n', hash]);
}
