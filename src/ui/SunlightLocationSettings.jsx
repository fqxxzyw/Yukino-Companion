import React,{useContext} from 'react';
import {SceneClimateContext} from './use-scene-climate.mjs';
import {daylightClockHour,sceneHourLabel,parseSceneHour} from './scene-time.mjs';

export default function SunlightLocationSettings({enabled=false,onChange,followTime=true,fixedHour=14,onTimeChange}){
 const climate=useContext(SceneClimateContext),busy=climate.phase==='locating'||climate.phase==='loading';
 function toggle(next){
  if(next){climate.requestLocation?.();onChange(true)}
  else{climate.disable();onChange(false)}
 }
 return <div className="sunlight-location">
  <h4>场景时间与天气</h4>
  <label className="row"><div><strong>场景随时间变化</strong><small>关闭后固定场景光照；樱花、水流等动画仍可正常播放。</small></div><input type="checkbox" role="switch" aria-label="场景随时间变化" checked={followTime!==false} onChange={event=>onTimeChange?.(event.target.checked?{followTime:true}:{followTime:false,fixedHour:daylightClockHour(climate.liveTimeOfDay??climate.timeOfDay)})}/></label>
  {followTime===false&&<label className="field">固定场景时间<input type="time" aria-label="固定场景时间" step="60" value={sceneHourLabel(fixedHour)} onChange={event=>{const hour=parseSceneHour(event.target.value);if(hour!==null)onTimeChange?.({fixedHour:hour})}}/><small>此时间会保存，重新打开后仍保持不变。</small></label>}
  <p className="hint">跟随时间时，未授权位置的光照使用本地时钟；授权后按当地太阳高度变化。固定时间只影响场景光照，教室钟表仍显示真实时间。</p>
  <p className="hint" id="scene-climate-privacy">开启即同意向操作系统请求位置，并将四舍五入到小数点后两位的经纬度发送至固定的 https://api.open-meteo.com/v1/forecast 获取当前天气。位置仅临时留在内存，不保存精确坐标；不使用 IP 定位，无需 API 密钥。关闭会取消请求、清除临时位置和天气，恢复本地时间光照。</p>
  <label className="row"><div><strong>自动定位与实时天气</strong><small>窗口可见时约每 15 分钟更新；已开启且系统权限已允许时自动恢复，否则需点击授权。</small></div><input type="checkbox" role="switch" aria-label="自动定位与实时天气" aria-describedby="scene-climate-privacy" checked={enabled===true} disabled={!climate.requestLocation} onChange={event=>toggle(event.target.checked)}/></label>
  <p className="hint" role="status" aria-live="polite">{climate.status}</p>
  {enabled===true&&<div className="button-row">{!busy&&climate.requestLocation&&<button type="button" className="secondary" onClick={()=>climate.requestLocation()}>授权 / 重新获取位置与天气</button>}<button type="button" className="text-link" onClick={()=>toggle(false)}>{busy?'取消并关闭自动天气':'关闭并清除位置与天气'}</button></div>}
 </div>;
}
