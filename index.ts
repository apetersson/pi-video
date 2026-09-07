import {prepareVideoContext, omitVideos, cleanVideoMarkers} from './attachments.mjs';
import {createReadToolDefinition, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {readFile} from 'node:fs/promises';
import {isVideo, filePath, makeRef, prepare, rewrite} from './core.mjs';
import {discoverVideo} from './capabilities.mjs';
import {findFfmpeg} from './ffmpeg.mjs';

export default function(pi: ExtensionAPI) {
  const builtin = createReadToolDefinition(process.cwd());
  let refs = new Map();
  let controller = new AbortController();
  pi.on('session_shutdown', () => { controller.abort(); controller = new AbortController(); refs.clear(); });
  pi.on('agent_end', () => { controller.abort(); controller = new AbortController(); });
  pi.on('session_start', async (_event, ctx) => {
    try { await findFfmpeg(); } catch (error) { ctx.ui.notify((error as Error).message, 'warning'); }
  });

  async function route(ctx: any) {
    const model = ctx.model;
    if (!model) return {supported: false, reason: 'Select a model before reading video.'};
    if (model.api !== 'openai-completions') return discoverVideo(model);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    const headers = new Headers();
    for (const source of [model.headers, auth.ok ? auth.headers : undefined]) {
      for (const [key, value] of Object.entries(source || {})) {
        if (typeof value === 'string') headers.set(key, value);
      }
    }
    if (auth.ok && auth.apiKey && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${auth.apiKey}`);
    const active = {...model, baseUrl: auth.ok && auth.baseUrl ? auth.baseUrl : model.baseUrl};
    return discoverVideo(active, {fetchJson: async (url: string) => {
      const response = await fetch(url, {headers, redirect: 'error', signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('Capability discovery failed');
      return response.json();
    }});
  }

  pi.registerTool({
    ...builtin,
    description: builtin.description + ' Also read local video files directly when the selected model advertises video input. Video is attached to the next model request; audio is not supplied.',
    async execute(id, params, signal, onUpdate, ctx) {
      if (!isVideo(params.path)) return builtin.execute(id, params, signal, onUpdate, ctx);
      if (params.offset !== undefined || params.limit !== undefined) throw Error('Line offset/limit do not apply to video.');
      const capability = await route(ctx);
      if (!capability.supported) throw Error(capability.reason);
      const ref = await makeRef(filePath(params.path, ctx.cwd), signal);
      onUpdate?.({content: [{type: 'text', text: 'Preparing video orientation and preview resolution…'}]});
      await prepare(ref, signal);
      return {content: [{type: 'text', text: `Read video ${ref.path}. Native video will be attached when the selected model supports video. No audio.`}], details: {piVideo: ref}};
    }
  });
  pi.on('context', async event => {
    const prepared = prepareVideoContext(event.messages);
    refs = prepared.refs;
    return {messages: prepared.messages};
  });
  pi.on('before_provider_request', async (event, ctx) => {
    const requestRefs = refs;
    if (!requestRefs.size) return cleanVideoMarkers(event.payload);
    try {
      const capability = await route(ctx);
      if (!capability.supported) {
        return omitVideos(event.payload, requestRefs, capability.reason);
      }
      return await rewrite(event.payload, requestRefs, async (ref: any) => readFile(await prepare(ref, controller.signal), {signal: controller.signal}), capability.format);
    } catch {
      // pi catches hook exceptions and sends the previous payload. Return an
      // explicit omission instead, so failures never send temporary markers or
      // claim that an unreadable/changed video was attached.
      return omitVideos(event.payload, requestRefs, 'Video could not be attached. Read the file again and check ffmpeg and the selected model configuration.');
    }
  });
}
