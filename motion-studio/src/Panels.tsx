import { StudioSelect } from './StudioSelect.tsx';
import { useEffect, useState } from 'react';
import { Activity, Bone, ChevronDown, ChevronRight, ChevronUp, CirclePlus, Diamond, RotateCcw, Search, SlidersHorizontal, Smile, Trash2 } from 'lucide-react';
import { clipDuration, clipSourceTime } from './motion/index.ts';
import type { Clip, ModelMapping, MotionModule, Track } from './motion/index.ts';
import type { RigControl, RigInfo } from './viewport.ts';
import { regionLabel } from './Timeline.tsx';
import { compatibility } from './compatibility.ts';
import { BodyPose } from './BodyPose.tsx';
import type { BodyPoseProps } from './BodyPose.tsx';

export function Library({ tab, setTab, modules, rig, current, onAdd, onSelect, disabled }: {
  tab: 'library' | 'rig';
  setTab: (tab: 'library' | 'rig') => void;
  modules: MotionModule[];
  rig: RigInfo | null;
  current: string;
  onAdd: (id: string) => void;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '躯干': true, '头颈': true });
  const normalize = (value: string) => value.toLowerCase().includes(query.trim().toLowerCase());
  const groups = [
    { title: '身体动作', icon: Bone, items: modules.filter((module) => !['eyes', 'brows', 'face', 'mouth'].includes(module.region) && module.kind === 'procedural') },
    { title: '表情与口型', icon: Smile, items: modules.filter((module) => ['eyes', 'brows', 'face', 'mouth'].includes(module.region) && module.kind === 'procedural') },
    { title: '原始动画与录制', icon: Activity, items: modules.filter((module) => module.kind === 'keyframes') },
  ];
  // Recognised humanoid names use canonical ids; unmatched source bones are
  // kept in a separate group so model-specific controls remain accessible.
  function bodyGroup(control: RigControl): string {
    const id = control.id;
    if (/^(root|hips|spine|chest|upperChest)$/i.test(id)) return '躯干';
    if (/^(neck|head|leftEye|rightEye)$/i.test(id)) return '头颈';
    if (/^left(thumb|index|middle|ring|little)\d+$/i.test(id)) return '左手手指';
    if (/^right(thumb|index|middle|ring|little)\d+$/i.test(id)) return '右手手指';
    if (/^left(shoulder|upperArm|lowerArm|hand)$/i.test(id)) return '左臂';
    if (/^right(shoulder|upperArm|lowerArm|hand)$/i.test(id)) return '右臂';
    if (/^left(upperLeg|lowerLeg|foot|toeBase)$/i.test(id)) return '左腿';
    if (/^right(upperLeg|lowerLeg|foot|toeBase)$/i.test(id)) return '右腿';
    return '其他关节';
  }
  const bodyTitles = ['躯干', '头颈', '左臂', '左手手指', '右臂', '右手手指', '左腿', '右腿', '其他关节'];
  const rigGroups = rig ? [
    ...bodyTitles.map((title) => ({ title, icon: Bone, items: rig.bones.filter((bone) => bodyGroup(bone) === title) })),
    { title: '表情通道', icon: Smile, items: rig.expressions.filter((item) => !item.internal) },
  ] : [];
  return <aside className="library panel">
    <div className="tabs">
      <button aria-pressed={tab === 'rig'} onClick={() => { setTab('rig'); setQuery(''); }}>关节与表情</button>
      <button aria-pressed={tab === 'library'} onClick={() => { setTab('library'); setQuery(''); }}>动作模块</button>
    </div>
    <label className="search"><Search size={15} /><input placeholder={tab === 'rig' ? '搜索关节或表情' : '搜索动作'} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="library-scroll">
      {tab === 'rig' && !rig && <p className="quiet-empty">加载角色后显示可控关节。</p>}
      {tab === 'rig' && rigGroups.map(({ title, icon: Icon, items }) => {
        const filtered = items.filter((item) => normalize(`${item.id} ${item.label} ${item.source}`));
        const open = !!query.trim() || !!expanded[title];
        return filtered.length > 0 && <div className="library-group" key={title}>
          <button type="button" className="rig-group-toggle" aria-expanded={open} onClick={() => setExpanded((previous) => ({ ...previous, [title]: !previous[title] }))}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Icon size={14} /> {title}<span>{filtered.length}</span>
          </button>
          {open && filtered.map((control) => <button className="rig-row" key={control.id} aria-pressed={control.id === current} onClick={() => onSelect(control.id)}>
            <i className={`region-mark region-${control.region}`} /><span>{control.label}</span>
          </button>)}
        </div>;
      })}
      {tab === 'library' && groups.map(({ title, icon: Icon, items }) => {
        const filtered = items.filter((item) => normalize(`${item.name} ${item.id}`));
        return filtered.length > 0 && <div className="library-group" key={title}>
          <h3><Icon size={14} /> {title}<span>{filtered.length}</span></h3>
          {filtered.map((module) => {
            const warning = compatibility(module, rig);
            return <button className="module-row" key={module.id} title={warning || module.description}
              disabled={disabled || !!warning} draggable={!disabled && !warning}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('application/yukino-module', module.id);
              }} onClick={() => onAdd(module.id)}>
              <i className={`region-mark region-${module.region}`} /><span>{module.name}</span>
              {warning ? <small>缺通道</small> : <CirclePlus size={14} />}
            </button>;
          })}
        </div>;
      })}
      {tab === 'library' && rig && !rig.clips.length && !query.trim() && <p className="quiet-empty">此模型没有内嵌动作，可以使用支持的动作模块或自己录制。</p>}
    </div>
    <div className="panel-foot">{tab === 'rig' ? '选择关节或表情，在属性面板操控' : '点击插入，或拖到任意轨道'}</div>
  </aside>;
}

