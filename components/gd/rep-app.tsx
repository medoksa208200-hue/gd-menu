'use client';
// The rep's phone app (/rep, and the Android app): start the day with the vehicle and odometer, GPS tracking
// while working, fuel fills and expenses with photos, and end the day with the odometer.
import React,{useEffect,useMemo,useState} from 'react';
import L from 'leaflet';
import {Truck,Fuel,Receipt,Flag,MapPin,Navigation,LogOut,CloudOff,Cloud,Camera,Download,Footprints,CircleAlert,Play,History,LayoutDashboard} from 'lucide-react';
import {toast} from 'sonner';
import {db,unwrap,Row,message,num,uploadImage} from '@/lib/gd';
import * as tracker from '@/lib/tracker';
import {useUI} from './platform';
import {Modal,ThemeButton} from './ui';
import {MapView,dot} from './map';
import PasswordField from './password-field';
import {CATEGORIES} from './fleet';
import {staffIdentity} from '@/supabase/functions/_shared/staff-identity.mjs';

// Database messages arrive in English; the rep reads Arabic.
function repError(e:unknown,lang:string){const text=message(e);if(lang!=='ar')return text;const n=(text.match(/\(([\d.]+)\)/)||[])[1];
  if(/below the last reading/.test(text))return `قراءة العداد أقل من آخر قراءة مسجلة للعربية (${n})`;
  if(/below the start reading/.test(text))return `قراءة العداد أقل من قراءة بداية اليوم (${n})`;
  if(/greater than the previous fill/.test(text))return `قراءة العداد لازم تكون أكبر من قراءة آخر تفويلة (${n})`;
  if(/Odometer reading required/.test(text))return 'اكتب قراءة العداد';
  if(/tracking.log required/.test(text))return 'الحساب ده مش حساب مندوب';
  if(/Failed to fetch|NetworkError|network/i.test(text))return 'مفيش اتصال بالإنترنت. حاول تاني لما النت يرجع.';
  return text}
const hm=(ms:number,lang:string)=>{const m=Math.max(0,Math.round(ms/60000)),h=Math.floor(m/60);return lang==='ar'?(h?`${h} س ${m%60} د`:`${m} د`):(h?`${h}h ${m%60}m`:`${m}m`)};
const kmText=(m:any)=>(Number(m||0)/1000).toFixed(1);
const clock=(v:any,lang:string)=>v?new Date(v).toLocaleTimeString(lang==='ar'?'ar-EG':'en-GB',{hour:'numeric',minute:'2-digit'}):'—';
// The Android app bundles the rep screens only in practice; managers open the dashboard on the website.
const ADMIN_URL='https://gd-menu.pages.dev/admin';
const dayText=(v:any,lang:string)=>new Date(v).toLocaleDateString(lang==='ar'?'ar-EG':'en-GB',{weekday:'short',day:'numeric',month:'short'});

