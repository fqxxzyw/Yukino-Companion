export const DEFAULT_CHARACTER_ID='yukino';
export const DEFAULT_CHARACTER={id:DEFAULT_CHARACTER_ID,name:'雪之下雪乃',persona:'',personaEnabled:true,personaPromptMode:'detailed',memory:'',useMemory:false,modelId:'yukino-07-v1',voiceId:'',voiceLanguage:'ja',builtin:true};
const fields=['persona','personaEnabled','personaPromptMode','memory','useMemory'];
export function normalizeCharacters(state={}){
 const existing=Array.isArray(state.characters)?state.characters:[];
 const seen=new Set();const characters=existing.filter(item=>item&&typeof item.id==='string'&&item.id.length<=100&&typeof item.name==='string'&&item.name.trim()&&!seen.has(item.id)&&seen.add(item.id)).slice(0,100).map(item=>({...DEFAULT_CHARACTER,...item,name:item.name.trim().slice(0,60),builtin:item.id===DEFAULT_CHARACTER_ID,modelId:typeof item.modelId==='string'?item.modelId:'',voiceId:typeof item.voiceId==='string'?item.voiceId:'',voiceLanguage:['ja','zh'].includes(item.voiceLanguage)?item.voiceLanguage:'ja'}));
 if(!characters.some(item=>item.id===DEFAULT_CHARACTER_ID))characters.unshift({...DEFAULT_CHARACTER,...Object.fromEntries(fields.filter(key=>state[key]!==undefined).map(key=>[key,state[key]]))});
 const activeCharacter=characters.some(item=>item.id===state.activeCharacter)?state.activeCharacter:DEFAULT_CHARACTER_ID;
 const current=characters.find(item=>item.id===activeCharacter);
 return {...state,characters,activeCharacter,...Object.fromEntries(fields.map(key=>[key,current[key]])),conversations:(state.conversations||[]).map(conversation=>({...conversation,characterId:conversation.characterId||DEFAULT_CHARACTER_ID}))};
}
export function characterFor(state){return state.characters?.find(item=>item.id===state.activeCharacter)||DEFAULT_CHARACTER;}
// Model files remain in the shared local library. A character's wardrobe stores
// only associations, so switching characters or deleting a choice never moves a file.
export function rememberCharacterModel(character,modelId){
 const skinIds=Array.isArray(character.skinIds)?character.skinIds.filter(id=>typeof id==='string'&&id):[];
 const nextId=typeof modelId==='string'?modelId:'';
 return {...character,modelId:nextId,skinIds:[...new Set([...skinIds,...(character.modelId?[character.modelId]:[]),...(nextId?[nextId]:[])])]};
}
export function characterWardrobe(character,models=[]){
 const ids=new Set([...(Array.isArray(character?.skinIds)?character.skinIds:[]),character?.modelId].filter(Boolean));
 return models.filter(model=>ids.has(model.id)||(character?.id===DEFAULT_CHARACTER_ID&&/^yukino-0[1-7](?:-|$)/.test(model.id)));
}
export function patchCharacterState(state,patch){
 const changed=Object.fromEntries(fields.filter(key=>Object.hasOwn(patch,key)).map(key=>[key,patch[key]]));
 return {...state,...patch,...(Object.keys(changed).length?{characters:state.characters.map(item=>item.id===state.activeCharacter?{...item,...changed}:item)}:{})};
}
export function selectCharacter(state,id){
 if(!state.characters.some(item=>item.id===id))return state;
 return normalizeCharacters({...state,activeCharacter:id,activeConversation:null});
}
export function selectCharacterConversation(state,id,conversationId){
 const conversation=state.conversations?.find(item=>item.id===conversationId&&item.characterId===id);
 if(!conversation||!state.characters?.some(item=>item.id===id))return state;
 return {...selectCharacter(state,id),activeConversation:conversationId};
}
export function createCharacter(state,{name,persona='',modelId='',voiceId='',voiceLanguage='ja'}){
 name=name?.trim();if(!name||name.length>60)throw Error('请填写 1–60 字符的角色姓名。');
 if(typeof persona!=='string'||!persona.trim())throw Error('请填写角色设定。');
 if(persona.length>6000)throw Error('角色设定最多 6000 字符。');
 if(state.characters.length>=100)throw Error('最多保存 100 个本地角色。');
 if(!['ja','zh'].includes(voiceLanguage))throw Error('请选择中文或日语语音。');
 const item=rememberCharacterModel({...DEFAULT_CHARACTER,id:crypto.randomUUID(),name,persona,modelId:'',voiceId:typeof voiceId==='string'?voiceId:'',voiceLanguage,personaEnabled:false,builtin:false},modelId);
 return selectCharacter({...state,characters:[...state.characters,item]},item.id);
}
