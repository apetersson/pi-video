// Copied into a fresh npm host by test:pack. All runtime imports below resolve
// inside that host, never from the source tree or a global pi installation.
import {test} from 'node:test';
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

test('actual Chat Completions conversion preserves video after pipe, long-ID and provider/model switches',async()=>{
  for(const id of ['call_123|fc_456',`call_123|fc_${'x+/='.repeat(120)}`,'x'.repeat(90)]) {
    const original=history([id]),before=structuredClone(original),marked=prepareVideoContext(original);
    for(const active of [model,{...model,provider:'openai'},{...model,id:'another-model',provider:'another-provider'}]) {
      const payload=serialize(marked.messages,active),wire=payload.messages.find(message=>message.role==='tool');
      if(id.includes('|')||active.provider==='openai') assert.notEqual(wire.tool_call_id,id);
      const output=await rewrite(payload,marked.refs,async()=>Buffer.from('video'),'video_url');
      assert.equal(videos(output).length,1);noMarker(output);
      assert.equal(output.messages.find(message=>message.role==='tool').tool_call_id,wire.tool_call_id);
    }
    assert.deepEqual(original,before);noMarker(original);
  }
});

test('actual serialization keeps colliding call prefixes distinct and attaches each video after the group',async()=>{
  const refs=[ref,{...ref,path:'/mock/other.mp4',sha256:'b'.repeat(64)}];
  const marked=prepareVideoContext(history(['call_shared|fc_one','call_shared|fc_two'],refs));
  const payload=serialize(marked.messages),tools=payload.messages.filter(message=>message.role==='tool');
  assert.equal(new Set(tools.map(message=>message.tool_call_id)).size,2);
  const loaded=[];
  const output=await rewrite(payload,marked.refs,async reference=>{loaded.push(reference.path);return Buffer.from(reference.path);});
  assert.deepEqual(loaded,refs.map(reference=>reference.path));assert.equal(videos(output).length,2);
  assert.equal(output.messages.at(-2).role,'tool');assert.equal(output.messages.at(-1).role,'user');noMarker(output);
});

test('unsupported Responses and Gemini conversions omit video and markers, including nested request wrappers',async()=>{
  const original=history(),marked=prepareVideoContext(original);
  const responses=convertResponsesMessages({...model,api:'openai-responses',provider:'openai'},{messages:marked.messages},new Set(['openai']));
  const google=convertGoogle({...model,api:'google-generative-ai',provider:'google',id:'gemini-3-flash'},{messages:marked.messages});
  for(const payload of [{input:responses},{contents:google},{request:{contents:google}}]) {
    assert.ok(JSON.stringify(payload).includes('[pi-video-ref:'));
    const output=omitVideos(payload,marked.refs,'No transport adapter.');noMarker(output);
    assert.ok(JSON.stringify(output).includes('Previously read video omitted'));
  }
  noMarker(original);
});

test('actual Anthropic serializer omission strips nested tool-result markers before any network request',async()=>{
  const marked=prepareVideoContext(history());let captured;
  const result=await streamAnthropic({...model,api:'anthropic-messages',provider:'anthropic',id:'claude-test'},
    {messages:marked.messages},{client:{},onPayload:payload=>{captured=payload;throw Error('Stop before network');}}).result();
  assert.equal(result.stopReason,'error');assert.ok(captured,'Anthropic did not reach payload serialization');
  assert.ok(JSON.stringify(captured).includes('[pi-video-ref:'));
  const output=omitVideos(captured,marked.refs,'No transport adapter.');noMarker(output);
  assert.ok(JSON.stringify(output).includes('Previously read video omitted'));
});