export default function RepApp(){const {t,lang}=useUI();const [user,setUser]=useState<Row|null|undefined>(undefined),[access,setAccess]=useState<Row|null>(null);
 const load=async()=>{try{const {data:{user:u}}=await db().auth.getUser();setAccess(u?unwrap(await db().rpc('get_my_access')):null);setUser(u)}catch(e){toast.error(repError(e,lang));setUser(null)}};
 useEffect(()=>{load();const {data}=db().auth.onAuthStateChange(e=>{if(e==='SIGNED_OUT'||e==='SIGNED_IN')setTimeout(load,0)});return()=>data.subscription.unsubscribe()},[]);
 useEffect(()=>{document.title=t('GD — تطبيق المندوب','GD — Rep app');const link=document.querySelector('link[rel=manifest]')||Object.assign(document.createElement('link'),{rel:'manifest'});(link as HTMLLinkElement).href='/rep.webmanifest';document.head.appendChild(link);if('serviceWorker' in navigator&&!tracker.isNativeApp())navigator.serviceWorker.register('/rep-sw.js',{scope:'/rep'}).catch(()=>{})},[lang]);
 if(user===undefined)return <div className="center-state"><span className="spinner"/></div>;
 if(!user)return <RepLogin reload={load}/>;
 if(!access?.active||!access.permissions?.includes('tracking.log'))return <main className="center-state rep-blocked"><span className="empty-icon"><CircleAlert size={30}/></span><h1>{t('الحساب ده مش متفعّل كمندوب','This account is not set up as a rep')}</h1><p>{t('اطلب من الإدارة تفعيل حسابك بصلاحية "مندوب".','Ask the office to give your account the "Sales rep" role.')}</p><div className="btn-row"><button className="btn btn-dark" onClick={()=>db().auth.signOut()}>{t('تسجيل الخروج','Sign out')}</button>{access?.permissions?.includes('tracking.view')&&<a className="btn btn-outline" href="/admin/tracking">{t('لوحة التتبع','Tracking dashboard')}</a>}</div></main>;
 return <RepHome manager={!!access.permissions?.includes('tracking.view')}/>}

function RepLogin({reload}:{reload:()=>Promise<void>}){const {t}=useUI();const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 return <main className="rep-login"><form className="card" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const u=username.trim().toLowerCase();const r=await db().auth.signInWithPassword({email:staffIdentity(u,import.meta.env.VITE_SUPABASE_URL),password});if(r.error)throw Error(t('اسم المستخدم أو كلمة المرور غلط','Incorrect username or password'));await reload()}catch(e){toast.error(message(e))}finally{setBusy(false)}}}>
  <img width="110" height="80" src="/brand/gd-logo.webp" alt="GD"/><h1>{t('تطبيق المندوب','Rep app')}</h1><p className="muted">{t('سجّل دخولك بالحساب اللي الإدارة عملتهولك.','Sign in with the account the office created for you.')}</p>
  <label className="field">{t('اسم المستخدم','Username')}<input required dir="ltr" autoCapitalize="none" autoComplete="username" spellCheck={false} value={username} onChange={e=>setUsername(e.target.value)}/></label>
  <PasswordField label={t('كلمة المرور','Password')} required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/>
  <button className="btn btn-red btn-lg btn-block" disabled={busy}>{busy?<span className="spinner small light"/>:t('دخول','Sign in')}</button></form></main>}

function useInstall(){const [prompt,setPrompt]=useState<any>(null);useEffect(()=>{const h=(e:any)=>{e.preventDefault();setPrompt(e)};window.addEventListener('beforeinstallprompt',h);return()=>window.removeEventListener('beforeinstallprompt',h)},[]);return prompt}

