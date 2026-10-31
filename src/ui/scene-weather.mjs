import {validDaylightLocation} from './solar-daylight.mjs';

// Only this public endpoint is used. Neither a provider URL nor an API key is
// accepted from preferences or from the response.
export const SCENE_WEATHER_ENDPOINT='https://api.open-meteo.com/v1/forecast';
export const WEATHER_MAX_AGE_MS=45*60*1000;
export const WEATHER_FUTURE_TOLERANCE_MS=5*60*1000;
const fields=['cloud_cover','rain','showers','snowfall','weather_code','wind_speed_10m'];
const units={time:'unixtime',interval:'seconds',cloud_cover:'%',rain:'mm',showers:'mm',snowfall:'cm',weather_code:'wmo code',wind_speed_10m:'m/s'};
const codes=new Set([0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]);
const numberIn=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const intensity=(value,scale)=>Math.min(1,value/scale);

// About a kilometre at the equator. Keep only this coarse location in memory;
// do not return or persist the original operating-system coordinates.
export function roundedWeatherLocation(value){
 const coords=validDaylightLocation(value);
 return coords?{latitude:Number(coords.latitude.toFixed(2)),longitude:Number(coords.longitude.toFixed(2))}:null;
}
export function sceneWeatherUrl(location){
 const coords=roundedWeatherLocation(location);
 if(!coords)throw new TypeError('Invalid weather location');
 const url=new URL(SCENE_WEATHER_ENDPOINT);
 url.search=new URLSearchParams({latitude:String(coords.latitude),longitude:String(coords.longitude),current:fields.join(','),timeformat:'unixtime',timezone:'UTC',wind_speed_unit:'ms',precipitation_unit:'mm'}).toString();
 return url.href;
}
export function isSceneWeatherFresh(weather,now=Date.now()){
 return record(weather)&&Number.isFinite(now)&&Number.isFinite(weather.observedAt)&&Number.isFinite(weather.fetchedAt)
  &&now-weather.observedAt<=WEATHER_MAX_AGE_MS&&weather.observedAt-now<=WEATHER_FUTURE_TOLERANCE_MS
  &&now-weather.fetchedAt<=WEATHER_MAX_AGE_MS&&weather.fetchedAt-now<=WEATHER_FUTURE_TOLERANCE_MS;
}

// Strictly validate measured values and their units before deriving bounded
// artistic intensities. Missing/invalid/stale data is unknown (null), not clear
// weather. No coordinates, endpoint, or other untrusted metadata are retained.
export function normalizeSceneWeather(payload,{now=Date.now()}={}){
 if(!record(payload)||!record(payload.current)||!record(payload.current_units)||!Number.isFinite(now))return null;
 const data=payload.current;
 if(Object.entries(units).some(([key,unit])=>payload.current_units[key]!==unit))return null;
 if(!numberIn(data.time,0,253402300799)||!Number.isInteger(data.time)||!numberIn(data.interval,1,3600)||!Number.isInteger(data.interval))return null;
 if(!numberIn(data.cloud_cover,0,100)||!numberIn(data.rain,0,500)||!numberIn(data.showers,0,500)||!numberIn(data.snowfall,0,500)||!numberIn(data.wind_speed_10m,0,150)||!codes.has(data.weather_code))return null;
 const result={cloud:data.cloud_cover/100,rain:intensity(data.rain+data.showers,5),fog:data.weather_code===48?1:data.weather_code===45?.8:0,snow:intensity(data.snowfall,2),wind:intensity(data.wind_speed_10m,20),windSpeed:data.wind_speed_10m,weatherCode:data.weather_code,observedAt:data.time*1000,fetchedAt:now};
 return isSceneWeatherFresh(result,now)?Object.freeze(result):null;
}
