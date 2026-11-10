import { StudioSelect } from './StudioSelect.tsx';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { ChevronFirst, ChevronLast, CirclePlus, Clipboard, Copy, Eye, EyeOff, Lock, LockOpen, Pause, Play, Repeat2, Scissors, Trash2 } from 'lucide-react';
import { channelAllowed, clipDuration, getModule } from './motion/index.ts';
import type { Clip, Project, Track } from './motion/index.ts';
import { timecode } from './session.tsx';
import type { useTransport } from './session.tsx';

type Move = { id: string; track: string; start: number };
type Drag = { x: number; initial: Move[]; preview: Move[]; trim?: Clip; stretch?: number; guide?: number };
const regionNames: Record<string, string> = {
  all: '全身', root: '根节点', body: '躯干', lowerBody: '下半身', upperBody: '上半身',
  head: '头颈', leftArm: '左臂', rightArm: '右臂', eyes: '眼部', brows: '眉部', mouth: '口型',
  face: '表情', lookAt: '视线', physics: '物理', audio: '音频',
};
export const regionLabel = (region: string) => regionNames[region] ?? region;

export function Timeline({ project, transport, selected, activeTrack, setActiveTrack, select, addModule, updateTrack, addTrack, moveClips, editClip, copy, paste, split, remove, duration, recording, disabled, hasClipboard, trackRegions }: {
  project: Project;
  transport: ReturnType<typeof useTransport>;
  selected: string[];
  activeTrack: string;
  setActiveTrack: (id: string) => void;
  select: (ids: string[]) => void;
  addModule: (id: string, trackId?: string, start?: number) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  addTrack: (region: Track['region']) => void;
  moveClips: (moves: Move[]) => void;
  editClip: (id: string, patch: Partial<Clip>) => void;
  copy: () => void;
  paste: () => void;
  split: () => void;
  remove: () => void;
  duration: number;
  recording: boolean;
  disabled: boolean;
  hasClipboard: boolean;
  trackRegions: Track['region'][];
}) {
  const [pixels, setPixels] = useState(104);
  const [snap, setSnap] = useState(true);
  const [adding, setAdding] = useState(false);
  const [inserting, setInserting] = useState<{ track: string; frame: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [visibleWidth, setVisibleWidth] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const currentDrag = useRef<Drag | null>(null);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const update = () => setVisibleWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fps = project.fps;
  const lastSecond = Math.max(12, Math.ceil(visibleWidth / pixels) + 1, Math.ceil(duration + 2), Math.ceil(transport.time + 1));
  const width = lastSecond * pixels;
  const canEditSelected = project.tracks.some((track) => !track.locked && track.clips.some((clip) => selected.includes(clip.id)));
  const availableForTrack = (track: Track) => project.modules.filter(item =>
    (!item.modelId || item.modelId === project.modelId) && (track.region === 'all' || item.region === track.region
      || item.kind === 'keyframes' && item.channels.some(channel => channelAllowed(track.region, channel))));
  function snapFrame(frame: number, edges = true, excluded = selected): { frame: number; guide?: number } {
    const rounded = Math.max(0, Math.round(frame));
    if (!snap || !edges) return { frame: rounded };
    const max = 7 / pixels * fps;
    const bounds = project.tracks.flatMap((track) => track.clips.filter((clip) => !excluded.includes(clip.id))
      .flatMap((clip) => [clip.start, clip.start + Math.round(clipDuration(clip) * fps)]));
    const nearest = [0, Math.round(transport.time * fps), ...bounds]
      .reduce((best, point) => Math.abs(point - frame) < Math.abs(best - frame) ? point : best, frame + max);
    return Math.abs(nearest - frame) < max ? { frame: nearest, guide: nearest } : { frame: rounded };
  }
  function begin(event: PointerEvent<HTMLButtonElement>, clip: Clip, track: Track, trim = false) {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    const multi = event.shiftKey || event.ctrlKey || event.metaKey;
    const ids = multi ? selected.includes(clip.id) ? selected.filter((id) => id !== clip.id) : [...selected, clip.id] :
      selected.includes(clip.id) ? selected : [clip.id];
    setActiveTrack(track.id);
    select(ids);
    if (track.locked || multi) return;
    const initial = project.tracks.filter((item) => !item.locked).flatMap((item) => item.clips
      .filter((entry) => ids.includes(entry.id)).map((entry) => ({ id: entry.id, track: item.id, start: entry.start })));
    const next = { x: event.clientX, initial, preview: initial, trim: trim ? clip : undefined };
    currentDrag.current = next;
    setDrag(next);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const state = currentDrag.current;
    if (!state || Math.abs(event.clientX - state.x) < 2 && !state.stretch && state.preview === state.initial) return;
    const delta = (event.clientX - state.x) / pixels * fps;
    const excluded = state.initial.map(({ id }) => id);
    if (state.trim) {
      const end = snapFrame(state.trim.start + clipDuration(state.trim) * fps + delta, true, excluded);
      currentDrag.current = { ...state, stretch: Math.max(1, end.frame - state.trim.start) / fps, guide: end.guide };
    } else {
      const original = state.initial.find((item) => item.id === event.currentTarget.dataset.clip);
      if (!original) return;
      const clip = project.tracks.flatMap((track) => track.clips).find((item) => item.id === original.id);
      const length = clip ? Math.round(clipDuration(clip) * fps) : 0;
      const startSnap = snapFrame(original.start + delta, true, excluded);
      const endSnap = snapFrame(original.start + delta + length, true, excluded);
      const startDistance = startSnap.guide === undefined ? Infinity : Math.abs(startSnap.guide - original.start - delta);
      const endDistance = endSnap.guide === undefined ? Infinity : Math.abs(endSnap.guide - original.start - delta - length);
      const useEnd = endDistance < startDistance;
      const desired = useEnd ? endSnap.frame - length : startSnap.frame;
      const shift = Math.max(-Math.min(...state.initial.map((item) => item.start)), desired - original.start);
      const over = document.elementsFromPoint(event.clientX, event.clientY)
        .find((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.track)?.dataset.track;
      const destination = project.tracks.find((item) => item.id === over && !item.locked);
      const preview = state.initial.map((item) => ({
        ...item, start: item.start + shift, track: state.initial.length === 1 && destination ? destination.id : item.track,
      }));
      const guide = useEnd ? endSnap.guide : startSnap.guide;
      currentDrag.current = { ...state, preview, guide: shift === desired - original.start ? guide : undefined };
    }
    setDrag(currentDrag.current);
  }
  function end(commit: boolean) {
    const state = currentDrag.current;
    currentDrag.current = null;
    setDrag(null);
    if (!commit || !state) return;
    if (state.trim && state.stretch !== undefined) {
      const portion = state.trim.window ? state.trim.window.to - state.trim.window.from : 1;
      editClip(state.trim.id, { stretch: state.stretch / portion });
    }
    else if (state.preview !== state.initial) moveClips(state.preview);
  }
  function seek(event: PointerEvent<HTMLDivElement>) {
    if (recording || (event.type === 'pointermove' && !event.currentTarget.hasPointerCapture(event.pointerId))) return;
    if (event.type === 'pointerdown' && event.button !== 0) return;
    if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId);
    transport.setPlaying(false);
    transport.seek(snapFrame((event.clientX - event.currentTarget.getBoundingClientRect().left) / pixels * fps, false).frame / fps);
  }
  return <section className="timeline" aria-label="时间线">
    <div className="timeline-toolbar">
      <div className="transport">
        <button title="回到起点" aria-label="回到起点" disabled={recording} onClick={() => { transport.setPlaying(false); transport.seek(0); }}><ChevronFirst size={17} /></button>
        <button className="play-button" title={transport.playing ? '暂停' : '播放'} aria-label={transport.playing ? '暂停' : '播放'} disabled={recording || duration <= 0} onClick={transport.toggle}>{transport.playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button title="跳到末尾" aria-label="跳到末尾" disabled={recording} onClick={() => { transport.setPlaying(false); transport.seek(duration); }}><ChevronLast size={17} /></button>
        <button title="循环预览" aria-label="循环预览" aria-pressed={transport.loop} onClick={() => transport.setLoop(!transport.loop)}><Repeat2 size={16} /></button>
        <output>{timecode(transport.time, fps)} <span>/ {timecode(duration, fps)}</span></output>
      </div>
      <div className="timeline-tools">
        <button title="复制片段" aria-label="复制片段" disabled={!selected.length || disabled} onClick={copy}><Copy size={15} /></button>
        <button title="粘贴到播放头" aria-label="粘贴到播放头" disabled={!hasClipboard || disabled} onClick={paste}><Clipboard size={15} /></button>
        <button title="在播放头分割" aria-label="在播放头分割" disabled={!canEditSelected || disabled} onClick={split}><Scissors size={15} /></button>
        <button title="删除选中片段" aria-label="删除选中片段" disabled={!canEditSelected || disabled} onClick={remove}><Trash2 size={15} /></button>
        <label className="snap"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> 吸附</label>
        <input className="zoom" type="range" aria-label="时间线缩放" min="44" max="220" value={pixels} onChange={(event) => setPixels(event.target.valueAsNumber)} />
      </div>
    </div>
    <div className="timeline-scroll" ref={scroll}>
      <div className="timeline-content" style={{ '--timeline-width': `${width}px`, '--second': `${pixels}px` } as React.CSSProperties}>
        <div className="track-head add-track">
          {adding ? <StudioSelect aria-label="新轨道区域" value="" autoFocus onBlur={() => setAdding(false)} onChange={(event) => {
            addTrack(event.target.value as Track['region']);
            setAdding(false);
          }}><option value="" disabled>选择身体区域</option>{trackRegions.map((region) => <option key={region} value={region}>{regionLabel(region)}</option>)}</StudioSelect>
            : <button disabled={disabled} onClick={() => setAdding(true)}><CirclePlus size={15} /> 新建轨道</button>}
        </div>
        <div className="ruler" onPointerDown={seek} onPointerMove={seek}>
          {Array.from({ length: Math.min(lastSecond, 3600) }, (_, second) =>
            <span key={second} style={{ left: second * pixels }}>{second}s</span>)}
        </div>
        {project.tracks.map((track) => <div className="timeline-row" key={track.id}>
          <div className={`track-head ${activeTrack === track.id ? 'active' : ''}`}>
            <button className="track-name" title={track.name} onClick={() => setActiveTrack(track.id)}>
              <i className={`region-mark region-${track.region}`} /> <span>{track.name}</span>
            </button>
            <button title="静音轨道" aria-label={`静音 ${track.name}`} aria-pressed={track.muted} disabled={disabled} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            <button title="独奏轨道" aria-label={`独奏 ${track.name}`} aria-pressed={track.solo} disabled={disabled} onClick={() => updateTrack(track.id, { solo: !track.solo })}>S</button>
            <button title="锁定轨道" aria-label={`锁定 ${track.name}`} aria-pressed={track.locked} disabled={disabled} onClick={() => updateTrack(track.id, { locked: !track.locked })}>{track.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
          </div>
          <div data-track={track.id} className={`track-lane ${track.muted ? 'is-muted' : ''} ${inserting?.track === track.id ? 'is-inserting' : ''}`}
            onPointerDown={(event) => { if (!recording) { setActiveTrack(track.id); select([]); seek(event); } }} onPointerMove={seek}
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget || disabled || recording || track.locked) return;
              event.preventDefault();
              const frame=snapFrame((event.clientX-event.currentTarget.getBoundingClientRect().left)/pixels*fps).frame;
              setInserting({track:track.id,frame});
            }}
            onDragOver={(event) => { if (!disabled && !track.locked && event.dataTransfer.types.includes('application/yukino-module')) event.preventDefault(); }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData('application/yukino-module');
              if (id && !disabled && !track.locked) addModule(id, track.id, snapFrame((event.clientX - event.currentTarget.getBoundingClientRect().left) / pixels * fps).frame);
            }}>
            {inserting?.track === track.id && <div className="timeline-insert" style={{left:inserting.frame/fps*pixels}} onPointerDown={event=>event.stopPropagation()}>
              <StudioSelect aria-label="在此处插入动作" value="" autoFocus onBlur={()=>setInserting(null)} onChange={event=>{
                if(event.target.value) addModule(event.target.value,track.id,inserting.frame);setInserting(null);
              }}>
                <option value="" disabled>选择已加入工程的动作</option>
                {availableForTrack(track).length===0 && <option value="none" disabled>先从动作资源加入工程</option>}
                {availableForTrack(track).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}
              </StudioSelect>
            </div>}
            {track.clips.map((clip) => {
              const module = getModule(project, clip.moduleId);
              const moved = drag?.preview.find((item) => item.id === clip.id);
              const start = moved?.start ?? clip.start;
              const rowOffset = moved ? project.tracks.findIndex((item) => item.id === moved.track) - project.tracks.indexOf(track) : 0;
              const length = drag?.trim?.id === clip.id ? drag?.stretch ?? clipDuration(clip) : clipDuration(clip);
              return <div key={clip.id} className={`clip region-${track.region} ${selected.includes(clip.id) ? 'chosen' : ''}`}
                style={{ left: start / fps * pixels, width: Math.max(9, length * pixels), top: 3 + rowOffset * 33 }}>
                <button data-clip={clip.id} className="clip-label" title={module?.name} onPointerDown={(event) => begin(event, clip, track)}
                  onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)}
                  onClick={(event) => { if (event.detail === 0) { setActiveTrack(track.id); select([clip.id]); } }}>
                  {module?.name ?? '未知模块'}
                </button>
                {!track.locked && <button className="clip-trim" title="拖动改变片段时长" aria-label="拖动改变片段时长" onPointerDown={(event) => begin(event, clip, track, true)}
                  onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)} />}
              </div>;
            })}
          </div>
        </div>)}
        <div className="playhead" style={{ left: `calc(var(--track-label) + ${transport.time * pixels}px)` }} />
        {drag?.guide !== undefined && <div className="snap-guide" aria-label="对齐参考线" style={{ left: `calc(var(--track-label) + ${drag.guide / fps * pixels}px)` }} />}
      </div>
    </div>
  </section>;
}
