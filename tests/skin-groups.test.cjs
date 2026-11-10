const test=require('node:test'),assert=require('node:assert/strict'),catalog=require('../resources/character-models.json');
test('all built-in model variants remain seven outfit groups with stable reversible defaults',async()=>{const {skinGroups}=await import('../src/ui/skin-groups.mjs');const groups=skinGroups(catalog.models);assert.equal(groups.length,7);for(const group of groups){assert.equal(group.model.id,group.id+'-v1');assert.ok(group.versions.some(item=>item.garment));const garment=group.versions.find(item=>item.garment);assert.equal(skinGroups(catalog.models,garment.id).find(item=>item.id===group.id).model.id,garment.id);assert.equal(skinGroups(catalog.models,garment.id,{[group.id]:group.id+'-v1'}).find(item=>item.id===group.id).model.id,group.id+'-v1');}});
test('stale saved version choices fall back to current selection, custom models remain independent',async()=>{const {skinGroups}=await import('../src/ui/skin-groups.mjs');const models=[{id:'a',outfitGroup:'one'},{id:'b',outfitGroup:'one'},{id:'custom-1'},{id:'custom-2'}];const groups=skinGroups(models,'b',{one:'deleted'});assert.equal(groups.length,3);assert.equal(groups[0].model.id,'b')});
test('each character retains its own selected skin through switches and serialization',async()=>{const {normalizeCharacters,selectCharacter,createCharacter}=await import('../src/companion/characters.mjs');let state=normalizeCharacters({characters:[{id:'yukino',name:'A',modelId:'yukino-02-v1'}]});state=createCharacter(state,{name:'B',persona:'B',modelId:'yukino-03-v1'});const second=state.activeCharacter;state=selectCharacter(state,'yukino');state={...state,characters:state.characters.map(c=>c.id===state.activeCharacter?{...c,modelId:'yukino-04-v1'}:c)};state=normalizeCharacters(JSON.parse(JSON.stringify(state)));assert.equal(state.characters.find(c=>c.id===second).modelId,'yukino-03-v1');state=selectCharacter(state,second);assert.equal(state.characters.find(c=>c.id===state.activeCharacter).modelId,'yukino-03-v1');state=selectCharacter(state,'yukino');assert.equal(state.characters.find(c=>c.id===state.activeCharacter).modelId,'yukino-04-v1');});
test('character wardrobes retain multiple imports independently and preserve unassigned legacy models',async()=>{
 const {normalizeCharacters,selectCharacter,createCharacter,rememberCharacterModel,characterWardrobe}=await import('../src/companion/characters.mjs');
 const models=[{id:'yukino-07-v1'},{id:'yukino-02-v1'},{id:'custom-a'},{id:'custom-b'},{id:'custom-c'},{id:'custom-legacy'}];
 let state=normalizeCharacters({characters:[{id:'yukino',name:'Yukino',modelId:'custom-legacy'}]});
 state=createCharacter(state,{name:'Other',persona:'Other',modelId:'custom-a'});const other=state.activeCharacter;
 state={...state,characters:state.characters.map(c=>c.id===other?rememberCharacterModel(c,'custom-b'):rememberCharacterModel(c,'custom-c'))};
 state=normalizeCharacters(JSON.parse(JSON.stringify(state)));
 const yuki=state.characters.find(c=>c.id==='yukino'),custom=state.characters.find(c=>c.id===other);
 assert.deepEqual(characterWardrobe(yuki,models).map(m=>m.id),['yukino-07-v1','yukino-02-v1','custom-c','custom-legacy']);
 assert.deepEqual(characterWardrobe(custom,models).map(m=>m.id),['custom-a','custom-b']);
 assert.equal(selectCharacter(state,other).characters.find(c=>c.id===other).modelId,'custom-b');
 assert.equal(selectCharacter(state,'yukino').characters.find(c=>c.id==='yukino').modelId,'custom-c');
 const empty=rememberCharacterModel(custom,'');assert.deepEqual(characterWardrobe(empty,models).map(m=>m.id),['custom-a','custom-b']);
});
