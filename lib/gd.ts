import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type Row=Record<string,any>;
let staffClient:SupabaseClient;let catalogClient:SupabaseClient;
export async function initClients(){if(staffClient)return;const c={url:import.meta.env.VITE_SUPABASE_URL as string,key:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string};if(!c.url||!c.key)throw Error('Supabase build environment is not configured');staffClient=createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'gd-staff-session'}});catalogClient=createClient(c.url,c.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
export const db=()=>staffClient;export const publicDB=()=>catalogClient;
export function unwrap(result:{data:any,error:any}):any{if(result.error)throw Error(result.error.message);return result.data}
export function message(e:unknown){return e instanceof Error?e.message:'Operation failed'}
export function dimensions(m:Row){return ['diameter_mm','length_mm','width_mm','height_mm','depth_mm'].filter(k=>m[k]).map(k=>(k==='diameter_mm'?'Ø ':'')+m[k]).join(' × ')+' mm'}
export function normalizeNumbers(v:Row,keys:string[]){const r={...v};for(const k of keys)r[k]=v[k]===''||v[k]===undefined?null:Number(v[k]);return r}
export async function signed(bucket:string,path:string,internal=false){const c=internal?db():publicDB();const d=unwrap(await c.storage.from(bucket).createSignedUrl(path,60));return d.signedUrl}
export const num=(x:any)=>Number(x??0).toLocaleString();
export async function imageFile(file:File){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Only JPEG, PNG and WebP images');if(file.size>20*1024*1024)throw Error('Maximum image size is 20 MiB');const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Invalid image')),'image/webp',.9))}
export async function uploadImage(file:File,bucket:string,folder:string){const blob=await imageFile(file);const path=folder+'/'+crypto.randomUUID()+'.webp';unwrap(await db().storage.from(bucket).upload(path,blob,{contentType:'image/webp',upsert:false}));return path}
