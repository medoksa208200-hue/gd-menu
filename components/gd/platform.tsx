'use client';
import React,{createContext,useContext,useEffect,useState} from 'react';
import {initClients,message,Row} from '@/lib/gd';
import PublicSite from './public-site';
import Admin from './admin';
import {Toaster,toast} from 'sonner';
export const UI=createContext<any>(null);
export const useUI=()=>useContext(UI);
export default function Platform(){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[path,setPath]=useState('/'),[lang,setLang]=useState('ar'),[comparison,setComparison]=useState<string[]>([]);
 useEffect(()=>{setPath(location.pathname);setLang(localStorage.getItem('gd-language')||'ar');try{setComparison(JSON.parse(localStorage.getItem('gd-compare')||'[]'))}catch{}initClients().then(()=>setReady(true)).catch(e=>setError(message(e)));const nav=()=>setPath(location.pathname);window.addEventListener('popstate',nav);return()=>window.removeEventListener('popstate',nav)},[]);
 useEffect(()=>{document.title=lang==='ar'?'جي دي لصناعة أدوات المائدة | دقة في كل تصميم':'GD TABLEWARE INDUSTRY | Precision in Every Design';document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';localStorage.setItem('gd-language',lang)},[lang]);
 const go=(url:string)=>{history.pushState(null,'',url);setPath(url.split('?')[0]);window.dispatchEvent(new Event('gd:navigate'));window.scrollTo(0,0)};
 const toggleCompare=(id:string)=>setComparison(old=>{if(!old.includes(id)&&old.length>=4){toast.error(lang==='ar'?'يمكن مقارنة 4 تصميمات فقط':'Compare up to four designs');return old}const next=old.includes(id)?old.filter(i=>i!==id):[...old,id];localStorage.setItem('gd-compare',JSON.stringify(next));return next});
 const t=(ar:string,en:string)=>lang==='ar'?ar:en;
 const Link=({href,children,...props}:any)=><a href={href} {...props} onClick={(e:any)=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();go(href)}}}>{children}</a>;
 return <UI.Provider value={{lang,setLang,path,go,t,Link,comparison,toggleCompare}}><Toaster richColors position="top-center"/>{error?<main className="center-state"><h1>{t('تعذّر الاتصال','Connection unavailable')}</h1><p>{message(error,lang==='en'?'en':'ar')}</p><button onClick={()=>location.reload()}>{t('إعادة المحاولة','Try again')}</button></main>:!ready?<div className="center-state"><img width="100" src="/brand/gd-original.jpg" alt={t('جي دي','GD')}/><span className="spinner"/></div>:path.startsWith('/admin')?<Admin/>:<PublicSite/>}</UI.Provider>
}
