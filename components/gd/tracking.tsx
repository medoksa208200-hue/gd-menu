'use client';
// Rep tracking for managers: where every rep is now, each day's route with new streets and stops, and the
// network the reps cover on the map.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import {MapPin,Route,Map as MapIcon,Users,ArrowLeft,ArrowRight,Flag,Clock,Gauge,Grid2x2,Smartphone,RefreshCw,TriangleAlert,Trophy,FileSpreadsheet,Play,Pause,Crosshair,SignalLow,Timer} from 'lucide-react';
import {toast} from 'sonner';
import {db,unwrap,Row,message,num} from '@/lib/gd';
import {useUI} from './platform';
import {Empty} from './public-site';
import {PageHead} from './ui';
import {MapView,dot,cellBounds,REP_COLORS,routeLine} from './map';
import {meters} from '@/lib/tracker';

const localDay=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const daysAgo=(n:number)=>localDay(new Date(Date.now()-n*86400000));
const kmText=(m:any)=>(Number(m||0)/1000).toFixed(1);
const ago=(v:any,t:(a:string,e:string)=>string)=>{if(!v)return t('لا توجد إشارة','No signal');const m=Math.round((Date.now()-Date.parse(v))/60000);if(m<1)return t('الآن','now');if(m<60)return t(`منذ ${m} د`,`${m} min ago`);const h=Math.floor(m/60);if(h<24)return t(`منذ ${h} س`,`${h} h ago`);return t(`منذ ${Math.floor(h/24)} يوم`,`${Math.floor(h/24)} d ago`)};
const clock=(v:any,lang:string)=>v?new Date(v).toLocaleTimeString(lang==='ar'?'ar-EG':'en-GB',{hour:'numeric',minute:'2-digit'}):'—';
const day=(v:any,lang:string)=>new Date(v).toLocaleDateString(lang==='ar'?'ar-EG':'en-GB',{weekday:'short',day:'numeric',month:'short'});
const dur=(ms:number,lang:string)=>{const m=Math.max(0,Math.round(ms/60000)),h=Math.floor(m/60);return lang==='ar'?(h?`${h}س ${m%60}د`:`${m}د`):(h?`${h}h ${m%60}m`:`${m}m`)};
const CELL_KM2=0.0224,SPEED_LIMIT=100;
// Excel download of any table: the header row is the column titles.
async function exportSheet(name:string,header:string[],rows:any[][],rtl:boolean){const Excel=(await import('exceljs')).default;const wb=new Excel.Workbook();const sheet=wb.addWorksheet(name.slice(0,30));sheet.views=[{rightToLeft:rtl}];sheet.addRow(header);for(const r of rows)sheet.addRow(r);sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>c.width=18);const out=await wb.xlsx.writeBuffer();const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));a.download=name+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
const minutesOfDay=(v:string)=>{const d=new Date(v);return d.getHours()*60+d.getMinutes()};
const hhmm=(m:number,lang:string)=>new Date(2000,0,1,Math.floor(m/60),Math.round(m%60)).toLocaleTimeString(lang==='ar'?'ar-EG':'en-GB',{hour:'numeric',minute:'2-digit'});
function useReps(){const [reps,setReps]=useState<Row[]>([]);const load=()=>db().rpc('tracking_reps').then(r=>{if(r.error)toast.error(message(r.error));else setReps(r.data||[])});useEffect(()=>{load()},[]);return {reps,load}}
const colorOf=(reps:Row[],id:string)=>REP_COLORS[Math.max(0,reps.findIndex(r=>r.id===id))%REP_COLORS.length];

export default function TrackingPage({access,id}:{access:Row,id?:string}){const {t}=useUI();const [tab,setTab]=useState<'live'|'shifts'|'scores'|'coverage'>(()=>{const q=new URLSearchParams(location.search).get('tab');return q==='shifts'||q==='coverage'||q==='scores'?q:'live'});const {reps,load}=useReps();
 if(id)return <RouteView id={id} reps={reps}/>;
 const pick=(k:typeof tab)=>{setTab(k);history.replaceState(null,'','/admin/tracking'+(k==='live'?'':'?tab='+k))};
 return <><PageHead title={t('تتبع المناديب','Rep tracking')} subtitle={t('مكان كل مندوب دلوقتي، خط سير كل يوم، والشبكة اللي بتغطيها المناديب.','Where every rep is now, each day’s route, and the network your reps cover.')}><a className="btn btn-outline" href="/rep" target="_blank" rel="noopener"><Smartphone size={17}/>{t('تطبيق المندوب','Rep app')}</a></PageHead>
  <div className="segmented tracking-tabs" role="tablist">{([['live','مباشر','Live',MapPin],['shifts','الورديات والمسافات','Shifts & distance',Route],['scores','تقييم المناديب','Rep scorecard',Trophy],['coverage','خريطة التغطية','Coverage map',MapIcon]] as const).map(([k,a,e,Icon])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>pick(k)}><Icon size={15}/>{t(a,e)}</button>)}</div>
  {tab==='live'?<Live reps={reps} reload={load} access={access}/>:tab==='shifts'?<Shifts reps={reps}/>:tab==='scores'?<Scorecard reps={reps}/>:<Coverage reps={reps}/>}</>}

