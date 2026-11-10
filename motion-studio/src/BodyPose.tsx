import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Quaternion, Vector3 } from 'three';
import type { Pose, Vec3 } from './motion/types.ts';
import type { RigControl } from './model-rig.ts';
import './body-pose.css';

const width = 184;
const height = 244;
const center = width / 2;
type Joint = { id: string; x: number; y: number; parent?: string };
const joints: Joint[] = [
  { id: 'root', x: center, y: 229 },
  { id: 'hips', x: center, y: 130, parent: 'root' },
  { id: 'spine', x: center, y: 110, parent: 'hips' },
  { id: 'chest', x: center, y: 91, parent: 'spine' },
  { id: 'upperChest', x: center, y: 72, parent: 'chest' },
  { id: 'neck', x: center, y: 52, parent: 'upperChest' },
  { id: 'head', x: center, y: 29, parent: 'neck' },
];
const centralJoints = new Set(joints.map(({ id }) => id));
const sides = [['right', -1], ['left', 1]] as const;
for (const [side, direction] of sides) {
  const joint = (part: string, offset: number, y: number, parent: string) => ({ id: side + part, x: center + offset * direction, y, parent });
  joints.push(
    joint('Shoulder', 17, 69, 'upperChest'), joint('UpperArm', 34, 78, side + 'Shoulder'),
    joint('LowerArm', 45, 109, side + 'UpperArm'), joint('Hand', 56, 143, side + 'LowerArm'),
    joint('UpperLeg', 16, 136, 'hips'), joint('LowerLeg', 19, 174, side + 'UpperLeg'),
    joint('Foot', 21, 209, side + 'LowerLeg'), joint('ToeBase', 37, 217, side + 'Foot'),
  );
}
const definitions = new Map(joints.map((joint) => [joint.id, joint]));
const limbSegments = [
  ['Shoulder', 'UpperArm', 4, 7], ['UpperArm', 'LowerArm', 6.8, 4.7], ['LowerArm', 'Hand', 5, 3.3],
  ['UpperLeg', 'LowerLeg', 8.1, 5.1], ['LowerLeg', 'Foot', 5.5, 3.8],
] as const;

type Point = { x: number; y: number };
const coordinate = (point: Point) => `${point.x} ${point.y}`;

function taperedSegment(start: Point, end: Point, startWidth: number, endWidth: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.1) return '';
  const offset = (point: Point, width: number) => coordinate({ x: point.x - dy / length * width, y: point.y + dx / length * width });
  return `M${offset(start, startWidth)} L${offset(end, endWidth)} Q${coordinate(end)} ${offset(end, -endWidth)}
    L${offset(start, -startWidth)} Q${coordinate(start)} ${offset(start, startWidth)}Z`;
}

function diagramPose(rotations: Pose['rotations'], controls: ReadonlyMap<string, RigControl>) {
  const transforms = new Map<string, { point: Vector3; rotation: Quaternion }>();
  for (const joint of joints) {
    const reference = joint.parent ? definitions.get(joint.parent) : undefined;
    const parent = reference ? transforms.get(reference.id) : undefined;
    const point = new Vector3(joint.x, -joint.y, 0);
    if (reference && parent) {
      point.sub(new Vector3(reference.x, -reference.y, 0)).applyQuaternion(parent.rotation).add(parent.point);
    }
    const rotation = parent?.rotation.clone() ?? new Quaternion();
    if (controls.has(joint.id) && rotations[joint.id]) rotation.multiply(new Quaternion().fromArray(rotations[joint.id]));
    transforms.set(joint.id, { point, rotation });
  }
  return transforms;
}

interface Drag {
  id: string;
  pointer: number;
  x: number;
  y: number;
  start: Vec3;
  last: Vec3;
  ik?: boolean;
  unitsPerPixel?: number;
}

const angle = (value: number) => Math.max(-180, Math.min(180, Math.round(value)));
const arrowStep: Partial<Record<string, [axis: 0 | 2, change: number]>> = {
  ArrowLeft: [2, 5], ArrowRight: [2, -5], ArrowUp: [0, 5], ArrowDown: [0, -5],
};

