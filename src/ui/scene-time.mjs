// Fixed scene lighting is a saved preference. Wall clocks and the system clock
// remain live; only the environment/avatar daylight input is selected here.
export function fixedSceneHour(value){return typeof value==='number'&&Number.isFinite(value)?Math.min(23+59/60,Math.max(0,value)):14;}
export function sceneTimeFor(presentation,liveTime){return presentation?.followTime===false?fixedSceneHour(presentation.fixedHour):liveTime;}
export function daylightClockHour(value){
 if(typeof value==='number'&&Number.isFinite(value))return ((value%24)+24)%24;
 if(value?.kind==='solar'&&Number.isFinite(value.hourAngle))return ((12+value.hourAngle/15)%24+24)%24;
 return 14;
}
export function sceneClimateFor(presentation,live){
 const fixed=presentation?.followTime===false,hour=fixedSceneHour(presentation?.fixedHour);
 const weatherStatus=presentation?.liveWeather===true?live.status?.replaceAll('光照继续随时间变化','场景光照保持固定').replaceAll('继续使用本地时间','场景保持固定时间').replaceAll('已恢复自动日照','已恢复天气更新').replaceAll('同步太阳高度和当前天气','同步当前天气'):'自动天气未启用。';
 return {...live,liveTimeOfDay:live.timeOfDay,timeOfDay:sceneTimeFor(presentation,live.timeOfDay),...(fixed?{status:`场景时间固定为 ${sceneHourLabel(hour)}。${weatherStatus||''}`}:{})};
}
export function sceneHourLabel(hour){const minutes=Math.round(fixedSceneHour(hour)*60);return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
export function parseSceneHour(text){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))return null;const [h,m]=text.split(':').map(Number);return h+m/60;}
