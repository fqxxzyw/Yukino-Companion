// Append only new facts; never replace text entered by the user.
export function appendExtractedMemories(current, facts, limit=12000){
 let result=typeof current==='string'?current:'';
 if(!Array.isArray(facts))return result;
 for(const fact of facts){
  if(typeof fact!=='string'||fact.length<2||fact.length>120||/[\r\n]/.test(fact)||result.includes(fact))continue;
  const next=result+(result?'\n':'')+'• '+fact;
  if(next.length<=limit)result=next;
 }
 return result;
}

// The editor reads the active character's mirrored top-level memory. Update
// both copies together; if the user switched characters, only update the
// character that owned the conversation when extraction began.
export function recordExtractedMemories(state, characterId, facts, expectedMemory){
 if(state.autoMemory===false||!Array.isArray(state.characters))return state;
 const character=state.characters.find(item=>item.id===characterId);
 if(!character)return state;
 if(expectedMemory!==undefined&&(character.memory||'')!==expectedMemory)return state;
 const memory=appendExtractedMemories(character.memory,facts);
 if(memory===character.memory)return state;
 return {...state,...(state.activeCharacter===characterId?{memory}:{}),characters:state.characters.map(item=>item.id===characterId?{...item,memory}:item)};
}
