import {sunlightConfig} from './sunlight.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function sceneDaylight(value){
 const sun=sunlightConfig(value);
 const elevation=value?.kind==='solar'?value.elevation:null;
 const hour=typeof value==='number'?((value%24)+24)%24:elevation!==null?12+value.hourAngle/15:value==='morning'?8:value==='evening'?18:12;
 const brightness=elevation!==null?clamp((elevation+6)/26,0,1):clamp(Math.min((hour-5)/2,(20-hour)/2),0,1);
 return {sun,brightness,night:brightness<.12,twilight:brightness<.8,hour};
}
export function sceneLightingPreset(value,available=[]){
 const ids=Array.isArray(available)?available.map(v=>typeof v==='string'?v:v.id):Object.keys(available||{});
 const daylight=sceneDaylight(value);
 const preferences=daylight.night?['night','dusk','evening']:daylight.twilight?['dusk','afterschool','evening','afternoon']:daylight.hour<10?['morning','day','noon','afternoon']:['day','afternoon','noon','afterschool'];
 return preferences.find(id=>ids.includes(id))||ids[0]||'day';
}
// Fallback for supplied scenes without a native night preset: only real glazing
// and lamps emit. Building walls/trees are never painted as fake window lights.
export function applyWindowNight(root,night){
 const seen=new Set();root.traverse(node=>{
  if(!node.isMesh||!/(window.*glass|window.*pane|glazing|glass.*pane|window-band|window:glass)/i.test(node.name))return;
  for(const material of [node.material].flat()){
   if(!material?.emissive||seen.has(material))continue;seen.add(material);
   material.userData.sceneEmission??={color:material.emissive.clone(),intensity:material.emissiveIntensity??0};
   const original=material.userData.sceneEmission;
   if(night){material.emissive.set('#ffd99e');material.emissiveIntensity=Math.max(.65,original.intensity);}
   else {material.emissive.copy(original.color);material.emissiveIntensity=original.intensity;}
  }
 });
}
