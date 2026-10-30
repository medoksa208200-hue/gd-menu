import {term,localizedError,currentLanguage,type Language} from './i18n';
import {edgeErrorMessage} from './edge-errors.mjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type Row=Record<string,any>;
let staffClient:SupabaseClient;let catalogClient:SupabaseClient;
export async function initClients(){if(staffClient)return;const c={url:import.meta.env.VITE_SUPABASE_URL as string,key:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string};if(!c.url||!c.key)throw Error('Supabase build environment is not configured');staffClient=createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'gd-staff-session'}});catalogClient=createClient(c.url,c.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
export const db=()=>staffClient;export const publicDB=()=>catalogClient;
export function unwrap(result:{data:any,error:any}):any{if(result.error)throw Error(result.error.message);return result.data}
export function message(e:unknown,lang:Language=currentLanguage()){const text=typeof e==='string'?e:e instanceof Error?e.message:e&&typeof e==='object'&&'message' in e?String(e.message):'Operation failed';return localizedError(text,lang)}
export function dimensions(m:Row,lang:Language=currentLanguage(),limit=5){return ['diameter_mm','length_mm','width_mm','height_mm','depth_mm'].filter(k=>m[k]).slice(0,limit).map(k=>(k==='diameter_mm'?'Ø ':'')+m[k]).join(' × ')+' '+term('mm',lang)}
export function normalizeNumbers(v:Row,keys:string[]){const r={...v};for(const k of keys)r[k]=v[k]===''||v[k]===undefined?null:Number(v[k]);return r}
// Signed URLs are cached until shortly before expiry so repeat renders reuse the same URL (and the browser's
// HTTP cache), and requests made in the same tick are batched into one createSignedUrls call per bucket.
const signedCache=new Map<string,{url:string,until:number}>();
const pendingSigned=new Map<string,{client:SupabaseClient,bucket:string,ttl:number,paths:Map<string,{resolve:(u:string)=>void,reject:(e:unknown)=>void}[]>}>();
async function flushSigned(group:string){const g=pendingSigned.get(group)!;pendingSigned.delete(group);const paths=[...g.paths.keys()];try{const rows=unwrap(await g.client.storage.from(g.bucket).createSignedUrls(paths,g.ttl)) as {path:string|null,signedUrl:string,error:string|null}[];const until=Date.now()+(g.ttl-60)*1000;for(const [i,path] of paths.entries()){const row=rows.find(r=>r.path===path)||rows[i];const waiters=g.paths.get(path)!;if(row?.signedUrl&&!row.error){signedCache.set(group+'|'+path,{url:row.signedUrl,until});waiters.forEach(w=>w.resolve(row.signedUrl))}else waiters.forEach(w=>w.reject(Error(row?.error||'Object not found')))}}catch(e){for(const waiters of g.paths.values())waiters.forEach(w=>w.reject(e))}}
export function signed(bucket:string,path:string,internal=false):Promise<string>{if(bucket==='r2')return r2Base?Promise.resolve(r2Base+'/'+path.split('/').map(encodeURIComponent).join('/')):Promise.reject(Error('R2 public URL is not configured'));const group=(internal?'staff':'public')+'|'+bucket;const hit=signedCache.get(group+'|'+path);if(hit&&hit.until>Date.now())return Promise.resolve(hit.url);return new Promise((resolve,reject)=>{let g=pendingSigned.get(group);if(!g){g={client:internal?db():publicDB(),bucket,ttl:internal?300:3600,paths:new Map()};pendingSigned.set(group,g);setTimeout(()=>flushSigned(group),0)}const waiters=g.paths.get(path)||[];waiters.push({resolve,reject});g.paths.set(path,waiters)})}
export const num=(x:any)=>Number(x??0).toLocaleString('en-US');
export async function imageFile(file:File){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Only JPEG, PNG and WebP images');if(file.size>20*1024*1024)throw Error('Maximum image size is 20 MiB');const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Invalid image')),'image/webp',.84))}
// Public catalog images go to Cloudflare R2 when it is configured (edge-cached, no egress fees); otherwise,
// and for private factory files, they go to Supabase Storage. Returns where the object was stored.
const r2Base=(import.meta.env.VITE_R2_PUBLIC_URL as string|undefined)?.replace(/\/+$/,'');
let r2Available:boolean|undefined;
async function uploadToR2(blob:Blob,moldId:string){if(r2Available===false||!r2Base)return null;const result=await db().functions.invoke('gd-media',{body:{mold_id:moldId,content_type:'image/webp',size:blob.size}});if(result.error||!result.data?.configured){r2Available=false;return null}r2Available=true;const put=await fetch(result.data.upload_url,{method:'PUT',headers:result.data.headers,body:blob});if(!put.ok)throw Error('Upload failed');return result.data.key as string}
export async function uploadImage(file:File,bucket:string,folder:string):Promise<{bucket:string,path:string}>{const blob=await imageFile(file);if(bucket==='catalog-media'&&folder.startsWith('molds/')){try{const key=await uploadToR2(blob,folder.slice(6));if(key)return {bucket:'r2',path:key}}catch(e){console.warn('R2 upload failed; using Supabase Storage',e)}}const path=folder+'/'+crypto.randomUUID()+'.webp';unwrap(await db().storage.from(bucket).upload(path,blob,{contentType:'image/webp',upsert:false,cacheControl:'31536000'}));return {bucket,path}}

export async function invokeChecked(name:string, body:Row) {
 const result=await db().functions.invoke(name,{body});
 if(result.error)throw Error(await edgeErrorMessage(result.error,result.data));
 if(result.data?.error)throw Error(result.data.error);
 return result.data;
}