function RepFilter({reps,value,onChange}:{reps:Row[],value:string,onChange:(v:string)=>void}){const {t}=useUI();return <label className="field inline"><span>{t('المندوب','Rep')}</span><select value={value} onChange={e=>onChange(e.target.value)}><option value="">{t('كل المناديب','All reps')}</option>{reps.map(r=><option key={r.id} value={r.id}>{r.display_name}</option>)}</select></label>}
function Dates({from,to,setFrom,setTo}:{from:string,to:string,setFrom:(v:string)=>void,setTo:(v:string)=>void}){const {t}=useUI();const presets:[string,string,number][]=[['النهارده','Today',0],['7 أيام','7 days',6],['30 يوم','30 days',29],['90 يوم','90 days',89]];
 return <div className="tracking-dates"><div className="chip-row wrap">{presets.map(([a,e,n])=><button key={e} type="button" className={'chip'+(from===daysAgo(n)&&to===localDay()?' active':'')} onClick={()=>{setFrom(daysAgo(n));setTo(localDay())}}>{t(a,e)}</button>)}</div><label className="field inline"><span>{t('من','From')}</span><input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label className="field inline"><span>{t('إلى','To')}</span><input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label></div>}

// Today's route of every open shift, fetched incrementally: only points newer than the last one already loaded.
function useLiveRoutes(shifts:Row[]){const store=useRef(new Map<string,{since:string|null,pts:[number,number][]}>()),[version,setVersion]=useState(0);
 const key=shifts.map(s=>s.id+':'+(s.last_seen_at||'')).join('|');
 useEffect(()=>{let cancelled=false;(async()=>{let changed=false;
  for(const s of shifts){const r=store.current.get(s.id)||{since:null,pts:[]};
   for(let page=0;page<20;page++){let q=db().from('rep_locations').select('lat,lng,recorded_at').eq('shift_id',s.id).lte('accuracy',100).order('recorded_at').limit(1000);if(r.since)q=q.gt('recorded_at',r.since);
    const {data,error}=await q;if(error||!data?.length)break;for(const p of data)r.pts.push([p.lat,p.lng]);r.since=data[data.length-1].recorded_at;changed=true;if(data.length<1000)break}
   store.current.set(s.id,r)}
  if(changed&&!cancelled)setVersion(v=>v+1)})();return()=>{cancelled=true}},[key]);
 return {routes:store.current,version}}

