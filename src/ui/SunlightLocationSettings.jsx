import React,{useEffect,useState} from 'react';
import {validDaylightLocation} from './solar-daylight.mjs';

export default function SunlightLocationSettings({value,onChange}){
 const saved=validDaylightLocation(value);
 const [latitude,setLatitude]=useState(()=>saved?String(saved.latitude):'');
 const [longitude,setLongitude]=useState(()=>saved?String(saved.longitude):'');
 useEffect(()=>{setLatitude(saved?String(saved.latitude):'');setLongitude(saved?String(saved.longitude):'')},[saved?.latitude,saved?.longitude]);
 const location=latitude.trim()&&longitude.trim()?validDaylightLocation({latitude:Number(latitude),longitude:Number(longitude)}):null;
 return <div className="sunlight-location">
  <p className="hint" role="status">{saved?'按位置日光：根据所填经纬度和日期离线计算太阳高度。':'本地时间模拟：未设置地点，使用固定的日光变化曲线。'}</p>
  <details><summary>设置日光地点（可选）</summary>
   <p className="hint">手动输入十进制度；北纬、东经为正，南纬、西经为负。地点仅保存在本机，不使用系统定位或联网。</p>
   <label className="field">纬度（−90 至 90）<input type="number" min="-90" max="90" step="any" value={latitude} onChange={event=>setLatitude(event.target.value)} /></label>
   <label className="field">经度（−180 至 180）<input type="number" min="-180" max="180" step="any" value={longitude} onChange={event=>setLongitude(event.target.value)} /></label>
   <div className="button-row"><button type="button" className="secondary" disabled={!location} onClick={()=>onChange(location)}>应用地点</button>{saved&&<button type="button" className="text-link" onClick={()=>onChange(null)}>清除地点</button>}</div>
  </details>
 </div>;
}
