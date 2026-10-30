import {responseHeaders,originAllowed,readJson} from '../_shared/http.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
import {AwsClient} from 'npm:aws4fetch@1.0.20';
// Issues a short-lived, single-object upload URL for a public catalog image in Cloudflare R2, and deletes a
// mold image together with its stored file. Only active staff with media.manage may call it; object keys are
// chosen here (upload) or read from the deleted row (delete), never taken from the client.
const IMMUTABLE='public, max-age=31536000, immutable';
const UUID=/^[0-9a-f-]{36}$/i;
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
 const r2Ready=!!(r2.account&&r2.key&&r2.secret&&r2.bucket&&r2.publicUrl);
 const signer=()=>new AwsClient({accessKeyId:r2.key!,secretAccessKey:r2.secret!,service:'s3',region:'auto'});
 const objectUrl=(key:string)=>new URL(`https://${r2.account}.r2.cloudflarestorage.com/${r2.bucket}/${key}`);
 const body=await readJson(req);
 if(body.action==='delete'){
  if(typeof body.image_id!=='string'||!UUID.test(body.image_id))return reply({error:'Invalid image'},400);
  // The row is deleted as the caller, so RLS and the approved-media guard still decide whether it may go.
  const removed=await scoped.from('mold_images').delete().eq('id',body.image_id).select('bucket_id,storage_key,thumb_key').maybeSingle();
  if(removed.error)return reply({error:removed.error.message},403);
  if(!removed.data)return reply({error:'Image not found'},404);
  const {bucket_id:bucket,storage_key:key,thumb_key:thumb}=removed.data as {bucket_id:string,storage_key:string,thumb_key:string|null};
  const secretKey=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const server=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const shared=await server.from('mold_images').select('id',{count:'exact',head:true}).eq('bucket_id',bucket).eq('storage_key',key);
  if(shared.error||shared.count)return reply({success:true,file_removed:false});
  let fileRemoved=false;
  if(bucket==='r2'){if(r2Ready&&key.startsWith('molds/')){fileRemoved=(await signer().fetch(objectUrl(key),{method:'DELETE'})).ok;if(thumb?.startsWith('molds/'))await signer().fetch(objectUrl(thumb),{method:'DELETE'})}}
  else fileRemoved=!(await server.storage.from(bucket).remove([key])).error;
  return reply({success:true,file_removed:fileRemoved});
 }
 if(!r2Ready)return reply({configured:false});
 if(typeof body.mold_id!=='string'||!UUID.test(body.mold_id))return reply({error:'Invalid mold'},400);
 if(body.content_type!=='image/webp'||typeof body.size!=='number'||body.size<=0||body.size>20*1024*1024)return reply({error:'Only optimized WebP images up to 20 MB'},400);
 const withThumb=body.thumb_size!==undefined;if(withThumb&&(typeof body.thumb_size!=='number'||body.thumb_size<=0||body.thumb_size>2*1024*1024))return reply({error:'Thumbnail must be a WebP image up to 2 MB'},400);
 const mold=await scoped.from('molds').select('id').eq('id',body.mold_id).maybeSingle();if(!mold.data)return reply({error:'Mold not found'},404);
 const base=`molds/${body.mold_id}/${crypto.randomUUID()}`,key=base+'.webp',thumbKey=base+'-thumb.webp';
 const uploadHeaders={'content-type':'image/webp','cache-control':IMMUTABLE};
 const presign=async(objectKey:string)=>{const target=objectUrl(objectKey);target.searchParams.set('X-Amz-Expires','300');return (await signer().sign(new Request(target,{method:'PUT',headers:uploadHeaders}),{aws:{signQuery:true,allHeaders:true}})).url};
 return reply({configured:true,upload_url:await presign(key),headers:uploadHeaders,key,public_url:r2.publicUrl!.replace(/\/+$/,'')+'/'+key,
  ...(withThumb?{thumb_upload_url:await presign(thumbKey),thumb_key:thumbKey}:{})});
 }catch{return reply({error:'Unable to process media request'},500)}
});