function RepHome({manager}:{manager:boolean}){const {t,lang}=useUI();const [ctx,setCtx]=useState<Row|null>(null),[track,setTrack]=useState<tracker.TrackerState|null>(null),[modal,setModal]=useState<''|'fuel'|'expense'|'end'>(''),[now,setNow]=useState(Date.now());
 const install=useInstall();
 const load=async()=>{try{const c=unwrap(await db().rpc('rep_context'));setCtx(c);if(c.shift)tracker.start(c.shift.id,c.shift);else tracker.stop()}catch(e){toast.error(repError(e,lang));setCtx(c=>c||{vehicles:[],recent:[]})}};
 useEffect(()=>{load();const off=tracker.subscribe(setTrack);const tick=setInterval(()=>setNow(Date.now()),30000);return()=>{off();clearInterval(tick)}},[]);
 const shift=ctx?.shift;const vehicle=ctx?.vehicles?.find((v:Row)=>v.id===shift?.vehicle_id);
 return <div className="rep-app">
  <header className="rep-top"><img width="54" height="40" src="/brand/gd-logo.webp" alt="GD"/><div><b>{ctx?.display_name||'…'}</b><small>{shift?t('في الوردية','On shift'):t('خارج الوردية','Off shift')}</small></div>{manager&&<a className="btn btn-outline btn-sm" href={tracker.isNativeApp()?ADMIN_URL:'/admin'} target={tracker.isNativeApp()?'_blank':undefined} rel="noopener"><LayoutDashboard size={16}/>{t('لوحة الإدارة','Dashboard')}</a>}<ThemeButton/><button className="icon-btn" aria-label={t('تسجيل الخروج','Sign out')} onClick={async()=>{if(shift&&!confirm(t('الوردية لسه مفتوحة. لو خرجت التتبع هيقف. تخرج؟','Your shift is still open; signing out stops tracking. Sign out?')))return;await tracker.stop();await db().auth.signOut()}}><LogOut size={19}/></button></header>
  {!ctx?<div className="center-block"><span className="spinner"/></div>:shift?<ActiveShift shift={shift} vehicle={vehicle} track={track} now={now} onAction={setModal}/>:<StartShift ctx={ctx} onStarted={load}/>}
  {!tracker.isNativeApp()&&<div className="rep-install">{install?<button className="btn btn-outline btn-block" onClick={()=>install.prompt()}><Download size={17}/>{t('ثبّت التطبيق على الموبايل','Install on this phone')}</button>:null}<a className="btn btn-ghost btn-block" href="/downloads/gd-rep.apk" download><Download size={17}/>{t('تحميل تطبيق الأندرويد (تتبع والشاشة مقفولة)','Download the Android app (tracks with screen off)')}</a></div>}
  {ctx?.recent?.length>0&&<section className="card rep-history"><h3><History size={17}/>{t('آخر الأيام','Recent days')}</h3><ul>{ctx!.recent.filter((r:Row)=>r.ended_at).slice(0,7).map((r:Row)=><li key={r.id}><span><b>{dayText(r.started_at,lang)}</b><small>{clock(r.started_at,lang)} – {clock(r.ended_at,lang)}{r.plate_number?' · '+r.plate_number:''}</small></span><span className="rep-history-num"><b>{kmText(r.distance_m)}</b><small>{t('كم','km')}</small></span>{r.new_cells>0&&<span className="pill pill-amber">{t(`${r.new_cells} مربع جديد`,`${r.new_cells} new`)}</span>}</li>)}</ul></section>}
  {modal==='fuel'&&vehicle&&<FuelForm vehicle={vehicle} onClose={()=>setModal('')} onDone={()=>{setModal('');load()}}/>}
  {modal==='expense'&&vehicle&&<ExpenseForm vehicle={vehicle} onClose={()=>setModal('')} onDone={()=>{setModal('');load()}}/>}
  {modal==='end'&&shift&&<EndForm shift={shift} vehicle={vehicle} track={track} onClose={()=>setModal('')} onDone={()=>{setModal('');load()}}/>}
 </div>}

function PhotoInput({label,file,onChange}:{label:string,file:File|null,onChange:(f:File|null)=>void}){const {t}=useUI();const preview=useMemo(()=>file?URL.createObjectURL(file):'',[file]);useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 return <label className="rep-photo"><input type="file" accept="image/*" capture="environment" onChange={e=>onChange(e.target.files?.[0]||null)}/>{preview?<img src={preview} alt=""/>:<Camera size={22}/>}<span>{file?t('تغيير الصورة','Retake photo'):label}</span></label>}

