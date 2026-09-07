import {referenceForTool, cleanToolMessage, cleanVideoMarkers} from './attachments.mjs';
import {videoBlock} from './capabilities.mjs';
import {findFfmpeg} from './ffmpeg.mjs';
import {readFile,stat,mkdir,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const isVideo=p=>/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(p);
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const filePath=(p,cwd)=>resolve(cwd,p==='~'?homedir():p.startsWith('~/')?join(homedir(),p.slice(2)):p);
export async function makeRef(path,signal){
 signal?.throwIfAborted();
 const s=await stat(path);
 if(!s.isFile() || s.size>256*1024*1024)throw Error('Video must be a regular file under 256 MiB.');
 const b=await readFile(path,{signal});
 return {version:1,path,size:b.length,sha256:hash(b)};
}
export async function hydrate(ref,signal){
 const s=await stat(ref.path);
 if(s.size!==ref.size)throw Error('Video changed since read; read it again.');
 const b=await readFile(ref.path,{signal});
 if(hash(b)!==ref.sha256)throw Error('Video changed since read; read it again.');
 return b;
}
export async function prepare(ref,signal){
 await hydrate(ref,signal);
 const cache=join(tmpdir(),'pi-video-v1');await mkdir(cache,{recursive:true});
 const target=join(cache,ref.sha256+'-640.mp4');
 try{await stat(target);return target;}catch{}
 const pending=join(cache,randomUUID()+'.mp4');
 try{
  await exec(await findFfmpeg(),['-nostdin','-v','error','-y','-i',ref.path,'-map','0:v:0','-an','-vf',"scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-map_metadata','-1','-metadata:s:v:0','rotate=0','-movflags','+faststart',pending],{signal,maxBuffer:1024*1024});
  await hydrate(ref,signal);
  await rename(pending,target);return target;
 }finally{await rm(pending,{force:true});}
}
export async function rewrite(payload,refs,load,format='input_video'){
 if(!Array.isArray(payload?.messages))return cleanVideoMarkers(payload);
 const messages=[];
 for(let i=0;i<payload.messages.length;i++){
  const m=payload.messages[i];messages.push(cleanToolMessage(m));
  if(m.role!=='tool')continue;
  const group=[m];
  while(payload.messages[i+1]?.role==='tool'){group.push(payload.messages[++i]);messages.push(cleanToolMessage(group.at(-1)));}
  const content=[];const seen=new Set();
  for(const t of group){
   const ref=referenceForTool(t,refs);if(!ref || seen.has(ref.sha256))continue;
   seen.add(ref.sha256);
   content.push({type:'text',text:`Video read from ${ref.path}. Visual content only; audio is not supplied.`});
   content.push(videoBlock(await load(ref),format));
  }
  if(content.length)messages.push({role:'user',content});
 }
 return cleanVideoMarkers({...payload,messages});
}