function Live({reps,reload,access}:{reps:Row[],reload:()=>void,access:Row}){const {t,lang,Link}=useUI();const [,tick]=useState(0);const mapRef=useRef<L.Map|null>(null);
 const focus=(s:Row)=>{if(s?.last_lat!=null)mapRef.current?.flyTo([s.last_lat,s.last_lng],16,{duration:.8})};
 useEffect(()=>{const i=setInterval(()=>{reload();tick(x=>x+1)},15000);return()=>clearInterval(i)},[]);
 const onShift=reps.filter(r=>r.shift);const {routes,version}=useLiveRoutes(onShift.map(r=>r.shift));const live=onShift.filter(r=>r.shift.last_seen_at&&Date.now()-Date.parse(r.shift.last_seen_at)<180000);
 const canEnd=access.permissions?.includes('fleet.manage');
 // Things a manager should look at now.
 const alerts:{rep:Row,kind:string,text:string}[]=[];
 for(const r of onShift){const s=r.shift;const silent=s.last_seen_at?Date.now()-Date.parse(s.last_seen_at):Date.now()-Date.parse(s.started_at);
  if(silent>10*60000)alerts.push({rep:r,kind:'signal',text:t(`مفيش إشارة من ${dur(silent,lang)} — ممكن الموبايل اتقفل أو الـ GPS اتقفل`,`No signal for ${dur(silent,lang)} — phone or GPS may be off`)});
  if(Date.now()-Date.parse(s.started_at)>12*3600000)alerts.push({rep:r,kind:'long',text:t(`الوردية مفتوحة من ${dur(Date.now()-Date.parse(s.started_at),lang)} — غالبًا نسي ينهي اليوم`,`Shift open for ${dur(Date.now()-Date.parse(s.started_at),lang)} — probably forgot to end the day`)});
  if(Number(s.last_speed||0)*3.6>SPEED_LIMIT&&silent<180000)alerts.push({rep:r,kind:'speed',text:t(`سرعة ${Math.round(Number(s.last_speed)*3.6)} كم/س دلوقتي`,`Driving at ${Math.round(Number(s.last_speed)*3.6)} km/h now`)})}
 return <><div className="stat-cards"><div className="stat-card tone-green"><b>{num(live.length)}</b><span>{t('بيتحركوا دلوقتي (إشارة آخر 3 دقايق)','Live now (signal in last 3 min)')}</span></div><div className="stat-card tone-amber"><b>{num(onShift.length-live.length)}</b><span>{t('في الوردية والإشارة متأخرة','On shift, signal delayed')}</span></div><div className="stat-card tone-gray"><b>{num(reps.length-onShift.length)}</b><span>{t('خارج الوردية','Off shift')}</span></div><div className="stat-card tone-blue"><b>{kmText(onShift.reduce((s,r)=>s+Number(r.shift.distance_m||0),0))}</b><span>{t('كم اتقطعت النهارده (الورديات المفتوحة)','km driven in open shifts')}</span></div></div>
  {alerts.length>0&&<section className="tracking-alerts">{alerts.map((a,i)=><button key={i} className={'tracking-alert kind-'+a.kind} onClick={()=>focus(a.rep.shift)}>{a.kind==='signal'?<SignalLow size={17}/>:a.kind==='speed'?<Gauge size={17}/>:<Timer size={17}/>}<b>{a.rep.display_name}</b><span>{a.text}</span></button>)}</section>}
  <div className="tracking-live"><section className="card tracking-map-card"><MapView onReady={m=>{mapRef.current=m}} height={520} fitKey={onShift.length} deps={[reps,version]} draw={g=>{const pts:[number,number][]=[];for(const r of onShift){const s=r.shift;const line=routes.get(s.id)?.pts||[];routeLine(g,line,colorOf(reps,r.id));if(s.last_lat==null)continue;const p:[number,number]=[s.last_lat,s.last_lng];pts.push(p);const stale=!s.last_seen_at||Date.now()-Date.parse(s.last_seen_at)>180000;L.marker(p,{icon:dot(stale?'#9a9aa1':colorOf(reps,r.id),r.display_name),title:r.display_name}).bindPopup(`<b>${r.display_name}</b><br>${s.plate_number||''}<br>${ago(s.last_seen_at,t)} · ${kmText(s.distance_m)} ${t('كم','km')}`).addTo(g)}return pts.length?L.latLngBounds(pts):null}}/></section>
   <section className="card tracking-list"><div className="card-head"><h3><Users size={18}/>{t('المناديب','Reps')}</h3><button className="icon-btn" aria-label={t('تحديث','Refresh')} onClick={reload}><RefreshCw size={17}/></button></div>
    {reps.length?<ul>{reps.map(r=>{const s=r.shift;const stale=s&&(!s.last_seen_at||Date.now()-Date.parse(s.last_seen_at)>180000);return <li key={r.id} className={s?'clickable':''} onClick={()=>s&&focus(s)}><i style={{background:colorOf(reps,r.id)}}/><span className="grow"><b>{r.display_name}{s?.last_speed!=null&&!stale&&Number(s.last_speed)>0.5?<em className="live-speed">{Math.round(Number(s.last_speed)*3.6)} {t('كم/س','km/h')}</em>:null}</b><small>{s?`${s.plate_number||t('بدون عربية','No vehicle')} · ${t('من ','since ')}${clock(s.started_at,lang)} · ${kmText(s.distance_m)} ${t('كم','km')}${s.new_cells?` · ${s.new_cells} ${t('جديدة','new')}`:''}`:r.last_seen_at?t('آخر وردية ','Last shift ')+ago(r.last_seen_at,t):t('لم يبدأ أي وردية بعد','No shifts yet')}</small></span>
      {s?<span className={'pill '+(stale?'pill-amber':'pill-green')}>{stale?ago(s.last_seen_at,t):t('مباشر','Live')}</span>:<span className="pill pill-gray">{t('خارج الوردية','Off')}</span>}
      {s&&<Link className="btn btn-ghost btn-sm" href={'/admin/tracking/'+s.id} onClick={(e:any)=>e.stopPropagation()}>{t('خط السير','Route')}</Link>}
      {s&&canEnd&&stale&&<button className="btn btn-ghost btn-sm" onClick={async(e:any)=>{e.stopPropagation();if(!confirm(t(`قفل وردية ${r.display_name}؟`,`Close ${r.display_name}'s shift?`)))return;try{unwrap(await db().rpc('tracking_end_shift',{shift:s.id}));reload()}catch(e){toast.error(message(e))}}}>{t('قفل','Close')}</button>}</li>})}</ul>:<Empty title={t('لا يوجد مناديب بعد','No reps yet')} detail={t('من صفحة الموظفين أضف حساب لكل مندوب بصلاحية "مندوب"، وخليه يسجل دخول من التطبيق.','On the Staff page add an account for each rep with the "Sales rep" role, then sign in from the rep app.')} action={<Link href="/admin/users" className="btn btn-red">{t('إضافة مندوب','Add a rep')}</Link>}/>}
   </section></div></>}

