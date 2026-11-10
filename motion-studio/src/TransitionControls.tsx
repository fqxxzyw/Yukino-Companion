import {useEffect, useState} from 'react';
import type {Pose, RetargetReference, KeyframeModule} from './motion/types.ts';
import {createPoseTransition} from './motion/transition.ts';

export function TransitionControls({pose, modelId, projectId, defaults, restDirections, disabled, onCreate}: {
  pose: Pose; modelId: string; projectId: string; defaults: Record<string,number>; restDirections?: RetargetReference;
  disabled: boolean; onCreate: (item: KeyframeModule)=>void;
}) {
  const [start,setStart]=useState<Pose|null>(null),[duration,setDuration]=useState(1),[message,setMessage]=useState('');
  useEffect(()=>{setStart(null);setMessage('');},[modelId,projectId]);
  return <section className="property-group" aria-label="姿势过渡">
    <h3>姿势过渡</h3>
    <p className="quiet-empty">先调整并记录起始姿势，再调整终点；插入后中间自动平滑过渡。</p>
    <div className="property-actions">
      <button type="button" disabled={disabled} onClick={()=>{setStart(structuredClone(pose));setMessage('已记录起始姿势，请调整终点');}}>记录起始姿势</button>
      <label>时长 <input aria-label="过渡时长（秒）" type="number" min="0.1" max="30" step="0.1" value={duration} disabled={disabled} onChange={e=>setDuration(e.target.valueAsNumber)} /> 秒</label>
      <button type="button" className="key-button" disabled={disabled||!start||!Number.isFinite(duration)||duration<.1||duration>30} onClick={()=>{
        if(!start)return;const item=createPoseTransition(start,pose,duration,defaults,modelId,restDirections);
        if(!item){setMessage('起始和终点相同，请先调整关节或表情');return;}
        onCreate(item);setStart(null);setMessage('已插入姿势过渡片段');
      }}>插入过渡片段</button>
    </div>
    {message&&<p className="quiet-empty" role="status">{message}</p>}
  </section>;
}
