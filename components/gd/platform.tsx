'use client';
import React,{createContext,lazy,Suspense,useContext,useEffect,useState} from 'react';
import {initClients,message} from '@/lib/gd';
import PublicSite from './public-site';
import {Toaster,toast} from 'sonner';
// The staff workspace (charts, Excel, QR, forms) is a separate chunk that public visitors never download.
const Admin=lazy(()=>import('./admin'));
export const UI=createContext<any>(null);
export const useUI=()=>useContext(UI);
export default function Platform(){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[path,setPath]=useState(location.pathname),[lang,setLang]=useState(()=>{try{return localStorage.getItem('gd-language')==='en'?'en':'ar'}catch{return 'ar'}}),[comparison,setComparison]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('gd-compare')||'[]')}catch{return []}}),[version,setVersion]=useState(0);
 useEffect(()=>{initClients().then(()=>setReady(true)).catch(e=>setError(message(e)));const nav=()=>{setPath(location.pathname);window.dispatchEvent(new Event('gd:navigate'))};window.addEventListener('popstate',nav);
  // Returning to the tab re-reads live data, so changes made in the workspace show without a manual reload.
  let hiddenAt=0;const visibility=()=>{if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>15000)setVersion(v=>v+1)};document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('popstate',nav);document.removeEventListener('visibilitychange',visibility)}},[]);
 useEffect(()=>{document.title=lang==='ar'?'جي دي لصناعة أدوات المائدة | دقة في كل تصميم':'GD TABLEWARE INDUSTRY | Precision in Every Design';document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';try{localStorage.setItem('gd-language',lang)}catch{}},[lang]);
 const go=(url:string,{replace=false,keepScroll=false}={})=>{if(replace)history.replaceState(null,'',url);else history.pushState(null,'',url);setPath(url.split(/[?#]/)[0]);window.dispatchEvent(new Event('gd:navigate'));if(!keepScroll)window.scrollTo(0,0)};
 const toggleCompare=(id:string)=>setComparison(old=>{if(!old.includes(id)&&old.length>=4){toast.error(lang==='ar'?'يمكنك مقارنة 4 تصميمات بحد أقصى':'Compare up to four designs');return old}const next=old.includes(id)?old.filter(i=>i!==id):[...old,id];try{localStorage.setItem('gd-compare',JSON.stringify(next))}catch{}if(!old.includes(id))toast.success(lang==='ar'?'أُضيف للمقارنة':'Added to comparison');return next});
 const t=(ar:any,en:any)=>lang==='ar'?ar:en;
 const refresh=()=>setVersion(v=>v+1);
 const Link=({href,children,...props}:any)=><a href={href} {...props} onClick={(e:any)=>{props.onClick?.(e);if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0&&!props.target){e.preventDefault();go(href)}}}>{children}</a>;
 const fallback=<div className="center-state"><span className="spinner"/></div>;
 return <UI.Provider value={{lang,setLang,path,go,t,Link,comparison,toggleCompare,version,refresh}}><Toaster richColors position="top-center" dir={lang==='ar'?'rtl':'ltr'} toastOptions={{style:{fontFamily:'inherit'}}}/>{error?<main className="center-state"><h1>{t('تعذّر تحميل الصفحة','Unable to load the page')}</h1><p>{t('تحقق من اتصال الإنترنت ثم حاول مرة أخرى.','Check your connection and try again.')}</p><button className="btn btn-dark" onClick={()=>location.reload()}>{t('إعادة المحاولة','Try again')}</button></main>:!ready?<div className="center-state"><img width="100" height="99" src="/brand/gd-logo.webp" alt={t('جي دي','GD')}/><span className="spinner"/></div>:path.startsWith('/admin')?<Suspense fallback={fallback}><Admin/></Suspense>:<PublicSite/>}</UI.Provider>
}
