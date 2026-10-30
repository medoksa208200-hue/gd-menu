'use client';
import React,{useState} from 'react';
import {Check,X,Plus,Palette} from 'lucide-react';
import {toast} from 'sonner';
import {Row,message} from '@/lib/gd';
import {useUI} from './platform';
// Common melamine/tableware colors. A preset is saved to the shared color list the first time it is used.
export const presetColors:[string,string,string][]=[
 ['أبيض','White','#FFFFFF'],['أوف وايت','Off-white','#F5F1E6'],['كريمي','Cream','#EFE3C8'],['بيج','Beige','#D9C3A0'],['رملي','Sand','#C8B08A'],['رمادي فاتح','Light grey','#D3D3D6'],
 ['رمادي','Grey','#8E8E93'],['رمادي غامق','Charcoal','#4A4A4F'],['أسود','Black','#111111'],['فضي','Silver','#C0C0C0'],['ذهبي','Gold','#C9A227'],['نحاسي','Copper','#B87333'],
 ['أحمر','Red','#D1202F'],['نبيتي','Burgundy','#7B1E2B'],['وردي','Pink','#F2A7B5'],['فوشيا','Fuchsia','#D63384'],['بينك فاتح','Blush','#F7D6D0'],['خوخي','Peach','#F6B48F'],
 ['برتقالي','Orange','#F28C28'],['أصفر','Yellow','#F5C518'],['ليموني','Lime yellow','#E5E85A'],['مستردة','Mustard','#D4A017'],['أخضر فاتح','Light green','#9BCB6B'],['أخضر','Green','#2E9D57'],
 ['زيتي','Olive','#6B7B3A'],['أخضر غامق','Dark green','#1F5C3F'],['مِنت','Mint','#A8E6CF'],['تركواز','Turquoise','#2BB3B1'],['سماوي','Sky blue','#7CC6E8'],['أزرق','Blue','#2D6CDF'],
 ['أزرق ملكي','Royal blue','#1E3A8A'],['كحلي','Navy','#1B2A4A'],['ليلكي','Lilac','#B9A3D9'],['بنفسجي','Purple','#6F42C1'],['بني فاتح','Light brown','#A9744F'],['بني','Brown','#6B4226'],
];
const norm=(hex:string)=>hex.trim().toUpperCase();
export function AllColorsDot(){return <i className="all-colors-dot" aria-hidden="true"/>}
export default function ColorPalette({colors,selected,allColors,disabled,onToggle,onAllColors,onCreate}:{colors:Row[],selected:string[],allColors:boolean,disabled?:boolean,onToggle:(id:string)=>void,onAllColors:(v:boolean)=>void,onCreate:(c:{name_ar:string,name_en:string,hex:string})=>Promise<Row>}){
 const {t,lang}=useUI();const [hex,setHex]=useState('#2D6CDF'),[name,setName]=useState(''),[busy,setBusy]=useState('');
 const byHex=(h:string)=>colors.find(c=>norm(c.hex)===norm(h));
 const pick=async(ar:string,en:string,h:string)=>{const existing=byHex(h);if(existing){onToggle(existing.id);return}setBusy(h);try{const created=await onCreate({name_ar:ar,name_en:en,hex:norm(h)});onToggle(created.id)}catch(e){toast.error(message(e))}finally{setBusy('')}};
 const validHex=/^#[0-9A-Fa-f]{6}$/.test(hex.trim());
 const extra=colors.filter(c=>!presetColors.some(p=>norm(p[2])===norm(c.hex)));
 const chosen=colors.filter(c=>selected.includes(c.id));
 return <div className="palette">
  <button type="button" role="switch" aria-checked={allColors} disabled={disabled} onClick={()=>onAllColors(!allColors)} className={'all-colors-toggle'+(allColors?' on':'')}><AllColorsDot/><span><b>{t('متاح بكل الألوان','Available in all colors')}</b><small>{t('يظهر للعميل أن التصميم يُصنع بأي لون يطلبه','Tells customers this design can be made in any color')}</small></span><span className="switch-track"><span className="switch-thumb"/></span></button>
  <div className="palette-chosen">{chosen.length?chosen.map(c=><span key={c.id} className="swatch static"><i style={{background:c.hex}}/>{c['name_'+lang]}{!disabled&&<button type="button" onClick={()=>onToggle(c.id)} aria-label={t('إزالة','Remove')}><X size={14}/></button>}</span>):<span className="muted small">{allColors?t('يمكنك أيضًا تحديد ألوان معيّنة متوفرة حاليًا.','You can also mark specific colors in stock.'):t('لم تختر ألوانًا بعد — اضغط على الألوان من اللوحة.','No colors chosen yet — tap colors in the palette.')}</span>}</div>
  <div className="palette-grid" role="group" aria-label={t('لوحة الألوان','Color palette')}>{[...presetColors.map(([ar,en,h])=>({name_ar:ar,name_en:en,hex:h,id:byHex(h)?.id})),...extra].map(c=>{const on=!!c.id&&selected.includes(c.id);return <button type="button" key={c.hex+(c.name_en||'')} disabled={disabled||busy===c.hex} className={'palette-swatch'+(on?' on':'')} onClick={()=>c.id?onToggle(c.id):pick(c.name_ar,c.name_en,c.hex)} aria-pressed={on} title={(lang==='ar'?c.name_ar:c.name_en)+' '+norm(c.hex)}><i style={{background:c.hex}}>{on&&<Check size={15}/>}</i><span>{lang==='ar'?c.name_ar:c.name_en}</span></button>})}</div>
  {!disabled&&<div className="custom-color"><span className="field-label"><Palette size={15}/>{t('لون غير موجود؟ أضفه من اللوحة أو بكود اللون','Missing a color? Pick it or enter its code')}</span><div className="custom-row"><input type="color" value={validHex?hex:'#000000'} onChange={e=>setHex(e.target.value.toUpperCase())} aria-label={t('اختيار اللون','Pick color')}/><input dir="ltr" className="hex-input" value={hex} onChange={e=>setHex(e.target.value.startsWith('#')?e.target.value:'#'+e.target.value)} maxLength={7} placeholder="#2D6CDF" aria-label={t('كود اللون','Color code')}/><input value={name} onChange={e=>setName(e.target.value)} placeholder={t('اسم اللون (مثال: أزرق بترولي)','Color name (e.g. Petrol blue)')} aria-label={t('اسم اللون','Color name')}/><button type="button" className="btn btn-dark" disabled={!validHex||!!busy} onClick={async()=>{await pick(name.trim()||norm(hex),name.trim()||norm(hex),hex);setName('')}}><Plus size={16}/>{t('إضافة','Add')}</button></div>{!validHex&&hex.length>1&&<small className="hint amber">{t('الكود يكون بالشكل #RRGGBB مثل #2D6CDF','Use the #RRGGBB format, e.g. #2D6CDF')}</small>}</div>}
 </div>}
