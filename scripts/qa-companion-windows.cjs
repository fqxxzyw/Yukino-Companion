// QA observation only: keep the real main, manager, renderer, preload and IPC.
// The driver injects clearly labelled reply text for layout, never model output.
const {CompanionManager}=require('../electron/companions.cjs');
const initialize=CompanionManager.prototype.initialize;
CompanionManager.prototype.initialize=async function(...args){
  const result=await initialize.apply(this,args);
  globalThis.companionWindowQa=this;
  return result;
};
require('./qa-speech-settings.cjs');
