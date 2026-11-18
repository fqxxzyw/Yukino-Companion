import replacements from '../../resources/model-replacements.json' with {type:'json'};

const exact=replacements.exact,prefixes=Object.entries(replacements.prefixes);

// The approved V2 package directly replaces the legacy runtime outfits. Keep
// this map in shared data so renderer state and the Electron main process
// migrate the same saved model ids.
export function approvedModelId(id){
 if(typeof id!=='string'||!id)return '';
 if(Object.hasOwn(exact,id))return exact[id];
 const match=prefixes.find(([prefix])=>id.startsWith(prefix+'-'));
 return match?match[1]:id;
}
