'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),catalog=require('../resources/character-models.json'),rules=require('../shared/outfit-rules.json');

test('one shared outfit configuration drives desktop, main process and Worker',async()=>{
 const {OUTFIT_RULES}=await import('../shared/outfit-rules.mjs');
 const {PROGRESS_RULES,skinCatalog,eligibleSkins}=await import('../shared/progress-rules.mjs');
 const {getSkinStatus}=await import('../src/companion/skin-unlocks.mjs');
 const {canUseSkin}=require('../electron/skin-policy.cjs');
 const approved=catalog.models.filter(model=>model.approvedV2&&model.ready);
 assert.equal(OUTFIT_RULES.outfits.length,9);
 assert.deepEqual(new Set(OUTFIT_RULES.outfits.map(outfit=>outfit.id)),new Set(approved.map(model=>model.id)));
 assert.deepEqual(PROGRESS_RULES.skins.map(skin=>[skin.id,skin.kind,skin.target]),rules.outfits.map(outfit=>[outfit.id,outfit.kind,outfit.target]));
 assert.deepEqual(OUTFIT_RULES.outfits.filter(outfit=>outfit.kind==='base').map(outfit=>outfit.id),['summer-uniform-v2','winter-uniform-v2']);
 assert.deepEqual(OUTFIT_RULES.outfits.filter(outfit=>outfit.kind==='login-days').map(outfit=>[outfit.id,outfit.target]),[['swimsuit-v2',2],['twin-tail-v2',3]]);
 // Server and renderer agree at the boundaries, including the initial point.
 for(const affection of [35,44,45,54,55,64,65,74,75,84,85,100])for(const loginDays of [0,1,2,3,4]){
  const server=new Map(skinCatalog({affection,loginDays}).map(skin=>[skin.id,skin.unlocked]));
  for(const outfit of OUTFIT_RULES.outfits){
   const model=approved.find(item=>item.id===outfit.id);
   const local=getSkinStatus(model,{relationship:{affection},usedDates:{version:1,dates:Array.from({length:loginDays},(_,index)=>`2026-11-${String(index+1).padStart(2,'0')}`)}});
   assert.equal(local.unlocked,server.get(outfit.id),`${outfit.id} affection=${affection} loginDays=${loginDays}`);
   assert.equal(canUseSkin(model,{relationship:{affection},usedDates:{version:1,dates:Array.from({length:loginDays},(_,index)=>`2026-11-${String(index+1).padStart(2,'0')}`)}}),local.unlocked);
  }
 }
 assert.deepEqual(eligibleSkins({affection:45,loginDays:3}),['swimsuit-v2','twin-tail-v2','beret-v2']);
});

test('legacy V1 rows map to current outfits without deleting the stored right',async()=>{
 const {canonicalOutfitIds,outfitRuleById}=await import('../shared/outfit-rules.mjs');
 const {skinCatalog}=await import('../shared/progress-rules.mjs');
 assert.deepEqual(canonicalOutfitIds(['yukino-01-v1','yukino-02-v1','yukino-04-v1','yukino-05-v1']),['swimsuit-v2','beret-v2','kimono-v2','qipao-v2']);
 assert.deepEqual(canonicalOutfitIds(['yukino-07-v1']),['summer-uniform-v2','winter-uniform-v2']);
 assert.equal(outfitRuleById('yukino-06-v1'),null,'no approved V2 equivalent is invented for the retired maid outfit');
 const catalog=skinCatalog({affection:35,loginDays:0,unlocked:['yukino-04-v1']});
 assert.equal(catalog.find(skin=>skin.id==='kimono-v2').unlocked,true);
});
