import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

let cache = {};

export function detectFfmpeg(ffmpegPath = 'ffmpeg') {
  if (cache[ffmpegPath]) return cache[ffmpegPath];
  cache[ffmpegPath] = new Promise((resolve) => {
    execFile(ffmpegPath, ['-version'], { timeout: 10000, windowsHide: true }, (err, stdout) => {
      if (err) resolve({ ok: false });
      else resolve({ ok: true, version: String(stdout).split('\n')[0].replace('ffmpeg version ', '').split(' ')[0] });
    });
  });
  return cache[ffmpegPath];
}

/** Transcode a browser WebM recording into a widely compatible H.264/AAC MP4. */
export function webmToMp4(ffmpegPath, input, output) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      ['-y', '-i', input, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output],
      { timeout: 30 * 60 * 1000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      async (err, _o, stderr) => {
        if (err) {
          await fs.rm(output, { force: true });
          reject(new Error(String(stderr).split('\n').slice(-4).join(' ')));
        } else resolve(output);
      }
    );
  });
}
