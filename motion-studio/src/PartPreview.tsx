import {useEffect,useRef,useState} from 'react';
import type {KeyframeModule,Pose,RetargetReference} from './motion/types.ts';
import {samplePartPreview,createPartPreviewModule} from './part-preview.ts';
import {StudioSelect} from './StudioSelect.tsx';
import {clamp} from './motion/math.ts';

export function PartPreview({id,label,kind,pose,defaultWeight=0,modelId,restDirections,disabled,onPreview,onCreate,limitsEnabled=false}: {
  id:string;label:string;kind:'bone'|'expression';pose:Pose;defaultWeight?:number;disabled:boolean;
  modelId:string;restDirections?:RetargetReference;limitsEnabled?:boolean;onCreate:(module:KeyframeModule)=>void;
  onPreview:(pose:Pose|null)=>void;
}) {
  const [playing,setPlaying]=useState(false),[axis,setAxis]=useState<0|1|2>(2),[amplitude,setAmplitude]=useState(20),[period,setPeriod]=useState(2);
  const latest=useRef(onPreview);latest.current=onPreview;
  const base=useRef({rotation:pose.rotations[id],weight:pose.expressions[id]??defaultWeight});
  useEffect(()=>{setPlaying(false);latest.current(null);},[id,kind,disabled]);
  useEffect(()=>{
    if(!playing||disabled)return;
    let frame=0,origin:number|undefined;
    const tick=(now:number)=>{origin??=now;latest.current(samplePartPreview({kind,id,axis,amplitude:kind==='bone'?amplitude:amplitude/100,period,elapsed:(now-origin)/1000,limitsEnabled,...base.current}));frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);latest.current(null);};
  },[playing,id,kind,axis,amplitude,period,disabled,limitsEnabled]);
  return <section className="property-group" aria-label="部位动作试播">
    <h3>动作试播 <span>{label}</span></h3>
    <p className="quiet-empty">以当前姿势为起点试播，停止后回到原姿势。</p>
    <div className="number-grid">
      {kind==='bone'&&<label className="number-field"><span>旋转轴</span><StudioSelect aria-label="试播旋转轴" value={String(axis)} disabled={disabled} onChange={e=>setAxis(Number(e.target.value) as 0|1|2)}><option value="0">X</option><option value="1">Y</option><option value="2">Z</option></StudioSelect></label>}
      <label className="number-field"><span>幅度 {kind==='bone'?'°':'%'}</span><input aria-label="试播幅度" type="number" min="0" max={kind==='bone'?90:100} step="1" value={amplitude} disabled={disabled} onChange={e=>setAmplitude(clamp(e.target.valueAsNumber||0,0,kind==='bone'?90:100))}/></label>
      <label className="number-field"><span>周期 秒</span><input aria-label="试播周期" type="number" min="0.2" max="10" step="0.1" value={period} disabled={disabled} onChange={e=>setPeriod(clamp(e.target.valueAsNumber||.2,.2,10))}/></label>
    </div>
    <div className="property-actions"><button type="button" disabled={disabled} onClick={()=>{
      if(playing){setPlaying(false);latest.current(null);}else{base.current={rotation:pose.rotations[id],weight:pose.expressions[id]??defaultWeight};setPlaying(true);}
    }}>{playing?'停止并回正':'试一试'}</button><button type="button" disabled={disabled||amplitude===0} onClick={()=>{
      const start=playing?base.current:{rotation:pose.rotations[id],weight:pose.expressions[id]??defaultWeight};
      const module=createPartPreviewModule({kind,id,label,modelId,restDirections,period,axis,limitsEnabled,amplitude:kind==='bone'?amplitude:amplitude/100,...start});
      if(module){setPlaying(false);latest.current(null);onCreate(module);}
    }}>加入时间线</button></div>
  </section>;
}
