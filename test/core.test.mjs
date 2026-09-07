import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isVideo,makeRef,hydrate,rewrite} from '../core.mjs';
import {prepareVideoContext} from '../attachments.mjs';
test('video detection',()=>{ assert.ok(isVideo('clip.MP4')); assert.ok(!isVideo('image.png')); });
test('changed and missing files fail closed',async()=>{
 const d=await mkdtemp(join(tmpdir(),'pi-video-test-'));const p=join(d,'clip.mp4');
 try{await writeFile(p,'abc');const ref=await makeRef(p);assert.equal((await hydrate(ref)).toString(),'abc');await writeFile(p,'xyz');await assert.rejects(hydrate(ref),/changed/);await rm(p);await assert.rejects(hydrate(ref));}finally{await rm(d,{recursive:true,force:true});}
});
test('native video follows whole tool-result group; payload not mutated',async()=>{
 const p={messages:[{role:'assistant',tool_calls:[{id:'a'},{id:'b'}]},{role:'tool',tool_call_id:'a',content:'video'},{role:'tool',tool_call_id:'b',content:'text'},{role:'user',content:'continue'}]};
 const ref={version:1,path:'/clip.mp4',sha256:'abc'};
 const marked=prepareVideoContext([{role:'toolResult',toolCallId:'original',toolName:'read',content:[],details:{piVideo:ref}}]);
 p.messages[1].content+='\n'+marked.messages[0].content[0].text;
 const before=structuredClone(p);
 const result=await rewrite(p,marked.refs,async()=>Buffer.from('video'));
 assert.equal(p.messages.length,4);assert.equal(result.messages[2].role,'tool');assert.equal(result.messages[3].content[1].type,'input_video');assert.equal(result.messages[3].content[1].input_video.data,'dmlkZW8=');assert.equal(result.messages[4].content,'continue');
 assert.deepEqual(p,before);
 const withoutRefs=await rewrite(p,new Map(),()=>assert.fail());
 assert.equal(withoutRefs.messages.length,p.messages.length);
 assert.ok(!JSON.stringify(withoutRefs).includes('[pi-video-ref:'));
});
