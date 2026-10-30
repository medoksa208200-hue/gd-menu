'use client';
import React,{useEffect,useRef,useState} from 'react';
import {X,CameraOff} from 'lucide-react';
import {useUI} from './platform';
// Reads a design's QR card with the phone camera and opens that design. Uses the browser's
// BarcodeDetector when available (Android Chrome) and the bundled jsQR decoder otherwise (iPhone).
export function codeFromScan(text:string){const value=text.trim();try{const url=new URL(value);const match=url.pathname.match(/^\/catalog\/(.+)$/);if(match)return decodeURIComponent(match[1]);return null}catch{return value.length<=80?value:null}}
export default function QrScanner({onClose}:{onClose:()=>void}){const {t,go}=useUI();const video=useRef<HTMLVideoElement>(null);const [error,setError]=useState('');
 useEffect(()=>{let stream:MediaStream|null=null,timer=0,stopped=false;const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const found=(text:string)=>{const code=codeFromScan(text);if(!code||stopped)return;stopped=true;onClose();go('/catalog/'+encodeURIComponent(code))};
  (async()=>{try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(stopped){stream.getTracks().forEach(tr=>tr.stop());return}const v=video.current!;v.srcObject=stream;await v.play();
   const Detector=(window as any).BarcodeDetector;const detector=Detector&&(await Detector.getSupportedFormats?.())?.includes('qr_code')?new Detector({formats:['qr_code']}):null;const jsQR=detector?null:(await import('jsqr')).default;
   const scan=async()=>{if(stopped)return;if(v.readyState>=2&&v.videoWidth){try{if(detector){const codes=await detector.detect(v);if(codes[0]?.rawValue)return found(codes[0].rawValue)}else{const w=Math.min(640,v.videoWidth),h=Math.round(v.videoHeight*w/v.videoWidth);canvas.width=w;canvas.height=h;ctx.drawImage(v,0,0,w,h);const result=jsQR!(ctx.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'dontInvert'});if(result?.data)return found(result.data)}}catch{}}timer=window.setTimeout(scan,180)};scan()}
   catch{setError(t('لا يمكن فتح الكاميرا. اسمح للمتصفح باستخدام الكاميرا ثم حاول مرة أخرى.','Unable to open the camera. Allow camera access in the browser and try again.'))}})();
  const key=(e:KeyboardEvent)=>e.key==='Escape'&&onClose();document.addEventListener('keydown',key);
  return()=>{stopped=true;clearTimeout(timer);stream?.getTracks().forEach(tr=>tr.stop());document.removeEventListener('keydown',key)}},[]);
 return <div className="scanner" role="dialog" aria-modal="true" aria-label={t('مسح QR','Scan QR')}><video ref={video} playsInline muted/><div className="scanner-frame" aria-hidden="true"><span/></div><div className="scanner-top"><b>{t('وجّه الكاميرا إلى كود QR الخاص بالأسطمبة','Point the camera at the mold’s QR code')}</b><button className="icon-btn" onClick={onClose} aria-label={t('إغلاق','Close')}><X size={22}/></button></div>{error&&<div className="scanner-error"><CameraOff size={30}/><p>{error}</p><button className="btn btn-white" onClick={onClose}>{t('إغلاق','Close')}</button></div>}</div>}