export function NumberField({ label, value, onChange, min, max, step = 0.01, disabled, unit }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean; unit?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Number(value.toFixed(5)))), [value]);
  return <label className="number-field">
    <span>{label}</span>
    <div><input type="number" value={text} min={min} max={max} step={step} disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => {
        const number = event.target.valueAsNumber;
        if (!Number.isFinite(number)) { setText(String(value)); return; }
        const bounded = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number));
        setText(String(bounded));
        if (bounded !== value) onChange(bounded);
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />{unit && <small>{unit}</small>}</div>
  </label>;
}

export function ControlPanel({ control, rotation, position, updateRotation, updatePosition, onRangeStart, reset, keyframe, armed, disabled, canKey, keyHint, body }: {
  control?: RigControl; rotation: number[]; position: number[];
  updateRotation: (axis: number, value: number) => void; updatePosition: (axis: number, value: number) => void;
  reset: () => void; keyframe: () => void; armed: boolean; disabled: boolean;
  onRangeStart: React.PointerEventHandler<HTMLInputElement>;
  canKey: boolean; keyHint: string;
  body?: Omit<BodyPoseProps, 'disabled'>;
}) {
  const [translation, setTranslation] = useState(false);
  return <>
    {body && <BodyPose {...body} disabled={disabled} />}
    <div className="control-title"><div className="control-icon"><Bone size={19} /></div>
      <div><strong>{control?.label ?? '选择一个关节'}</strong><small>{control?.source ?? '从身体姿势图、列表或三维骨架选择'}</small></div>
    </div>
    {control && <>
      <div className="property-group">
        <h3>局部旋转 <span>角度</span></h3>
        {['X', 'Y', 'Z'].map((axis, index) => <label className={`slider-row axis-${axis.toLowerCase()}`} key={axis}><span>{axis}</span>
          <input type="range" aria-label={`旋转 ${axis}`} min="-180" max="180" step="1" disabled={disabled} value={rotation[index]}
            onPointerDown={onRangeStart} onChange={(event) => updateRotation(index, event.target.valueAsNumber)} />
          <output>{Math.round(rotation[index])}°</output></label>)}
        <button className="text-button" aria-expanded={translation} onClick={() => setTranslation(!translation)}><SlidersHorizontal size={13} /> 局部位移</button>
        {translation && <div className="number-grid">{['X', 'Y', 'Z'].map((axis, index) =>
          <NumberField key={axis} label={`位移 ${axis}`} value={position[index] * 100} onChange={(number) => updatePosition(index, number / 100)} step={0.1} unit="%" disabled={disabled} />)}</div>}
      </div>
      <div className="property-actions">
        <button onClick={reset} disabled={disabled}><RotateCcw size={14} /> 重置控制</button>
        <button className="key-button" title={keyHint} onClick={keyframe} disabled={!canKey || armed}><Diamond size={14} /> 写入关键帧</button>
      </div>
    </>}
  </>;
}

