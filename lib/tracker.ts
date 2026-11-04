// GPS tracking for the rep app. In the Android app it uses the native background-location plugin (keeps
// recording with the screen off, with a persistent notification); in a browser it uses watchPosition, which
// records while the app is on screen. Points are queued on the phone and uploaded in batches, so a dead zone
// or no data balance loses nothing.
import {db} from './gd';

export type Fix={t:number,lat:number,lng:number,acc:number|null,spd:number|null,hdg:number|null};
export type TrackerState={status:'off'|'starting'|'on'|'denied'|'unavailable'|'error',native:boolean,lastFix:Fix|null,pending:number,
  lastSync:number|null,syncError:string|null,distanceM:number,newCells:number,points:number,route:[number,number][]};

const QUEUE_KEY='gd-rep-queue',ROUTE_KEY='gd-rep-route',MAX_QUEUE=20000,MIN_MOVE_M=20,HEARTBEAT_MS=120000,FLUSH_MS=20000,MAX_ACC=100;
const read=<T,>(key:string,fallback:T):T=>{try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}};
const write=(key:string,v:unknown)=>{try{localStorage.setItem(key,JSON.stringify(v))}catch{}};
export const meters=(a:{lat:number,lng:number},b:{lat:number,lng:number})=>{const r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lng-a.lng)*r;const h=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*6371000*Math.asin(Math.min(1,Math.sqrt(h)))};
export const isNativeApp=()=>!!(window as any).Capacitor?.isNativePlatform?.();

let state:TrackerState={status:'off',native:isNativeApp(),lastFix:null,pending:read<Fix[]>(QUEUE_KEY,[]).length,lastSync:null,syncError:null,distanceM:0,newCells:0,points:0,route:[]};
const listeners=new Set<(s:TrackerState)=>void>();
const emit=(patch:Partial<TrackerState>)=>{state={...state,...patch};listeners.forEach(l=>l(state))};
export const subscribe=(fn:(s:TrackerState)=>void)=>{listeners.add(fn);fn(state);return()=>{listeners.delete(fn)}};

let shiftId:string|null=null,watchId:any=null,flushTimer:any=null,lastKept:Fix|null=null,flushing=false,wakeLock:any=null;

function accept(f:Fix){
  if(!shiftId)return;
  emit({lastFix:f,status:'on'});
  if(f.acc!=null&&f.acc>MAX_ACC)return;
  // Keep a point when the rep moved, or every two minutes while standing still.
  if(lastKept&&meters(lastKept,f)<Math.max(MIN_MOVE_M,(f.acc||0)*0.6)&&f.t-lastKept.t<HEARTBEAT_MS)return;
  lastKept=f;
  const queue=read<Fix[]>(QUEUE_KEY,[]);queue.push(f);if(queue.length>MAX_QUEUE)queue.splice(0,queue.length-MAX_QUEUE);write(QUEUE_KEY,queue);
  const route=[...state.route,[f.lat,f.lng] as [number,number]].slice(-3000);write(ROUTE_KEY,{shift:shiftId,route});
  emit({pending:queue.length,route});
  if(queue.length>=25)flush();
}

// Android throttles network requests made by the WebView after a few minutes in the background, so the app
// uploads points through the native HTTP client there.
async function push(shift:string,points:Fix[]):Promise<{data:any}>{
  if(isNativeApp()){
    const {CapacitorHttp}=await import('@capacitor/core');
    const {data:{session}}=await db().auth.getSession();if(!session)throw Error('Not signed in');
    const r=await CapacitorHttp.post({url:import.meta.env.VITE_SUPABASE_URL+'/rest/v1/rpc/rep_push_locations',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token},data:{shift,points}});
    if(r.status>=300)throw Error(typeof r.data==='object'?r.data?.message||JSON.stringify(r.data):String(r.data));
    return {data:typeof r.data==='string'?JSON.parse(r.data):r.data};
  }
  const r=await db().rpc('rep_push_locations',{shift,points});if(r.error)throw Error(r.error.message);return {data:r.data};
}

