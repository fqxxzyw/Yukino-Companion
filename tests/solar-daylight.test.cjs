const test=require('node:test'),assert=require('node:assert/strict');

test('offline solar elevation follows the Tokyo observatory sunrise, noon and sunset benchmark',async()=>{
 const {solarPosition}=await import('../src/ui/solar-daylight.mjs');
 // National Astronomical Observatory of Japan, Tokyo, 2026-10-30: sunrise
 // 06:01, solar noon 11:25 (40.6°), sunset 16:48 JST. Rise/set use the
 // conventional -0.833° apparent threshold; our NOAA approximation is within
 // a few minutes, not claimed as an exact astronomical almanac.
 // https://eco.mtk.nao.ac.jp/koyomi/dni/2026/s1310.html.en
 const loc={latitude:35.6895,longitude:139.6917};
 const rise=solarPosition(new Date('2026-10-29T21:01:00Z'),loc);
 const noon=solarPosition(new Date('2026-10-30T02:25:00Z'),loc);
 const set=solarPosition(new Date('2026-10-30T07:48:00Z'),loc);
 assert.ok(Math.abs(rise.elevation-(-.833))<.5);assert.ok(Math.abs(noon.elevation-40.6)<.5);assert.ok(Math.abs(set.elevation-(-.833))<.5);
 assert.ok(rise.hourAngle<0&&set.hourAngle>0);
});
test('solar position rejects bad coordinates and stays finite in polar day and night',async()=>{
 const {solarPosition,validDaylightLocation}=await import('../src/ui/solar-daylight.mjs');
 for(const loc of [null,{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:'35',longitude:0},{latitude:NaN,longitude:0}])assert.equal(validDaylightLocation(loc),null);
 assert.equal(solarPosition(new Date('bad'),{latitude:0,longitude:0}),null);
 for(const date of ['2026-06-21','2026-12-21'])for(const latitude of [-90,-80,80,90])for(let hour=0;hour<24;hour++){
  const r=solarPosition(new Date(`${date}T${String(hour).padStart(2,'0')}:00:00Z`),{latitude,longitude:0});assert.ok(Number.isFinite(r.elevation)&&Math.abs(r.elevation)<=90&&Number.isFinite(r.hourAngle));
  if(latitude===80)assert.equal(r.elevation>0,date==='2026-06-21');
 }
});
test('location-based light varies smoothly and shares the same sky/light snapshot',async()=>{
 const {sunlightConfig,createEnvironment,updateEnvironmentSunlight,disposeEnvironment}=await import('../src/ui/procedural-scenes.mjs');
 const {solarPosition}=await import('../src/ui/solar-daylight.mjs');
 const l={latitude:35.6895,longitude:139.6917},a=solarPosition(new Date('2026-10-29T21:01:00Z'),l),b=solarPosition(new Date('2026-10-29T21:02:00Z'),l),first=sunlightConfig(a),next=sunlightConfig(b);
 assert.ok(Math.abs(first.intensity-next.intensity)<.06);assert.notEqual(first.color,sunlightConfig(solarPosition(new Date('2026-10-30T02:25:00Z'),l)).color);
 const env=createEnvironment('beach',{timeOfDay:a}),sky=env.children.find(mesh=>mesh.userData.role==='sky');assert.equal(sky.material.color.getHexString(),first.skyColor.slice(1));updateEnvironmentSunlight(env,b);assert.equal(sky.material.color.getHexString(),next.skyColor.slice(1));disposeEnvironment(env);
});
