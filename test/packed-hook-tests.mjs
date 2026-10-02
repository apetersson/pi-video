// Copied into a fresh npm host by test:pack. All runtime imports below resolve
// inside that host, never from the source tree or a global pi installation.
import {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rm, realpath} from 'node:fs/promises';
import {findPackageJSON} from 'node:module';
import {randomUUID} from 'node:crypto';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';

const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
const piRoot = dirname(dirname(piEntry));
const aiDist = join(dirname(findPackageJSON('@earendil-works/pi-ai', pathToFileURL(piEntry))), 'dist');
const fromFile = path => import(pathToFileURL(path).href);
const {convertMessages} = await fromFile(join(aiDist, 'api/openai-completions.js'));
const {convertResponsesMessages} = await fromFile(join(aiDist, 'api/openai-responses-shared.js'));
const {convertMessages: convertGoogle} = await fromFile(join(aiDist, 'api/google-shared.js'));
const {stream: streamAnthropic} = await fromFile(join(aiDist, 'api/anthropic-messages.js'));
const packageRoot = await realpath(process.env.PI_VIDEO_PACKAGE_ROOT);
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const {prepareVideoContext, omitVideos} = await fromFile(join(packageRoot, 'attachments.mjs'));
const {makeRef, rewrite} = await fromFile(join(packageRoot, 'core.mjs'));
const cost = {input:0, output:0, cacheRead:0, cacheWrite:0};
const model = {id:'video-model', name:'Mock video', provider:'mock-compatible', api:'openai-completions',
  baseUrl:'https://model.invalid/v1', input:['text','image'], reasoning:false, contextWindow:8192, maxTokens:1024, cost};
const ref = {version:1,path:'/mock/clip.mp4',size:5,sha256:'a'.repeat(64)};
const history = (ids=['call_123|fc_456'], references=ids.map(()=>ref)) => [
  {role:'user',content:'Describe the video.',timestamp:1},
  {role:'assistant',api:'openai-responses',provider:'openai',model:'source-model',timestamp:2,stopReason:'toolUse',
    content:ids.map(id=>({type:'toolCall',id,name:'read',arguments:{path:ref.path}}))},
  ...ids.map((id,i)=>({role:'toolResult',toolCallId:id,toolName:'read',isError:false,timestamp:3,
    content:[{type:'text',text:'Read video. Native video will be attached when supported.'}],details:{piVideo:references[i]}}))
];
const serialize = (messages, active=model) => ({model:active.id,messages:convertMessages(active,{messages},{}),stream:true});
const videos = payload => (payload.messages||[]).flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(block=>['input_video','video_url'].includes(block.type));
const noMarker = payload => assert.ok(!JSON.stringify(payload).includes('[pi-video-ref:'), 'Temporary marker leaked into request');

