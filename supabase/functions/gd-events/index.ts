import {responseHeaders,originAllowed,readJson,clientAddress} from '../_shared/http.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
Deno.serve(async(req:Request)=>{
 const headers=responseHeaders(req);
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!originAllowed(req))return reply({error:'Origin not allowed'},403);
 try{
 const b=await readJson(req);if(!['view','search'].includes(b.type)||b.query!=null&&(typeof b.query!=='string'||b.query.length>200)||b.mold_id!=null&&(typeof b.mold_id!=='string'||!/^[0-9a-f-]{36}$/i.test(b.mold_id)))return reply({error:'Invalid event'},400);
 const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const ip=clientAddress(req);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key+'|'+ip))),x=>x.toString(16).padStart(2,'0')).join('');
 const server=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false}});
 const r=await server.rpc('ingest_catalog_event',{visitor_hash:hash,event_type:b.type,target_mold:b.mold_id||null,query_text:b.query||null});
 if(r.error)return reply({accepted:false},400);
 return reply({accepted:!!r.data},r.data?200:429);
 }catch{return reply({accepted:false},400)}
});