function Shifts({reps}:{reps:Row[]}){const {t,lang,go}=useUI();const [from,setFrom]=useState(daysAgo(6)),[to,setTo]=useState(localDay()),[rep,setRep]=useState(''),[rows,setRows]=useState<Row[]|null>(null);
 useEffect(()=>{setRows(null);db().rpc('tracking_shifts',{from_date:from,to_date:to,rep:rep||null}).then(r=>{if(r.error){toast.error(message(r.error));setRows([])}else setRows(r.data||[])})},[from,to,rep]);
 const total=(rows||[]).reduce((s,r)=>s+Number(r.distance_m||0),0);const odo=(rows||[]).filter(r=>r.odometer_end!=null&&r.odometer_start!=null).reduce((s,r)=>s+Number(r.odometer_end)-Number(r.odometer_start),0);
 const gap=(r:Row)=>{if(r.odometer_end==null||r.odometer_start==null)return null;const o=Number(r.odometer_end)-Number(r.odometer_start),g=Number(r.distance_m||0)/1000;if(o<3&&g<3)return null;return Math.round((o-g)/Math.max(g,1)*100)};
 const flagged=(rows||[]).filter(r=>{const g=gap(r);return g!=null&&Math.abs(g)>25});
 const exportRows=()=>exportSheet(t('ورديات المناديب','rep-shifts')+' '+from+' '+to,[t('اليوم','Day'),t('المندوب','Rep'),t('العربية','Vehicle'),t('البداية','Start'),t('النهاية','End'),t('كم GPS','GPS km'),t('كم العداد','Odometer km'),t('الفرق %','Gap %'),t('مربعات جديدة','New cells'),t('سولار (لتر)','Fuel (L)'),t('مصروفات','Expenses'),t('ملاحظات','Notes')],(rows||[]).map(r=>[day(r.started_at,lang),r.rep_name,r.plate_number||'',clock(r.started_at,lang),r.ended_at?clock(r.ended_at,lang):'',Number(kmText(r.distance_m)),r.odometer_end!=null&&r.odometer_start!=null?Number(r.odometer_end)-Number(r.odometer_start):'',gap(r)??'',Number(r.new_cells||0),Number(r.fuel_liters||0),Number(r.expenses||0),r.notes||'']),lang==='ar');
 return <><div className="card tracking-filters"><Dates from={from} to={to} setFrom={setFrom} setTo={setTo}/><RepFilter reps={reps} value={rep} onChange={setRep}/><button className="btn btn-outline tracking-export" disabled={!rows?.length} onClick={exportRows}><FileSpreadsheet size={16}/>{t('تصدير Excel','Export to Excel')}</button></div>
  <div className="stat-cards"><div className="stat-card tone-blue"><b>{kmText(total)}</b><span>{t('كم حسب الـ GPS','km by GPS')}</span></div><div className="stat-card tone-gray"><b>{num(Math.round(odo))}</b><span>{t('كم حسب العداد','km by odometer')}</span></div><div className="stat-card tone-amber"><b>{num((rows||[]).reduce((s,r)=>s+Number(r.new_cells||0),0))}</b><span>{t('مربع جديد (150×150 م) اتغطى','new 150 m cells covered')}</span></div><div className={'stat-card '+(flagged.length?'tone-red':'tone-green')}><b>{num(flagged.length)}</b><span>{t('أيام فرق العداد عن الـ GPS أكتر من 25%','days with odometer vs GPS gap > 25%')}</span></div></div>
  <div className="card table-scroll"><table className="data-table stack-table clickable"><thead><tr>{[['اليوم','Day'],['المندوب','Rep'],['العربية','Vehicle'],['الوقت','Time'],['GPS','GPS'],['العداد','Odometer'],['الفرق','Gap'],['مربعات جديدة','New cells'],['سولار','Fuel'],['مصروفات','Expenses']].map(([a,e])=><th key={e}>{t(a,e)}</th>)}</tr></thead>
   <tbody>{(rows||[]).map(r=>{const g=gap(r);const o=r.odometer_end!=null&&r.odometer_start!=null?Number(r.odometer_end)-Number(r.odometer_start):null;return <tr key={r.id} onClick={()=>go('/admin/tracking/'+r.id)}>
    <td data-label={t('اليوم','Day')}>{day(r.started_at,lang)}</td><td data-label={t('المندوب','Rep')}><b>{r.rep_name}</b></td><td data-label={t('العربية','Vehicle')}>{r.plate_number||'—'}</td>
    <td data-label={t('الوقت','Time')}>{clock(r.started_at,lang)} – {r.ended_at?clock(r.ended_at,lang):<span className="pill pill-green">{t('مفتوحة','Open')}</span>}<small className="muted"> {dur(Date.parse(r.ended_at||r.last_seen_at||r.started_at)-Date.parse(r.started_at),lang)}</small></td>
    <td data-label="GPS">{kmText(r.distance_m)} {t('كم','km')}</td><td data-label={t('العداد','Odometer')}>{o!=null?num(Math.round(o))+' '+t('كم','km'):'—'}</td>
    <td data-label={t('الفرق','Gap')}>{g==null?'—':<span className={'pill '+(Math.abs(g)>25?'pill-red':'pill-green')}>{g>0?'+':''}{g}%</span>}</td>
    <td data-label={t('مربعات جديدة','New cells')}>{r.new_cells?<span className="pill pill-amber">{num(r.new_cells)}</span>:'0'}</td><td data-label={t('سولار','Fuel')}>{r.fuel_liters?num(r.fuel_liters)+' '+t('لتر','L'):'—'}</td><td data-label={t('مصروفات','Expenses')}>{r.expenses?num(Math.round(r.expenses))+' '+t('ج.م','EGP'):'—'}</td></tr>})}</tbody></table>
   {rows===null&&<div className="center-block"><span className="spinner"/></div>}{rows?.length===0&&<Empty title={t('لا توجد ورديات في الفترة دي','No shifts in this period')}/>}</div>
  <p className="muted small">{t('"الفرق" = (كم العداد − كم الـ GPS) ÷ كم الـ GPS. فرق كبير موجب معناه إن العربية اتحركت والتتبع مقفول أو إن قراءة العداد غلط.','“Gap” = (odometer km − GPS km) ÷ GPS km. A large positive gap means the vehicle moved with tracking off, or a wrong odometer reading.')}</p></>}