// The real bundled pi CLI imports this module through packed-driver.ts. Individual
// hook cases use captured registrations and isolated contexts, without inference.
export async function runHookTests(videoExtension) {
  const results=[];
  async function test(name, body) {
    const cleanup=[];
    let error;
    try {await body({mock,after:fn=>cleanup.push(fn)});} catch(cause) {error=cause;}
    for(const fn of cleanup) {try {await fn();} catch(cause) {error??=cause;}}
    mock.restoreAll();
    results.push({name,passed:!error,...(error?{error:String(error.stack||error)}:{})});
  }

async function harness(t) {
  assert.equal(JSON.parse(await readFile(join(piRoot,'package.json'),'utf8')).version,'1.0.0');
  const extension={handlers:new Map(),tools:new Map()};
  videoExtension({
    on(name, handler) { const handlers=extension.handlers.get(name)||[]; handlers.push(handler); extension.handlers.set(name,handlers); },
    registerTool(definition) { extension.tools.set(definition.name,{definition}); }
  });
  let active=model;
  const registry={getApiKeyAndHeaders:async()=>({ok:true,apiKey:'mock-secret',headers:{'X-Test':'mock'},baseUrl:'https://auth.invalid/v1'})};
  const context={cwd:process.cwd(),modelRegistry:registry,get model(){return active;},ui:{notify:()=>{}}};
  const runner={
    createContext:()=>context,
    async emitContext(messages) {
      let current=structuredClone(messages);
      for(const handler of extension.handlers.get('context')||[]) current=(await handler({messages:current},context))?.messages||current;
      return current;
    },
    async emitBeforeProviderRequest(payload) {
      let current=payload;
      for(const handler of extension.handlers.get('before_provider_request')||[]) current=(await handler({payload:current},context))??current;
      return current;
    },
    async emit(event) {for(const handler of extension.handlers.get(event.type)||[]) await handler(event,context);}
  };
  return {extension,runner,registry,setModel:value=>{active=value;}};
}

async function cachedVideo(t) {
  const path=join(tmpdir(),`mock-${randomUUID()}.mp4`);
  await writeFile(path,`Original mock bytes ${randomUUID()}`);
  const reference=await makeRef(path), bytes=Buffer.from(`Normalized mock MP4 ${randomUUID()}`);
  const cache=join(tmpdir(),'pi-video-v1');await mkdir(cache,{recursive:true});
  const cached=join(cache,`${reference.sha256}-640.mp4`);await writeFile(cached,bytes);
  t.after(async()=>{await rm(path,{force:true});await rm(cached,{force:true});});
  return {path,reference,bytes,cached};
}

await test('fresh tarball loads its TypeScript manifest entry and delegates ordinary text and image reads',async t=>{
  assert.ok(packageRoot.startsWith(join(dirname(fileURLToPath(import.meta.url)),'node_modules')));
  const {extension,runner}=await harness(t);
  assert.ok(extension.tools.has('read'));
  for(const hook of ['session_start','context','before_provider_request','agent_end','session_shutdown']) assert.ok(extension.handlers.has(hook),hook);
  const read=extension.tools.get('read').definition;
  const text=await read.execute('text',{path:join(packageRoot,'LICENSE')},undefined,undefined,runner.createContext());
  assert.ok(text.content.some(block=>block.type==='text'&&block.text.includes('MIT License')));
  const png=join(tmpdir(),'pixel.png');
  await writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64'));
  const image=await read.execute('image',{path:png},undefined,undefined,runner.createContext());
  assert.ok(image.content.some(block=>block.type==='image'), JSON.stringify(image));
});

await test('loaded hooks use selected auth endpoint, replay after agent_end, and omit on text/API switches',async t=>{
  const {runner,setModel}=await harness(t),video=await cachedVideo(t),calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push(String(url));assert.ok(String(url).startsWith('https://auth.invalid/'));
    assert.equal(options.headers.get('Authorization'),'Bearer mock-secret');assert.equal(options.headers.get('X-Test'),'mock');
    return {ok:true,json:async()=>String(url).endsWith('/models')?{data:[{id:'video-model',input:['video']}]}:{}};
  });
  const original=history(['call_123|fc_456'],[video.reference]),before=structuredClone(original);
  let marked=await runner.emitContext(original);
  let output=await runner.emitBeforeProviderRequest(serialize(marked));
  assert.equal(videos(output)[0].video_url.url,`data:video/mp4;base64,${video.bytes.toString('base64')}`);noMarker(output);
  assert.deepEqual(original,before);
  await runner.emit({type:'agent_end',messages:original});
  marked=await runner.emitContext(JSON.parse(JSON.stringify(original)));
  output=await runner.emitBeforeProviderRequest(serialize(marked));assert.equal(videos(output).length,1);noMarker(output);
  setModel({...model,id:'text-model'});
  marked=await runner.emitContext(original);
  output=await runner.emitBeforeProviderRequest(serialize(marked,{...model,id:'text-model'}));
  assert.equal(videos(output).length,0);assert.ok(JSON.stringify(output).includes('omitted'));noMarker(output);
  const callsBefore=calls.length;
  setModel({...model,api:'openai-responses',provider:'openai'});
  marked=await runner.emitContext(original);
  output=await runner.emitBeforeProviderRequest({input:convertResponsesMessages({...model,api:'openai-responses',provider:'openai'},{messages:marked},new Set(['openai']))});
  assert.equal(calls.length,callsBefore);assert.ok(JSON.stringify(output).includes('omitted'));noMarker(output);
  await runner.emit({type:'session_shutdown'});
  output=await runner.emitBeforeProviderRequest(serialize(marked));assert.equal(videos(output).length,0);noMarker(output);
});