function StartShift({ctx,onStarted}:{ctx:Row,onStarted:()=>void}){const {t,lang}=useUI();const vehicles:Row[]=ctx.vehicles||[];
 const [vehicleId,setVehicleId]=useState<string>(()=>vehicles.find(v=>v.id===ctx.last_vehicle_id)?.id||vehicles[0]?.id||'none'),[odometer,setOdometer]=useState(''),[photo,setPhoto]=useState<File|null>(null),[busy,setBusy]=useState(false);
 const v=vehicles.find(x=>x.id===vehicleId);
 return <section className="card rep-start"><h2><Play size={20}/>{t('ابدأ يوم الشغل','Start your work day')}</h2>
  <div className="field-label">{t('العربية اللي معاك النهارده','Your vehicle today')}</div>
  <div className="rep-vehicles">{vehicles.map(x=><button type="button" key={x.id} className={'rep-vehicle'+(vehicleId===x.id?' active':'')} onClick={()=>{setVehicleId(x.id);setOdometer('')}}><Truck size={18}/><b dir="rtl">{x.plate_number}</b><small>{lang==='ar'?x.type_ar:x.type_en}{x.in_use_by?' · '+t('مع ','with ')+x.in_use_by:''}</small></button>)}
   <button type="button" className={'rep-vehicle'+(vehicleId==='none'?' active':'')} onClick={()=>setVehicleId('none')}><Footprints size={18}/><b>{t('من غير عربية','No vehicle')}</b><small>{t('مشي أو مواصلات','On foot or transport')}</small></button></div>
  {v&&<><label className="field">{t('قراءة العداد دلوقتي (كم)','Odometer now (km)')}<input required inputMode="decimal" type="number" step="0.1" min={0} value={odometer} placeholder={v.odometer!=null?t('آخر قراءة: ','Last: ')+num(v.odometer):''} onChange={e=>setOdometer(e.target.value)}/></label>
   <PhotoInput label={t('صوّر العداد','Photo of the odometer')} file={photo} onChange={setPhoto}/></>}
  <button className="btn btn-red btn-lg btn-block" disabled={busy||(!!v&&!odometer)} onClick={async()=>{setBusy(true);try{
    const pos=await tracker.currentPosition();if(!pos&&!confirm(t('مش قادر أحدد مكانك. اتأكد إن الـ GPS شغال وإنك سمحت للتطبيق بالموقع. تكمّل برضه؟','Your location is not available. Check GPS and the location permission. Continue anyway?')))return;
    const key=v&&photo?(await uploadImage(photo,'factory-files','fleet/'+v.id)).path:null;
    unwrap(await db().rpc('rep_start_shift',{vehicle:v?.id||null,odometer:v?Number(odometer):null,photo:key,lat:pos?.lat??null,lng:pos?.lng??null}));
    toast.success(t('بدأ اليوم — التتبع شغال','Day started — tracking is on'));onStarted()}catch(e){toast.error(repError(e,lang))}finally{setBusy(false)}}}>{busy?<span className="spinner small light"/>:<><Navigation size={19}/>{t('ابدأ اليوم وشغّل التتبع','Start the day and tracking')}</>}</button>
  <p className="muted small">{t('التتبع بيشتغل في وقت الوردية بس، وبيقف لما تنهي اليوم.','Tracking runs only during your shift and stops when you end the day.')}</p></section>}

