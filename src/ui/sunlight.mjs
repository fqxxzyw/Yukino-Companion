import * as THREE from 'three';
const SUNLIGHT = Object.freeze({
 morning: {color: '#ffe2bc', intensity: 2.5, position: [-5, 4, 3], ambient: 1.45, ambientColor: '#dceafb', groundColor: '#b5b9a5', skyColor: '#dceaf2'},
 noon: {color: '#fff8e8', intensity: 3.1, position: [-2, 7, 4], ambient: 1.65, ambientColor: '#e5f0ff', groundColor: '#b9c7b2', skyColor: '#cee6f3'},
 evening: {color: '#ffc18c', intensity: 2.1, position: [5, 2.2, 1], ambient: 1.05, ambientColor: '#c2c9e6', groundColor: '#9a9398', skyColor: '#e9d9dc'}
});
const NIGHT = Object.freeze({color:'#c5d6f2',intensity:1.05,position:[-1,3,3],ambient:.95,ambientColor:'#c0d3ef',groundColor:'#8f9daf',skyColor:'#778cae'});
const DAYLIGHT_CURVE = Object.freeze([[0,NIGHT],[5,NIGHT],[7,SUNLIGHT.morning],[12,SUNLIGHT.noon],[18,SUNLIGHT.evening],[20,NIGHT],[24,NIGHT]]);
function blendLight(a,b,t){
 const mix=(x,y)=>x+(y-x)*t,color=key=>'#'+new THREE.Color(a[key]).lerp(new THREE.Color(b[key]),t).getHexString();
 return {color:color('color'),intensity:mix(a.intensity,b.intensity),position:a.position.map((v,i)=>mix(v,b.position[i])),ambient:mix(a.ambient,b.ambient),ambientColor:color('ambientColor'),groundColor:color('groundColor'),skyColor:color('skyColor')};
}
const smooth=(x)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t)};
function daylightAtSolarPosition(solar){
 const warm=blendLight(SUNLIGHT.morning,SUNLIGHT.evening,(1+Math.sin(solar.hourAngle*Math.PI/180))/2);
 // -0.833° is the usual approximate sunrise/sunset threshold. Twilight is
 // deliberately soft; indoor fill at night keeps the character visible.
 const illuminated=blendLight(NIGHT,warm,smooth((solar.elevation+6)/9));
 const daylight=blendLight(illuminated,SUNLIGHT.noon,smooth((solar.elevation-3)/32));
 daylight.position=[Math.sin(solar.hourAngle*Math.PI/180)*5,1.5+5*smooth((solar.elevation+6)/50),3];
 return {...daylight,timeOfDay:solar};
}
function daylightAtHour(hour){
 const normalized=((hour%24)+24)%24;
 const next=DAYLIGHT_CURVE.findIndex(([time])=>time>normalized);
 const [start,a]=DAYLIGHT_CURVE[next-1], [end,b]=DAYLIGHT_CURVE[next];
 const t=(normalized-start)/(end-start),smooth=t*t*(3-2*t),mix=(x,y)=>x+(y-x)*smooth;
 const color=key=>'#'+new THREE.Color(a[key]).lerp(new THREE.Color(b[key]),smooth).getHexString();
 return {color:color('color'),intensity:mix(a.intensity,b.intensity),position:a.position.map((v,i)=>mix(v,b.position[i])),ambient:mix(a.ambient,b.ambient),ambientColor:color('ambientColor'),groundColor:color('groundColor'),skyColor:color('skyColor'),timeOfDay:normalized};
}

/** Colors are sRGB strings; intensities are artistic Three light multipliers.
 * Assign ambient/ambientColor/groundColor to an existing HemisphereLight and
 * color/intensity/position to a DirectionalLight. Never adds duplicate lights. */
export function sunlightConfig(timeOfDay = 'noon') {
 if(typeof timeOfDay==='number'&&Number.isFinite(timeOfDay))return daylightAtHour(timeOfDay);
 if(timeOfDay?.kind==='solar'&&Number.isFinite(timeOfDay.elevation)&&Math.abs(timeOfDay.elevation)<=90&&Number.isFinite(timeOfDay.hourAngle)&&Math.abs(timeOfDay.hourAngle)<=180)return daylightAtSolarPosition(timeOfDay);
 const id = Object.hasOwn(SUNLIGHT, timeOfDay) ? timeOfDay : 'noon';
 return {...SUNLIGHT[id], timeOfDay: id, position: [...SUNLIGHT[id].position]};
}
