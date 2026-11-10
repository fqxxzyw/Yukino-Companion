import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEventHandler } from 'react';
import { Diamond, Eye as EyeIcon, EyeOff, RotateCcw, Search, Smile } from 'lucide-react';
import { expressionWeight } from './expressions.ts';
import type { Eye, ExpressionWeights } from './expressions.ts';
import type { RigControl } from './viewport.ts';
import './expression-panel.css';

const eyeRows: { id: Eye; label: string }[] = [
  { id: 'blink', label: '双眼' }, { id: 'blinkLeft', label: '左眼' }, { id: 'blinkRight', label: '右眼' },
];
const groups = [
  { key: 'face', label: '面部表情' }, { key: 'mouth', label: '口型与嘴部' }, { key: 'brows', label: '眉部' },
  { key: 'eyes', label: '眼部细调' }, { key: 'other', label: '其他通道' },
];
const eyeIds = new Set<string>(eyeRows.map(({ id }) => id));

export function ExpressionPanel({ controls, eyes, pose, manual, selected, loading, loaded, error, armed, canKey,
  onSelect, onChange, onRangeStart, follow, keyframe }: {
  controls: RigControl[];
  eyes: Record<Eye, boolean>;
  pose: ExpressionWeights;
  manual: boolean;
  selected: string;
  loading: boolean;
  loaded: boolean;
  error: string;
  armed: boolean;
  canKey: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, value: number, fromRange?: boolean) => void;
  onRangeStart: PointerEventHandler<HTMLInputElement>;
  follow: () => void;
  keyframe: () => void;
}) {
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLElement>(null);
  const filter = query.trim().toLowerCase();
  const available = controls.filter((item) => `${item.label} ${item.source} ${item.id}`.toLowerCase().includes(filter));
  const state = loading ? '正在读取角色表情…' : error ? error : !loaded ? '请先载入角色。' : '此模型未绑定可用表情。';

  // A library selection can be far below the visible inspector, or hidden by
  // a previous inspector search. Reveal it without changing any morph values.
  useLayoutEffect(() => {
    if (!loaded || !selected) return;
    if (filter && !available.some((control) => control.id === selected) && !eyeIds.has(selected)) { setQuery(''); return; }
    const root=panel.current, container=root?.closest('.inspector-scroll');
    const target=Array.from(root?.querySelectorAll<HTMLElement>('[data-expression-id]') ?? []).find((item)=>item.dataset.expressionId===selected);
    if (!target || !container) return;
    const bounds=container.getBoundingClientRect(), row=target.getBoundingClientRect();
    if (row.top<bounds.top || row.bottom>bounds.bottom) container.scrollBy({top:row.top-bounds.top-12,behavior:'auto'});
  }, [selected, filter, loaded]);

  return <section ref={panel} className="expression-panel" aria-label="表情控制">
    <div className="expression-heading"><Smile size={17} /><strong>表情控制</strong>
      <span>{loading ? '准备中' : loaded ? `${controls.length} 个有效通道` : '未就绪'}</span></div>
    {!loaded || !controls.length ? <p className="expression-empty" role="status">{state}</p> : <>
      <section className="eye-controls" aria-label="睁闭眼">
        <h3><EyeIcon size={15} /> 睁闭眼</h3>
        {eyeRows.map(({ id, label }) => {
          const value = expressionWeight(pose, id, controls.find((control) => control.id === id)?.defaultValue);
          return <div className="eye-control-row" data-expression-id={id} key={id}>
            <span>{label}</span>
            {eyes[id] ? <div className="eye-actions">
              <button type="button" aria-label={`睁开${label}`} aria-pressed={value <= 0.001} onClick={() => onChange(id, 0)}>
                <EyeIcon size={13} /> 睁开
              </button>
              <button type="button" aria-label={`闭上${label}`} aria-pressed={value >= 0.999} onClick={() => onChange(id, 1)}>
                <EyeOff size={13} /> 闭上
              </button>
            </div> : <span className="eye-unavailable">缺少{label}闭合通道</span>}
          </div>;
        })}
      </section>
      <div className="expression-actions">
        <button type="button" onClick={follow} disabled={!manual || armed}><RotateCcw size={13} /> 交还时间线</button>
        <button type="button" className="key-button" onClick={keyframe} disabled={!canKey || armed}><Diamond size={13} /> 写入关键帧</button>
      </div>
      <label className="search expression-search"><Search size={14} /><input type="search" aria-label="搜索表情通道"
        placeholder="搜索表情通道" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {available.length === 0 && <p className="expression-empty">没有匹配的表情通道。</p>}
      {groups.map(({ key, label }) => {
        const items = available.filter((control) => {
          const region = eyeIds.has(control.id) || control.region === 'lookAt' ? 'eyes' : control.region;
          return region === key || (key === 'other' && !groups.some((item) => item.key === region));
        });
        if (!items.length) return null;
        return <section className="expression-group" key={key} aria-label={label}>
          <h3>{label}<span>{items.length}</span></h3>
          {items.map((control) => {
            const value = expressionWeight(pose, control.id, control.defaultValue);
            return <label className={`expression-slider ${selected === control.id ? 'selected' : ''}`} data-expression-id={control.id} key={control.id} title={control.source}>
              <span>{control.label}</span>
              <input type="range" aria-label={`${control.label}权重`} min={0} max={1} step={0.01} value={value}
                onFocus={() => onSelect(control.id)} onPointerDown={onRangeStart}
                onChange={(event) => onChange(control.id, event.target.valueAsNumber, true)} />
              <output>{value.toFixed(2)}</output>
            </label>;
          })}
        </section>;
      })}
    </>}
  </section>;
}
