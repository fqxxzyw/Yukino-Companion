import React,{lazy,Suspense,useState} from 'react';
import {Eye,RotateCcw,Trash2,Upload} from 'lucide-react';
import {SCENE_GROUPS,sceneEntries,scenePreset} from './scene-catalog.mjs';
import {DEFAULT_SCENE_VIEW,SCENE_VIEW_CONTROLS} from './scene-view.mjs';
import SceneThumbnail from './SceneThumbnail.jsx';

const SceneBackdrop=lazy(()=>import('./SceneBackdrop.jsx'));

export default function SceneCompositionSettings({config,importedScenes,onScene,onView,onOpenGallery,onImport,onRemove,libraryStatus,timeOfDay,weather,reducedMotion}){
 const [preview,setPreview]=useState(false);
 const entries=sceneEntries(importedScenes),scene=scenePreset(config.scene,importedScenes);
 const view=config.sceneViews[config.scene]||DEFAULT_SCENE_VIEW;
 const adjusted=SCENE_VIEW_CONTROLS.some(({key,initial})=>view[key]!==initial);
 return <>
  <h3 className="settings-section-title">三维场景</h3>
  <p className="hint">选择内置或已导入的场景作为三维背景。每个场景单独保存构图。</p>
  <div className="scene-option-groups" aria-label="人物环境">
   {SCENE_GROUPS.map(({kind,label})=>{
    const group=entries.filter(([,item])=>item.kind===kind);
    if(!group.length)return null;
    return <section key={kind} aria-label={label+'场景'}><h4>{label}</h4><div className="scene-options">{group.map(([id,item])=>{
     const selected=config.scene===id;
     return <button type="button" key={id} aria-pressed={selected} className={selected?'selected':''} onClick={()=>onScene(id)}><SceneThumbnail scene={item}/><span>{item.label}</span></button>;
    })}</div></section>;
   })}
  </div>
  <section className="settings-card scene-composition" aria-label="场景构图">
   <h3>场景构图 · {scene.label}</h3>
   <div className="button-row">
    <button className="secondary" type="button" aria-expanded={preview} onClick={()=>setPreview(open=>!open)}><Eye size={15}/>{preview?'关闭预览':'预览构图'}</button>
    <button className="secondary" type="button" disabled={!adjusted} onClick={()=>onView(config.scene,null)}><RotateCcw size={15}/>还原默认位置</button>
    {onOpenGallery&&<button className="secondary" type="button" onClick={()=>onOpenGallery(config.scene)}>观赏当前三维景观</button>}
   </div>
   {preview&&<div className="scene-composition-preview" aria-label="构图实时预览"><Suspense fallback={<p className="scene-load-status" role="status">正在打开构图预览…</p>}><SceneBackdrop preview scene={config.scene} view={view} importedScenes={importedScenes} timeOfDay={timeOfDay} weather={weather} enabled reducedMotion={reducedMotion} motionEnabled={false}/></Suspense></div>}
   <div className="scene-view-controls">{SCENE_VIEW_CONTROLS.map(({key,label,min,max,unit})=><label key={key} className="field">
    <span>{label}<output>{view[key]}{unit}</output></span>
    <input type="range" aria-label={label} min={min} max={max} step="1" value={view[key]} onChange={event=>onView(config.scene,{[key]:Number(event.target.value)})}/>
   </label>)}</div>
   {onOpenGallery&&<p className="hint">观赏模式可拖拽旋转、滚轮或双指缩放，也可使用方向键和加减号。Home 回到已保存构图，Esc 返回。</p>}
  </section>
  <section className="settings-card scene-library" aria-label="导入场景">
   <h3>导入场景</h3>
   <p className="hint">支持 GLB、内嵌资源的 glTF、OBJ、FBX、STL、PLY、Three.js JSON、JS / MJS 和 Blender（.blend）。单个文件最大 128 MiB，GLB 可同时保存网格和贴图。</p>
   <p className="hint">JS / MJS 使用 Three.js 场景 JSON，可在前面加 <code>export default</code>。导入器仅解析场景数据。导入 .blend 需要本机安装 Blender。</p>
   <div className="button-row"><button className="secondary" type="button" onClick={onImport} disabled={libraryStatus?.pending}><Upload size={15}/>{libraryStatus?.pending?'正在处理…':'导入本机场景'}</button></div>
   {libraryStatus?.message&&<p className={libraryStatus.error?'wallpaper-error':'hint'} role={libraryStatus.error?'alert':'status'}>{libraryStatus.message}</p>}
   {importedScenes.length>0&&<ul className="scene-library-list">{importedScenes.map(item=><li key={item.id}>
    <div><strong>{item.label}</strong><small>{(item.sourceExtension||item.extension).toUpperCase()}</small></div>
    <button className="icon" type="button" disabled={libraryStatus?.pending} title={`移除 ${item.label}`} aria-label={`移除 ${item.label}`} onClick={()=>onRemove(item)}><Trash2 size={15}/></button>
   </li>)}</ul>}
  </section>
 </>;
}
