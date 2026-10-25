'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseLegacySettings,QuotePicker,allowedHour}=require('../electron/pet-features.cjs');
test('imports all original desktop pet INI preferences and ignores unknown keys',()=>{
 const legacy=parseLegacySettings('left=-240\ntop=99\nscale=1.25\nopacity=.6\ntopmost=False\npaused=True\ninteractionPaused=True\nrandomQuotes=False\ninteractionQuotes=False\nnightReminders=False\nshowBubbles=False\nquietMode=True\nsoundEnabled=False\nsoundVolume=.75\nvoiceInitialized=True\napiKey=not-imported');
 assert.deepEqual(legacy,{positions:{pet:{x:-240,y:99}},scale:1.25,opacity:.6,alwaysOnTop:false,animation:false,interactionPaused:true,randomQuotes:false,interactionQuotes:false,nightReminders:false,showBubbles:false,quietMode:true,soundEnabled:false,soundVolume:.75});
 assert.deepEqual(parseLegacySettings('scale=8\nopacity=-1\nsoundVolume=invalid\nleft=bad\ntop=3'),{scale:2,opacity:.35});
});
test('night quote hours wrap midnight and daytime upper bounds remain exclusive',()=>{
 assert.equal(allowedHour({StartHour:23,EndHour:6},0),true);assert.equal(allowedHour({StartHour:23,EndHour:6},23),true);assert.equal(allowedHour({StartHour:23,EndHour:6},6),false);assert.equal(allowedHour({StartHour:8,EndHour:23},23),false);assert.equal(allowedHour({StartHour:0,EndHour:0},17),true);
});
test('weighted quotes respect action, mood, affection, global and per-quote cooldowns',()=>{
 let now=new Date(2026,9,25,12).getTime();
 const common={TriggerType:'Idle',StartHour:0,EndHour:0,Weight:1,CooldownSeconds:90,MinAffection:0,MaxAffection:100,RequiredState:'Any',RequiredAction:'Any'};
 const entries=[{...common,Text:'ordinary',Category:'base'},{...common,Text:'sitting',Category:'sitting',RequiredAction:'sitting',Weight:9},{...common,Text:'close',Category:'close',MinAffection:50,RequiredState:'Relaxed'}];
 const picker=new QuotePicker(entries,{now:()=>now,random:()=>.5});
 assert.equal(picker.pick('Idle',{action:'idle'}).Text,'ordinary');assert.equal(picker.pick('Idle',{action:'sitting'}),null);
 now+=30000;assert.equal(picker.pick('Idle',{action:'sitting'}).Text,'sitting');
 now+=30000;assert.equal(picker.pick('Idle',{mood:'Calm',affection:60}),null);
 assert.equal(picker.pick('Idle',{mood:'Relaxed',affection:60}).Text,'close');
 now+=30000;assert.equal(picker.pick('Idle',{action:'idle'}).Text,'ordinary');
});
