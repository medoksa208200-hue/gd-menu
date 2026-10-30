'use client';
import React,{useEffect,useState} from 'react';
import {X,Download,Link2,Share2} from 'lucide-react';
import {toast} from 'sonner';
import {useUI} from './platform';
import SocialIcon from './social-icon';
type Mold={code:string,name_ar?:string,name_en?:string};
export const moldUrl=(code:string)=>location.origin+'/catalog/'+encodeURIComponent(code);
export const whatsappShareUrl=(text:string)=>'https://wa.me/?text='+encodeURIComponent(text);
const loadImage=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src});
function wrap(ctx:CanvasRenderingContext2D,text:string,width:number){const words=text.split(/\s+/);const lines:string[]=[];let line='';for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>width&&line){lines.push(line);line=word}else line=next}if(line)lines.push(line);return lines.slice(0,2)}
// A printable / shareable card: logo, design name, code and a QR that opens the design's public page.
async function renderCard(mold:Mold,lang:string){const QR=await import('qrcode');const url=moldUrl(mold.code);const [qr,logo]=await Promise.all([QR.toDataURL(url,{width:640,margin:0,errorCorrectionLevel:'M',color:{dark:'#0b0b0c',light:'#ffffff'}}).then(loadImage),loadImage('/brand/gd-logo.webp').catch(()=>null)]);await document.fonts?.ready;
 const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d')!;const rtl=lang==='ar';ctx.direction=rtl?'rtl':'ltr';
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1080,1350);ctx.fillStyle='#ed0715';ctx.fillRect(0,0,1080,14);
 if(logo){const h=150,w=logo.width/logo.height*h;ctx.drawImage(logo,(1080-w)/2,70,w,h)}
 ctx.textAlign='center';ctx.fillStyle='#0b0b0c';ctx.font='700 58px Cairo, sans-serif';const name=(rtl?mold.name_ar:mold.name_en)||mold.name_ar||mold.code;wrap(ctx,name,900).forEach((line,i)=>ctx.fillText(line,540,320+i*72));
 ctx.font='600 34px Cairo, sans-serif';ctx.fillStyle='#ed0715';ctx.fillText((rtl?'كود التصميم: ':'Design code: ')+mold.code,540,470);
 ctx.fillStyle='#f4f4f2';const box=700,x=(1080-box)/2,y=520;ctx.beginPath();ctx.roundRect(x,y,box,box,36);ctx.fill();ctx.drawImage(qr,x+30,y+30,box-60,box-60);
 ctx.fillStyle='#6b6b70';ctx.font='500 30px Cairo, sans-serif';ctx.fillText(rtl?'امسح الكود لعرض التصميم ومواصفاته':'Scan to view the design and its specifications',540,1290);
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Card unavailable')),'image/png'))}
export function ShareSheet({mold,onClose}:{mold:Mold,onClose:()=>void}){const {t,lang}=useUI();const [preview,setPreview]=useState(''),[blob,setBlob]=useState<Blob|null>(null);const url=moldUrl(mold.code);const name=(lang==='ar'?mold.name_ar:mold.name_en)||mold.name_ar||mold.code;const text=t(`${name}\nكود التصميم: ${mold.code}\n${url}`,`${name}\nDesign code: ${mold.code}\n${url}`);const fileName='GD-'+mold.code.replace(/[^\w.-]+/g,'-')+'.png';
 useEffect(()=>{let objectUrl='';renderCard(mold,lang).then(b=>{setBlob(b);objectUrl=URL.createObjectURL(b);setPreview(objectUrl)}).catch(()=>toast.error(t('تعذّر تجهيز البطاقة','Unable to prepare the card')));const key=(e:KeyboardEvent)=>e.key==='Escape'&&onClose();document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(objectUrl)URL.revokeObjectURL(objectUrl)}},[mold.code,lang]);
 const file=blob?new File([blob],fileName,{type:'image/png'}):null;const canShareFile=!!file&&!!navigator.canShare?.({files:[file]});
 const download=()=>{if(!preview)return;const a=document.createElement('a');a.href=preview;a.download=fileName;a.click()};
 return <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}><div className="sheet share-sheet" role="dialog" aria-modal="true" aria-label={t('مشاركة التصميم','Share design')}><div className="sheet-head"><div><h2>{t('مشاركة التصميم','Share this design')}</h2><p>{name} · <span className="code">{mold.code}</span></p></div><button className="icon-btn" onClick={onClose} aria-label={t('إغلاق','Close')}><X size={20}/></button></div>
 <div className="share-preview">{preview?<img src={preview} alt={t('بطاقة QR للتصميم','Design QR card')}/>:<span className="spinner"/>}</div>
 <div className="share-actions"><a className="btn btn-whatsapp btn-lg" href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer"><SocialIcon name="whatsapp"/>{t('إرسال الرابط على واتساب','Send link on WhatsApp')}</a>{canShareFile&&<button className="btn btn-dark btn-lg" onClick={async()=>{try{await navigator.share({files:[file!],text})}catch{}}}><Share2 size={18}/>{t('إرسال بطاقة QR (واتساب وغيره)','Send QR card (WhatsApp & more)')}</button>}<div className="share-row"><button className="btn btn-outline" onClick={download} disabled={!preview}><Download size={17}/>{t('تنزيل البطاقة','Download card')}</button><button className="btn btn-outline" onClick={async()=>{try{await navigator.clipboard.writeText(url);toast.success(t('تم نسخ الرابط','Link copied'))}catch{toast.error(t('تعذّر النسخ','Copy failed'))}}}><Link2 size={17}/>{t('نسخ الرابط','Copy link')}</button></div></div></div></div>}
