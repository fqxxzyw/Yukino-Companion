'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CompanionManager}=require('../electron/companions.cjs');

function fixture(){
 const events=[];
 const main={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,show(){},restore(){},focus(){},webContents:{send:(name,value)=>events.push({name,value})}};
 const manager=new CompanionManager({electron:{app:{quit(){}}},dataDir:'unused'});
 manager.mainWindow=main;manager.applyMode=()=>{};manager.prepareDesktopAlignment=()=>{};manager.persist=async()=>{};
 manager.refreshActivity=()=>{};manager.emit=()=>{};
 return {manager,events};
}
const phases=events=>events.filter(event=>event.name==='close-feedback').map(event=>event.value.phase);

test('close feedback starts before the target is ready and ends when handoff completes',async()=>{
 const {manager,events}=fixture();let finish;
 manager.handoffToDesktop=()=>new Promise(resolve=>{finish=resolve});
 const closing=manager.closeChoice('pet');
 await Promise.resolve();
 assert.deepEqual(phases(events),['start']);
 finish();await closing;
 assert.deepEqual(phases(events),['start','end']);
});

test('failed close restores feedback',async()=>{
 const {manager,events}=fixture();manager.onError=()=>{};manager.persist=async()=>{throw Error('save failed')};
 await assert.rejects(manager.closeChoice('pet'),/save failed/);
 assert.deepEqual(phases(events),['start','end']);
});

test('reopening clears feedback and a superseded handoff cannot clear it again',async()=>{
 const {manager,events}=fixture();let finish;
 manager.handoffToDesktop=()=>new Promise(resolve=>{finish=resolve});
 const closing=manager.closeChoice('pet');await Promise.resolve();
 await manager.revealMain();finish();await closing;
 assert.deepEqual(phases(events),['start','end']);
});