export function ClipPanel({ clip, module, fps, time, track, onChange, disabled, onKey, onRename }: {
  clip: Clip; module?: MotionModule; fps: number; time: number; track: Track; onChange: (patch: Partial<Clip>) => void; disabled: boolean;
  onKey: (type: string, key: string, oldTime: number, newTime: number | null, interpolation?: 'linear' | 'smooth' | 'hold', copy?: boolean) => void;
  onRename: (name: string) => void;
}) {
  const localTime = time - clip.start / fps;
  const currentSource = localTime >= 0 && localTime < clipDuration(clip) ? clipSourceTime(clip, localTime) : undefined;
  const exclusive = module?.kind === 'keyframes' && Boolean(module.exclusiveGroup);
  return <>
    <div className="control-title"><div className="control-icon"><Activity size={19} /></div><div><strong>{module?.name ?? '片段'}</strong>
      <small>{track.name} · {clipDuration(clip).toFixed(2)} 秒</small></div></div>
    {module?.description && <p className="quiet-empty">{module.description}</p>}
    {module?.kind === 'keyframes' && <div className="property-group">
      <label className="number-field">动作名称<input key={module.name} defaultValue={module.name} maxLength={140} disabled={disabled} onBlur={(event) => {
        const name = event.target.value.trim();
        if (name && name !== module.name) onRename(name);
        else event.target.value = module.name;
      }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    </div>}
    <div className="property-group number-grid">
      <NumberField label="开始帧" value={clip.start} min={0} step={1} onChange={(start) => onChange({ start: Math.round(start) })} disabled={disabled} />
      <NumberField label="播放速度" value={clip.speed} min={0.05} max={16} step={0.05} unit="×" onChange={(speed) => onChange({ speed })} disabled={disabled} />
      <NumberField label="源入点" value={clip.sourceIn} min={0} max={clip.sourceOut - 0.001} unit="秒" onChange={(sourceIn) => onChange({ sourceIn })} disabled={disabled} />
      <NumberField label="源出点" value={clip.sourceOut} min={clip.sourceIn + 0.001} max={module?.duration} unit="秒" onChange={(sourceOut) => onChange({ sourceOut })} disabled={disabled} />
      <NumberField label="循环次数" value={exclusive ? 1 : clip.loops} min={1} max={99} step={1} onChange={(loops) => onChange({ loops: Math.round(loops) })} disabled={disabled || exclusive} />
      <NumberField label="拉伸时长" value={clip.stretch ?? 0} min={0} unit="秒" onChange={(stretch) => onChange({ stretch: stretch || null })} disabled={disabled} />
      <NumberField label="淡入" value={exclusive ? 0 : clip.blendIn} min={0} unit="秒" onChange={(blendIn) => onChange({ blendIn })} disabled={disabled || exclusive} />
      <NumberField label="淡出" value={exclusive ? 0 : clip.blendOut} min={0} unit="秒" onChange={(blendOut) => onChange({ blendOut })} disabled={disabled || exclusive} />
      <NumberField label="权重" value={exclusive ? 1 : clip.weight} min={0} max={1} onChange={(weight) => onChange({ weight })} disabled={disabled || exclusive} />
      <NumberField label="优先级" value={clip.priority ?? 0} min={-100} max={100} step={1} onChange={(priority) => onChange({ priority: Math.round(priority) })} disabled={disabled} />
      <label className="number-field"><span>混合</span><StudioSelect aria-label="混合" value={exclusive ? 'override' : clip.mode} disabled={disabled || exclusive} onChange={(event) => onChange({ mode: event.target.value as Clip['mode'] })}>
        <option value="override">覆盖</option><option value="additive">增量</option><option value="priority">优先</option>
      </StudioSelect></label>
    </div>
    {module?.kind === 'procedural' && module.parameters.length > 0 && <div className="property-group">
      <h3>动作参数</h3><div className="number-grid">
        {module.parameters.map((parameter) => <NumberField key={parameter.key} label={parameter.label}
          value={clip.parameters[parameter.key] ?? parameter.defaultValue} min={parameter.min} max={parameter.max} step={parameter.step}
          unit={parameter.unit} disabled={disabled} onChange={(value) => onChange({ parameters: { ...clip.parameters, [parameter.key]: value } })} />)}
      </div>
    </div>}
    {module?.kind === 'keyframes' && <div className="property-group">
      <h3>关键帧 <span>{typeof currentSource === 'number' ? `${currentSource.toFixed(2)} 秒` : '源时间'}</span></h3>
      <div className="key-list">
        {module.channels.filter((channel) => !exclusive || channel.type !== 'expression' || !channel.key.startsWith('native:morph:Kimono_')).map((channel) => <details key={`${channel.type}:${channel.key}`}>
          <summary><Diamond size={12} /> {channel.key}<small>{channel.type === 'rotation' ? '旋转' : channel.type === 'translation' ? '位移' : '表情'} · {channel.keys.length}</small></summary>
          {channel.keys.map((keyframe) => <div className="key-row" key={keyframe.time}>
            <NumberField label="时间" value={keyframe.time} min={0} step={1 / fps} unit="秒" disabled={disabled} onChange={(time) => onKey(channel.type, channel.key, keyframe.time, time)} />
            <StudioSelect title="插值" aria-label="插值" value={keyframe.interpolation ?? 'linear'} disabled={disabled}
              onChange={(event) => onKey(channel.type, channel.key, keyframe.time, keyframe.time, event.target.value as 'linear' | 'smooth' | 'hold')}>
              <option value="linear">线性</option><option value="smooth">平滑</option><option value="hold">保持</option>
            </StudioSelect>
            <button title="复制到播放头" aria-label="复制关键帧到播放头" disabled={disabled || typeof currentSource !== 'number'} onClick={() => onKey(channel.type, channel.key, keyframe.time, currentSource ?? 0, keyframe.interpolation, true)}><CirclePlus size={14} /></button>
            <button title="删除关键帧" aria-label="删除关键帧" disabled={disabled} onClick={() => onKey(channel.type, channel.key, keyframe.time, null)}><Trash2 size={14} /></button>
          </div>)}
        </details>)}
      </div>
    </div>}
  </>;
}

export function TrackPanel({ track, regions, onChange, onMove, onDelete, disabled }: {
  track: Track; regions: Track['region'][]; onChange: (patch: Partial<Track>) => void; onMove: (delta: number) => void;
  onDelete: () => void; disabled: boolean;
}) {
  return <div className="property-group">
    <h3>轨道设置</h3>
    <label className="number-field"><span>名称</span><input key={track.name} defaultValue={track.name} disabled={disabled || track.locked}
      onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== track.name) onChange({ name }); }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label className="number-field"><span>身体区域</span><StudioSelect aria-label="轨道身体区域" value={track.region} disabled={disabled || track.locked} onChange={(event) => onChange({ region: event.target.value as Track['region'] })}>
      {regions.map((region) => <option key={region} value={region}>{regionLabel(region)}</option>)}
    </StudioSelect></label>
    <div className="property-actions">
      <button disabled={disabled || track.locked} onClick={() => onMove(-1)}><ChevronUp size={14} /> 上移</button>
      <button disabled={disabled || track.locked} onClick={() => onMove(1)}><ChevronDown size={14} /> 下移</button>
      <button disabled={disabled || track.locked} onClick={onDelete}><Trash2 size={14} /> 删除</button>
    </div>
  </div>;
}

