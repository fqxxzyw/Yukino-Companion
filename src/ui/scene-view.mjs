import {SCENES,isCustomSceneId} from './scene-catalog.mjs';

export const SCENE_VIEW_CONTROLS=Object.freeze([
 {key:'horizontal',label:'水平位置',min:-40,max:40,initial:0,unit:'%'},
 {key:'vertical',label:'垂直位置',min:-35,max:35,initial:0,unit:'%'},
 {key:'azimuth',label:'水平角度',min:-180,max:180,initial:0,unit:'°'},
 {key:'elevation',label:'俯仰角度',min:-60,max:60,initial:0,unit:'°'},
 {key:'scale',label:'显示大小',min:50,max:200,initial:100,unit:'%'}
]);
export const DEFAULT_SCENE_VIEW=Object.freeze(Object.fromEntries(SCENE_VIEW_CONTROLS.map(({key,initial})=>[key,initial])));

export function sceneViewConfig(value){
 if(!value)return DEFAULT_SCENE_VIEW;
 return Object.fromEntries(SCENE_VIEW_CONTROLS.map(({key,min,max,initial})=>[
  key,Number.isFinite(value[key])?Math.round(Math.min(max,Math.max(min,value[key]))):initial
 ]));
}

export function sceneViewsConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value)
  .filter(([id,view])=>(Object.hasOwn(SCENES,id)||isCustomSceneId(id))&&view&&typeof view==='object')
  .map(([id,view])=>[id,sceneViewConfig(view)]));
}
