import React from 'react';
import {Box} from 'lucide-react';

export default function SceneThumbnail({scene}){
 return scene.thumbnail?<img className="scene-thumbnail" src={scene.thumbnail} alt="" loading="lazy"/>:
  <span className="scene-thumbnail scene-thumbnail-placeholder" aria-hidden="true" style={{background:scene.background}}><Box size={22}/></span>;
}
