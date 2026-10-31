const test=require('node:test'),assert=require('node:assert/strict');
const now=Date.parse('2026-10-31T12:00:00Z');
function fixture(){return {current:{time:now/1000,interval:900,cloud_cover:75,rain:1,showers:.5,snowfall:.4,weather_code:48,wind_speed_10m:6},current_units:{time:'unixtime',interval:'seconds',cloud_cover:'%',rain:'mm',showers:'mm',snowfall:'cm',weather_code:'wmo code',wind_speed_10m:'m/s'}};}

test('weather URL is fixed HTTPS, rounds coordinates, and requests explicit current fields and units',async()=>{
 const {sceneWeatherUrl,SCENE_WEATHER_ENDPOINT,roundedWeatherLocation}=await import('../src/ui/scene-weather.mjs');
 const input={latitude:35.689487,longitude:139.691706,endpoint:'https://evil.invalid/?token=private',apiKey:'private'},url=new URL(sceneWeatherUrl(input));
 assert.equal(url.origin+url.pathname,SCENE_WEATHER_ENDPOINT);assert.equal(url.protocol,'https:');
 assert.deepEqual(roundedWeatherLocation(input),{latitude:35.69,longitude:139.69});assert.equal(input.latitude,35.689487);
 assert.equal(url.searchParams.get('latitude'),'35.69');assert.equal(url.searchParams.get('longitude'),'139.69');
 assert.equal(url.searchParams.get('timeformat'),'unixtime');assert.equal(url.searchParams.get('timezone'),'UTC');
 assert.equal(url.searchParams.get('wind_speed_unit'),'ms');assert.equal(url.searchParams.get('precipitation_unit'),'mm');
 assert.deepEqual(url.searchParams.get('current').split(','),['cloud_cover','rain','showers','snowfall','weather_code','wind_speed_10m']);
 assert.equal(url.href.includes('private'),false);assert.equal(url.href.includes('evil'),false);assert.equal(url.searchParams.has('apikey'),false);
 for(const value of [null,[],{latitude:'35&url=https://evil.invalid',longitude:1},{latitude:NaN,longitude:0},{latitude:0,longitude:Infinity},{latitude:91,longitude:0},{latitude:0,longitude:-181}]){
  assert.equal(roundedWeatherLocation(value),null);assert.throws(()=>sceneWeatherUrl(value),TypeError);
 }
 assert.deepEqual(roundedWeatherLocation({latitude:-90,longitude:180}),{latitude:-90,longitude:180});
});

test('current weather becomes bounded intensities without retaining response coordinates or endpoint',async()=>{
 const {normalizeSceneWeather}=await import('../src/ui/scene-weather.mjs');
 const payload={...fixture(),latitude:35.689487,longitude:139.691706,url:'https://evil.invalid',extra:'untrusted'},weather=normalizeSceneWeather(payload,{now});
 assert.deepEqual(weather,{cloud:.75,rain:.3,fog:1,snow:.2,wind:.3,windSpeed:6,weatherCode:48,observedAt:now,fetchedAt:now});assert.equal(Object.isFrozen(weather),true);
 payload.current.cloud_cover=0;assert.equal(weather.cloud,.75,'mapping does not retain a mutable response');
 for(const code of [0,3,45,48,71,95]){
  const raw=fixture();Object.assign(raw.current,{weather_code:code,rain:0,showers:0,snowfall:0,wind_speed_10m:0});
  const result=normalizeSceneWeather(raw,{now});assert.equal(result.fog,code===48?1:code===45?.8:0);assert.equal(result.rain,0);assert.equal(result.snow,0);assert.equal(result.wind,0);
 }
 const heavy=fixture();Object.assign(heavy.current,{rain:50,showers:30,snowfall:20,wind_speed_10m:50});
 const normalized=normalizeSceneWeather(heavy,{now});for(const field of ['rain','snow','wind'])assert.equal(normalized[field],1);
});

test('weather validation rejects missing fields, coercion, nonfinite values, ranges and unsupported WMO codes',async()=>{
 const {normalizeSceneWeather}=await import('../src/ui/scene-weather.mjs');
 for(const payload of [null,[],{},'weather',{current:null,current_units:{}},{current:[],current_units:{}}])assert.equal(normalizeSceneWeather(payload,{now}),null);
 for(const key of Object.keys(fixture().current)){
  const missing=fixture();delete missing.current[key];assert.equal(normalizeSceneWeather(missing,{now}),null,key+' missing');
  for(const bad of [null,undefined,NaN,Infinity,-Infinity,'0',{},[]]){const payload=fixture();payload.current[key]=bad;assert.equal(normalizeSceneWeather(payload,{now}),null,key+' '+String(bad));}
 }
 for(const [key,value]of [['cloud_cover',101],['rain',-1],['showers',501],['snowfall',-1],['wind_speed_10m',151],['weather_code',4],['weather_code',45.5],['interval',0],['interval',3601],['interval',900.5],['time',now/1000+.1]]){
  const payload=fixture();payload.current[key]=value;assert.equal(normalizeSceneWeather(payload,{now}),null,key+' range');
 }
 assert.equal(normalizeSceneWeather(fixture(),{now:NaN}),null);
});

test('weather validation checks every unit rather than silently treating km/h, inches or strings as SI',async()=>{
 const {normalizeSceneWeather}=await import('../src/ui/scene-weather.mjs');
 for(const key of Object.keys(fixture().current_units))for(const bad of [undefined,null,0,'wrong']){
  const payload=fixture();payload.current_units[key]=bad;assert.equal(normalizeSceneWeather(payload,{now}),null,key);
 }
 for(const [key,unit]of [['wind_speed_10m','km/h'],['rain','inch'],['snowfall','mm'],['time','iso8601']]){
  const payload=fixture();payload.current_units[key]=unit;assert.equal(normalizeSceneWeather(payload,{now}),null);
 }
});

test('weather age is bounded independently by observation and fetch times, including future clock skew',async()=>{
 const {normalizeSceneWeather,isSceneWeatherFresh,WEATHER_MAX_AGE_MS,WEATHER_FUTURE_TOLERANCE_MS}=await import('../src/ui/scene-weather.mjs');
 for(const [age,valid]of [[0,true],[WEATHER_MAX_AGE_MS,true],[WEATHER_MAX_AGE_MS+1000,false],[-WEATHER_FUTURE_TOLERANCE_MS,true],[-WEATHER_FUTURE_TOLERANCE_MS-1000,false]]){
  const payload=fixture();payload.current.time=(now-age)/1000;assert.equal(!!normalizeSceneWeather(payload,{now}),valid,String(age));
 }
 const fresh=normalizeSceneWeather(fixture(),{now});assert.equal(isSceneWeatherFresh(fresh,now+WEATHER_MAX_AGE_MS),true);assert.equal(isSceneWeatherFresh(fresh,now+WEATHER_MAX_AGE_MS+1),false);
 assert.equal(isSceneWeatherFresh({...fresh,fetchedAt:now-WEATHER_MAX_AGE_MS-1},now),false);
 assert.equal(isSceneWeatherFresh({...fresh,fetchedAt:now+WEATHER_FUTURE_TOLERANCE_MS+1},now),false);
 for(const invalid of [null,{},[],{observedAt:'0',fetchedAt:now}])assert.equal(isSceneWeatherFresh(invalid,now),false);
});
