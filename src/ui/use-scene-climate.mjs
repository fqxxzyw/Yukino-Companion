import {createContext,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {localDaylightHour} from './use-local-daylight.mjs';
import {solarPosition} from './solar-daylight.mjs';
import {isSceneWeatherFresh,normalizeSceneWeather,roundedWeatherLocation,sceneWeatherUrl} from './scene-weather.mjs';

export const WEATHER_REFRESH_MS=15*60*1000;
export const WEATHER_REQUEST_TIMEOUT_MS=10000;
export const GEOLOCATION_TIMEOUT_MS=12000;
const localStatus='本地时间自动更新；自动定位和天气未启用。';
const consentStatus='时间自动更新。请点击授权定位，以启用当地日照和天气；尚未请求系统位置。';
const visible=()=>typeof document==='undefined'||!document.hidden;
const abortError=()=>Object.assign(new Error('Cancelled'),{name:'AbortError'});

// A bounded request, including body decoding. Abort/timeout wins even if a
// platform implementation does not promptly reject its fetch promise.
export async function fetchSceneWeather(location,{signal,fetchImpl=globalThis.fetch,timeoutMs=WEATHER_REQUEST_TIMEOUT_MS,now=Date.now}={}){
 const url=sceneWeatherUrl(location);
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw new TypeError('Invalid weather timeout');
 if(signal?.aborted)throw abortError();
 const controller=new AbortController();let timer,onAbort;
 const cancelled=new Promise((_,reject)=>{
  onAbort=()=>{controller.abort();reject(abortError())};
  signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Weather request timed out'),{name:'TimeoutError'}))},timeoutMs);
 });
 try{
  const request=(async()=>{
   if(typeof fetchImpl!=='function')throw new Error('Weather unavailable');
   const response=await fetchImpl(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',mode:'cors'});
   if(!response?.ok)throw new Error('Weather response failed');
   const weather=normalizeSceneWeather(await response.json(),{now:now()});
   if(!weather)throw new Error('Invalid or stale weather');
   return weather;
  })();
  return await Promise.race([request,cancelled]);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort()}
}

// Main owns one hook instance and shares its result with this provider. The
// default permits settings to render outside main without fabricating consent.
export const SceneClimateContext=createContext(Object.freeze({timeOfDay:12,weather:null,status:'时间由系统自动提供；当前界面尚未连接自动天气。',phase:'unavailable',requestLocation:null,disable:()=>{}}));

export function useSceneClimate(enabled=false){
 const [now,setNow]=useState(()=>new Date());
 const [location,setLocation]=useState(null),[snapshot,setSnapshot]=useState(null);
 const [phase,setPhase]=useState(enabled===true?'consent':'local');
 const [status,setStatus]=useState(enabled===true?consentStatus:localStatus);
 const session=useRef({generation:0,active:false,coords:null,weather:null,controller:null,timer:null,geoCancel:null,lastAttempt:0});
 const stopSession=useCallback(()=>{
  const state=session.current;state.generation++;state.active=false;state.coords=null;state.weather=null;state.lastAttempt=0;
  clearTimeout(state.timer);state.timer=null;state.geoCancel?.();state.geoCancel=null;state.controller?.abort();state.controller=null;
 },[]);
 const disable=useCallback(()=>{stopSession();setLocation(null);setSnapshot(null);setPhase('local');setStatus(localStatus)},[stopSession]);
 const refreshWeather=useCallback(async()=>{
  const state=session.current;
  if(!state.active||!state.coords||!visible()||state.controller)return;
  clearTimeout(state.timer);state.timer=null;
  const generation=state.generation,controller=new AbortController();state.controller=controller;state.lastAttempt=Date.now();
  setPhase('loading');setStatus('已取得临时粗略位置，正在获取 Open-Meteo 当前天气…');
  try{
   const weather=await fetchSceneWeather(state.coords,{signal:controller.signal});
   if(!state.active||state.generation!==generation||state.controller!==controller)return;
   state.weather=weather;setSnapshot(weather);setNow(new Date());setPhase('ready');setStatus('已按当前位置同步太阳高度和当前天气；窗口可见时约每 15 分钟更新天气。');
  }catch(error){
   if(!state.active||state.generation!==generation||state.controller!==controller||error?.name==='AbortError')return;
   setPhase('error');setStatus(`${error?.name==='TimeoutError'?'天气请求超时':'天气获取失败或数据无效'}；仅在数据仍有效时使用上次天气，光照继续随时间变化。`);
  }finally{
   if(state.active&&state.generation===generation&&state.controller===controller){
    state.controller=null;
    if(visible())state.timer=setTimeout(()=>refreshWeather(),Math.max(0,state.lastAttempt+WEATHER_REFRESH_MS-Date.now()));
   }
  }
 },[]);
 const requestLocation=useCallback(()=>{
  stopSession();const state=session.current,generation=state.generation;state.active=true;
  setLocation(null);setSnapshot(null);setNow(new Date());setPhase('locating');setStatus('正在请求系统位置授权；可随时关闭并取消。');
  let settled=false,timer;
  const finish=()=>{if(settled||!state.active||state.generation!==generation)return false;settled=true;clearTimeout(timer);state.geoCancel=null;return true};
  const fail=error=>{
   if(!finish())return;
   state.active=false;
   const denied=error?.code===1,timeout=error?.code===3;
   setPhase(denied?'denied':'unavailable');setStatus(denied?'系统位置授权被拒绝；继续使用本地时间，不会请求天气。可在系统权限中允许后重试。':timeout?'系统定位超时；继续使用本地时间，尚未获取天气。可重新授权重试。':'系统定位不可用；继续使用本地时间，不会使用 IP 定位或虚构当地天气。');
  };
  state.geoCancel=()=>{settled=true;clearTimeout(timer)};
  timer=setTimeout(()=>fail({code:3}),GEOLOCATION_TIMEOUT_MS);
  try{
   const geolocation=globalThis.navigator?.geolocation;
   if(!geolocation||typeof geolocation.getCurrentPosition!=='function'){fail({code:2});return}
   geolocation.getCurrentPosition(position=>{
    if(!finish())return;
    const coords=roundedWeatherLocation(position?.coords);
    if(!coords){state.active=false;setPhase('unavailable');setStatus('系统返回的位置无效；继续使用本地时间，未请求天气。');return}
    state.coords=coords;setLocation(coords);setNow(new Date());
    if(visible())void refreshWeather();
    else{setPhase('paused');setStatus('已取得临时粗略位置；窗口隐藏，天气更新已暂停。')}
   },fail,{enableHighAccuracy:false,timeout:GEOLOCATION_TIMEOUT_MS,maximumAge:5*60*1000});
  }catch{fail({code:2})}
 },[stopSession,refreshWeather]);

 // Persisted enabled records prior in-app consent. Only an already-granted
 // Permissions API result may resume it; prompt/denied/unsupported results
 // require a fresh explicit action and never trigger an OS prompt on mount.
 useEffect(()=>{
  if(enabled!==true){disable();return}
  if(session.current.active)return;
  setPhase('consent');setStatus(consentStatus);
  let cancelled=false;const generation=session.current.generation;
  try{
   const permissions=globalThis.navigator?.permissions;
   if(typeof permissions?.query!=='function')return;
   Promise.resolve(permissions.query({name:'geolocation'})).then(permission=>{
    if(cancelled||session.current.generation!==generation||session.current.active||permission?.state!=='granted')return;
    requestLocation();
   }).catch(()=>{});
  }catch{}
  return()=>{cancelled=true};
 },[enabled,disable,requestLocation]);
 useEffect(()=>{
  let timer;
  const schedule=()=>{clearTimeout(timer);if(visible())timer=setTimeout(()=>{setNow(new Date());schedule()},60000-Date.now()%60000+10)};
  const update=()=>{
   setNow(new Date());schedule();const state=session.current;
   if(!state.active||!state.coords)return;
   if(!visible()){
    clearTimeout(state.timer);state.timer=null;
    if(state.controller){state.controller.abort();state.controller=null;state.lastAttempt=0}
    setPhase('paused');setStatus('窗口隐藏，天气更新已暂停；重新显示后继续。');
   }else if(!state.lastAttempt||Date.now()-state.lastAttempt>=WEATHER_REFRESH_MS)void refreshWeather();
   else if(!state.controller){
    clearTimeout(state.timer);state.timer=setTimeout(()=>refreshWeather(),Math.max(0,state.lastAttempt+WEATHER_REFRESH_MS-Date.now()));
    setPhase(state.weather?'ready':'error');setStatus(state.weather?'已恢复自动日照；最近的有效天气将在约 15 分钟的更新周期内刷新。':'上次天气更新未完成；继续自动日照，将在下一个更新周期重试。');
   }
  };
  schedule();globalThis.window?.addEventListener('focus',update);globalThis.document?.addEventListener('visibilitychange',update);
  return()=>{clearTimeout(timer);globalThis.window?.removeEventListener('focus',update);globalThis.document?.removeEventListener('visibilitychange',update);stopSession()};
 },[refreshWeather,stopSession]);
 const timeOfDay=useMemo(()=>solarPosition(now,enabled===true?location:null)||localDaylightHour(now),[now,location,enabled]);
 const weather=enabled===true&&isSceneWeatherFresh(snapshot,now.getTime())?snapshot:null;
 const stale=enabled===true&&snapshot&&!weather;
 return {timeOfDay,weather,status:stale&&phase!=='loading'&&phase!=='paused'?'天气数据已过期，当前不使用旧天气；光照继续随时间变化，等待下次更新。':status,phase,requestLocation,disable};
}
