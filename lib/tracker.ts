// GPS tracking for the rep app. In the Android app it uses the native background-location plugin (keeps
// recording with the screen off, with a persistent notification); in a browser it uses watchPosition, which
// records while the app is on screen.
// Every point is saved on the phone first, tagged with its shift, and uploaded in batches whenever there is a
// connection — during the shift or after it ended. Nothing is lost without a connection, and ending the day
// never waits for the network.
import {db} from './gd';

export type Fix={t:number,lat:number,lng:number,acc:number|null,spd:number|null,hdg:number|null};
type Queued=Fix&{s:string};
export type TrackerState={status:'off'|'starting'|'on'|'denied'|'unavailable'|'error',native:boolean,lastFix:Fix|null,pending:number,
  lastSync:number|null,syncError:string|null,distanceM:number,newCells:number,points:number,route:[number,number][]};

const QUEUE_KEY='gd-rep-queue',ROUTE_KEY='gd-rep-route',MAX_QUEUE=50000,MIN_MOVE_M=20,MIN_GAP_MS=5000,HEARTBEAT_MS=120000,FLUSH_MS=20000,MAX_ACC=100,BATCH=400;
const read=<T,>(key:string,fallback:T):T=>{try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}};
const write=(key:string,v:unknown)=>{try{localStorage.setItem(key,JSON.stringify(v))}catch{}};
const queue=()=>read<Queued[]>(QUEUE_KEY,[]).filter(p=>p&&p.s);
export const meters=(a:{lat:number,lng:number},b:{lat:number,lng:number})=>{const r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lng-a.lng)*r;const h=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*6371000*Math.asin(Math.min(1,Math.sqrt(h)))};
export const isNativeApp=()=>!!(window as any).Capacitor?.isNativePlatform?.();

let state:TrackerState={status:'off',native:isNativeApp(),lastFix:null,pending:queue().length,lastSync:null,syncError:null,distanceM:0,newCells:0,points:0,route:[]};
const listeners=new Set<(s:TrackerState)=>void>();
const emit=(patch:Partial<TrackerState>)=>{state={...state,...patch};listeners.forEach(l=>l(state))};
export const subscribe=(fn:(s:TrackerState)=>void)=>{listeners.add(fn);fn(state);return()=>{listeners.delete(fn)}};

let shiftId:string|null=null,watchId:any=null,lastKept:Fix|null=null,lastFlush=0,wakeLock:any=null,running:Promise<void>|null=null,runningSince=0,uploader:any=null;

function accept(f:Fix){
  if(!shiftId)return;
  emit({lastFix:f,status:'on'});
  if(f.acc!=null&&f.acc>MAX_ACC)return;
  // Keep a point when the rep moved (at most one every 5 s, ~160 m apart on a highway), or every two minutes while standing still.
  if(lastKept&&f.t-lastKept.t<HEARTBEAT_MS&&(f.t-lastKept.t<MIN_GAP_MS||meters(lastKept,f)<Math.max(MIN_MOVE_M,(f.acc||0)*0.6)))return;
  lastKept=f;
  const q=queue();q.push({...f,s:shiftId});if(q.length>MAX_QUEUE)q.splice(0,q.length-MAX_QUEUE);write(QUEUE_KEY,q);
  const route=[...state.route,[f.lat,f.lng] as [number,number]].slice(-3000);write(ROUTE_KEY,{shift:shiftId,route});
  emit({pending:q.length,route});
  // Location callbacks keep arriving in the background while timers are throttled, so they also drive the upload.
  if(q.length>=25||Date.now()-lastFlush>=FLUSH_MS)flush();
}

// Android throttles network requests made by the WebView after a few minutes in the background, so the app
// uploads points through the native HTTP client there.
async function push(shift:string,points:Fix[]):Promise<any>{
  if(isNativeApp()){
    const {CapacitorHttp}=await import('@capacitor/core');
    const {data:{session}}=await db().auth.getSession();if(!session)throw Error('Not signed in');
    const r=await CapacitorHttp.post({connectTimeout:15000,readTimeout:30000,url:import.meta.env.VITE_SUPABASE_URL+'/rest/v1/rpc/rep_push_locations',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token},data:{shift,points}});
    if(r.status>=300){const m=typeof r.data==='object'?r.data?.message||JSON.stringify(r.data):String(r.data);throw Object.assign(Error(m),{status:r.status})}
    return typeof r.data==='string'?JSON.parse(r.data):r.data;
  }
  const r=await db().rpc('rep_push_locations',{shift,points});if(r.error)throw Object.assign(Error(r.error.message),{status:r.status});return r.data;
}

async function upload(){
  while(true){
    const q=queue();if(!q.length)break;
    const s=q[0].s;const batch=q.filter(p=>p.s===s).slice(0,BATCH);
    let result:any=null;
    try{result=await push(s,batch.map(({s:_,...p})=>p))}
    catch(e:any){
      // A shift the server no longer accepts (deleted, or another account signed in) would block the queue forever.
      if(!/Shift not found/.test(String(e?.message)))throw e;
    }
    const sent=new Set(batch.map(p=>p.t));write(QUEUE_KEY,queue().filter(p=>!(p.s===s&&sent.has(p.t))));
    const patch:Partial<TrackerState>={lastSync:Date.now(),syncError:null,pending:queue().length};
    if(result&&s===shiftId)Object.assign(patch,{distanceM:Number(result.distance_m||0),newCells:Number(result.new_cells||0),points:Number(result.points||0)});
    emit(patch);
  }
}

