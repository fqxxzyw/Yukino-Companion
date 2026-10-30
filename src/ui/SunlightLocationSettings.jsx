import React,{useEffect,useState} from 'react';
import {validDaylightLocation} from './solar-daylight.mjs';

export default function SunlightLocationSettings({value,onChange}){
 const saved=validDaylightLocation(value);
 const [latitude,setLatitude]=useState(()=>saved?String(saved.latitude):'');
 const [longitude,setLongitude]=useState(()=>saved?String(saved.longitude):'');
 useEffect(()=>{setLatitude(saved?String(saved.latitude):'');setLongitude(saved?String(saved.longitude):'')},[saved?.latitude,saved?.longitude]);
 const location=latitude.trim()&&longitude.trim()?validDaylightLocation({latitude:Number(latitude),longitude:Number(longitude)}):null;
 return <div className="sunlight-location">
  <p className="hint" role="status">{saved?'光照随当前时间和当地太阳高度自动变化。':'光照随系统时间自动变化；未设置地点，当前使用日光模拟。'}</p>
  <details><summary>日照地点</summary>
   <p className="hint">填写后按当地日出日落变化。北纬、东经为正；地点仅保存在本机。</p>
   <label className="field">纬度（−90 至 90）<input type="number" min="-90" max="90" step="any" value={latitude} onChange={event=>setLatitude(event.target.value)} /></label>
   <label className="field">经度（−180 至 180）<input type="number" min="-180" max="180" step="any" value={longitude} onChange={event=>setLongitude(event.target.value)} /></label>
   <div className="button-row"><button type="button" className="secondary" disabled={!location} onClick={()=>onChange(location)}>应用地点</button>{saved&&<button type="button" className="text-link" onClick={()=>onChange(null)}>清除地点</button>}</div>
  </details>
 </div>;
}
