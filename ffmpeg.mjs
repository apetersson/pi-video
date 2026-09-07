import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
export function installHint(platform = process.platform) {
  if (platform === 'darwin') return 'Please install ffmpeg with: brew install ffmpeg';
  if (platform === 'win32') return 'Please install ffmpeg with: winget install Gyan.FFmpeg';
  return 'Please install ffmpeg using your package manager (Debian/Ubuntu: sudo apt install ffmpeg).';
}
export async function findFfmpeg({override = process.env.PI_VIDEO_FFMPEG, probe = path => exec(path, ['-version'], {timeout: 5000}), platform = process.platform} = {}) {
  const executable = override || 'ffmpeg';
  try { await probe(executable); return executable; } catch {
    throw new Error(`pi-video could not run ${override ? 'PI_VIDEO_FFMPEG' : 'ffmpeg on PATH'}. ${installHint(platform)} Then restart pi so it receives the updated PATH, or set PI_VIDEO_FFMPEG to the executable.`);
  }
}
