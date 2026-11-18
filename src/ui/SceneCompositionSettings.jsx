import React,{useRef,useState} from 'react';
import {Eye,RotateCcw,Trash2,Upload} from 'lucide-react';
import {SCENE_GROUPS,sceneEntries,scenePreset} from './scene-catalog.mjs';
import {DEFAULT_SCENE_VIEW} from './scene-view.mjs';
import SceneThumbnail from './SceneThumbnail.jsx';
import SceneViewEditor from './SceneViewEditor.jsx';
import {clearScenePreview} from './scene-preview-store.mjs';

export default function SceneCompositionSettings({config,importedScenes,onScene,onView,onSceneEnabledChange,onSceneToonChange,onSpreadChange,onOpenGallery,onImport,onRemove,libraryStatus,timeOfDay,weather,reducedMotion}){
 const [preview,setPreview]=useState(false),previewHost=useRef(null);
 const entries=sceneEntries(importedScenes),scene=scenePreset(config.scene,importedScenes);
 const view=config.sceneViews[config.scene]||DEFAULT_SCENE_VIEW;
 const adjusted=Object.keys(DEFAULT_SCENE_VIEW).some(key=>view[key]!==DEFAULT_SCENE_VIEW[key]);
 // Selecting a scene is a composition action: open the direct-manipulation
 // preview immediately instead of asking for a second click on "预览构图".
 function chooseScene(id){
  onScene(id);setPreview(true);
  setTimeout(()=>previewHost.current?.scrollIntoView({block:'nearest',behavior:reducedMotion?'auto':'smooth'}),0);
 }
 return <>
  <h3 className="settings-section-title">三维场景</h3>
  <p className="hint">选择内置或已导入的场景作为三维背景。每个场景单独保存构图。</p>
  <div className="scene-display-switches">
   <label className="row"><div><strong>打开三维场景</strong><small>关闭后隐藏场景。</small></div><input className="scene-switch" type="checkbox" role="switch" aria-label="打开三维场景" checked={config.sceneEnabled} onChange={event=>onSceneEnabledChange?.(event.target.checked)}/></label>
   <label className={"row "+(!config.sceneEnabled?"switch-disabled":"")}><div><strong>环境延伸到整个界面</strong><small>关闭时场景仅显示在人物框内。</small></div><input className="scene-switch" type="checkbox" role="switch" aria-label="环境延伸到整个界面" disabled={!config.sceneEnabled} checked={config.spread} onChange={event=>onSpreadChange?.(event.target.checked)}/></label>
   <label className="row"><div><strong>赛璐璐场景</strong><small>独立控制场景的新海诚式分层天空、云与描边。</small></div><input className="scene-switch" type="checkbox" role="switch" aria-label="赛璐璐场景渲染" checked={config.sceneToon===true} onChange={event=>onSceneToonChange?.(event.target.checked)}/></label>
  </div>
  <div className="scene-option-groups" aria-label="人物环境">
   {SCENE_GROUPS.map(({kind,label})=>{
    const group=entries.filter(([,item])=>item.kind===kind);
    if(!group.length)return null;
    return <section key={kind} aria-label={label+'场景'}><h4>{label}</h4><div className="scene-options">{group.map(([id,item])=>{
     const selected=config.scene===id;
     return <button type="button" key={id} aria-pressed={selected} className={selected?'selected':''} onClick={()=>chooseScene(id)}><SceneThumbnail scene={item} sceneId={id}/><span>{item.label}</span></button>;
    })}</div></section>;
   })}
  </div>
  <section className="settings-card scene-composition" aria-label="场景构图">
   <h3>场景构图 · {scene.label}</h3>
   <div className="button-row">
    <button className="secondary" type="button" aria-expanded={preview} onClick={()=>setPreview(open=>!open)}><Eye size={15}/>{preview?'关闭预览':'预览构图'}</button>
    <button className="secondary" type="button" disabled={!adjusted} onClick={()=>{clearScenePreview(config.scene);onView(config.scene,null)}}><RotateCcw size={15}/>还原默认位置</button>
    {onOpenGallery&&<button className="secondary" type="button" onClick={()=>onOpenGallery(config.scene)}>观赏当前三维景观</button>}
   </div>
   {preview&&<div ref={previewHost}><SceneViewEditor sceneId={config.scene} view={view} onView={onView} importedScenes={importedScenes} timeOfDay={timeOfDay} weather={weather} reducedMotion={reducedMotion} sceneToon={config.sceneToon}/></div>}
   {preview&&<p className="hint">直接拖动画面旋转；滚轮缩放，Shift＋拖动平移构图。松手后自动保存当前构图预览。</p>}
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