export async function flush(){
  if(flushing||!shiftId)return;const queue=read<Fix[]>(QUEUE_KEY,[]);if(!queue.length){emit({pending:0});return}
  if(typeof navigator!=='undefined'&&navigator.onLine===false){emit({syncError:'offline'});return}
  flushing=true;
  try{
    while(true){
      const all=read<Fix[]>(QUEUE_KEY,[]);if(!all.length)break;
      const batch=all.slice(0,400);
      const r=await push(shiftId,batch);
      // Remove what was sent; points queued meanwhile stay.
      const sent=new Set(batch.map(p=>p.t));write(QUEUE_KEY,read<Fix[]>(QUEUE_KEY,[]).filter(p=>!sent.has(p.t)));
      emit({lastSync:Date.now(),syncError:null,distanceM:Number(r.data?.distance_m||0),newCells:Number(r.data?.new_cells||0),points:Number(r.data?.points||0),pending:read<Fix[]>(QUEUE_KEY,[]).length});
      if(batch.length<400)break;
    }
  }catch(e:any){emit({syncError:String(e?.message||e)})}
  finally{flushing=false}
}

async function keepAwake(){try{if(!isNativeApp()&&'wakeLock' in navigator&&document.visibilityState==='visible')wakeLock=await (navigator as any).wakeLock.request('screen')}catch{}}
const onVisible=()=>{if(document.visibilityState==='visible'&&shiftId){keepAwake();flush()}};

export async function start(id:string,summary?:{distance_m?:any,new_cells?:any,points_count?:any}){
  if(shiftId===id&&watchId!=null)return;
  await stop(false);
  shiftId=id;lastKept=null;
  const saved=read<{shift:string,route:[number,number][]}|null>(ROUTE_KEY,null);
  emit({status:'starting',native:isNativeApp(),route:saved?.shift===id?saved.route:[],distanceM:Number(summary?.distance_m||0),newCells:Number(summary?.new_cells||0),points:Number(summary?.points_count||0),syncError:null});
  flushTimer=setInterval(flush,FLUSH_MS);
  window.addEventListener('online',flush);document.addEventListener('visibilitychange',onVisible);
  if(isNativeApp()){
    try{
      const {registerPlugin}=await import('@capacitor/core');
      const plugin:any=registerPlugin('BackgroundGeolocation');
      watchId=await plugin.addWatcher({backgroundTitle:'GD — تتبع المندوب',backgroundMessage:'جاري تسجيل خط السير أثناء الوردية',requestPermissions:true,stale:false,distanceFilter:15},
        (loc:any,err:any)=>{if(err){if(err.code==='NOT_AUTHORIZED'){emit({status:'denied'});if(confirm('التطبيق محتاج إذن الموقع "طول الوقت" عشان يسجل خط السير. تفتح الإعدادات؟'))plugin.openSettings()}else emit({status:'error'});return}
          if(loc)accept({t:Math.round(loc.time||Date.now()),lat:loc.latitude,lng:loc.longitude,acc:loc.accuracy??null,spd:loc.speed??null,hdg:loc.bearing??null})});
      flush();return;
    }catch(e){console.warn('Native tracking unavailable, using browser location',e)}
  }
  if(!('geolocation' in navigator)){emit({status:'unavailable'});return}
  keepAwake();
  watchId=navigator.geolocation.watchPosition(p=>accept({t:p.timestamp||Date.now(),lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy??null,spd:p.coords.speed,hdg:p.coords.heading}),
    e=>emit({status:e.code===e.PERMISSION_DENIED?'denied':'error'}),{enableHighAccuracy:true,maximumAge:5000,timeout:30000});
  flush();
}

export async function stop(clear=true){
  if(watchId!=null){
    try{if(isNativeApp()){const {registerPlugin}=await import('@capacitor/core');await (registerPlugin('BackgroundGeolocation') as any).removeWatcher({id:watchId})}else navigator.geolocation.clearWatch(watchId)}catch{}
    watchId=null;
  }
  clearInterval(flushTimer);flushTimer=null;window.removeEventListener('online',flush);document.removeEventListener('visibilitychange',onVisible);
  try{await wakeLock?.release?.()}catch{}wakeLock=null;
  if(clear){shiftId=null;write(ROUTE_KEY,null);emit({status:'off',route:[],lastFix:null,distanceM:0,newCells:0,points:0})}
}

// Upload everything still queued before the shift is closed. Returns how many points could not be sent.
export async function drain(){await flush();return read<Fix[]>(QUEUE_KEY,[]).length}
export const pendingCount=()=>read<Fix[]>(QUEUE_KEY,[]).length;
export function currentPosition():Promise<Fix|null>{if(state.lastFix&&Date.now()-state.lastFix.t<60000)return Promise.resolve(state.lastFix);return new Promise(resolve=>{if(!('geolocation' in navigator))return resolve(null);navigator.geolocation.getCurrentPosition(p=>resolve({t:p.timestamp,lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,spd:p.coords.speed,hdg:p.coords.heading}),()=>resolve(null),{enableHighAccuracy:true,timeout:15000,maximumAge:30000})})}
