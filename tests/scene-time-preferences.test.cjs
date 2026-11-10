const test=require('node:test'),assert=require('node:assert/strict');

test('fixed scene time survives a save/reload while live solar time and weather keep their own state',async()=>{
 const {sceneTimeFor,sceneClimateFor}=await import('../src/ui/scene-time.mjs'),{presentationConfig}=await import('../src/ui/avatar-presentation.mjs');
 const saved=JSON.parse(JSON.stringify({scene:'sakura',followTime:false,fixedHour:21.5})),config=presentationConfig(saved);
 for(const time of [4,14,23,{kind:'solar',elevation:40,hourAngle:-60}])assert.equal(sceneTimeFor(config,time),21.5);
 const weather={rain:.6},live={timeOfDay:5,weather,requestLocation:()=>{},status:'live'};
 const fixed=sceneClimateFor(config,live);assert.equal(fixed.timeOfDay,21.5);assert.equal(fixed.liveTimeOfDay,5);assert.equal(fixed.weather,weather);assert.equal(fixed.requestLocation,live.requestLocation);assert.equal(live.timeOfDay,5);
 assert.equal(sceneTimeFor({...config,followTime:true},live.timeOfDay),5);
 assert.equal(presentationConfig({}).followTime,true,'existing preferences continue following time');
});

test('fixed time rejects malformed values and parses only valid local clock times',async()=>{
 const {sceneHourLabel,parseSceneHour,fixedSceneHour,daylightClockHour}=await import('../src/ui/scene-time.mjs');
 assert.equal(parseSceneHour('23:59'),23+59/60);assert.equal(parseSceneHour('06:30'),6.5);
 for(const value of ['24:00','06:60','6:30','',null,'abc'])assert.equal(parseSceneHour(value),null);
 assert.equal(sceneHourLabel(23+59/60),'23:59');assert.equal(sceneHourLabel(6.5),'06:30');
 for(const value of [NaN,Infinity,undefined,'12'])assert.equal(fixedSceneHour(value),14);
 assert.equal(daylightClockHour({kind:'solar',hourAngle:-90}),6);
});

test('manual and system themes are independent of scene lighting and keep readable wallpaper chrome',async()=>{
 const {themeVariables,themeBackground,contrast}=await import('../src/ui/theme.mjs');
 for(const sceneNight of [false,true])for(const mode of ['light','dark','system'])for(const systemDark of [false,true]){
  const background=themeBackground('#f1f6fc',mode,systemDark,sceneNight),theme=themeVariables('#477fd1',background),dark=mode==='dark'||mode==='system'&&systemDark;
  assert.equal(theme['--scheme'],dark?'dark':'light');
  for(const ink of ['--text','--secondary','--accent-text'])assert.ok(contrast(theme[ink],theme['--surface'])>=4.5);
 }
 assert.equal(themeBackground('#122234',undefined,false,false),'#122234','old custom backgrounds are retained');
 assert.equal(themeBackground('#122234','dark',false,false),'#122234','matching custom colours stay available');
 assert.equal(themeBackground('#f5f2f8','light',false,true),'#f5f2f8');
});