const boneRoles = ['root', 'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm',
  'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
const expressionRoles = ['blink', 'blinkLeft', 'blinkRight', 'smile', 'frown', 'mouthOpen', 'aa', 'ih', 'ou', 'ee', 'oh', 'mbp'];

export function MappingPanel({ rig, mapping, update, disabled }: {
  rig: RigInfo; mapping?: ModelMapping; update: (mapping: ModelMapping) => void; disabled: boolean;
}) {
  const [kind, setKind] = useState<'bones' | 'expressions'>('bones');
  const [role, setRole] = useState('head');
  const controls = rig[kind];
  const sources = Array.from(new Set(controls.map((control) => control.source)));
  return <details className="rig-report">
    <summary>校正模型映射</summary>
    <label className="number-field">通道类型
      <StudioSelect aria-label="通道类型" disabled={disabled} value={kind} onChange={(event) => {
        const next = event.target.value as typeof kind;
        setKind(next);
        setRole(next === 'bones' ? 'head' : 'blink');
      }}><option value="bones">关节</option><option value="expressions">表情</option></StudioSelect>
    </label>
    <label className="number-field">语义通道
      <StudioSelect aria-label="语义通道" disabled={disabled} value={role} onChange={(event) => setRole(event.target.value)}>
        {(kind === 'bones' ? boneRoles : expressionRoles).map((id) => <option key={id} value={id}>{controls.find((control) => control.id === id)?.label ?? id}</option>)}
      </StudioSelect>
    </label>
    <label className="number-field">模型原通道
      <StudioSelect aria-label="模型原通道" disabled={disabled} value={mapping?.[kind]?.[role] ?? ''} onChange={(event) => {
        const values = { ...mapping?.[kind] };
        if (event.target.value) values[role] = event.target.value;
        else delete values[role];
        update({ ...mapping, [kind]: values });
      }}><option value="">自动 · {controls.find((control) => control.id === role)?.source ?? '未识别'}</option>
        {sources.map((source) => <option value={source} key={source}>{source}</option>)}</StudioSelect>
    </label>
  </details>;
}
