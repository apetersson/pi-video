import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advertisedVideo,discoverVideo,videoBlock} from '../capabilities.mjs';
import {findFfmpeg} from '../ffmpeg.mjs';
const model={id:'selected',api:'openai-completions',baseUrl:'https://arbitrary.example/api/v1'};
const mock=(models,props)=>async url=>url.endsWith('/models')?models:props;
test('input capability shapes; images and output modalities do not imply video',()=>{
 for(const r of [{input:['text','image','video']},{modalities:{video:true}},{capabilities:['video']},{architecture:{input_modalities:['video']}}])assert.equal(advertisedVideo(r),true);
 assert.equal(advertisedVideo({input:['text','image']}),undefined);
 assert.equal(advertisedVideo({output_modalities:['video']}),undefined);
 assert.equal(advertisedVideo({modalities:{video:false}}),false);
});
test('explicit denial wins over every positive source regardless of field order',()=>{
 const positives=[{modalities:['video']},{capabilities:{video:true}},{architecture:{input:['video']}},{meta:{inputModalities:['video']}}];
 for(const positive of positives){
  for(const location of ['record','architecture','meta']){
   for(const key of ['modalities','capabilities','input_modalities','inputModalities','input']){
    const record=structuredClone(positive);
    const source=location==='record'?record:(record[location]??={});
    source[key]={video:false};
    assert.equal(advertisedVideo(record),false,JSON.stringify(record));
   }
  }
 }
 assert.equal(advertisedVideo({modalities:['video'],capabilities:{video:false}}),false);
 assert.equal(advertisedVideo({capabilities:{video:false},modalities:['video']}),false);
});
test('own, matching catalog and matching props denials override positive metadata',async()=>{
 const positive={data:[{id:'selected',input:['video']}]};
 const props={model_alias:'selected',modalities:{video:true}};
 const own=await discoverVideo({...model,input:['video'],meta:{capabilities:{video:false}}},{fetchJson:()=>assert.fail('Own denial must not query endpoint')});
 assert.equal(own.supported,false);
 const catalog=await discoverVideo({...model,input:['video']},{fetchJson:mock({data:[...positive.data,{id:'selected',modalities:['video'],capabilities:{video:false}}]},props)});
 assert.equal(catalog.supported,false);
 assert.equal((await discoverVideo({...model,input:['video']},{fetchJson:mock(positive,{...props,modalities:{video:false}})})).supported,false);
 assert.equal((await discoverVideo(model,{fetchJson:mock({data:[...positive.data,{id:'other',capabilities:{video:false}}]})})).supported,true);
});
test('selected model at arbitrary endpoint uses video_url',async()=>{
 const calls=[];const result=await discoverVideo(model,{fetchJson:async url=>{calls.push(url);return url.endsWith('/models')?{data:[{id:'selected',architecture:{input_modalities:['text','video']}}]}:undefined;}});
 assert.equal(result.format,'video_url');assert.ok(calls.every(url=>url.startsWith(model.baseUrl.replace('/v1',''))));
});
test('wrong model and image-only model never inherit another capability',async()=>{
 const r=await discoverVideo(model,{fetchJson:mock({data:[{id:'other',input_modalities:['video']},{id:'selected',input_modalities:['text','image']}]},{model_path:'other',modalities:{video:true}})});assert.equal(r.supported,false);
});
test('matching llama props, explicit false and transport metadata',async()=>{
 assert.equal((await discoverVideo(model,{fetchJson:mock({data:[{id:'selected'}]},{model_path:'selected',modalities:{video:true}})})).format,'input_video');
 assert.equal((await discoverVideo(model,{fetchJson:mock({data:[{id:'selected',capabilities:{video:false}}]},{model_path:'selected',modalities:{video:true}})})).supported,false);
 assert.equal((await discoverVideo(model,{fetchJson:mock({data:[{id:'selected',input:['video'],video_input_format:'input_video'}]})})).format,'input_video');
});
test('switches re-resolve capabilities and unsupported API fails clearly',async()=>{
 const fetchJson=mock({data:[{id:'selected',input:['video']},{id:'text',modalities:{video:false}}]});
 assert.equal((await discoverVideo(model,{fetchJson})).supported,true);
 assert.equal((await discoverVideo({...model,id:'text'},{fetchJson})).supported,false);
 assert.equal((await discoverVideo({...model,api:'anthropic-messages'},{fetchJson})).supported,false);
});
test('discovery failures fail closed; own video metadata is sufficient',async()=>{
 const fetchJson=async()=>{throw Error('offline');};
 assert.equal((await discoverVideo(model,{fetchJson})).supported,false);
 assert.equal((await discoverVideo({...model,input:['video']},{fetchJson})).format,'video_url');
});
test('native formats differ and contain exact video bytes',()=>{
 const b=Buffer.from('sample');assert.deepEqual(videoBlock(b,'input_video'),{type:'input_video',input_video:{data:'c2FtcGxl'}});
 assert.deepEqual(videoBlock(b,'video_url'),{type:'video_url',video_url:{url:'data:video/mp4;base64,c2FtcGxl'}});
 assert.throws(()=>videoBlock(b,'unknown'));
});
test('ffmpeg searches PATH or explicit override and gives installation hint',async()=>{
 assert.equal(await findFfmpeg({probe:async p=>assert.equal(p,'ffmpeg')}),'ffmpeg');
 assert.equal(await findFfmpeg({override:'custom-ffmpeg',probe:async p=>assert.equal(p,'custom-ffmpeg')}),'custom-ffmpeg');
 await assert.rejects(findFfmpeg({platform:'darwin',probe:async()=>{throw Error('ENOENT');}}),/brew install ffmpeg/);
 await assert.rejects(findFfmpeg({platform:'win32',probe:async()=>{throw Error('ENOENT');}}),/winget install/);
});