function Coverage({reps}:{reps:Row[]}){const {t}=useUI();const [from,setFrom]=useState(daysAgo(29)),[to,setTo]=useState(localDay()),[rep,setRep]=useState(''),[cells,setCells]=useState<any[]|null>(null),[mode,setMode]=useState<'reps'|'heat'|'new'>('reps');
 useEffect(()=>{setCells(null);db().rpc('tracking_coverage',{from_date:from,to_date:to,rep:rep||null}).then(r=>{if(r.error){toast.error(message(r.error));setCells([])}else setCells(r.data||[])})},[from,to,rep]);
 const stats=useMemo(()=>{const per=new Map<string,{cells:number,shared:number}>();let fresh=0,shared=0;for(const c of cells||[]){if(c[5])fresh++;if(c[4]>1)shared++;for(const id of c[6]){const p=per.get(id)||{cells:0,shared:0};p.cells++;if(c[4]>1)p.shared++;per.set(id,p)}}return {per,fresh,shared}},[cells]);
 const maxDays=Math.max(1,...(cells||[]).map(c=>c[3]));
 return <><div className="card tracking-filters"><Dates from={from} to={to} setFrom={setFrom} setTo={setTo}/><RepFilter reps={reps} value={rep} onChange={setRep}/><div className="segmented" role="tablist">{([['reps','لون كل مندوب','By rep'],['heat','كثافة التردد','Visit frequency'],['new','الجديد في الفترة','New in period']] as const).map(([k,a,e])=><button key={k} className={mode===k?'active':''} onClick={()=>setMode(k)}>{t(a,e)}</button>)}</div></div>
  <div className="stat-cards"><div className="stat-card tone-blue"><b>{num(Math.round((cells?.length||0)*CELL_KM2*10)/10)}</b><span>{t('كم² متغطية','km² covered')}</span></div><div className="stat-card tone-gray"><b>{num(cells?.length||0)}</b><span>{t('مربع (150×150 م)','cells (150×150 m)')}</span></div><div className="stat-card tone-amber"><b>{num(stats.fresh)}</b><span>{t('مربع جديد في الفترة','new cells in period')}</span></div><div className="stat-card tone-red"><b>{num(stats.shared)}</b><span>{t('مربع فيه أكتر من مندوب','cells shared by reps')}</span></div></div>
  <section className="card tracking-map-card"><MapView height={560} fitKey={from+to+rep+(cells?.length?'1':'0')} deps={[cells,mode,reps]} draw={g=>{if(!cells?.length)return null;let b:L.LatLngBounds|null=null;
    for(const c of cells){const bounds=cellBounds(c[0],c[1]);const many=c[4]>1;const color=mode==='new'?(c[5]?'#ea580c':'#64748b'):mode==='heat'?'#dc2626':many?'#111827':colorOf(reps,c[6][0]);const opacity=mode==='heat'?0.25+0.6*(c[3]/maxDays):mode==='new'?(c[5]?0.65:0.2):0.6;
     L.rectangle(bounds,{color,weight:2,opacity:Math.min(1,opacity+.35),fillColor:color,fillOpacity:opacity}).bindTooltip(`${c[3]} ${t('يوم','days')} · ${c[2]} ${t('نقطة','points')}${many?` · ${c[4]} ${t('مناديب','reps')}`:''}${c[5]?' · '+t('جديد','new'):''}`).addTo(g);b=b?b.extend(bounds):L.latLngBounds(bounds)}return b}}/>
   {cells?.length===0&&<p className="muted center">{t('لا توجد نقاط تتبع في الفترة دي.','No tracking points in this period.')}</p>}
   {mode==='reps'&&<div className="map-legend">{reps.filter(r=>stats.per.has(r.id)).map(r=><span key={r.id}><i style={{background:colorOf(reps,r.id)}}/>{r.display_name}</span>)}<span><i style={{background:'#111827'}}/>{t('أكتر من مندوب','Several reps')}</span></div>}</section>
  {stats.per.size>0&&<div className="card table-scroll"><table className="data-table stack-table"><thead><tr><th>{t('المندوب','Rep')}</th><th>{t('المساحة','Area')}</th><th>{t('مربعات','Cells')}</th><th>{t('مشتركة مع غيره','Shared')}</th></tr></thead><tbody>{reps.filter(r=>stats.per.has(r.id)).sort((a,b)=>stats.per.get(b.id)!.cells-stats.per.get(a.id)!.cells).map(r=>{const p=stats.per.get(r.id)!;return <tr key={r.id}><td data-label={t('المندوب','Rep')}><span className="rep-swatch" style={{background:colorOf(reps,r.id)}}/><b>{r.display_name}</b></td><td data-label={t('المساحة','Area')}>{(p.cells*CELL_KM2).toFixed(1)} {t('كم²','km²')}</td><td data-label={t('مربعات','Cells')}>{num(p.cells)}</td><td data-label={t('مشتركة مع غيره','Shared')}>{num(p.shared)} ({Math.round(p.shared/p.cells*100)}%)</td></tr>})}</tbody></table></div>}</>}

