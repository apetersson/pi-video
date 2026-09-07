import videoExtension from './node_modules/pi-video/index.ts';
import {runHookTests} from './packed-hook-tests.mjs';
import {writeFile} from 'node:fs/promises';

export default function(pi: any) {
  // Register the actual packed extension through the real bundled pi loader/API.
  videoExtension(pi);
  pi.on('input', () => ({action: 'handled'}));
  globalThis.fetch = async () => { throw Error('Network disabled in packed CLI smoke'); };
  pi.on('session_start', async (_event: any, ctx: any) => {
    let report;
    try { report = await runHookTests(videoExtension); }
    catch (error) { report = {tests: 0, passed: 0, error: String(error)}; }
    await writeFile(process.env.PI_VIDEO_HOOK_REPORT!, JSON.stringify(report, null, 2) + '\n');
    ctx.shutdown();
  });
}
