import {responseHeaders,originAllowed,readJson} from '../_shared/http.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
import {AwsClient} from 'npm:aws4fetch@1.0.20';
// Issues a short-lived, single-object upload URL for a public catalog image in Cloudflare R2.
// Only active staff with media.manage may request one; the object key is chosen here, never by the client.
const IMMUTABLE='public, max-age=31536000, immutable';
Deno.serve(async(req:Request)=>{
 const headers=responseHeaders(req);
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!originAllowed(req))return reply({error:'Origin not allowed'},403);
 try{
 const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({error:'Authentication required'},401);
 const url=Deno.env.get('SUPABASE_URL')!;
 const publicKey=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')!;
 const scoped=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 const access=await scoped.rpc('get_my_access');if(access.error||!access.data?.active||!access.data?.permissions?.includes('media.manage'))return reply({error:'media.manage required'},403);
 const r2={account:Deno.env.get('R2_ACCOUNT_ID'),key:Deno.env.get('R2_ACCESS_KEY_ID'),secret:Deno.env.get('R2_SECRET_ACCESS_KEY'),bucket:Deno.env.get('R2_BUCKET'),publicUrl:Deno.env.get('R2_PUBLIC_URL')};
 if(!r2.account||!r2.key||!r2.secret||!r2.bucket||!r2.publicUrl)return reply({configured:false});
 const body=await readJson(req);
 if(typeof body.mold_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.mold_id))return reply({error:'Invalid mold'},400);
 if(body.content_type!=='image/webp'||typeof body.size!=='number'||body.size<=0||body.size>20*1024*1024)return reply({error:'Only optimized WebP images up to 20 MB'},400);
 const mold=await scoped.from('molds').select('id').eq('id',body.mold_id).maybeSingle();if(!mold.data)return reply({error:'Mold not found'},404);
 const key=`molds/${body.mold_id}/${crypto.randomUUID()}.webp`;
 const target=new URL(`https://${r2.account}.r2.cloudflarestorage.com/${r2.bucket}/${key}`);target.searchParams.set('X-Amz-Expires','300');
 const uploadHeaders={'content-type':'image/webp','cache-control':IMMUTABLE};
 const signed=await new AwsClient({accessKeyId:r2.key,secretAccessKey:r2.secret,service:'s3',region:'auto'}).sign(new Request(target,{method:'PUT',headers:uploadHeaders}),{aws:{signQuery:true,allHeaders:true}});
 return reply({configured:true,upload_url:signed.url,headers:uploadHeaders,key,public_url:r2.publicUrl.replace(/\/+$/,'')+'/'+key});
 }catch{return reply({error:'Unable to prepare upload'},500)}
});
