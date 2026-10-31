const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const start=Date.parse('2026-10-31T12:00:00Z');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function payload(now=start){return {current:{time:Math.floor(now/1000),interval:900,cloud_cover:75,rain:1,showers:0,snowfall:0,weather_code:61,wind_speed_10m:4},current_units:{time:'unixtime',interval:'seconds',cloud_cover:'%',rain:'mm',showers:'mm',snowfall:'cm',weather_code:'wmo code',wind_speed_10m:'m/s'}};}

// Execute the real hook and fetch code with deterministic clocks, effect order,
// browser event targets and OS/network boundaries. No browser or service runs.
async function climateHarness(t,{enabled=false,geolocation=true,fetchBehavior,permissionQuery}={}){
 const source=(await fs.readFile(path.join(root,'src/ui/use-scene-climate.mjs'),'utf8')).replace(/^import .*;\s*$/gm,'').replaceAll('export ','');
 const weather=await import('../src/ui/scene-weather.mjs'),solar=await import('../src/ui/solar-daylight.mjs'),{localDaylightHour}=await import('../src/ui/use-local-daylight.mjs');
 let now=start,cursor=0,dirty=false,effects=[],result,mounted=true,id=0,behavior=fetchBehavior;
 const values=[],cleanups=new Map(),timers=new Map(),geo=[],requests=[];
 const hooks={
  createContext:value=>({_currentValue:value}),
  useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true}}]},
  useRef(initial){const n=cursor++;return values[n]||(values[n]={current:initial})},
  useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((v,i)=>!Object.is(v,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn())})}},
  useMemo(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))values[n]={deps,value:fn()};return values[n].value},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps)},
 };
 const eventTarget=()=>{const listeners=new Map();return {listeners,hidden:false,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeEventListener(name,fn){listeners.get(name)?.delete(fn)},fire(name){for(const fn of listeners.get(name)||[])fn()}}};
 const window=eventTarget(),document=eventTarget();
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const env={window,document,navigator:geolocation?{geolocation:{getCurrentPosition:(success,error,options)=>geo.push({success,error,options})}}:{},fetch:(url,options)=>{
  requests.push({url,options});return behavior?behavior(url,options):Promise.resolve({ok:true,json:async()=>payload(now)});
 }};
 if(permissionQuery)env.navigator.permissions={query:permissionQuery};
 const deps={...hooks,...weather,...solar,localDaylightHour,Date:Clock,globalThis:env,document,setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{at:now+delay,fn});return key},clearTimeout:key=>timers.delete(key),AbortController};
 const module=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${source};return {useSceneClimate,fetchSceneWeather,WEATHER_REFRESH_MS,WEATHER_REQUEST_TIMEOUT_MS,GEOLOCATION_TIMEOUT_MS};`)(deps);
 function render(next=enabled){enabled=next;let turns=0;do{cursor=0;dirty=false;result=module.useSceneClimate(enabled);effects.splice(0).forEach(fn=>fn());assert.ok(++turns<20,'effects settle')}while(dirty);return result}
 async function settle(){for(let i=0;i<6;i++){await tick();if(mounted&&dirty)render()}return result}
 async function advance(ms){const until=now+ms;let turns=0;for(;;){const next=[...timers].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await settle();assert.ok(++turns<500,'timers make progress')}now=until;await settle()}
 function unmount(){if(!mounted)return;mounted=false;for(const cleanup of cleanups.values())cleanup?.();cleanups.clear()}
 t.after(unmount);render();
 return {module,render,settle,advance,geo,requests,window,document,timers,unmount,setFetch:fn=>behavior=fn,get now(){return now},get value(){return result},async hide(){document.hidden=true;document.fire('visibilitychange');await settle()},async show(){document.hidden=false;document.fire('visibilitychange');await settle()}};
}

test('local time ticks automatically and a saved preference alone cannot trigger a new OS permission prompt',async t=>{
 const h=await climateHarness(t);assert.equal(h.value.phase,'local');assert.equal(typeof h.value.timeOfDay,'number');assert.equal(h.value.weather,null);assert.equal(h.geo.length,0);assert.equal(h.requests.length,0);
 const before=h.value.timeOfDay;await h.advance(60020);assert.notEqual(h.value.timeOfDay,before);
 h.render(true);assert.equal(h.value.phase,'consent');assert.equal(h.geo.length,0);assert.match(h.value.status,/尚未请求/);
 const saved=await climateHarness(t,{enabled:true});assert.equal(saved.geo.length,0);assert.equal(saved.requests.length,0);assert.equal(saved.value.phase,'consent');
});

test('saved consent resumes only an already-granted permission and never requests a fresh permission implicitly',async t=>{
 let checks=0;const disabled=await climateHarness(t,{permissionQuery:async()=>{checks++;return {state:'granted'}}});await disabled.settle();assert.equal(checks,0);assert.equal(disabled.geo.length,0);
 let resolveGranted;const granted=await climateHarness(t,{enabled:true,permissionQuery:descriptor=>{checks++;assert.deepEqual(descriptor,{name:'geolocation'});return new Promise(resolve=>resolveGranted=resolve)}});
 assert.equal(granted.geo.length,0,'permission must be checked before resuming');resolveGranted({state:'granted'});await granted.settle();assert.equal(granted.geo.length,1);assert.equal(granted.value.phase,'locating');assert.equal(granted.requests.length,0);
 granted.geo[0].success({coords:{latitude:35,longitude:139}});await granted.settle();assert.equal(granted.value.phase,'ready');assert.equal(granted.requests.length,1);
 for(const state of ['prompt','denied','unknown']){const h=await climateHarness(t,{enabled:true,permissionQuery:async()=>({state})});await h.settle();assert.equal(h.geo.length,0,state);assert.equal(h.requests.length,0);assert.equal(h.value.phase,'consent')}
 for(const permissionQuery of [()=>{throw Error('unsupported')},()=>Promise.reject(Error('unavailable'))]){const h=await climateHarness(t,{enabled:true,permissionQuery});await h.settle();assert.equal(h.geo.length,0);assert.equal(h.value.weather,null);assert.equal(h.value.phase,'consent')}
});

test('late permission queries cannot duplicate explicit requests or resume a disabled/unmounted session',async t=>{
 for(const action of ['disable','unmount','explicit']){
  let resolve;const h=await climateHarness(t,{enabled:true,permissionQuery:()=>new Promise(r=>resolve=r)});
  if(action==='disable')h.render(false);else if(action==='unmount')h.unmount();else{h.value.requestLocation();h.render()}
  resolve({state:'granted'});await h.settle();assert.equal(h.geo.length,action==='explicit'?1:0,action);
 }
});

test('explicit consent requests OS location, sends rounded coordinates and shares solar/weather snapshots',async t=>{
 const h=await climateHarness(t);h.value.requestLocation();h.render(true);assert.equal(h.geo.length,1);assert.equal(h.requests.length,0);assert.equal(h.value.phase,'locating');
 assert.deepEqual(h.geo[0].options,{enableHighAccuracy:false,timeout:h.module.GEOLOCATION_TIMEOUT_MS,maximumAge:300000});
 h.geo[0].success({coords:{latitude:35.689487,longitude:139.691706,accuracy:5}});await h.settle();
 assert.equal(h.requests.length,1);const {url,options}=h.requests[0];assert.equal(new URL(url).searchParams.get('latitude'),'35.69');assert.equal(new URL(url).searchParams.get('longitude'),'139.69');
 assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
 assert.equal(h.value.phase,'ready');assert.deepEqual([h.value.weather.cloud,h.value.weather.rain,h.value.weather.fog,h.value.weather.snow,h.value.weather.wind],[.75,.2,0,0,.2]);
 const {solarPosition}=await import('../src/ui/solar-daylight.mjs');assert.deepEqual(h.value.timeOfDay,solarPosition(new Date(h.now),{latitude:35.69,longitude:139.69}));
 const serialized=JSON.stringify(h.value);assert.equal(serialized.includes('35.689487'),false);assert.equal(serialized.includes('latitude'),false);assert.equal(serialized.includes('longitude'),false);
 h.value.disable();h.render(false);assert.equal(typeof h.value.timeOfDay,'number');assert.equal(h.value.weather,null);assert.equal(h.value.phase,'local');assert.equal(h.timers.size,1,'only local minute ticking remains');
});

test('denied, unavailable and malformed location errors stay honest and never fall back to IP weather',async t=>{
 const unavailable=await climateHarness(t,{enabled:true,geolocation:false});unavailable.value.requestLocation();await unavailable.settle();assert.equal(unavailable.value.phase,'unavailable');assert.match(unavailable.value.status,/不.*IP/);assert.equal(unavailable.requests.length,0);
 const h=await climateHarness(t,{enabled:true});h.value.requestLocation();h.render();h.geo[0].error({code:1});await h.settle();assert.equal(h.value.phase,'denied');assert.equal(h.value.weather,null);assert.equal(typeof h.value.timeOfDay,'number');assert.match(h.value.status,/拒绝/);assert.equal(h.requests.length,0);
 h.value.requestLocation();h.render();h.geo[1].success({coords:{latitude:91,longitude:0}});await h.settle();assert.equal(h.value.phase,'unavailable');assert.match(h.value.status,/无效/);assert.equal(h.requests.length,0);
});

test('geolocation has its own deadline and late callbacks cannot resurrect timed-out or cancelled sessions',async t=>{
 const h=await climateHarness(t,{enabled:true});h.value.requestLocation();h.render();await h.advance(h.module.GEOLOCATION_TIMEOUT_MS);assert.equal(h.value.phase,'unavailable');assert.match(h.value.status,/超时/);
 h.geo[0].success({coords:{latitude:35,longitude:139}});await h.settle();assert.equal(h.requests.length,0);
 h.value.requestLocation();h.render();h.value.disable();h.render(false);h.geo[1].success({coords:{latitude:35,longitude:139}});await h.settle();assert.equal(h.requests.length,0);assert.equal(h.value.phase,'local');
 h.render(true);assert.equal(h.geo.length,2,'re-enabling a preference alone must not prompt');
});

test('weather refresh is about 15 minutes and visibility pauses timers and cancels active network work',async t=>{
 const h=await climateHarness(t,{enabled:true});h.value.requestLocation();h.render();h.geo[0].success({coords:{latitude:35,longitude:139}});await h.settle();
 await h.advance(h.module.WEATHER_REFRESH_MS-1);assert.equal(h.requests.length,1);await h.advance(1);assert.equal(h.requests.length,2);
 await h.hide();assert.equal(h.value.phase,'paused');assert.equal(h.timers.size,0);await h.advance(60*60*1000);assert.equal(h.requests.length,2);
 h.setFetch(()=>new Promise(()=>{}));await h.show();assert.equal(h.requests.length,3);assert.equal(h.value.weather,null,'stale weather is not rendered while refreshing');
 const signal=h.requests[2].options.signal;await h.hide();assert.equal(signal.aborted,true);assert.equal(h.timers.size,0);await h.advance(h.module.WEATHER_REFRESH_MS);assert.equal(h.requests.length,3);
 await h.show();assert.equal(h.requests.length,4,'a hidden aborted request retries immediately on return');h.window.fire('focus');await h.settle();assert.equal(h.requests.length,4,'focus cannot duplicate an active request');
});

test('invalid weather is never fabricated and previously valid data expires during repeated refresh failures',async t=>{
 const h=await climateHarness(t,{enabled:true});h.value.requestLocation();h.render();h.geo[0].success({coords:{latitude:35,longitude:139}});await h.settle();const old=h.value.weather;
 h.setFetch(async()=>({ok:true,json:async()=>({current:{rain:'bad'}})}));await h.advance(h.module.WEATHER_REFRESH_MS);assert.equal(h.value.phase,'error');assert.equal(h.value.weather,old,'valid recent snapshot can bridge one failed refresh');assert.match(h.value.status,/无效/);
 await h.advance(31*60*1000);assert.equal(h.value.weather,null);assert.match(h.value.status,/过期/);assert.equal(h.value.timeOfDay.kind,'solar','weather failure does not stop astronomical lighting');
});

test('disabling or unmounting cancels bounded weather requests and ignores superseded geolocation callbacks',async t=>{
 let resolve;const h=await climateHarness(t,{enabled:true,fetchBehavior:()=>new Promise(r=>resolve=r)});h.value.requestLocation();h.render();const first=h.geo[0];h.value.requestLocation();h.render();first.success({coords:{latitude:1,longitude:1}});await h.settle();assert.equal(h.requests.length,0);
 h.geo[1].success({coords:{latitude:35,longitude:139}});await h.settle();assert.equal(h.requests.length,1);const signal=h.requests[0].options.signal;
 h.render(false);assert.equal(signal.aborted,true);resolve({ok:true,json:async()=>payload(h.now)});await h.settle();assert.equal(h.value.weather,null);assert.equal(h.value.phase,'local');
 h.unmount();assert.equal(h.timers.size,0);for(const target of [h.window,h.document])for(const listeners of target.listeners.values())assert.equal(listeners.size,0);
});

test('fetch deadline covers both stalled connection and stalled JSON decoding; cancellation is immediate',async t=>{
 for(const fetchBehavior of [()=>new Promise(()=>{}),async()=>({ok:true,json:()=>new Promise(()=>{})})]){
  const h=await climateHarness(t,{fetchBehavior});const promise=h.module.fetchSceneWeather({latitude:0,longitude:0},{timeoutMs:25});const rejected=assert.rejects(promise,{name:'TimeoutError'});
  await h.advance(25);await rejected;assert.equal(h.requests[0].options.signal.aborted,true);
 }
 const h=await climateHarness(t,{fetchBehavior:()=>new Promise(()=>{})}),controller=new AbortController();
 const promise=h.module.fetchSceneWeather({latitude:0,longitude:0},{signal:controller.signal});const rejected=assert.rejects(promise,{name:'AbortError'});controller.abort();await rejected;
 assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.timers.size,1);
 await assert.rejects(h.module.fetchSceneWeather({latitude:0,longitude:0},{signal:controller.signal}),{name:'AbortError'});assert.equal(h.requests.length,1,'already-cancelled requests never reach fetch');
});

test('a location callback received while hidden defers weather, and a weather timeout leaves solar time usable',async t=>{
 const h=await climateHarness(t,{enabled:true,fetchBehavior:()=>new Promise(()=>{})});h.value.requestLocation();h.render();await h.hide();
 h.geo[0].success({coords:{latitude:35,longitude:139}});await h.settle();assert.equal(h.requests.length,0);assert.equal(h.value.phase,'paused');assert.equal(h.value.timeOfDay.kind,'solar');
 await h.show();assert.equal(h.requests.length,1);await h.advance(h.module.WEATHER_REQUEST_TIMEOUT_MS);assert.equal(h.value.phase,'error');assert.match(h.value.status,/超时/);assert.equal(h.value.weather,null);assert.equal(h.value.timeOfDay.kind,'solar');
});

test('HTTP errors and malformed/stale units never become current weather',async t=>{
 for(const response of [{ok:false,json:async()=>payload()},{ok:true,json:async()=>{throw Error('bad JSON')}},{ok:true,json:async()=>payload(start-3600000)},{ok:true,json:async()=>{const result=payload();result.current_units.wind_speed_10m='km/h';return result}}]){
  const h=await climateHarness(t,{fetchBehavior:async()=>response});await assert.rejects(h.module.fetchSceneWeather({latitude:35,longitude:139}));assert.equal(h.timers.size,1);
 }
});

test('avatar settings toggles liveWeather without dropping unknown or concurrent presentation preferences',async()=>{
 const {transformWithOxc}=await import('vite'),jsx=require('react/jsx-runtime'),presentation=await import('../src/ui/avatar-presentation.mjs'),wallpapers=await import('../src/ui/bundled-wallpapers.mjs');
 const source=await fs.readFile(path.join(root,'src/ui/AvatarPresentationSettings.jsx'),'utf8');let {code}=await transformWithOxc(source,'AvatarPresentationSettings.jsx');
 code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 let latest,ref={current:null};const SunlightLocationSettings=()=>null,Select=()=>null;
 const catalogue=await import('../src/ui/scene-catalog.mjs');
 const deps={React:{},useRef:()=>ref,useState:initial=>[initial,()=>{}],...presentation,...wallpapers,...catalogue,Select,SunlightLocationSettings,_jsx:jsx.jsx,_jsxs:jsx.jsxs,_Fragment:jsx.Fragment};
 const component=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps),walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const custom={keep:true},value={scene:'beach',custom,liveWeather:false},props={value,onChange:next=>latest=next};
 let tree=component(props),climate=walk(tree).find(node=>node.type===SunlightLocationSettings);assert.equal(climate.props.enabled,false);climate.props.onChange(true);assert.equal(latest.liveWeather,true);assert.equal(latest.custom,custom);
 const oldHandler=climate.props.onChange;tree=component({...props,value:{...latest,custom:{newer:true},futurePreference:'retained'}});oldHandler(false);assert.equal(latest.liveWeather,false);assert.deepEqual(latest.custom,{newer:true});assert.equal(latest.futurePreference,'retained');assert.equal(JSON.stringify(tree).includes('始终保留夜景'),false);
});