// Uploads everything queued, for any shift. Calls made while an upload runs wait for it and then run once more.
export function flush():Promise<void>{
  lastFlush=Date.now();
  // A request that never returned (lost connection in the background) must not block uploads forever.
  if(running&&Date.now()-runningSince<60000)return running.then(()=>queue().length?flush():undefined);
  if(!queue().length){emit({pending:0});return Promise.resolve()}
  if(typeof navigator!=='undefined'&&navigator.onLine===false){emit({syncError:'offline',pending:queue().length});return Promise.resolve()}
  runningSince=Date.now();
  const p=upload().catch((e:any)=>{emit({syncError:String(e?.message||e),pending:queue().length})}).finally(()=>{if(running===p)running=null});
  running=p;return p;
}

// Keeps uploading leftovers (e.g. points of a day that ended without a connection) as long as the app is open.
export function startUploader(){
  if(uploader)return;
  const kick=()=>{if(document.visibilityState==='visible')keepAwake();flush()};
  uploader=setInterval(flush,FLUSH_MS);window.addEventListener('online',kick);document.addEventListener('visibilitychange',kick);flush();
}

async function keepAwake(){try{if(shiftId&&!isNativeApp()&&'wakeLock' in navigator&&document.visibilityState==='visible')wakeLock=await (navigator as any).wakeLock.request('screen')}catch{}}

export async function start(id:string,summary?:{distance_m?:any,new_cells?:any,points_count?:any}){
  if(shiftId===id&&watchId!=null)return;
  await stop(false);
  shiftId=id;lastKept=null;startUploader();
  const saved=read<{shift:string,route:[number,number][]}|null>(ROUTE_KEY,null);
  emit({status:'starting',native:isNativeApp(),route:saved?.shift===id?saved.route:[],distanceM:Number(summary?.distance_m||0),newCells:Number(summary?.new_cells||0),points:Number(summary?.points_count||0),syncError:null});
  if(isNativeApp()){
    try{
      const {registerPlugin}=await import('@capacitor/core');
      const plugin:any=registerPlugin('BackgroundGeolocation');
      watchId=await plugin.addWatcher({backgroundTitle:'GD — تتبع المندوب',backgroundMessage:'جاري تسجيل خط السير أثناء الوردية',requestPermissions:true,stale:false,distanceFilter:15},
        (loc:any,err:any)=>{if(err){emit({status:err.code==='NOT_AUTHORIZED'?'denied':'error'});return}
          if(loc)accept({t:Math.round(loc.time||Date.now()),lat:loc.latitude,lng:loc.longitude,acc:loc.accuracy??null,spd:loc.speed??null,hdg:loc.bearing??null})});
      return;
    }catch(e){console.warn('Native tracking unavailable, using browser location',e)}
  }
  if(!('geolocation' in navigator)){emit({status:'unavailable'});return}
  keepAwake();
  watchId=navigator.geolocation.watchPosition(p=>accept({t:p.timestamp||Date.now(),lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy??null,spd:p.coords.speed,hdg:p.coords.heading}),
    e=>emit({status:e.code===e.PERMISSION_DENIED?'denied':'error'}),{enableHighAccuracy:true,maximumAge:5000,timeout:30000});
}

// Stops recording. Points already recorded stay queued and keep uploading.
export async function stop(clear=true){
  if(watchId!=null){
    try{if(isNativeApp()){const {registerPlugin}=await import('@capacitor/core');await (registerPlugin('BackgroundGeolocation') as any).removeWatcher({id:watchId})}else navigator.geolocation.clearWatch(watchId)}catch{}
    watchId=null;
  }
  try{await wakeLock?.release?.()}catch{}wakeLock=null;
  if(clear){shiftId=null;write(ROUTE_KEY,null);emit({status:'off',route:[],lastFix:null,distanceM:0,newCells:0,points:0})}
}

export async function openLocationSettings(){if(!isNativeApp())return;const {registerPlugin}=await import('@capacitor/core');(registerPlugin('BackgroundGeolocation') as any).openSettings()}

// Tries to upload what is queued for up to `ms`; returns how many points are still waiting (they upload later).
export async function drain(ms=8000){await Promise.race([flush(),new Promise(r=>setTimeout(r,ms))]);return queue().length}
export const pendingCount=()=>queue().length;
// Older app versions queued points without their shift; they belong to the shift that was open.
export function adoptUntagged(id:string){const raw=read<any[]>(QUEUE_KEY,[]);if(raw.some(p=>p&&!p.s))write(QUEUE_KEY,raw.map(p=>p.s?p:{...p,s:id}))}
export function currentPosition():Promise<Fix|null>{if(state.lastFix&&Date.now()-state.lastFix.t<60000)return Promise.resolve(state.lastFix);return new Promise(resolve=>{if(!('geolocation' in navigator))return resolve(null);navigator.geolocation.getCurrentPosition(p=>resolve({t:p.timestamp,lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,spd:p.coords.speed,hdg:p.coords.heading}),()=>resolve(null),{enableHighAccuracy:true,timeout:15000,maximumAge:30000})})}
