import {MathUtils} from 'three';

const brows={
 beret:['EA_brow_happy','EA_brow_surprised','EA_brow_relaxed'],
 kimono:['YK20_brow_happy','YK20_brow_surprised','AnimeV2_Thinking_Brow'],
 'black-qipao':['AnimeV2_SoftJoy_Brow','AnimeV2_Surprise_Brow','AnimeV2_Thinking_Brow'],
 'summer-uniform':['EA_brow_happy','EA_brow_surprised','EA_brow_relaxed'],
 swimsuit:['EA_brow_happy','EA_brow_surprised','Anime_Question_Brow'],
 'twin-tail':['EA_brow_happy','EA_brow_surprised','EA_brow_relaxed'],
 'winter-uniform':['AnimeV2_SoftJoy_Brow','AnimeV2_Surprise_Brow','AnimeV2_Thinking_Brow'],
};

export function conversationExpression(text){
 const reply=typeof text==='string'?text.trim().slice(0,600):'';
 if(!reply)return '';
 if(/^(?:诶|欸|咦|哎呀|竟然|えっ|まさか|oh[!,])/iu.test(reply))return 'surprise';
 if(/[？?][。.!！…」”’\s]*$/u.test(reply))return 'thoughtful';
 if(/(?:谢谢|感谢|很高兴|恭喜|太好了|做得好|ありがとう|嬉しい|おめでとう|thank you|well done)/iu.test(reply))return 'warm';
 return '';
}

export function bindConversationExpression(scene,candidate){
 const shapes=brows[candidate];
 if(!shapes)return null;
 const targets=['warm','surprise','thoughtful'].map((cue,channel)=>{
  const bindings=[];
  scene.traverse(mesh=>{
   const index=mesh.morphTargetDictionary?.[shapes[channel]];
   const positions=mesh.geometry?.morphAttributes?.position?.[index];
   if(mesh.isMesh&&Number.isInteger(index)&&positions?.array.some(value=>Math.abs(value)>1e-8))bindings.push({mesh,index});
  });
  return [cue,bindings];
 });
 const bindings=new Map(targets);
 let applied=[];
 function restore(){
  for(const {mesh,index,value} of applied)mesh.morphTargetInfluences[index]=value;
  applied=[];
 }
 return {restore,apply(cue,elapsed){
  const list=bindings.get(cue);
  if(!list?.length)return false;
  const weight=MathUtils.smoothstep(elapsed,0,.22)*(1-MathUtils.smoothstep(elapsed,1.25,2.05))*(cue==='surprise'?.26:.21);
  if(weight<=0)return false;
  for(const {mesh,index} of list){
   const value=mesh.morphTargetInfluences[index];
   applied.push({mesh,index,value});
   mesh.morphTargetInfluences[index]=Math.max(value,weight);
  }
  return true;
 }};
}
