import {sceneId} from '../ui/scene-catalog.mjs';
const modules={city:()=>import('./convenience.mjs'),classroom:()=>import('./classroom.mjs'),bookshop:()=>import('./bookshop.mjs'),forest:()=>import('./forest.mjs'),school:()=>import('./school.mjs'),wedding:()=>import('./surf-hall.mjs'),kasai:()=>import('./kasai.mjs')};
export async function loadSceneFactory(value){return (await modules[sceneId(value)]()).createScene;}
