import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareVideoContext, referenceForTool, omitVideos, cleanVideoMarkers} from '../attachments.mjs';
import {rewrite} from '../core.mjs';

const ref={version:1,path:'/clip.mp4',sha256:'a'.repeat(64),size:5};
const result=(id='call_123|fc_456',value=ref)=>({role:'toolResult',toolCallId:id,toolName:'read',content:[{type:'text',text:'Read video.'}],details:{piVideo:value}});
const wire=message=>({role:'tool',tool_call_id:'provider-changed-id',content:message.content.map(block=>block.text).join('\n')});

test('markers are confined to cloned video context and resolve independently of wire IDs',()=>{
 const original=[{role:'user',content:'read this'},result(),{...result('ordinary'),details:undefined}];
 const before=structuredClone(original);
 const marked=prepareVideoContext(original);
 assert.deepEqual(original,before);
 assert.equal(marked.refs.size,1);
 assert.equal(marked.messages[0],original[0]);
 assert.notEqual(marked.messages[1].content,original[1].content);
 assert.equal(referenceForTool(wire(marked.messages[1]),marked.refs),ref);
 assert.equal(referenceForTool({...wire(marked.messages[1]),content:[{type:'text',text:wire(marked.messages[1]).content}]},marked.refs),ref);
 assert.ok(!JSON.stringify(original).includes('[pi-video-ref:'));
});

test('replay recreates refs; absent, failed and unsupported-version reads never attach',()=>{
 const marked=prepareVideoContext([result(),{...result(),isError:true},result('new',{...ref,version:2})]);
 assert.equal(marked.refs.size,1);
 assert.equal(marked.messages[1].content.length,1);
 assert.equal(marked.messages[2].content.length,1);
 const replay=prepareVideoContext(JSON.parse(JSON.stringify([result()])));
 assert.deepEqual([...replay.refs],[...marked.refs]);
 assert.equal(prepareVideoContext([]).refs.size,0);
});

test('duplicate reads attach once per complete tool group; distinct videos and later turns survive',async()=>{
 const second={...ref,path:'/another.mp4',sha256:'b'.repeat(64)};
 const marked=prepareVideoContext([result('a'),result('b'),result('c',second),result('d')]);
 const payload={messages:[...marked.messages.slice(0,3).map(wire),{role:'assistant',content:'continue'},wire(marked.messages[3])]};
 const before=structuredClone(payload),loaded=[];
 const rewritten=await rewrite(payload,marked.refs,async value=>{loaded.push(value.path);return Buffer.from(value.path);},'video_url');
 assert.deepEqual(loaded,[ref.path,second.path,ref.path]);
 assert.equal(rewritten.messages[2].role,'tool');
 assert.equal(rewritten.messages[3].content.filter(block=>block.type==='video_url').length,2);
 assert.equal(rewritten.messages[6].content[1].type,'video_url');
 assert.deepEqual(payload,before);
 assert.ok(!JSON.stringify(rewritten).includes('[pi-video-ref:'));
});

test('omission removes references in every nested provider shape without changing request options',()=>{
 const marked=prepareVideoContext([result()]),text=wire(marked.messages[0]).content;
 const payload={model:'selected',temperature:0,stream:true,messages:[wire(marked.messages[0]),{role:'user',content:[{type:'tool_result',tool_use_id:'id',content:[{type:'text',text}]}]}],input:[{type:'function_call_output',call_id:'id',output:text}],request:{contents:[{parts:[{functionResponse:{name:'read',response:{output:text}}}]}]}};
 const before=structuredClone(payload),omitted=omitVideos(payload,marked.refs,'No adapter.');
 assert.equal(omitted.messages[0].content,'Previously read video omitted: No adapter.');
 assert.equal(omitted.messages[1].content[0].content[0].text,omitted.messages[0].content);
 assert.equal(omitted.input[0].output,omitted.messages[0].content);
 assert.equal(omitted.request.contents[0].parts[0].functionResponse.response.output,omitted.messages[0].content);
 assert.equal(omitted.temperature,0);assert.equal(omitted.stream,true);
 assert.deepEqual(payload,before);
 assert.ok(!JSON.stringify(omitted).includes('[pi-video-ref:'));
});

test('orphan markers are scrubbed; ordinary text, images, whitespace and no-video payloads survive',async()=>{
 const plain={messages:[{role:'tool',content:'Keep trailing whitespace.  \n'},{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}],stop:null};
 assert.deepEqual(cleanVideoMarkers(plain),plain);
 assert.deepEqual(await rewrite(plain,new Map(),()=>assert.fail()),plain);
 assert.deepEqual(omitVideos(plain,new Map(),'unused'),plain);
 const marked=prepareVideoContext([result()]);
 const orphan={input:[{output:wire(marked.messages[0]).content}]};
 assert.ok(!JSON.stringify(await rewrite(orphan,new Map(),()=>assert.fail())).includes('[pi-video-ref:'));
 assert.ok(!JSON.stringify(omitVideos(orphan,new Map(),'unused')).includes('[pi-video-ref:'));
});

test('failed attachment loading never mutates the original payload with partial binary data',async()=>{
 const marked=prepareVideoContext([result('a'),result('b',{...ref,sha256:'b'.repeat(64)})]);
 const payload={messages:marked.messages.map(wire)},before=structuredClone(payload);
 let loaded=0;
 await assert.rejects(rewrite(payload,marked.refs,async()=>{if(++loaded===2)throw Error('missing');return Buffer.from('first');}),/missing/);
 assert.deepEqual(payload,before);
 const safe=omitVideos(payload,marked.refs,'Read the file again.');
 assert.ok(safe.messages.every(message=>message.content.includes('omitted')));
 assert.ok(!JSON.stringify(safe).includes('[pi-video-ref:'));
});

test('cleanup preserves native binary image payloads and other non-text values',()=>{
 const bytes=new Uint8Array([1,2,3]);
 const payload={messages:[{role:'user',content:[{image:{format:'png',source:{bytes}}}]}]};
 assert.equal(cleanVideoMarkers(payload),payload);
 assert.equal(omitVideos(payload,new Map(),'No video adapter.'),payload);
 assert.equal(cleanVideoMarkers(payload).messages[0].content[0].image.source.bytes,bytes);
});