// One row per rep for a period: how much they worked, how far, how new, how efficient, and what to check.
function Scorecard({reps}:{reps:Row[]}){const {t,lang}=useUI();const [from,setFrom]=useState(daysAgo(29)),[to,setTo]=useState(localDay()),[rows,setRows]=useState<Row[]|null>(null),[sort,setSort]=useState<'km'|'days'|'fresh'|'kml'|'cost'>('km');
 useEffect(()=>{setRows(null);db().rpc('tracking_shifts',{from_date:from,to_date:to,rep:null}).then(r=>{if(r.error){toast.error(message(r.error));setRows([])}else setRows(r.data||[])})},[from,to]);
 const cards=useMemo(()=>{const by=new Map<string,Row[]>();for(const r of rows||[]){const l=by.get(r.rep_id)||[];l.push(r);by.set(r.rep_id,l)}
  return [...by.entries()].map(([id,list])=>{const km=list.reduce((a,r)=>a+Number(r.distance_m||0),0)/1000;const days=new Set(list.map(r=>localDay(new Date(r.started_at)))).size;
   const hours=list.reduce((a,r)=>a+(Date.parse(r.ended_at||r.last_seen_at||r.started_at)-Date.parse(r.started_at)),0)/3600000;
   const fuel=list.reduce((a,r)=>a+Number(r.fuel_liters||0),0),cost=list.reduce((a,r)=>a+Number(r.expenses||0),0);
   const odo=list.filter(r=>r.odometer_end!=null&&r.odometer_start!=null).reduce((a,r)=>a+Number(r.odometer_end)-Number(r.odometer_start),0);
   const gaps=list.filter(r=>{if(r.odometer_end==null||r.odometer_start==null)return false;const o=Number(r.odometer_end)-Number(r.odometer_start),g=Number(r.distance_m||0)/1000;return (o>=3||g>=3)&&Math.abs((o-g)/Math.max(g,1))>0.25}).length;
   const start=list.reduce((a,r)=>a+minutesOfDay(r.started_at),0)/list.length;
   return {id,name:list[0].rep_name,days,shifts:list.length,km,kmDay:km/Math.max(days,1),hours:hours/Math.max(days,1),start,fresh:list.reduce((a,r)=>a+Number(r.new_cells||0),0),fuel,kml:fuel>0?(odo||km)/fuel:null,cost,costKm:km>0&&cost>0?cost/km:null,gaps}})},[rows]);
 const sorted=[...cards].sort((a,b)=>sort==='days'?b.days-a.days:sort==='fresh'?b.fresh-a.fresh:sort==='kml'?(b.kml??-1)-(a.kml??-1):sort==='cost'?(a.costKm??1e9)-(b.costKm??1e9):b.km-a.km);
 const maxKm=Math.max(1,...cards.map(c=>c.km));
 const exportRows=()=>exportSheet(t('تقييم المناديب','rep-scorecard')+' '+from+' '+to,[t('المندوب','Rep'),t('أيام شغل','Work days'),t('كم GPS','GPS km'),t('كم في اليوم','km per day'),t('ساعات في اليوم','Hours per day'),t('متوسط البداية','Average start'),t('مربعات جديدة','New cells'),t('سولار (لتر)','Fuel (L)'),t('كم/لتر','km/L'),t('مصروفات','Expenses'),t('تكلفة الكيلو','Cost per km'),t('أيام فرق عداد','Odometer gap days')],sorted.map(c=>[c.name,c.days,Math.round(c.km*10)/10,Math.round(c.kmDay*10)/10,Math.round(c.hours*10)/10,hhmm(c.start,lang),c.fresh,Math.round(c.fuel*10)/10,c.kml!=null?Math.round(c.kml*10)/10:'',Math.round(c.cost),c.costKm!=null?Math.round(c.costKm*100)/100:'',c.gaps]),lang==='ar');
 const sorts:[typeof sort,string,string][]=[['km','الأكتر مسافة','Most distance'],['days','الأكتر أيام','Most days'],['fresh','الأكتر استكشاف','Most new streets'],['kml','الأوفر سولار','Best km/L'],['cost','الأقل تكلفة للكيلو','Lowest cost per km']];
 return <><div className="card tracking-filters"><Dates from={from} to={to} setFrom={setFrom} setTo={setTo}/><button className="btn btn-outline tracking-export" disabled={!cards.length} onClick={exportRows}><FileSpreadsheet size={16}/>{t('تصدير Excel','Export to Excel')}</button></div>
  <div className="chip-row wrap">{sorts.map(([k,a,e])=><button key={k} className={'chip'+(sort===k?' active':'')} onClick={()=>setSort(k)}>{t(a,e)}</button>)}</div>
  {rows===null?<div className="center-block"><span className="spinner"/></div>:!cards.length?<Empty title={t('لا توجد ورديات في الفترة دي','No shifts in this period')}/>:
  <div className="score-list">{sorted.map((c,i)=><article key={c.id} className="card score-card">
   <header><span className="score-rank">{i+1}</span><i style={{background:colorOf(reps,c.id)}}/><b>{c.name}</b>{c.gaps>0&&<span className="pill pill-red">{t(`${c.gaps} يوم فرق عداد`,`${c.gaps} odometer gap days`)}</span>}</header>
   <div className="score-bar"><span style={{width:Math.max(3,c.km/maxKm*100)+'%',background:colorOf(reps,c.id)}}/></div>
   <dl>
    <div><dt>{t('المسافة','Distance')}</dt><dd>{num(Math.round(c.km))} <small>{t('كم','km')}</small></dd></div>
    <div><dt>{t('أيام الشغل','Work days')}</dt><dd>{c.days}</dd></div>
    <div><dt>{t('في اليوم','Per day')}</dt><dd>{num(Math.round(c.kmDay))} <small>{t('كم','km')}</small> · {c.hours.toFixed(1)} <small>{t('س','h')}</small></dd></div>
    <div><dt>{t('بيبدأ الساعة','Usually starts')}</dt><dd>{hhmm(c.start,lang)}</dd></div>
    <div><dt>{t('مربعات جديدة','New cells')}</dt><dd>{num(c.fresh)}</dd></div>
    <div><dt>{t('استهلاك السولار','Fuel economy')}</dt><dd>{c.kml!=null?<>{c.kml.toFixed(1)} <small>{t('كم/لتر','km/L')}</small></>:'—'}</dd></div>
    <div><dt>{t('المصروفات','Expenses')}</dt><dd>{c.cost?num(Math.round(c.cost)):'—'} {c.cost?<small>{t('ج.م','EGP')}</small>:null}</dd></div>
    <div><dt>{t('تكلفة الكيلو','Cost per km')}</dt><dd>{c.costKm!=null?<>{c.costKm.toFixed(2)} <small>{t('ج.م','EGP')}</small></>:'—'}</dd></div>
   </dl></article>)}</div>}
  <p className="muted small">{t('كم/لتر محسوبة من كيلومترات العداد على السولار اللي المندوب سجّله في وردياته (ولو مفيش عداد بتتحسب من الـ GPS). تكلفة الكيلو = المصروفات ÷ كيلومترات الـ GPS.','km/L uses odometer kilometres (GPS when missing) over the fuel the rep logged during their shifts. Cost per km = expenses ÷ GPS kilometres.')}</p></>}

