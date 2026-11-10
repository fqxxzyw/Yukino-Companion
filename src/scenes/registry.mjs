import {sceneId} from '../ui/scene-catalog.mjs';
import {finishScene} from './scene-finish.mjs';
import {prepareArchitectureTextures} from './architecture-textures.mjs';
const modules={city:()=>import('./lawson.mjs'),classroom:()=>import('./classroom.mjs'),bookshop:()=>import('./bookshop-ramen.mjs'),forest:()=>import('./arashiyama.mjs'),school:()=>import('./school.mjs'),wedding:()=>import('./surf-hall.mjs'),kasai:()=>import('./kasai.mjs'),inage:()=>import('./inage-overpass.mjs'),kyoto:()=>import('./kyoto-temple.mjs'),sakura:()=>import('./sakura-stream.mjs')};
export async function loadSceneFactory(value){
 const id=sceneId(value),create=(await modules[id]()).createScene;
 await prepareArchitectureTextures(id);
 return options=>finishScene(create(options),{...options,id});
}
