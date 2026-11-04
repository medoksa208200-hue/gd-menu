'use client';
// A thin Leaflet wrapper: one OpenStreetMap base layer, and a callback that draws the current data on a
// layer group that is cleared on every change.
import React,{useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const CELL_LAT=0.00135,CELL_LNG=0.00155;
export const cellBounds=(x:number,y:number):[[number,number],[number,number]]=>[[y*CELL_LAT,x*CELL_LNG],[(y+1)*CELL_LAT,(x+1)*CELL_LNG]];
// Strong, distinct rep colours that stand out on the muted base map (no pinks or light reds, which look like roads).
export const REP_COLORS=['#2563eb','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2','#c026d3','#65a30d','#4f46e5','#b45309','#0d9488','#1f2937'];
// A route line with a white casing under it, so it reads clearly over any street, at any zoom.
export function routeLine(g:L.LayerGroup,pts:L.LatLngExpression[],color:string,weight=5){if(pts.length<2)return;L.polyline(pts,{color:'#fff',weight:weight+4,opacity:.95,lineCap:'round',lineJoin:'round',interactive:false}).addTo(g);L.polyline(pts,{color,weight,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(g)}
const CAIRO:[number,number]=[30.0444,31.2357];

export function MapView({draw,deps,height=420,fitKey,className,onReady}:{draw:(layer:L.LayerGroup,map:L.Map)=>L.LatLngBoundsExpression|null|void,deps:any[],height?:number|string,fitKey?:any,className?:string,onReady?:(map:L.Map)=>void}){
  const ref=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),fitted=useRef<any>(undefined);
  useEffect(()=>{
    const m=L.map(ref.current!,{zoomControl:true,attributionControl:true,preferCanvas:true}).setView(CAIRO,11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
    layer.current=L.layerGroup().addTo(m);map.current=m;onReady?.(m);
    const resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(ref.current!);
    return()=>{resize.disconnect();m.remove();map.current=null}
  },[]);
  useEffect(()=>{
    const m=map.current,g=layer.current;if(!m||!g)return;g.clearLayers();
    const bounds=draw(g,m);
    // Fit to the data the first time it appears, and again whenever fitKey changes; live refreshes keep the view.
    if(bounds&&fitted.current!==fitKey){fitted.current=fitKey;try{m.fitBounds(bounds,{padding:[30,30],maxZoom:16})}catch{}}
  },deps);
  return <div ref={ref} className={'map-view '+(className||'')} style={{height}}/>
}

export function dot(color:string,label?:string){return L.divIcon({className:'map-pin',html:`<span style="--c:${color}"></span>${label?`<b>${label.replace(/[<>&"]/g,'')}</b>`:''}`,iconSize:[18,18],iconAnchor:[9,9]})}

// Places (factory, warehouses, customers) drawn as a dashed radius and a labelled pin.
export const PLACE_COLORS:Record<string,string>={factory:'#e30613',warehouse:'#1f2937',customer:'#2563eb',supplier:'#16a34a',other:'#9333ea'};
export function drawPlaces(g:L.LayerGroup,places:any[]){for(const p of places){if(p.is_active===false)continue;const c=PLACE_COLORS[p.kind]||'#475569';L.circle([p.lat,p.lng],{radius:p.radius_m,color:c,weight:1.5,fillOpacity:.08,dashArray:'4 4',interactive:false}).addTo(g);L.marker([p.lat,p.lng],{icon:L.divIcon({className:'place-pin',html:`<span style="--c:${c}"><i></i><b>${String(p.name).replace(/[<>&"]/g,'')}</b></span>`,iconSize:[14,14],iconAnchor:[7,7]}),interactive:false}).addTo(g)}}
