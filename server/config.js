import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from './util.js';

const CONFIG_DIR = process.env.EDITIONFLOW_HOME || path.join(os.homedir(), '.editionflow');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  workspace: process.env.EDITIONFLOW_WORKSPACE || path.join(os.homedir(), 'EditionFlow Projects'),
  // Command used to launch Claude Code. It uses whatever account you are signed in with
  // (`claude login`), so it runs on your normal Claude subscription.
  claudePath: process.env.EDITIONFLOW_CLAUDE || 'claude',
  model: '', // empty = Claude Code default
  permissionMode: 'acceptEdits',
  allowWeb: true, // lets Claude research topics (WebSearch / WebFetch)
  ffmpegPath: 'ffmpeg',
  convertToMp4: true,
  autoCommit: true,
  quickActions: [
    { scope: 'whole', label: 'Revisa todo el vídeo y arregla lo que se vea mal' },
    { scope: 'whole', label: 'Haz todo el texto en pantalla más fácil de leer en un móvil' },
    { scope: 'whole', label: 'Comprueba que cada visual cae en su palabra hablada' },
    { scope: 'shot', label: 'Mejora la iluminación y la profundidad' },
    { scope: 'shot', label: 'Añade más movimiento de cámara y vida al fondo' },
    { scope: 'selection', label: 'Haz que esto destaque más' },
  ],
};

let current = null;

export async function loadConfig() {
  if (current) return current;
  const saved = await readJson(CONFIG_FILE, {});
  current = { ...DEFAULTS, ...saved };
  await fs.mkdir(current.workspace, { recursive: true });
  return current;
}

export async function saveConfig(patch) {
  const cfg = await loadConfig();
  const allowed = Object.keys(DEFAULTS);
  for (const key of Object.keys(patch || {})) {
    if (allowed.includes(key)) cfg[key] = patch[key];
  }
  await fs.mkdir(cfg.workspace, { recursive: true });
  await writeJson(CONFIG_FILE, cfg);
  return cfg;
}

export function configPath() {
  return CONFIG_FILE;
}