function ActiveShift({shift,vehicle,track,now,onAction}:{shift:Row,vehicle?:Row,track:tracker.TrackerState|null,now:number,onAction:(m:any)=>void}){const {t,lang}=useUI();
 const s=track?.status||'starting';const fix=track?.lastFix;const stale=fix&&now-fix.t>180000;
 const [tone,label]=s==='on'&&!stale?['green',t('التتبع شغال','Tracking on')]:s==='denied'?['red',t('مفيش إذن للموقع','Location permission denied')]:s==='unavailable'||s==='error'?['red',t('الـ GPS مش شغال','GPS not working')]:stale?['amber',t('مستني إشارة GPS','Waiting for GPS')]:['amber',t('بيبدأ التتبع…','Starting tracking…')];
 const route=track?.route||[];
 return <>
  <section className={'card rep-status tone-'+tone}><div className="rep-status-row"><span className="rep-dot"/><b>{label}</b>{track&&(track.pending>0?<span className="pill pill-amber"><CloudOff size={13}/>{t(`${track.pending} نقطة مستنية الرفع`,`${track.pending} points to upload`)}</span>:track.lastSync?<span className="pill pill-green"><Cloud size={13}/>{t('متزامن','Synced')}</span>:null)}</div>
   <p className="muted small">{t('بدأت ','Started ')}{clock(shift.started_at,lang)} · {t('منذ ','')}{hm(now-Date.parse(shift.started_at),lang)}{vehicle?' · '+vehicle.plate_number:''}{fix?.acc!=null?' · '+t('دقة ','accuracy ')+Math.round(fix.acc)+t(' م',' m'):''}</p>
   {s==='denied'&&<div className="alert">{t('افتح إعدادات الموبايل ← التطبيقات ← المتصفح/تطبيق GD ← الموقع، واختار "السماح طول الوقت" أو "أثناء الاستخدام".','Open phone Settings → Apps → this app → Location and allow it.')}</div>}
   {!track?.native&&s!=='denied'&&<p className="rep-hint">{t('خلي التطبيق مفتوح قدامك والشاشة شغالة (ممكن تقللها للآخر). عشان التتبع والشاشة مقفولة نزّل تطبيق الأندرويد.','Keep this app open on screen (you can dim it). For tracking with the screen off, install the Android app.')}</p>}
  </section>
  <div className="rep-stats"><div><b>{kmText(track?.distanceM||shift.distance_m)}</b><span>{t('كم النهارده','km today')}</span></div><div><b>{num(track?.newCells??shift.new_cells)}</b><span>{t('مربع جديد','new cells')}</span></div><div><b>{num(track?.points||shift.points_count)}</b><span>{t('نقطة مسجلة','points')}</span></div></div>
  <p className="muted small rep-note">{t('الخريطة متقسمة مربعات 150×150 متر. "مربع جديد" = أول مرة تعدّي فيه. أول يوم كل المربعات بتتحسب جديدة، ومن تاني يوم بيتحسب الجديد بس.','The map is split into 150×150 m cells. A “new cell” is one you pass through for the first time; on your first day every cell counts as new.')}</p>
  <MapView height={240} className="rep-map" fitKey={route.length>1?'route':'none'} deps={[route.length,fix?.t]} draw={g=>{if(route.length>1)L.polyline(route,{color:'#e30613',weight:4,opacity:.85}).addTo(g);const here=fix?[fix.lat,fix.lng] as [number,number]:route[route.length-1];if(here){L.marker(here,{icon:dot('#1d4ed8')}).addTo(g);if(route.length<=1)return L.latLng(here).toBounds(800)}return route.length>1?L.latLngBounds(route):null}}/>
  <div className="rep-actions">{vehicle&&<button className="rep-action" onClick={()=>onAction('fuel')}><Fuel size={24}/>{t('تفويل سولار','Fuel fill')}</button>}{vehicle&&<button className="rep-action" onClick={()=>onAction('expense')}><Receipt size={24}/>{t('مصروف / صيانة','Expense / service')}</button>}<button className="rep-action end" onClick={()=>onAction('end')}><Flag size={24}/>{t('إنهاء اليوم','End the day')}</button></div>
 </>}

