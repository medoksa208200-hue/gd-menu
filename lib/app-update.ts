// In-app update check for the Android rep app. Each release publishes /downloads/version.json next to the APK;
// the app compares it with the version it was built as, and offers the new APK when it is newer.
import {isNativeApp} from './tracker';

export const SITE='https://gd-menu.pages.dev';
export type AppRelease={versionCode:number,versionName:string,url:string,notes?:string,minVersionCode?:number,publishedAt?:string};
export const currentBuild=()=>typeof __APP_BUILD__==='number'?__APP_BUILD__:0;
export const currentVersion=()=>typeof __APP_VERSION__==='string'?__APP_VERSION__:'';

export async function latestRelease():Promise<AppRelease|null>{
  const url=SITE+'/downloads/version.json?t='+Date.now();
  try{
    if(isNativeApp()){
      // Native HTTP: no CORS and no WebView throttling.
      const {CapacitorHttp}=await import('@capacitor/core');
      const r=await CapacitorHttp.get({url,headers:{'Cache-Control':'no-cache'}});
      if(r.status!==200)return null;
      return typeof r.data==='string'?JSON.parse(r.data):r.data;
    }
    const r=await fetch(url,{cache:'no-store'});return r.ok?await r.json():null;
  }catch{return null}
}

// Returns the newer release, or null when the app is up to date (or this is not the Android app).
export async function availableUpdate():Promise<(AppRelease&{required:boolean})|null>{
  if(!isNativeApp()||!currentBuild())return null;
  const r=await latestRelease();
  if(!r||!(Number(r.versionCode)>currentBuild()))return null;
  return {...r,url:r.url.startsWith('http')?r.url:SITE+r.url,required:!!r.minVersionCode&&currentBuild()<Number(r.minVersionCode)};
}

// Android opens links to other sites in the browser, which downloads the APK and offers to install it.
export function openUpdate(r:AppRelease){location.href=r.url+(r.url.includes('?')?'&':'?')+'v='+r.versionCode}
