import {useEffect,useMemo,useState} from 'react';
import {solarPosition,validDaylightLocation} from './solar-daylight.mjs';

// Artistic local-clock approximation; no location or actual sunrise data is
// accessed. The fractional hour is shared by all presentation surfaces.
export function localDaylightHour(date=new Date()){
 return date.getHours()+date.getMinutes()/60+date.getSeconds()/3600;
}
export function useLocalDaylight(location){
 const [now,setNow]=useState(()=>new Date());
 const coords=validDaylightLocation(location);
 useEffect(()=>{
  let timer;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{setNow(new Date());schedule()},60000-Date.now()%60000+10)};
  const update=()=>{setNow(new Date());schedule()};
  schedule();window.addEventListener('focus',update);
  return()=>{clearTimeout(timer);window.removeEventListener('focus',update)};
 },[]);
 return useMemo(()=>solarPosition(now,coords)||localDaylightHour(now),[now,coords?.latitude,coords?.longitude]);
}