function FuelForm({vehicle,onClose,onDone}:{vehicle:Row,onClose:()=>void,onDone:()=>void}){const {t,lang}=useUI();const [f,setF]=useState<Row>({odometer:'',liters:'',price:'',station:''}),[photo,setPhoto]=useState<File|null>(null),[busy,setBusy]=useState(false);const set=(k:string)=>(e:any)=>setF(o=>({...o,[k]:e.target.value}));
 const prev=vehicle.last_fuel_odometer;const dist=f.odometer&&prev!=null?Number(f.odometer)-Number(prev):null;
 return <Modal title={t('تفويل سولار — ','Fuel fill — ')+vehicle.plate_number} onClose={onClose}><form className="form-grid one" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const key=photo?(await uploadImage(photo,'factory-files','fleet/'+vehicle.id)).path:null;unwrap(await db().rpc('rep_log_fuel',{vehicle:vehicle.id,odometer:Number(f.odometer),liters:Number(f.liters),price:f.price?Number(f.price):null,station:f.station||null,photo:key}));toast.success(t('اتسجل التفويل','Fuel fill saved'));onDone()}catch(e){toast.error(repError(e,lang))}finally{setBusy(false)}}}>
  <label className="field">{t('قراءة العداد وقت التفويل (كم)','Odometer at the pump (km)')}<input required inputMode="decimal" type="number" step="0.1" min={0} value={f.odometer} onChange={set('odometer')}/>{prev!=null&&<small className="muted">{t('آخر تفويلة كانت على ','Previous fill at ')}{num(prev)}{dist!=null&&dist>0?' · '+t(`مشيت ${num(Math.round(dist))} كم`,`${num(Math.round(dist))} km since`):''}</small>}</label>
  <div className="form-grid"><label className="field">{t('عدد اللترات','Litres')}<input required inputMode="decimal" type="number" step="0.01" min={0.1} value={f.liters} onChange={set('liters')}/></label><label className="field">{t('سعر اللتر (ج.م)','Price per litre')}<input inputMode="decimal" type="number" step="0.01" min={0} value={f.price} onChange={set('price')}/></label></div>
  {f.liters&&f.price&&<p className="muted small">{t('الإجمالي: ','Total: ')}<b>{num(Math.round(Number(f.liters)*Number(f.price)))} {t('ج.م','EGP')}</b></p>}
  <label className="field">{t('البنزينة (اختياري)','Station (optional)')}<input maxLength={120} value={f.station} onChange={set('station')}/></label>
  <PhotoInput label={t('صوّر العداد أو الفاتورة','Photo of odometer or receipt')} file={photo} onChange={setPhoto}/>
  <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={onClose}>{t('إلغاء','Cancel')}</button><button className="btn btn-red" disabled={busy}>{busy?<span className="spinner small light"/>:t('حفظ','Save')}</button></div></form></Modal>}

function ExpenseForm({vehicle,onClose,onDone}:{vehicle:Row,onClose:()=>void,onDone:()=>void}){const {t,lang}=useUI();const [f,setF]=useState<Row>({category:'maintenance',amount:'',part_name:'',odometer:'',workshop:'',description:''}),[photo,setPhoto]=useState<File|null>(null),[busy,setBusy]=useState(false);const set=(k:string)=>(e:any)=>setF(o=>({...o,[k]:e.target.value}));
 return <Modal title={t('مصروف — ','Expense — ')+vehicle.plate_number} onClose={onClose}><form className="form-grid one" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const key=photo?(await uploadImage(photo,'factory-files','fleet/'+vehicle.id)).path:null;unwrap(await db().rpc('rep_log_expense',{vehicle:vehicle.id,category:f.category,amount:Number(f.amount),part_name:f.part_name||null,odometer:f.odometer?Number(f.odometer):null,workshop:f.workshop||null,description:f.description||null,photo:key}));toast.success(t('اتسجل المصروف','Expense saved'));onDone()}catch(e){toast.error(repError(e,lang))}finally{setBusy(false)}}}>
  <div className="chip-row wrap">{Object.entries(CATEGORIES).map(([k,[a,en]])=><button type="button" key={k} className={'chip'+(f.category===k?' active':'')} onClick={()=>setF(o=>({...o,category:k}))}>{t(a,en)}</button>)}</div>
  <label className="field">{t('المبلغ (ج.م)','Amount (EGP)')}<input required inputMode="decimal" type="number" step="0.01" min={0} value={f.amount} onChange={set('amount')}/></label>
  {f.category==='spare_part'&&<label className="field">{t('اسم القطعة','Part name')}<input required maxLength={120} value={f.part_name} onChange={set('part_name')}/></label>}
  <label className="field">{t('قراءة العداد','Odometer')}{f.category==='oil_change'?'':t(' (اختياري)',' (optional)')}<input required={f.category==='oil_change'} inputMode="decimal" type="number" step="0.1" min={0} value={f.odometer} onChange={set('odometer')}/></label>
  <label className="field">{t('الورشة / المحل (اختياري)','Workshop / shop (optional)')}<input maxLength={120} value={f.workshop} onChange={set('workshop')}/></label>
  <label className="field">{t('تفاصيل (اختياري)','Details (optional)')}<textarea rows={2} maxLength={1000} value={f.description} onChange={set('description')}/></label>
  <PhotoInput label={t('صوّر الفاتورة','Photo of the receipt')} file={photo} onChange={setPhoto}/>
  <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={onClose}>{t('إلغاء','Cancel')}</button><button className="btn btn-red" disabled={busy}>{busy?<span className="spinner small light"/>:t('حفظ','Save')}</button></div></form></Modal>}