await test('capability discovery honors null auth headers without restoring model headers or bearer credentials',async t=>{
  const {runner,registry,setModel}=await harness(t),video=await cachedVideo(t);
  setModel({...model,headers:{Authorization:'stale-secret','X-Remove':'stale','X-Keep':'kept'}});
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:'placeholder',headers:{authorization:null,'x-remove':null,'X-Test':'resolved'}});
  let requests=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    requests++;
    assert.equal(options.headers.has('Authorization'),false);
    assert.equal(options.headers.has('X-Remove'),false);
    assert.equal(options.headers.get('X-Keep'),'kept');
    assert.equal(options.headers.get('X-Test'),'resolved');
    return {ok:true,json:async()=>({data:[{id:model.id,input:['video']}]})};
  });
  const marked=await runner.emitContext(history(['call_123|fc_456'],[video.reference]));
  const output=await runner.emitBeforeProviderRequest(serialize(marked));
  assert.ok(requests>0);
  assert.equal(videos(output).length,1);noMarker(output);
});

await test('loaded request hook converts changed/missing files, ffmpeg and auth failures into clean omissions',async t=>{
  const {runner,registry}=await harness(t);
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({data:[{id:model.id,input:['video']}]})}));
  for(const failure of ['changed','missing','ffmpeg','auth']) {
    const video=await cachedVideo(t),original=history(['call_123|fc_456'],[video.reference]);
    if(failure==='changed') await writeFile(video.path,'changed');
    if(failure==='missing') await rm(video.path);
    if(failure==='ffmpeg') {await rm(video.cached);const previous=process.env.PI_VIDEO_FFMPEG;process.env.PI_VIDEO_FFMPEG=join(tmpdir(),'absent-ffmpeg');t.after(()=>{if(previous===undefined)delete process.env.PI_VIDEO_FFMPEG;else process.env.PI_VIDEO_FFMPEG=previous;});}
    if(failure==='auth') registry.getApiKeyAndHeaders=async()=>{throw Error('Secret auth error must not leak');};
    const marked=await runner.emitContext(original),payload=serialize(marked),before=structuredClone(payload);
    const output=await runner.emitBeforeProviderRequest(payload);
    assert.equal(videos(output).length,0);noMarker(output);
    assert.ok(JSON.stringify(output).includes('Read the file again'));
    assert.ok(!JSON.stringify(output).includes('Secret auth error'));
    assert.deepEqual(payload,before);
  }
});

await test('loaded hooks handle supported input_video dialect, removed history and denied video reads',async t=>{
  const {runner,extension,setModel}=await harness(t),video=await cachedVideo(t);
  t.mock.method(globalThis,'fetch',async url=>({ok:true,json:async()=>String(url).endsWith('/models')?
    {data:[{id:model.id,input:['video']}]}:{model_alias:model.id,modalities:{video:true}}}));
  const read=extension.tools.get('read').definition;
  const readResult=await read.execute('call_new',{path:video.path},undefined,undefined,runner.createContext());
  assert.equal(readResult.details.piVideo.sha256,video.reference.sha256);noMarker(readResult);
  const marked=await runner.emitContext(history(['call_new'],[readResult.details.piVideo]));
  const output=await runner.emitBeforeProviderRequest(serialize(marked));
  assert.equal(videos(output)[0].input_video.data,video.bytes.toString('base64'));noMarker(output);
  await runner.emitContext([]);
  const dropped=await runner.emitBeforeProviderRequest({messages:[]});assert.equal(videos(dropped).length,0);noMarker(dropped);
  setModel({...model,input:['video'],capabilities:{video:false}});
  await assert.rejects(read.execute('denied',{path:video.path},undefined,undefined,runner.createContext()),/disables video/);
  await assert.rejects(read.execute('offset',{path:video.path,offset:1},undefined,undefined,runner.createContext()),/offset/);
});

  return {tests:results.length,passed:results.filter(result=>result.passed).length,results};
}
