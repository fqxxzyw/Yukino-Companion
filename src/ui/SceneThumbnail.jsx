import React from 'react';
import {Box} from 'lucide-react';
import {useScenePreview} from './use-scene-preview.mjs';

export default function SceneThumbnail({scene,sceneId}){
 const saved=useScenePreview(sceneId||'');
 const source=saved||scene.thumbnail;
 return source?<img className="scene-thumbnail" src={source} alt="" loading="lazy"/>:
  <span className="scene-thumbnail scene-thumbnail-placeholder" aria-hidden="true" style={{background:scene.background}}><Box size={22}/></span>;
}