function EndForm({shift,vehicle,track,onClose,onDone}:{shift:Row,vehicle?:Row,track:tracker.TrackerState|null,onClose:()=>void,onDone:()=>void}){const {t,lang}=useUI();const [odometer,setOdometer]=useState(''),[note,setNote]=useState(''),[photo,setPhoto]=useState<File|null>(null),[busy,setBusy]=useState(false);
 const gpsKm=Number(track?.distanceM||shift.distance_m||0)/1000;const odoKm=odometer&&shift.odometer_start!=null?Number(odometer)-Number(shift.odometer_start):null;
 return <Modal title={t('إنهاء اليوم','End the day')} onClose={onClose}><form className="form-grid one" onSubmit={async e=>{e.preventDefault();setBusy(true);try{
   const left=await tracker.drain();if(left>0&&!confirm(t(`فيه ${left} نقطة لسه ما اترفعتش (مفيش نت). لو أنهيت دلوقتي ممكن جزء من خط السير يضيع. تنهي برضه؟`,`${left} points are not uploaded yet (no connection). End anyway?`)))return;
   const key=vehicle&&photo?(await uploadImage(photo,'factory-files','fleet/'+vehicle.id)).path:null;
   const s=unwrap(await db().rpc('rep_end_shift',{shift:shift.id,odometer:vehicle?Number(odometer):null,photo:key,note:note||null}));await tracker.stop();
   toast.success(t(`خلصت اليوم: ${kmText(s.distance_m)} كم، ${s.new_cells} مربع جديد`,`Day ended: ${kmText(s.distance_m)} km, ${s.new_cells} new areas`),{duration:8000});onDone()}catch(e){toast.error(repError(e,lang))}finally{setBusy(false)}}}>
  {vehicle&&<><label className="field">{t('قراءة العداد دلوقتي (كم)','Odometer now (km)')}<input required inputMode="decimal" type="number" step="0.1" min={shift.odometer_start||0} value={odometer} onChange={e=>setOdometer(e.target.value)}/><small className="muted">{t('بداية اليوم: ','Start of day: ')}{num(shift.odometer_start)}</small></label>
   {odoKm!=null&&odoKm>=0&&<div className="rep-compare"><span>{t('العداد','Odometer')}: <b>{num(Math.round(odoKm))} {t('كم','km')}</b></span><span>GPS: <b>{gpsKm.toFixed(1)} {t('كم','km')}</b></span></div>}
   <PhotoInput label={t('صوّر العداد','Photo of the odometer')} file={photo} onChange={setPhoto}/></>}
  <label className="field">{t('ملاحظات اليوم (اختياري)','Notes (optional)')}<textarea rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
  <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={onClose}>{t('رجوع','Back')}</button><button className="btn btn-red" disabled={busy}>{busy?<span className="spinner small light"/>:<><MapPin size={17}/>{t('إنهاء اليوم وإيقاف التتبع','End day and stop tracking')}</>}</button></div></form></Modal>}