export interface BodyPoseProps {
  bones: RigControl[];
  selected: string;
  rotations: Pose['rotations'];
  getGuide: () => Record<string, [number, number]> | null;
  onOrbit: (dx: number, dy: number) => void;
  onIKStart: (id: string) => boolean;
  onIKMove: (dx: number, dy: number) => void;
  onIKEnd: () => void;
  disabled: boolean;
  onSelect: (id: string) => void;
  angles: (id: string) => Vec3;
  onRotate: (id: string, value: Vec3, gesture: boolean) => void;
  onGestureStart: (pointer: number) => void;
  onGestureEnd: (pointer: number) => void;
}

export function BodyPose({ bones, selected, rotations, getGuide, onOrbit, onIKStart, onIKMove, onIKEnd, disabled, onSelect, angles, onRotate, onGestureStart, onGestureEnd }: BodyPoseProps) {
  const drag = useRef<Drag | null>(null);
  const [ik, setIK] = useState(true);
  const [ikNotice, setIKNotice] = useState('');
  const orbit = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const readGuide = useRef(getGuide);
  readGuide.current = getGuide;
  const [guide, setGuide] = useState<Record<string, [number, number]> | null>(null);
  useEffect(() => {
    let request = 0;
    let previous = '';
    let lastSample = 0;
    const tick = (now: number) => {
      if (now - lastSample >= 32) {
        lastSample = now;
        const points = readGuide.current();
        const key = points ? joints.map(({ id }) => points[id]?.map((n) => Math.round(n * 1000)).join(',') ?? '').join(';') : '';
        if (key !== previous) { previous = key; setGuide(points); }
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, []);
  const controls = new Map(bones.map((bone) => [bone.id, bone]));
  const visible = joints.filter(({ id }) => controls.has(id));
  const transforms = diagramPose(rotations, controls);
  const real = visible.filter(({ id }) => id !== 'root' && guide?.[id]);
  let guideFit = 0;
  if (real.length >= 3 && guide) {
    const xs = real.map(({ id }) => guide[id][0]);
    const ys = real.map(({ id }) => guide[id][1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const fit = Math.min((width - 40) / Math.max(0.001, maxX - minX), (height - 62) / Math.max(0.001, maxY - minY));
    guideFit = fit;
    for (const { id } of real) {
      const [x, y] = guide[id];
      transforms.get(id)!.point.set(center + (x - (minX + maxX) / 2) * fit,
        -(height / 2 - (y - (minY + maxY) / 2) * fit), 0);
    }
  }
  // Shrink a posed guide only if a rotated limb would leave the card.
  const scale = Math.min(1, ...visible.map(({ id }) => {
    const point = transforms.get(id)!.point;
    return Math.min((center - 14) / Math.max(1, Math.abs(point.x - center)),
      (height / 2 - 14) / Math.max(1, Math.abs(-point.y - height / 2)));
  }));
  const pointOf = (id: string, x = 0, y = 0) => {
    const { point, rotation } = transforms.get(id)!;
    const projected = x || y ? new Vector3(x, -y, 0).applyQuaternion(rotation).add(point) : point;
    return { x: center + (projected.x - center) * scale, y: height / 2 + (-projected.y - height / 2) * scale };
  };
  const at = (id: string, x: number, y: number) => coordinate(pointOf(id, x, y));
  const head = (x: number, y: number) => at('head', x, y);
  const hasTorso = ['upperChest', 'chest', 'spine', 'hips'].every((id) => controls.has(id));
  const selectedControl = controls.get(selected);

  function begin(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary || disabled || drag.current) return;
    const start = angles(id);
    const canvas = event.currentTarget.closest('.body-pose-canvas')?.getBoundingClientRect();
    const endpoint = ik && /^(left|right)(Hand|Foot)$/.test(id);
    if (endpoint && (!guideFit || !canvas?.width)) {
      setIKNotice('正在读取骨骼位置，请稍后再拖动。'); onSelect(id); return;
    }
    const isIK = endpoint && onIKStart(id);
    if (endpoint && !isIK) {
      setIKNotice('无法使用 IK。请退出参考姿态，并确认该手脚的上下两段骨骼已识别。'); onSelect(id); return;
    }
    setIKNotice('');
    drag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, start, last: start,
      ik: isIK, unitsPerPixel: isIK ? width / (canvas!.width * guideFit * scale) : undefined };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(id);
    onGestureStart(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || disabled) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.start === current.last && Math.hypot(dx, dy) < 3) return;
    if (current.ik) {
      current.last = [...current.start];
      onIKMove(dx * current.unitsPerPixel!, -dy * current.unitsPerPixel!);
      return;
    }
    const next: Vec3 = [dy === 0 ? current.start[0] : angle(current.start[0] - dy * 0.8), current.start[1],
      dx === 0 ? current.start[2] : angle(current.start[2] - dx * 0.8)];
    if (next.every((value, index) => value === current.last[index])) return;
    current.last = next;
    onRotate(current.id, next, true);
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    if (drag.current.ik) onIKEnd();
    drag.current = null;
    onGestureEnd(event.pointerId);
  }

  return <section className="body-pose" aria-label="身体姿势图" data-control-disabled={disabled} data-ik-ready={guideFit > 0}>
    <div className="body-pose-heading"><strong>身体姿势</strong>
      {selectedControl && <span className="body-pose-selection" title={`当前关节 ${selectedControl.source}`}>{selectedControl.label}</span>}
    </div>
    <div className="body-pose-modes" role="group" aria-label="姿势操控方式">
      <button type="button" aria-pressed={ik} onClick={() => { setIK(true); setIKNotice(''); }}>手脚 IK</button>
      <button type="button" aria-pressed={!ik} onClick={() => { setIK(false); setIKNotice(''); }}>关节旋转</button>
    </div>
    {visible.length ? <>
      <div className="body-pose-canvas" style={{ touchAction: 'none' }} onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || (event.target instanceof Element && event.target.closest('button'))) return;
        orbit.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const current = orbit.current;
        if (!current || current.pointer !== event.pointerId) return;
        onOrbit(event.clientX - current.x, event.clientY - current.y);
        current.x = event.clientX;
        current.y = event.clientY;
      }} onPointerUp={(event) => { if (orbit.current?.pointer === event.pointerId) orbit.current = null; }}
      onPointerCancel={(event) => { if (orbit.current?.pointer === event.pointerId) orbit.current = null; }}>
        <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <path className="body-pose-grid" d="M92 16v214 M20 72h144 M20 130h144 M20 174h144 M20 217h144" />
          <text x="14" y="19">右</text><text x="170" y="19" textAnchor="end">左</text>
          {controls.has('head') && <>
            <path className="body-pose-figure" d={`M${head(0, -16)} C${head(-10, -16)} ${head(-14, -9)} ${head(-13, 2)}
              C${head(-12, 10)} ${head(-6, 16)} ${head(0, 17)} C${head(6, 16)} ${head(12, 10)} ${head(13, 2)}
              C${head(14, -9)} ${head(10, -16)} ${head(0, -16)}Z`} />
            <path className="body-pose-detail" d={`M${head(-8, -3)} Q${head(0, -5)} ${head(8, -3)} M${head(0, -11)} L${head(0, 10)}`} />
          </>}
          {controls.has('head') && controls.has('neck') && <path className="body-pose-figure" d={taperedSegment(pointOf('head', 0, 15), pointOf('neck'), 4 * scale, 5 * scale)} />}
          {hasTorso && <>
            <path className="body-pose-figure" d={`M${at('upperChest', -22, -4)} Q${at('upperChest', 0, -10)} ${at('upperChest', 22, -4)}
              C${at('chest', 22, -8)} ${at('chest', 19, 7)} ${at('spine', 12, -3)} Q${at('spine', 0, 4)} ${at('spine', -12, -3)}
              C${at('chest', -19, 7)} ${at('chest', -22, -8)} ${at('upperChest', -22, -4)}Z`} />
            <path className="body-pose-figure" d={`M${at('spine', -12, 0)} Q${at('hips', -14, -9)} ${at('hips', -20, 1)}
              Q${at('hips', -13, 12)} ${at('hips', 0, 15)} Q${at('hips', 13, 12)} ${at('hips', 20, 1)}
              Q${at('hips', 14, -9)} ${at('spine', 12, 0)} Q${at('spine', 0, 6)} ${at('spine', -12, 0)}Z`} />
            <path className="body-pose-detail" d={`M${at('chest', -15, -4)} Q${at('chest', 0, 4)} ${at('chest', 15, -4)}
              M${at('hips', -13, 1)} Q${at('hips', 0, 7)} ${at('hips', 13, 1)}`} />
          </>}
          {sides.map(([side, direction]) => {
            const hand = (x: number, y: number) => at(`${side}Hand`, x * direction, y);
            const foot = (x: number, y: number) => at(`${side}Foot`, x * direction, y);
            const toe = (x: number, y: number) => at(`${side}ToeBase`, x * direction, y);
            return <g key={side}>
              {limbSegments.map(([from, to, start, end]) => controls.has(side + from) && controls.has(side + to) &&
                <path key={from} className="body-pose-figure" d={taperedSegment(pointOf(side + from), pointOf(side + to), start * scale, end * scale)} />)}
              {controls.has(`${side}Hand`) && <path className="body-pose-figure" d={`M${hand(-3, 0)} Q${hand(2, -3)} ${hand(4, 0)}
                L${hand(9, 9)} Q${hand(11, 13)} ${hand(7, 15)} Q${hand(2, 13)} ${hand(0, 8)} L${hand(-3, 5)}Z`} />}
              {controls.has(`${side}Foot`) && controls.has(`${side}ToeBase`) && <path className="body-pose-figure" d={`M${foot(-4, -2)}
                Q${foot(4, -2)} ${toe(0, -5)} Q${toe(7, -4)} ${toe(6, 1)} Q${toe(4, 5)} ${foot(-2, 5)}Z`} />}
            </g>;
          })}
          {visible.map(({ id, parent }) => {
            let fromId = parent;
            while (fromId && !controls.has(fromId)) fromId = definitions.get(fromId)?.parent;
            if (!fromId || fromId === 'root') return null;
            const from = pointOf(fromId);
            const to = pointOf(id);
            return <line key={id} className={fromId === selected || id === selected ? 'body-pose-link active' : 'body-pose-link'}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })}
        </svg>
        {visible.map(({ id }) => {
          const bone = controls.get(id)!;
          const point = pointOf(id);
          return <button key={id} type="button" className="body-pose-joint" data-joint={id}
            data-area={centralJoints.has(id) ? 'center' : 'limb'}
            data-ik-endpoint={ik && /^(left|right)(Hand|Foot)$/.test(id)}
            aria-label={`图上选择${bone.label}`} aria-pressed={selected === id} title={bone.label}
            style={{ left: `${point.x / width * 100}%`, top: `${point.y / height * 100}%` }}
            onClick={() => onSelect(id)} onPointerDown={(event) => begin(event, id)} onPointerMove={move}
            onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
            onKeyDown={(event) => {
              const step = arrowStep[event.key];
              if (!step || disabled) return;
              event.preventDefault();
              const [axis, change] = step;
              const next: Vec3 = [...angles(id)];
              next[axis] = angle(next[axis] + change);
              onSelect(id);
              onRotate(id, next, false);
            }} />;
        })}
      </div>
      <p role={ikNotice ? 'status' : undefined}>{ikNotice || (disabled ? '拖空白旋转视角 · 暂停后可调整关节' : ik ? '拖手脚带动肢体 · 拖其他关节旋转' : '拖空白旋转视角 · 拖关节调整姿势')}</p>
    </> : <p>当前模型暂无可绘制的人体关节，可在关节列表中选择原始骨骼。</p>}
  </section>;
}
