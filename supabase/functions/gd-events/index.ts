import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
 const b=await req.json();if(!['view','search'].includes(b.type)||typeof b.query==='string'&&b.query.length>200||b.mold_id&&!/^[0-9a-f-]{36}$/i.test(b.mold_id))return reply({error:'Invalid event'},400);
 const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||req.headers.get('cf-connecting-ip')||'unknown';
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key+'|'+ip))),x=>x.toString(16).padStart(2,'0')).join('');
 const server=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false}});
 const r=await server.rpc('ingest_catalog_event',{visitor_hash:hash,event_type:b.type,target_mold:b.mold_id||null,query_text:b.query||null});
 if(r.error)return reply({accepted:false},400);
 return reply({accepted:!!r.data},r.data?200:429);
 }catch{return reply({accepted:false},400)}
});
