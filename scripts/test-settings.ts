import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
export default function(pi:any){pi.on('before_provider_request',(e:any)=>{
 const p=e.payload;const videos=p.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((b:any)=>['input_video','video_url'].includes(b.type));
 appendFileSync(resolve('runs/transport.jsonl'),JSON.stringify({model:p.model,markers:JSON.stringify(p).includes('[pi-video-ref:'),videos:videos.length,formats:videos.map((b:any)=>b.type),videoBytes:videos.map((b:any)=>Buffer.from(b.input_video?.data ?? b.video_url.url.split(',')[1],'base64').length)})+'\n');
 return {...p,temperature:0,max_tokens:1024,chat_template_kwargs:{enable_thinking:false}};
});}
