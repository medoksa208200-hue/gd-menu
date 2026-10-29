'use client';
import {Globe2} from 'lucide-react';
import {useUI} from './platform';
export default function LanguageToggle(){const {lang,setLang,t}=useUI();const label=t('التبديل إلى الإنجليزية','Switch to Arabic');return <button type="button" className="language-toggle" onClick={()=>setLang(lang==='ar'?'en':'ar')} aria-label={label} title={label}><Globe2 size={19} aria-hidden="true"/><span className="language-toggle-mark" aria-hidden="true">{lang==='ar'?'A':'ع'}</span></button>}
