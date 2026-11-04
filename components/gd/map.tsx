'use client';
// A thin Leaflet wrapper: one OpenStreetMap base layer, and a callback that draws the current data on a
// layer group that is cleared on every change.
import React,{useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const CELL_LAT=0.00135,CELL_LNG=0.00155;
export const cellBounds=(x:number,y:number):[[number,number],[number,number]]=>[[y*CELL_LAT,x*CELL_LNG],[(y+1)*CELL_LAT,(x+1)*CELL_LNG]];
// Distinct, readable rep colours (light and dark map alike).
export const REP_COLORS=['#e30613','#1d4ed8','#127a3e','#9333ea','#ea580c','#0891b2','#be185d','#4d7c0f','#7c3aed','#b45309','#0f766e','#475569'];
const CAIRO:[number,number]=[30.0444,31.2357];

export function MapView({draw,deps,height=420,fitKey,className}:{draw:(layer:L.LayerGroup,map:L.Map)=>L.LatLngBoundsExpression|null|void,deps:any[],height?:number|string,fitKey?:any,className?:string}){
  const ref=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),fitted=useRef<any>(undefined);
  useEffect(()=>{
    const m=L.map(ref.current!,{zoomControl:true,attributionControl:true,preferCanvas:true}).setView(CAIRO,11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
    layer.current=L.layerGroup().addTo(m);map.current=m;
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