// Stops: the rep stayed within 80 m for at least 5 minutes.
export function findStops(points:any[],radius=80,minMs=300000){const stops:{lat:number,lng:number,from:number,to:number}[]=[];let i=0;while(i<points.length){const a={lat:points[i][0],lng:points[i][1]};let j=i+1;while(j<points.length&&meters(a,{lat:points[j][0],lng:points[j][1]})<=radius)j++;const last=points[j-1];if(last[2]-points[i][2]>=minMs){stops.push({...a,from:points[i][2],to:last[2]});i=j}else i++}return stops}

function RouteView({id,reps}:{id:string,reps:Row[]}){const {t,lang,Link}=useUI();const [data,setData]=useState<Row|null>(null),[error,setError]=useState('');
 useEffect(()=>{db().rpc('tracking_route',{shift:id}).then(r=>r.error?setError(message(r.error)):setData(r.data))},[id]);
 const pts:any[]=data?.points||[];const s=data?.shift;const stops=useMemo(()=>findStops(pts),[data]);
 const stopped=stops.reduce((a,x)=>a+x.to-x.from,0);const total=s?Date.parse(s.ended_at||s.last_seen_at||s.started_at)-Date.parse(s.started_at):0;const maxSpeed=Math.max(0,...pts.map(p=>Number(p[3]||0)))*3.6;
 const odo=s&&s.odometer_end!=null&&s.odometer_start!=null?Number(s.odometer_end)-Number(s.odometer_start):null;
 const fast=(p:any)=>Number(p?.[3]||0)*3.6>SPEED_LIMIT;
 const speedingMs=useMemo(()=>{let ms=0;for(let i=1;i<pts.length;i++)if(fast(pts[i])&&fast(pts[i-1])&&pts[i][2]-pts[i-1][2]<600000)ms+=pts[i][2]-pts[i-1][2];return ms},[data]);
 // Playback: a marker replays the day; `rate` is how many seconds of the day pass per real second.
 const mapRef=useRef<L.Map|null>(null),marker=useRef<L.Marker|null>(null),clockRef=useRef(0);
 const [pos,setPos]=useState(0),[playing,setPlaying]=useState(false),[rate,setRate]=useState(120);
 useEffect(()=>{if(!playing||!pts.length)return;const step=setInterval(()=>{clockRef.current+=rate*100;let i=pos;while(i<pts.length-1&&pts[i+1][2]<=clockRef.current)i++;if(i>=pts.length-1){setPos(pts.length-1);setPlaying(false)}else setPos(i)},100);return()=>clearInterval(step)},[playing,rate,pos,data]);
 useEffect(()=>{const m=mapRef.current;const p=pts[pos];if(!m||!p)return;if(!marker.current)marker.current=L.marker([p[0],p[1]],{icon:dot('#111827'),zIndexOffset:1000}).addTo(m);else marker.current.setLatLng([p[0],p[1]]);if(playing&&!m.getBounds().pad(-.15).contains([p[0],p[1]]))m.panTo([p[0],p[1]])},[pos,data]);
 useEffect(()=>()=>{marker.current?.remove();marker.current=null},[]);
 const seek=(i:number)=>{setPos(i);clockRef.current=pts[i]?.[2]||0};
 const toggle=()=>{if(!pts.length)return;if(!playing){if(pos>=pts.length-1)seek(0);else clockRef.current=pts[pos][2]}setPlaying(v=>!v)};
 return <><Link href="/admin/tracking?tab=shifts" className="text-link muted back-link">{lang==='ar'?<ArrowRight size={16}/>:<ArrowLeft size={16}/>}{t('تتبع المناديب','Rep tracking')}</Link>
  {error?<div className="alert">{error}</div>:!data?<div className="center-block"><span className="spinner"/></div>:<>
  <PageHead title={`${s.rep_name} — ${day(s.started_at,lang)}`} subtitle={`${s.plate_number||t('بدون عربية','No vehicle')} · ${clock(s.started_at,lang)} – ${s.ended_at?clock(s.ended_at,lang):t('الوردية مفتوحة','shift open')}`}/>
  <div className="stat-cards"><div className="stat-card tone-blue"><span className="stat-icon"><Route size={19}/></span><b>{kmText(s.distance_m)}</b><span>{t('كم حسب الـ GPS','km by GPS')}{odo!=null?` · ${t('العداد','odometer')} ${num(Math.round(odo))}`:''}</span></div><div className="stat-card tone-gray"><span className="stat-icon"><Clock size={19}/></span><b>{dur(total-stopped,lang)}</b><span>{t('حركة','moving')} · {dur(stopped,lang)} {t('وقوف','stopped')}</span></div><div className="stat-card tone-amber"><span className="stat-icon"><Grid2x2 size={19}/></span><b>{num(s.new_cells)}</b><span>{t(`مربع جديد من ${s.cells} مربع`,`new of ${s.cells} cells`)}</span></div><div className={'stat-card '+(speedingMs>60000?'tone-red':'tone-green')}><span className="stat-icon"><Gauge size={19}/></span><b>{Math.round(maxSpeed)} <small>{t('كم/س','km/h')}</small></b><span>{t('أقصى سرعة','top speed')}{speedingMs>60000?` · ${dur(speedingMs,lang)} ${t('فوق','over')} ${SPEED_LIMIT}`:''}</span></div></div>
  <section className="card tracking-map-card"><MapView onReady={m=>{mapRef.current=m}} height={560} fitKey={id} deps={[data]} draw={g=>{if(!pts.length)return null;
    // Consecutive points of the same kind form one line: blue for known streets, orange for new ones.
    let run:[number,number][]=[[pts[0][0],pts[0][1]]],kind=pts[0][5];const flushRun=()=>routeLine(g,run,kind?'#ea580c':'#2563eb',kind?6:5);
    for(let i=1;i<pts.length;i++){const p:[number,number]=[pts[i][0],pts[i][1]];if(pts[i][2]-pts[i-1][2]>600000){flushRun();run=[p];kind=pts[i][5];continue}if(pts[i][5]!==kind){run.push(p);flushRun();run=[p];kind=pts[i][5]}else run.push(p)}flushRun();
    // Speeding stretches drawn on top in red.
    let fastRun:[number,number][]=[];const flushFast=()=>{if(fastRun.length>1)L.polyline(fastRun,{color:'#dc2626',weight:7,opacity:.95,lineCap:'round'}).bindTooltip(t(`فوق ${SPEED_LIMIT} كم/س`,`Over ${SPEED_LIMIT} km/h`)).addTo(g);fastRun=[]};
    for(let i=0;i<pts.length;i++){if(fast(pts[i])&&(!fastRun.length||pts[i][2]-pts[i-1][2]<600000))fastRun.push([pts[i][0],pts[i][1]]);else flushFast()}flushFast();
    for(const [n,x] of stops.entries())L.marker([x.lat,x.lng],{icon:dot('#9333ea',String(n+1))}).bindPopup(`${t('وقفة','Stop')} ${n+1}<br>${clock(x.from,lang)} – ${clock(x.to,lang)} (${dur(x.to-x.from,lang)})`).addTo(g);
    L.marker([pts[0][0],pts[0][1]],{icon:dot('#127a3e',t('بداية','Start'))}).addTo(g);const e=pts[pts.length-1];L.marker([e[0],e[1]],{icon:dot('#e30613',s.ended_at?t('نهاية','End'):t('الآن','Now'))}).addTo(g);
    return L.latLngBounds(pts.map(p=>[p[0],p[1]] as [number,number]))}}/>
   <div className="map-legend"><span><i style={{background:'#2563eb'}}/>{t('شوارع معتادة للمندوب','Streets the rep already knew')}</span><span><i style={{background:'#ea580c'}}/>{t('مسار جديد أول مرة','New route, first time')}</span><span><i style={{background:'#9333ea'}}/>{t('وقفة 5 دقايق أو أكتر','Stop of 5+ minutes')}</span><span><i style={{background:'#dc2626'}}/>{t(`سرعة فوق ${SPEED_LIMIT} كم/س`,`Over ${SPEED_LIMIT} km/h`)}</span></div>
   {pts.length>1&&<div className="route-player"><button className="btn btn-dark btn-sm" onClick={toggle} aria-label={playing?t('إيقاف','Pause'):t('تشغيل','Play')}>{playing?<Pause size={16}/>:<Play size={16}/>}{playing?t('إيقاف','Pause'):t('إعادة اليوم','Replay the day')}</button>
    <input type="range" min={0} max={pts.length-1} value={pos} onChange={e=>seek(Number(e.target.value))} aria-label={t('الوقت','Time')}/>
    <span className="route-player-time"><b>{clock(pts[pos]?.[2],lang)}</b><small>{Math.round(Number(pts[pos]?.[3]||0)*3.6)} {t('كم/س','km/h')}</small></span>
    <div className="route-player-rates">{[30,120,600].map(r=><button key={r} className={'chip'+(rate===r?' active':'')} onClick={()=>setRate(r)}>×{r}</button>)}</div>
    <button className="icon-btn" aria-label={t('تتبع النقطة','Follow')} onClick={()=>{const p=pts[pos];if(p)mapRef.current?.flyTo([p[0],p[1]],16)}}><Crosshair size={17}/></button></div>}
   {!pts.length&&<p className="muted center"><TriangleAlert size={16}/> {t('مفيش نقاط GPS للوردية دي.','No GPS points for this shift.')}</p>}</section>
  {stops.length>0&&<section className="card"><div className="card-head"><h3><Flag size={18}/>{t('الوقفات','Stops')}</h3></div><ul className="tracking-stops">{stops.map((x,n)=><li key={n}><b>{n+1}</b><span>{clock(x.from,lang)} – {clock(x.to,lang)}</span><span className="pill pill-gray">{dur(x.to-x.from,lang)}</span><a className="text-link" target="_blank" rel="noopener" href={`https://www.google.com/maps?q=${x.lat},${x.lng}`}>{t('افتح في الخرائط','Open in Maps')}</a></li>)}</ul></section>}
  {s.notes&&<section className="card"><h3>{t('ملاحظات المندوب','Rep notes')}</h3><p>{s.notes}</p></section>}</>}</>}
