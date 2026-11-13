import React,{useState} from 'react';
import {ArrowRight,ArrowUpRight,Copy} from 'lucide-react';
import guideLinks from '../../resources/character-guide-links.json';

const handoff=`请在我指定的项目文件夹里，把我提供的角色参考图制作成一个可在 Yukino 导入的 GLB 或 VRM 1.0。
先读取 Charakuru 官方 README 和这次导出的制作请求，列出你可以使用的图像生成、浏览器和 Blender 能力，并标明需要我手动完成的步骤。
按阶段交付参考图、三维网格、Blender 工程和最终文件。登录、上传参考图或付费生成前，先说明将发送的素材和使用的服务。素材只使用我提供且有权使用的文件。
导出前检查面部、手指、脚底、材质、骨骼和蒙皮。最终文件须内嵌贴图并控制在 64 MiB 以内，同时提供预览图和仍需修复的问题。`;

function GuideImage({file,alt,children}){
 return <figure><img src={`./guides/custom-characters/${file}.png`} alt={alt} loading="lazy"/><figcaption>{children}</figcaption></figure>;
}

export default function CustomCharacterGuide({api,onNavigate}){
 const [message,setMessage]=useState('');
 const link=(id,label)=><a className="text-link" href={guideLinks[id]} target="_blank" rel="noreferrer" onClick={api?.characterGuideLink?event=>{event.preventDefault();api.characterGuideLink(id).catch(()=>setMessage('无法打开外部链接。'));}:undefined}>{label}<ArrowUpRight size={13}/></a>;
 async function copy(){
  try{if(api?.copyText)await api.copyText(handoff);else await navigator.clipboard.writeText(handoff);setMessage('已复制任务模板。');}
  catch{setMessage('复制失败，可选中下方任务文字手动复制。');}
 }
 return <div className="character-guide">
  <p className="intro">先准备角色名和人设，即可创建文字角色。想让角色出现在人物框，再制作或导入自己的三维模型。</p>
  <section className="settings-card"><h3>制作角色模型</h3>
   <ul>
    <li><strong>从参考图生成。</strong> 在 Tripo Studio 上传清晰的全身图，查看脸部、手指和背面。需要动作时，再做骨骼绑定和蒙皮检查，导出 GLB。{link('tripo','Tripo Studio')}</li>
    <li><strong>从模板捏人。</strong> 在 VRoid Studio 调整五官、发型和服装，再选择 VRM 1.0 导出。{link('vroid','VRoid Studio')}</li>
    <li><strong>手动建模和修整。</strong> 在 Blender 制作或修补网格、材质与权重，导出带内嵌贴图的 GLB。VRM 需要 VRM Add-on for Blender。{link('blender','Blender')}</li>
   </ul>
  </section>
  <section className="settings-card"><h3>用 Charakuru 和智能体协作</h3>
   <ol>
    <li>准备一张无遮挡的全身设定图，从 Charakuru 官方发布页取得工具。确认可用的图像生成工具、能访问 Tripo 的浏览器、Blender、Blender MCP 和 VRM 插件。{link('charakuru','Charakuru 官方项目')}</li>
    <li>在 Charakuru 中载入角色图，复制当前阶段的制作请求，交给智能体。先确认头部和全身各四个视角，再用 Tripo Smart Mesh 生成网格。</li>
    <li>在 Blender 修整模型并检查骨骼、蒙皮和表情。在 Charakuru 复核站姿、动作和面部，导出 VRM 1.0 并保留 Blender 工程。</li>
    <li>在 WorkBuddy 或其他智能体中打开项目文件夹，附上参考图和制作请求。先让智能体列出可用能力。缺少浏览器控制、图像生成或 Blender MCP 的阶段可以手动完成，把产物交回智能体继续。{link('workbuddy','Tencent WorkBuddy')}</li>
   </ol>
   <details><summary>交给智能体的任务模板</summary><pre>{handoff}</pre><button type="button" className="secondary" onClick={copy}><Copy size={15}/>复制任务模板</button></details>
   {message&&<p className="hint" role="status">{message}</p>}
  </section>
  <section className="settings-card"><h3>导入、创建与选择场景</h3>
   <ol>
    <li>在「高级与资源 → 导入人物模型」选择 GLB 或 VRM 1.0，文件上限 64 MiB。检查蒙皮和骨骼后选择导入方式。静态模式保留原始姿态，保留骨骼模式使用文件自带骨架和蒙皮。</li>
   </ol>
   <GuideImage file="01-model-import" alt="导入人物模型页面的检查报告和确认按钮">先选择文件并检查，再确认导入。</GuideImage>
   <ol start={2}>
    <li>在「角色管理」点击角色列表下方的「新建角色」。输入角色名和人设，从模型列表选刚导入的文件，也可以先留空。</li>
    <li>从「默认场景」选择内置或已导入的场景，创建后切到该角色就会应用它。也可在角色管理中修改当前角色的默认场景。</li>
   </ol>
   <GuideImage file="02-create-character" alt="展开的新建角色表单及模型和默认场景选项">创建前可预先指定模型和默认场景。</GuideImage>
   <ol start={4}>
    <li>在「外观」选择场景，点击「预览构图」，调整水平和垂直位置、角度及大小。每个场景单独保存，可点击「还原默认位置」复位。用「导入本机场景」添加 GLB 或 Blender 等场景文件。</li>
   </ol>
   <GuideImage file="03-scene-settings" alt="外观设置中的构图滑块、复位和场景导入按钮">构图即时预览，调整会自动保存。</GuideImage>
   <div className="button-row">
    <button type="button" className="secondary" onClick={()=>onNavigate('model-import')}>导入人物模型<ArrowRight size={15}/></button>
    <button type="button" className="secondary" onClick={()=>onNavigate('characters')}>角色管理<ArrowRight size={15}/></button>
    <button type="button" className="secondary" onClick={()=>onNavigate('appearance')}>外观设置<ArrowRight size={15}/></button>
   </div>
  </section>
 </div>;
}
