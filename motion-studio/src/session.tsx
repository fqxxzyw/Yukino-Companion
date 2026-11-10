import { StudioSelect } from './StudioSelect.tsx';
import { useEffect, useRef, useState } from 'react';
import { Aperture, Box, Eye, Focus, Scan, Rotate3d, Sun } from 'lucide-react';
import { Viewport } from './viewport.ts';
import type { RigInfo } from './viewport.ts';
import type { Pose, Project } from './motion/index.ts';
import type { ModelSource } from './local-model.ts';
import { lightingPresets } from './lighting.ts';
import type { LightingPreset } from './lighting.ts';

export function useTransport(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const clock = useRef(0);
  const seek = (seconds: number) => {
    clock.current = Math.max(0, seconds);
    setTime(clock.current);
  };
  useEffect(() => {
    if (!playing || duration <= 0) return;
    let previous = performance.now();
    let request = 0;
    function tick(now: number) {
      const next = clock.current + (now - previous) / 1000;
      previous = now;
      if (next >= duration && !loop) {
        seek(duration);
        setPlaying(false);
        return;
      }
      seek(next >= duration ? next % duration : next);
      request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [duration, playing, loop]);
  function toggle() {
    if (!playing && duration <= 0) return;
    if (!playing && clock.current >= duration - 0.0001) seek(0);
    setPlaying(!playing);
  }
  return { time, seek, playing, setPlaying, toggle, loop, setLoop };
}

export function useViewport(onSelect?: (id: string) => void) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const latestSelection = useRef(onSelect);
  latestSelection.current = onSelect;
  const [rig, setRig] = useState<RigInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    if (!host.current) return;
    try {
      viewport.current = new Viewport(host.current, (id) => latestSelection.current?.(id));
      if (new URLSearchParams(location.search).get('qa') === '1') {
        Object.assign(window, { motionSnapshot: () => viewport.current?.snapshot() });
      }
    } catch (reason) {
      setError(messageOf(reason));
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, []);
  async function load(source: string | ModelSource, mapping?: NonNullable<Project['mappings']>[string], transactional = false) {
    if (!viewport.current) {
      if (typeof source !== 'string') source.release?.();
      if (transactional) throw new Error('三维视窗无法启动，请检查 WebGL 2 支持。');
      return null;
    }
    const token = ++requestId.current;
    setLoading(true);
    if (!transactional) {
      setError('');
      setRig(null);
    }
    try {
      const result = typeof source === 'string' ? await viewport.current.load(source, mapping) : await viewport.current.loadSource(source, mapping);
      if (token === requestId.current) {
        setRig(result);
        setError('');
      }
      return result;
    } catch (reason) {
      if (transactional) throw reason;
      if (token === requestId.current) setError(messageOf(reason));
      return null;
    } finally {
      if (typeof source !== 'string') source.release?.();
      if (token === requestId.current) setLoading(false);
    }
  }
  function clear(reason = '') {
    requestId.current += 1;
    viewport.current?.unload();
    setRig(null);
    setLoading(false);
    setError(reason);
  }
  return { host, viewport, rig, loading, error, load, clear };
}

export type ViewSession = ReturnType<typeof useViewport>;

export function Stage({ session, pose, time, simulationTime, simulationPlaying = false, selected, extra, emptyMessage }: {
  session: ViewSession;
  pose: Pose;
  time: string;
  simulationTime?: number;
  simulationPlaying?: boolean;
  selected?: string;
  extra?: React.ReactNode;
  emptyMessage?: string;
}) {
  const [skeleton, setSkeleton] = useState(false);
  const [axes, setAxes] = useState(false);
  const [reference, setReference] = useState(false);
  const [lighting, setLighting] = useState<LightingPreset>('studio');
  const { viewport, rig, host, error, loading } = session;
  useEffect(() => {
    if (!rig) return;
    viewport.current?.applyPose(pose, simulationTime === undefined ? undefined : { time: simulationTime, playing: simulationPlaying });
  }, [viewport, rig, pose, simulationTime, simulationPlaying]);
  useEffect(() => { viewport.current?.setSkeleton(skeleton); }, [viewport, rig, skeleton]);
  useEffect(() => { viewport.current?.setAxes(axes); }, [viewport, rig, axes]);
  useEffect(() => { viewport.current?.setReference(reference); }, [viewport, rig, reference]);
  useEffect(() => { viewport.current?.setLighting(lighting); }, [viewport, lighting]);
  useEffect(() => { viewport.current?.selectBone(selected ?? null); }, [viewport, rig, selected]);
  return <section className="stage" aria-label="三维预览">
    <div ref={host} className="stage-canvas" />
    <div className="stage-top">
      <span className="stage-caption"><Aperture size={14} /> 三维预览</span>
      <span className="stage-time">{time}</span>
    </div>
    {(error || loading || !rig) && <div className="stage-state" role="status">
      <Box size={25} />
      <strong>{error ? '模型无法载入' : loading ? '正在读取本地模型…' : '等待模型'}</strong>
      {error && <span>{error}</span>}
      {!error && !loading && emptyMessage && <span>{emptyMessage}</span>}
    </div>}
    <div className="stage-bottom">
      <div className="view-tools">
        <label className="view-select"><Rotate3d size={15} /><StudioSelect aria-label="相机视角" defaultValue="full" onChange={(event) => {
          const value = event.target.value as Parameters<Viewport['setView']>[0];
          viewport.current?.setView(value);
        }}>
          <option value="full">全身</option><option value="upper">上半身</option><option value="face">面部</option>
          <option value="front">正面</option><option value="side">侧面</option><option value="back">背面</option>
        </StudioSelect></label>
        <label className="view-select" title="预览灯光"><Sun size={15} /><StudioSelect aria-label="预览灯光" value={lighting}
          onChange={(event) => setLighting(event.target.value as LightingPreset)}>
          {(['室内', '室外'] as const).map((group) => <optgroup key={group} label={group}>
            {(Object.entries(lightingPresets) as [LightingPreset, (typeof lightingPresets)[LightingPreset]][])
              .filter(([, preset]) => preset.group === group).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
          </optgroup>)}
        </StudioSelect></label>
        <button title="适合窗口" aria-label="适合窗口" onClick={() => viewport.current?.setView('fit')}><Scan size={15} /></button>
        <button title="骨架" aria-label="骨架" aria-pressed={skeleton} onClick={() => setSkeleton(!skeleton)}><Box size={15} /></button>
        <button title="局部坐标轴" aria-label="局部坐标轴" aria-pressed={axes} onClick={() => setAxes(!axes)}><Focus size={15} /></button>
        <button title="参考姿态" aria-label="参考姿态" aria-pressed={reference} onClick={() => setReference(!reference)}><Eye size={15} /></button>
      </div>
      {extra}
    </div>
  </section>;
}

export function timecode(seconds: number, fps = 30) {
  const total = Math.max(0, Math.floor(seconds * fps + 1e-6));
  return [Math.floor(total / fps / 60), Math.floor(total / fps) % 60, total % fps]
    .map((unit) => String(unit).padStart(2, '0')).join(':');
}

export function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function download(filename: string, content: string | Blob) {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type: 'application/json' }) : content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
