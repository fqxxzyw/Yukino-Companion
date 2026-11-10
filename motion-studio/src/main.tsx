import { StudioSelect } from './StudioSelect.tsx';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Circle, Download, FilePlus2, Film, FolderOpen, Redo2, Save, Square, Undo2 } from 'lucide-react';
import { models } from './viewport.ts';
import { noModelId } from './model-catalog.ts';
import { readLocalModel } from './local-model.ts';
import type { ModelFiles, ModelSource } from './local-model.ts';
import { ProjectDialog } from './ProjectDialog.tsx';
import type { NewProjectSelection } from './ProjectDialog.tsx';
import {
  builtinModules, changeProjectFps, channelAllowed, clipDuration, clipSourceTime, createClip, createExampleProject, createProject, createRecording,
  createTrack, emptyPose, endRecordingStroke, eulerDegreesToQuat, evaluateProject, findConflicts, finishRecording, getModule, projectDuration,
  quatToEulerDegrees, readProject, removeKeyframe, retargetModulePose, sampleRecording, setKeyframe, splitClip, writeProject, writeRuntime,
} from './motion/index.ts';
import type { Clip, MotionModule, Pose, Project, Track, Vec3 } from './motion/index.ts';
import {bakeClips} from './motion/bake-clips.ts';
import {splitBodyClip} from './motion/split-body.ts';
import { ClipPanel, ControlPanel, Library, MappingPanel, TrackPanel } from './Panels.tsx';
import { compatibility } from './compatibility.ts';
import { regionLabel, Timeline } from './Timeline.tsx';
import { Workspace } from './Workspace.tsx';
import { download, messageOf, Stage, timecode, useTransport, useViewport } from './session.tsx';
import { StudioBrand, ThemeButton, WindowControls } from './WindowChrome.tsx';
import type { CompanionModelRequest } from './WindowChrome.tsx';
import { MotionMenu } from './MotionMenu.tsx';
import { ExpressionPanel } from './ExpressionPanel.tsx';
import { TransitionControls } from './TransitionControls.tsx';
import { PartPreview } from './PartPreview.tsx';
import {limitJointAngles,limitJointQuaternion} from './joint-limits.ts';
import { expressionInput, expressionWeight, eyeCapabilities, overlayExpressions } from './expressions.ts';
import { previewTime } from './preview-time.ts';
import './style.css';

const regions: Track['region'][] = ['all', 'root', 'body', 'lowerBody', 'upperBody', 'head', 'leftArm', 'rightArm', 'eyes', 'brows', 'face', 'mouth'];
const initialModel = models[0].id;
const zero: Vec3 = [0, 0, 0];

function Studio() {
  const [project, setProject] = useState(() => createProject(initialModel));
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeTrack, setActiveTrack] = useState('');
  const [tab, setTab] = useState<'library' | 'rig'>('rig');
  const [inspector, setInspector] = useState<'pose' | 'expression' | 'clip' | 'track'>('pose');
  const [joint, setJoint] = useState('head');
  const [notice, setNotice] = useState('');
  const [exportingGlb, setExportingGlb] = useState(false);
  const [workspaceResetRevision, setWorkspaceResetRevision] = useState(0);
  const [manual, setManual] = useState<Pose>(emptyPose);
  const [previewPose, setPreviewPose] = useState<Pose | null>(null);
  const [jointLimitsEnabled, setJointLimitsEnabled] = useState(() => localStorage.getItem('yukino-motion-joint-limits') === 'true');
  const livePose = useRef<Pose>(manual);
  const euler = useRef<Record<string, Vec3>>({});
  const [armed, setArmed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<ReturnType<typeof createRecording> | null>(null);
  const handleKey = useRef<(event: KeyboardEvent) => void>(() => {});
  const recordingPointer = useRef<number | null>(null);
  const clipboard = useRef<{ clip: Clip; trackId: string }[]>([]);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [projectDialog, setProjectDialog] = useState<'new' | 'import' | 'relink' | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const motionInput = useRef<HTMLInputElement>(null);
  const localFiles = useRef(new Map<string, { files: ModelFiles; sha256: string }>());
  const readyProject = useRef<Project | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [companionRequest, setCompanionRequest] = useState<CompanionModelRequest | null>(null);
  const consumedCompanionRequest = useRef(0);

  const duration = projectDuration(project);
  const transport = useTransport(duration);
  const stage = useViewport(selectJoint);
  const rig = stage.rig;
  const rigReady = !!rig && rig.id === project.modelId;
  const mapping = project.mappings?.[project.modelId];
  const expectedHash = project.asset?.sha256;
  const modelChoices = [...models, ...Array.from(new Set([project.modelId, ...localFiles.current.keys()]))
    .filter((id) => id.startsWith('local:')).map((id) => ({ id, label: id.slice(6) }))];
  const modules: MotionModule[] = Array.from(new Map([...builtinModules, ...(rig?.clips ?? []), ...project.modules]
    .map((module) => [module.id, module])).values());
  const selectedClips = project.tracks.flatMap((track) => track.clips.filter((clip) => selected.includes(clip.id)).map((clip) => ({ clip, track })));
  const selectedClip = selectedClips.at(-1);
  const selectedTrack = project.tracks.find((track) => track.id === activeTrack) ?? project.tracks[0];
  const module = selectedClip ? getModule(project, selectedClip.clip.moduleId) : undefined;
  const evaluated = evaluateProject(project, previewTime(transport.time, duration), rigReady ? rig.retarget : undefined);
  const facialControls = rigReady ? rig.expressions.filter((item) => !item.internal) : [];
  const eyes = eyeCapabilities(facialControls);
  const basePose: Pose = {
    rotations: { ...evaluated.rotations, ...manual.rotations },
    translations: { ...evaluated.translations, ...manual.translations },
    expressions: overlayExpressions(evaluated.expressions, manual.expressions, eyes),
  };
  const pose: Pose = {
    rotations: {...basePose.rotations,...previewPose?.rotations},
    translations: {...basePose.translations,...previewPose?.translations},
    expressions: overlayExpressions(evaluated.expressions,{...manual.expressions,...previewPose?.expressions},eyes),
  };
  const face = facialControls.find((control) => control.id === joint) ?? (joint === 'blink' && eyes.blink
    ? { id: 'blink', region: 'eyes' as const, label: '双眼闭合', defaultValue: 0 } : undefined);
  const bone = rig?.bones.find((control) => control.id === joint);
  const conflicts = findConflicts(project, transport.time);
  const currentWarnings = project.tracks.flatMap((track) => track.clips.map((clip) => getModule(project, clip.moduleId)))
    .filter((item): item is MotionModule => !!item)
    .map((item) => ({ name: item.name, warning: compatibility(item, rig) }))
    .filter((item, index, items) => item.warning && items.findIndex((other) => other.name === item.name) === index);

  handleKey.current = hotkey;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handleKey.current(event);
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    const bridge = window.studioWindow;
    if (!bridge?.onCompanionModel || !bridge.getCompanionModelRequest) return;
    let alive = true;
    let latest = 0;
    const accept = (request: CompanionModelRequest | null) => {
      if (alive && request && request.revision > latest) {
        latest = request.revision;
        setCompanionRequest(request);
      }
    };
    const off = bridge.onCompanionModel(accept);
    void bridge.getCompanionModelRequest().then(accept);
    return () => { alive = false; off(); };
  }, []);
  useEffect(() => {
    if (!companionRequest || companionRequest.revision <= consumedCompanionRequest.current) return;
    if (armed) {
      setNotice('录制结束后将切换到 Companion 当前角色。');
      return;
    }
    let current = true;
    void (async () => {
      try {
        const result = await window.studioWindow?.readCompanionModel?.(companionRequest.revision);
        if (!result || !current) return;
        const registered = models.find((item) => item.id === result.id && item.sha256 === result.sha256);
        // Windows filenames cannot contain control characters.
        // eslint-disable-next-line no-control-regex
        const label = result.label.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || 'Companion 模型';
        const id = registered?.id ?? `local:${label}-${result.sha256.slice(0, 12)}.glb`;
        if (projectRef.current.modelId === id && projectRef.current.asset?.sha256 === result.sha256 && stage.rig?.id === id) {
          consumedCompanionRequest.current = companionRequest.revision;
          return;
        }
        const files: ModelFiles = { model: new File([Uint8Array.from(result.data).buffer], `${label}.glb`), dependencies: [] };
        const source = await readLocalModel(files, { id, sha256: result.sha256 });
        if (!current) { source.release?.(); return; }
        const loaded = await stage.load(source, projectRef.current.mappings?.[id], true);
        if (!current || !loaded) return;
        consumedCompanionRequest.current = companionRequest.revision;
        localFiles.current.set(id, { files, sha256: result.sha256 });
        const previous = projectRef.current;
        const next = { ...previous, modelId: id, asset: { name: loaded.asset.filename, path: loaded.asset.path, sha256: loaded.asset.sha256 } };
        readyProject.current = next;
        past.current = [...past.current.slice(-79), previous];
        future.current = [];
        setProject(next);
        transport.setPlaying(false);
        updateManual(emptyPose());
        setTab('rig');
        setInspector('pose');
        setNotice(`已载入 Companion 当前模型 · ${label} · ${loaded.bones.length} 个可控关节`);
      } catch (reason) {
        if (current) {
          consumedCompanionRequest.current = companionRequest.revision;
          setNotice(`无法载入 Companion 当前模型：${messageOf(reason)}`);
        }
      }
    })();
    return () => { current = false; };
  }, [companionRequest, armed]);
  useEffect(() => {
    const alreadyLoaded = readyProject.current === project;
    readyProject.current = null;
    if (alreadyLoaded) return;
    if (project.modelId === noModelId) {
      stage.clear();
      return;
    }
    const cached = localFiles.current.get(project.modelId);
    const files = cached && (!expectedHash || expectedHash === cached.sha256) ? cached.files : undefined;
    if (project.modelId.startsWith('local:') && !files) {
      stage.clear('请定位工程所引用的本地模型。');
      return;
    }
    if (expectedHash && !files && models.find((model) => model.id === project.modelId)?.sha256 !== expectedHash) {
      stage.clear('工程的模型指纹与本机模型目录不一致，请定位原文件。');
      return;
    }
    if (!files) {
      void stage.load(project.modelId, mapping);
      return;
    }
    let current = true;
    void readLocalModel(files, { id: project.modelId, sha256: cached?.sha256 }).then((source) => {
      if (current) return stage.load(source, mapping);
      source.release?.();
    }, (reason) => { if (current) stage.clear(messageOf(reason)); });
    return () => { current = false; };
  }, [project.modelId, mapping, expectedHash]);
  useEffect(() => {
    if (!rig) return;
    if ((joint === 'blink' && eyes.blink) || [...rig.bones, ...rig.expressions].some((item) => item.id === joint && !item.internal)) return;
    setJoint(rig.bones[0]?.id ?? rig.expressions.find((item) => !item.internal)?.id ?? '');
  }, [rig, joint, eyes.blink]);
  useEffect(() => {
    if (!armed) return;
    function endGesture() {
      recordingPointer.current = null;
      if (recorder.current) endRecordingStroke(recorder.current);
    }
    function releasePointer(event: PointerEvent) {
      endControlGesture(event.pointerId);
    }
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', endGesture);
    return () => {
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', endGesture);
    };
  }, [armed]);
  function commit(next: Project) {
    past.current = [...past.current.slice(-79), project];
    future.current = [];
    setProject(next);
  }
  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(project);
    setProject(previous);
    updateManual(emptyPose());
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(project);
    setProject(next);
    updateManual(emptyPose());
  }
  function replace(next: Project) {
    past.current = [];
    future.current = [];
    clipboard.current = [];
    setHasClipboard(false);
    setProject(next);
    setSelected([]);
    setActiveTrack('');
    updateManual(emptyPose());
    transport.setPlaying(false);
    transport.seek((next.playhead ?? 0) / next.fps);
    setTab('rig');
    setInspector('pose');
  }
  function updateManual(next: Pose) {
    if (!Object.keys(next.rotations).length) euler.current = {};
    livePose.current = next;
    setManual(next);
  }
  function selectJoint(id: string) {
    setJoint(id);
    setInspector(facialControls.some((item) => item.id === id) ? 'expression' : 'pose');
    setTab('rig');
  }
  function showExpressions() {
    if (!face) setJoint(facialControls.find(({ id }) => id === 'blink')?.id ?? facialControls[0]?.id ?? joint);
    setInspector('expression');
  }
  function showBody() {
    if (!bone) setJoint(rig?.bones.find(({ id }) => id === 'head')?.id ?? rig?.bones[0]?.id ?? joint);
    setInspector('pose');
  }
  function selectClips(ids: string[]) {
    setSelected(ids);
    if (ids.length) setInspector('clip');
  }
  function addMotion(item: MotionModule, trackId?: string, start = Math.round(transport.time * project.fps)) {
    const target = trackId
      ? project.tracks.find((track) => track.id === trackId)
      : project.tracks.find((track) => track.region === item.region && !track.locked);
    if (target?.locked) return;
    const track = target ?? createTrack(item.region === 'all' ? '动作录制' : regionLabel(item.region), item.region);
    const clip = createClip(item, start);
    const updated = { ...track, clips: [...track.clips, clip] };
    const tracks = target ? project.tracks.map((other) => other.id === target.id ? updated : other) : [...project.tracks, updated];
    const modules = project.modules.some((entry) => entry.id === item.id) ? project.modules : [...project.modules, item];
    commit({ ...project, tracks, modules });
    setActiveTrack(track.id);
    selectClips([clip.id]);
    return clip;
  }
  function updateTrack(id: string, patch: Partial<Track>) {
    commit({ ...project, tracks: project.tracks.map((track) => track.id === id ? { ...track, ...patch } : track) });
  }
  function editClip(id: string, patch: Partial<Clip>) {
    commit({ ...project, tracks: project.tracks.map((track) => track.locked ? track : {
      ...track, clips: track.clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip),
    }) });
  }
  function moveClips(moves: { id: string; track: string; start: number }[]) {
    const moving = project.tracks.filter((track) => !track.locked).flatMap((track) => track.clips)
      .flatMap((clip) => {
        const move = moves.find((item) => item.id === clip.id);
        if (!move || !project.tracks.some((track) => track.id === move.track && !track.locked)) return [];
        return [{ ...move, clip: { ...clip, start: move.start } }];
      });
    if (!moving.length) return;
    commit({ ...project, tracks: project.tracks.map((track) => track.locked ? track : {
      ...track,
      clips: [
        ...track.clips.flatMap((clip) => {
          const move = moving.find((item) => item.id === clip.id);
          return !move ? [clip] : move.track === track.id ? [move.clip] : [];
        }),
        ...moving.filter((item) => item.track === track.id && !track.clips.some((clip) => clip.id === item.id)).map((item) => item.clip),
      ],
    }) });
  }
  function copy() {
    clipboard.current = selectedClips.map(({ clip, track }) => ({ clip, trackId: track.id }));
    setHasClipboard(clipboard.current.length > 0);
  }
  function paste() {
    const entries = clipboard.current.filter(({ clip }) => getModule(project, clip.moduleId));
    if (!entries.length) return;
    const first = Math.min(...entries.map(({ clip }) => clip.start));
    const frame = Math.round(transport.time * project.fps);
    const copies = entries.flatMap(({ clip, trackId }) => {
      const target = project.tracks.find((track) => track.id === trackId && !track.locked)
        ?? (selectedTrack?.locked ? undefined : selectedTrack);
      if (!target) return [];
      return [{ target: target.id, clip: { ...clip, id: crypto.randomUUID(), start: frame + clip.start - first } }];
    });
    if (!copies.length) return;
    commit({ ...project, tracks: project.tracks.map((track) => ({
      ...track, clips: [...track.clips, ...copies.filter((item) => item.target === track.id).map((item) => item.clip)],
    })) });
    selectClips(copies.map((item) => item.clip.id));
  }
  function remove() {
    if (!selectedClips.some(({ track }) => !track.locked)) return;
    commit({ ...project, tracks: project.tracks.map((track) => track.locked ? track : {
      ...track, clips: track.clips.filter((clip) => !selected.includes(clip.id)),
    }) });
    setSelected([]);
  }
  function mergeSelected() {
    try {
      const baked=bakeClips(project,selected,rigReady?rig.retarget:undefined);
      commit(baked.project);selectClips([baked.clipId]);setNotice('已按当前帧率合并为一个动作片段');
    } catch(error) { setNotice(messageOf(error)); }
  }
  async function importMotion(file: File) {
    const initialProject=projectRef.current, viewport=stage.viewport.current;
    if (!rigReady || !viewport) { setNotice('请先载入当前角色模型'); return; }
    try {
      setNotice('正在导入动作…');
      const imported=await viewport.importMotion(file);
      if (projectRef.current.id!==initialProject.id || projectRef.current.modelId!==initialProject.modelId || stage.viewport.current!==viewport) {
        setNotice('工程或模型已切换，请重新导入动作'); return;
      }
      if (!imported.length) { setNotice('动作文件没有可用的动画'); return; }
      const current=projectRef.current;
      commit({...current,modules:[...current.modules,...imported]});setTab('library');setNotice(`已导入 ${imported.length} 个动作，可从动作资源添加到时间线`);
    } catch(error) { setNotice(messageOf(error)); }
  }
  function splitByPart() {
    if (selectedClips.length !== 1) { setNotice('请选择一个片段，再按部位分解'); return; }
    const {clip,track}=selectedClips[0], source=getModule(project,clip.moduleId);
    if (!source || track.locked || track.muted) { setNotice('请先选择未锁定、未静音的有效片段'); return; }
    if (project.tracks.some(item=>item.solo&&!item.muted)) { setNotice('请先关闭轨道独奏，再按部位分解'); return; }
    try {
      const parts=splitBodyClip(source,clip,project.fps,track.region);
      if (!parts.length) { setNotice('这个片段相对首帧没有发生变化的部位'); return; }
      const backup={...createTrack(`${source.name} · 原动作`,'all'),muted:true,clips:[clip]};
      const tracks=project.tracks.map(item=>item.id===track.id?{...item,clips:item.clips.filter(value=>value.id!==clip.id)}:item);
      const individual=parts.map(part=>({...createTrack(part.label,'all'),clips:[part.clip]}));
      commit({...project,modules:[...project.modules,...parts.map(part=>part.module)],tracks:[...tracks,backup,...individual]});
      selectClips(parts.map(part=>part.clip.id));setNotice(`已分解为 ${parts.length} 个变化部位；原动作保存在静音轨道`);
    } catch(error) { setNotice(messageOf(error)); }
  }
  function split() {
    const cut = Math.round(transport.time * project.fps);
    const results = new Map(selectedClips.filter(({ track }) => !track.locked).map(({ clip }) => [clip.id, splitClip(clip, cut, project.fps)]));
    if (![...results.values()].some(Boolean)) { setNotice('把播放头放在选中片段内部再分割'); return; }
    commit({ ...project, tracks: project.tracks.map((track) => ({
      ...track, clips: track.clips.flatMap((clip) => results.get(clip.id) ?? [clip]),
    })) });
    selectClips([...results.values()].flatMap((result) => result?.map((clip) => clip.id) ?? []));
  }
  function applyControl(change: Partial<Pose>, fromRange = false) {
    const current = livePose.current;
    const expressions = { ...current.expressions, ...change.expressions };
    if (change.expressions?.blink !== undefined) {
      delete expressions.blinkLeft;
      delete expressions.blinkRight;
    } else if (change.expressions?.blinkLeft !== undefined || change.expressions?.blinkRight !== undefined) {
      delete expressions.blink;
    }
    updateManual({
      rotations: { ...current.rotations, ...change.rotations },
      translations: { ...current.translations, ...change.translations },
      expressions,
    });
    const recording = recorder.current;
    if (!recording) return;
    const discrete = !fromRange || recordingPointer.current === null;
    if (discrete) endRecordingStroke(recording);
    setElapsed(sampleRecording(recording, change, performance.now()));
    if (discrete) endRecordingStroke(recording);
  }
  function startControlGesture(pointer: number) {
    if (!recorder.current) return;
    endRecordingStroke(recorder.current);
    recordingPointer.current = pointer;
  }
  function endControlGesture(pointer: number) {
    if (recordingPointer.current !== pointer) return;
    recordingPointer.current = null;
    if (recorder.current) endRecordingStroke(recorder.current);
  }
  function jointAngles(id: string): Vec3 {
    return euler.current[id] ?? quatToEulerDegrees(pose.rotations[id] ?? [0, 0, 0, 1]);
  }
  function rotateJoint(id: string, values: Vec3, gesture: boolean) {
    const bounded=jointLimitsEnabled?limitJointAngles(id,values,jointAngles(id)):values;
    euler.current[id] = bounded;
    applyControl({ rotations: { [id]: eulerDegreesToQuat(bounded) } }, gesture);
  }
  function moveIK(dx: number, dy: number) {
    const rotations = stage.viewport.current?.moveIK(dx, dy);
    if (!rotations) return;
    const bounded=Object.fromEntries(Object.entries(rotations).map(([id,value])=>[id,jointLimitsEnabled?limitJointQuaternion(id,value,pose.rotations[id]??[0,0,0,1]):value]));
    for (const id of Object.keys(bounded)) delete euler.current[id];
    applyControl({ rotations: bounded }, true);
  }
  function setAxis(axis: number, value: number, kind: 'rotation' | 'translation') {
    const values: Vec3 = kind === 'rotation' ? [...jointAngles(joint)]
      : [...(pose.translations[joint] ?? zero)];
    values[axis] = value;
    if (kind === 'rotation') rotateJoint(joint, values, true);
    else applyControl({ translations: { [joint]: values } });
  }
  function resetJoint() {
    euler.current[joint] = [0, 0, 0];
    const change: Partial<Pose> = { rotations: { [joint]: [0, 0, 0, 1] } };
    if (joint in livePose.current.translations) change.translations = { [joint]: [...zero] };
    applyControl(change);
  }
  function changeExpression(id: string, value: number, fromRange = false) {
    setJoint(id);
    applyControl({ expressions: expressionInput(id, value, eyes) }, fromRange);
  }
  function clearManualBody() {
    updateManual({ ...emptyPose(), expressions: livePose.current.expressions });
  }
  function startRecording() {
    if (!rigReady || stage.loading) return;
    transport.setPlaying(false);
    recordingPointer.current = null;
    const defaults = Object.fromEntries(facialControls.map(({ id, defaultValue }) => [id, expressionWeight(pose.expressions, id, defaultValue)]));
    const baseline = { ...pose, expressions: { ...defaults, ...pose.expressions } };
    recorder.current = createRecording(`动作录制 ${project.modules.filter((item) => item.name.startsWith('动作录制')).length + 1}`, project.fps, baseline);
    setElapsed(0);
    setArmed(true);
    if (inspector !== 'expression') showBody();
    setTab('rig');
  }
  function stopRecording() {
    if (!recorder.current) return;
    const raw = recorder.current;
    recorder.current = null;
    recordingPointer.current = null;
    setArmed(false);
    const item = finishRecording(raw);
    if (!item) {
      setNotice('这次没有捕捉到关节或表情输入');
      return;
    }
    const native = moduleHasNativeBindings(item);
    addMotion(native ? { ...item, modelId: project.modelId } : { ...item, restDirections: rig?.retarget });
    updateManual(emptyPose());
    setTab('library');
    setNotice(`已录制 ${item.duration.toFixed(2)} 秒，选中片段即可调整速度`);
  }
  function moduleHasNativeBindings(item: Extract<MotionModule, { kind: 'keyframes' }>) {
    return item.channels.some((channel) => channel.key.startsWith('native:'));
  }
  function writeKey() {
    const control = inspector === 'expression' ? face : bone;
    if (!control) return;
    const type = inspector === 'expression' ? 'expression' : 'rotation';
    const value = type === 'expression' ? expressionWeight(pose.expressions, joint, control.defaultValue) : pose.rotations[joint] ?? eulerDegreesToQuat(zero);
    if (!selectedClip || module?.kind !== 'keyframes' || !channelAllowed(selectedClip.track.region, { type, key: joint })) {
      const item: Extract<MotionModule, { kind: 'keyframes' }> = {
        id: crypto.randomUUID(), name: `${control.label}关键帧`, kind: 'keyframes',
        duration: 1, region: control.region, channels: [], version: 1, restDirections: rig?.retarget,
      };
      let next = setKeyframe(item, type, joint, 0, value, 'smooth');
      if (type === 'rotation' && joint in manual.translations) next = setKeyframe(next, 'translation', joint, 0, manual.translations[joint], 'smooth');
      addMotion(moduleHasNativeBindings(next) ? { ...next, modelId: project.modelId } : next);
    } else {
      if (selectedClip.track.locked) return;
      if (module.modelId && module.modelId !== project.modelId) {
        setNotice('请切回此动作绑定的模型再写入关键帧');
        return;
      }
      const localTime = transport.time - selectedClip.clip.start / project.fps;
      const t = clipSourceTime(selectedClip.clip, localTime);
      if (t === undefined || localTime >= clipDuration(selectedClip.clip)) { setNotice('把播放头放到关键帧片段内部'); return; }
      // New keys are entered in the current model's frame; preserve the module's original reference frame.
      const entered = type === 'rotation' && module.restDirections && rig?.retarget
        ? retargetModulePose({ rotations: { [joint]: value as [number, number, number, number] }, translations: {}, expressions: {} },
          { ...module, restDirections: rig.retarget }, t, module.restDirections).rotations[joint] : value;
      let next = setKeyframe(module, type, joint, t, entered, 'smooth');
      if (type === 'rotation' && joint in manual.translations) next = setKeyframe(next, 'translation', joint, t, manual.translations[joint], 'smooth');
      updateKeyModule(next);
    }
    if (type === 'expression') {
      const expressions = { ...livePose.current.expressions };
      for (const id of Object.keys(expressionInput(joint, 0, eyes))) delete expressions[id];
      updateManual({ ...livePose.current, expressions });
    } else clearManualBody();
    setNotice('已写入关键帧');
  }
  function editKey(type: string, key: string, oldTime: number, newTime: number | null, interpolation?: 'linear' | 'smooth' | 'hold', copyKey = false) {
    if (module?.kind !== 'keyframes' || selectedClip?.track.locked) return;
    const channel = module.channels.find((item) => item.type === type && item.key === key);
    const keyframe = channel?.keys.find((entry) => entry.time === oldTime);
    if (!channel || !keyframe) return;
    const next = copyKey ? module : removeKeyframe(module, channel.type, key, oldTime);
    const updated = newTime === null ? next : setKeyframe(next, channel.type, key, Math.min(module.duration, newTime), keyframe.value, interpolation ?? keyframe.interpolation);
    updateKeyModule(updated);
  }
  function updateKeyModule(updated: Extract<MotionModule, { kind: 'keyframes' }>) {
    if (!selectedClip) return;
    const compatible = moduleHasNativeBindings(updated) && !updated.modelId ? { ...updated, modelId: project.modelId } : updated;
    const lockedReference = project.tracks.some((track) => track.locked && track.clips.some((clip) => clip.moduleId === updated.id));
    if (lockedReference) {
      const fork = { ...compatible, id: crypto.randomUUID() };
      commit({ ...project, modules: [...project.modules, fork], tracks: project.tracks.map((track) => ({
        ...track, clips: track.clips.map((clip) => clip.id === selectedClip.clip.id ? { ...clip, moduleId: fork.id } : clip),
      })) });
      return;
    }
    commit({ ...project, modules: project.modules.map((item) => item.id === updated.id ? compatible : item) });
  }
  function changeModel(id: string) {
    if (id === project.modelId || armed) return;
    transport.setPlaying(false);
    updateManual(emptyPose());
    setNotice('');
    const cached = localFiles.current.get(id);
    commit({ ...project, modelId: id, asset: cached ? { name: cached.files.model.name, sha256: cached.sha256 } : undefined });
  }

  async function submitModel({ name, model }: NewProjectSelection) {
    const creating = projectDialog === 'new';
    const relinking = projectDialog === 'relink';
    if (creating && model === noModelId) {
      stage.clear();
      const next = { ...createProject(noModelId), name };
      readyProject.current = next;
      replace(next);
      setNotice(`已创建工程 · ${name}`);
      return;
    }
    const cached = typeof model === 'string' ? localFiles.current.get(model) : undefined;
    const files = typeof model === 'string' ? cached?.files : model;
    let source: ModelSource | string;
    if (files) {
      const expected = relinking ? {
        id: project.modelId, sha256: expectedHash ?? models.find(({ id }) => id === project.modelId)?.sha256,
      } : cached && typeof model === 'string' ? { id: model, sha256: cached.sha256 } : undefined;
      source = await readLocalModel(files, expected);
      const sameName = localFiles.current.get(source.id);
      if (!expected && source.id.startsWith('local:') && sameName && sameName.sha256 !== source.asset.sha256) {
        source.id += `#${source.asset.sha256.slice(0, 12)}`;
      }
    } else {
      if (typeof model !== 'string' || !models.some(({ id }) => id === model)) throw new Error('请重新选择一个本地模型。');
      source = model;
    }
    const id = typeof source === 'string' ? source : source.id;
    const selectedMapping = project.mappings?.[id];
    const loaded = await stage.load(source, selectedMapping, true);
    if (!loaded) throw new Error('模型载入已取消，请重试。');
    const { filename, path, sha256 } = loaded.asset;
    if (files) localFiles.current.set(id, { files, sha256 });
    updateManual(emptyPose());
    transport.setPlaying(false);
    const next = {
      ...(creating ? createProject(id) : project), modelId: id, asset: { name: filename, path, sha256 },
      ...(creating ? { name, mappings: selectedMapping ? { [id]: selectedMapping } : undefined } : {}),
    };
    readyProject.current = next;
    if (creating) replace(next);
    else commit(next);
    setTab('rig');
    setInspector('pose');
    setNotice(`${creating ? `已创建工程 · ${name} · ` : ''}${loaded.label} · ${loaded.bones.length} 个可控关节`);
  }
  function exportFile(runtime: boolean) {
    try {
      const asset = rigReady && rig.asset ? { name: rig.asset.filename, path: rig.asset.path, sha256: rig.asset.sha256 } : project.asset;
      const snapshot = { ...project, playhead: Math.round(transport.time * project.fps), asset };
      download(`${projectFilename()}.${runtime ? 'motion.json' : 'motionproject.json'}`, runtime ? writeRuntime(snapshot) : writeProject(snapshot));
      setNotice(runtime ? '已导出动作 JSON' : '已保存工程 JSON');
    } catch (reason) { setNotice(messageOf(reason)); }
  }
  function projectFilename() {
    return project.name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/[ .]+$/, '') || '动作工程';
  }
  async function exportGlb() {
    if (!rigReady || rig.format === 'vrm' || armed || exportingGlb || duration <= 0) return;
    setExportingGlb(true);
    setNotice('正在烘焙动画并导出 GLB…');
    try {
      const { exportMotionGlb } = await import('./export-glb.ts');
      const cached = localFiles.current.get(project.modelId);
      const source = cached
        ? await readLocalModel(cached.files, { id: project.modelId, sha256: cached.sha256 })
        : project.modelId;
      const file = await exportMotionGlb(project, source);
      download(`${projectFilename()}.glb`, file);
      setNotice('已导出带动画的 GLB');
    } catch (reason) {
      setNotice(messageOf(reason));
    } finally {
      setExportingGlb(false);
    }
  }
  async function exportPortrait() {
    const viewport=stage.viewport.current;
    if (!rigReady || !viewport) { setNotice('请先载入角色模型'); return; }
    try { const png=await viewport.captureTransparentPng();download(`${projectFilename()}-人物.png`,png);setNotice('已导出透明人物 PNG'); }
    catch(error) { setNotice(messageOf(error)); }
  }
  function openPlayer() {
    if (window.studioWindow) void window.studioWindow.openPlayer();
    else window.open('./player.html', '_blank', 'noopener,noreferrer');
  }
  async function openProject(file: File) {
    try {
      const next = readProject(await file.text());
      replace(next);
      setNotice(`已打开 ${next.name}`);
    } catch (reason) { setNotice(messageOf(reason)); }
  }
  function example() {
    const next = { ...createExampleProject(project.modelId), asset: project.asset, mappings: project.mappings };
    next.tracks = next.tracks.map((track) => ({
      ...track, clips: track.clips.filter((clip) => {
        const item = getModule(next, clip.moduleId);
        return item && !compatibility(item, rig);
      }),
    }));
    replace(next);
    setTab('library');
    setNotice('已打开当前模型的动作示例');
  }
  function setFps(fps: Project['fps']) {
    commit(changeProjectFps(project, fps));
  }
  function togglePlay() {
    if (!transport.playing) clearManualBody();
    transport.toggle();
  }
  function seek(seconds: number) {
    clearManualBody();
    transport.seek(seconds);
  }
  function hotkey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || projectDialog || armed
      || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLElement && event.target.isContentEditable) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); togglePlay(); }
    if (command && !event.shiftKey && key === 'n') { event.preventDefault(); setProjectDialog('new'); }
    if (command && !event.shiftKey && key === 'o') { event.preventDefault(); openInput.current?.click(); }
    if (command && !event.shiftKey && key === 's') { event.preventDefault(); exportFile(false); }
    if (transport.playing) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) {event.preventDefault();remove();}
    if (command && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (command && key === 'y') { event.preventDefault(); redo(); }
    if (command && key === 'c' && selected.length) { event.preventDefault(); copy(); }
    if (command && key === 'v' && hasClipboard) { event.preventDefault(); paste(); }
  }
  const inputsLocked = armed || transport.playing;
  const controlDisabled = !rigReady || transport.playing;
  const trackForPanel = selectedTrack;
  return <main className="studio">
    <div className="studio-header">
    <header className="topbar">
      <StudioBrand subtitle="角色动作工作台" />
      <div className="header-file">
        <button title="新建工程" aria-label="新建工程" disabled={armed} onClick={() => setProjectDialog('new')}><FilePlus2 size={16} /><span>新建</span></button>
        <button title="打开工程" aria-label="打开工程" disabled={armed} onClick={() => openInput.current?.click()}><FolderOpen size={16} /></button>
        <button title="撤销" aria-label="撤销" disabled={armed || !past.current.length} onClick={undo}><Undo2 size={16} /></button>
        <button title="重做" aria-label="重做" disabled={armed || !future.current.length} onClick={redo}><Redo2 size={16} /></button>
        <input aria-label="工程名称" className="project-name" key={project.name} defaultValue={project.name} disabled={armed}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== project.name) commit({ ...project, name });
            else event.target.value = project.name;
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </div>
      <div className="window-drag-space" aria-hidden="true" />
      <div className="header-actions">
        <button className={`record ${armed ? 'recording' : ''}`} disabled={!rigReady || (!armed && stage.loading)} onClick={armed ? stopRecording : startRecording}>
          {armed ? <Square size={14} fill="currentColor" /> : <Circle size={12} fill="currentColor" />} {armed ? '停止录制' : '开始录制'}
        </button>
        <button className="action-button" title="保存可继续编辑的工程 JSON" onClick={() => exportFile(false)} disabled={armed}><Save size={15} /> 保存</button>
        <button className="action-button export" title="导出供独立播放器加载的动作 JSON" onClick={() => exportFile(true)} disabled={armed}><Download size={15} /> 导出动作包</button>
        <ThemeButton />
      </div>
      <WindowControls />
      <input hidden type="file" accept=".yukinomotion,.json" ref={openInput} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void openProject(file);
      }} />
      <input hidden type="file" accept=".glb" ref={motionInput} onChange={(event) => {
        const file=event.target.files?.[0]; event.target.value=''; if(file) void importMotion(file);
      }} />
    </header>
    <MotionMenu menus={[
      { label: '文件', actions: [
        { label: '新建工程…', run: () => setProjectDialog('new'), disabled: armed, shortcut: 'Ctrl+N' },
        { label: '打开工程…', run: () => openInput.current?.click(), disabled: armed, shortcut: 'Ctrl+O' },
        { label: '导入模型…', run: () => setProjectDialog('import'), disabled: armed },
        { label: '导入动作 GLB…', run: () => motionInput.current?.click(), disabled: inputsLocked || !rigReady },
        { label: '保存工程 JSON', run: () => exportFile(false), disabled: armed, shortcut: 'Ctrl+S', separated: true },
        { label: '导出动作 JSON', run: () => exportFile(true), disabled: armed },
        { label: '导出透明人物 PNG', run: () => void exportPortrait(), disabled: !rigReady || stage.loading },
        { label: rig?.format === 'vrm' ? '当前 VRM 请导出动作 JSON' : '导出带动画的 GLB',
          run: () => void exportGlb(), disabled: armed || !rigReady || rig?.format === 'vrm' || duration <= 0 || exportingGlb },
        { label: '打开独立播放器', run: openPlayer, separated: true },
      ] },
      { label: '编辑', actions: [
        { label: '撤销', run: undo, disabled: inputsLocked || !past.current.length, shortcut: 'Ctrl+Z' },
        { label: '重做', run: redo, disabled: inputsLocked || !future.current.length, shortcut: 'Ctrl+Shift+Z' },
        { label: '复制片段', run: copy, disabled: inputsLocked || !selectedClips.length, shortcut: 'Ctrl+C', separated: true },
        { label: '粘贴片段', run: paste, disabled: inputsLocked || !hasClipboard, shortcut: 'Ctrl+V' },
        { label: '合并所选片段', run: mergeSelected, disabled: inputsLocked || selectedClips.length < 2 },
        { label: '按变化部位分解片段', run: splitByPart, disabled: inputsLocked || selectedClips.length !== 1 },
        { label: '在播放头分割', run: split, disabled: inputsLocked || !selectedClips.some(({ track }) => !track.locked) },
        { label: '删除片段', run: remove, disabled: inputsLocked || !selectedClips.some(({ track }) => !track.locked), shortcut: 'Delete' },
      ] },
      { label: '视图', actions: [
        { label: '模型适合窗口', run: () => stage.viewport.current?.setView('fit'), disabled: !rigReady },
        { label: '恢复默认布局', run: () => setWorkspaceResetRevision((value) => value + 1) },
      ] },
    ]} />
    </div>
    <Workspace trackCount={project.tracks.length} resetRevision={workspaceResetRevision} panels={{
      library: <Library key={`${project.id}:${project.modelId}`} tab={tab} setTab={setTab} modules={modules} rig={rig} current={joint} onSelect={selectJoint} disabled={inputsLocked || !rigReady}
        onAdd={(id) => { const item = modules.find((entry) => entry.id === id); if (item) addMotion(item); }} />,
      preview: <div className="view-area">
        <div className="model-bar">
          <div><span className={`status-dot ${rigReady ? 'ready' : ''}`} />
            <StudioSelect aria-label="角色模型" value={project.modelId} onChange={(event) => changeModel(event.target.value)} disabled={armed}>
              <option value={noModelId}>未选择模型</option>
              {modelChoices.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}
            </StudioSelect></div>
          <div><button onClick={() => setProjectDialog('import')} disabled={armed}>导入模型</button>
            <button onClick={() => motionInput.current?.click()} disabled={inputsLocked || !rigReady}>导入动作</button>
            {project.modelId !== noModelId && !rigReady && !stage.loading && <button onClick={() => setProjectDialog('relink')} disabled={armed}>定位本地模型</button>}
            <button onClick={example} disabled={armed || !rigReady}><Film size={14} /> 动作示例</button>
            <a href="./player.html" target="_blank" rel="noreferrer" onClick={(event) => {
              if (!window.studioWindow) return;
              event.preventDefault();
              openPlayer();
            }}>独立播放器 <ArrowUpRight size={13} /></a></div>
        </div>
        <Stage session={stage} pose={pose} time={timecode(armed ? elapsed : transport.time, project.fps)} selected={face ? undefined : joint}
          simulationTime={transport.time} simulationPlaying={transport.playing}
          emptyMessage="请选择内置角色，或导入本地 VRM、GLB 或 glTF。"
          extra={<span className={`viewport-mode ${armed ? 'live' : ''}`}>{armed ? elapsed ? '● 操控录制' : '● 等待操控' : transport.playing ? '时间线播放' : '手动操控'}</span>} />
      </div>,
      inspector: <aside className="panel inspector">
        <div className="tabs">
          <button aria-pressed={inspector === 'pose'} onClick={showBody}>操控</button>
          <button aria-pressed={inspector === 'expression'} onClick={showExpressions}>表情</button>
          <button aria-pressed={inspector === 'clip'} disabled={!selectedClip} onClick={() => setInspector('clip')}>片段</button>
          <button aria-pressed={inspector === 'track'} disabled={!trackForPanel} onClick={() => setInspector('track')}>轨道</button>
        </div>
        <div className="inspector-scroll">
          {inspector === 'pose' && <label className="snap"><input type="checkbox" checked={jointLimitsEnabled} onChange={event=>{setJointLimitsEnabled(event.target.checked);localStorage.setItem('yukino-motion-joint-limits',String(event.target.checked));}} /> 限制关节活动范围</label>}
          {inspector === 'pose' && <ControlPanel control={bone}
            rotation={jointAngles(joint)} position={pose.translations[joint] ?? zero}
            updateRotation={(axis, value) => setAxis(axis, value, 'rotation')}
            updatePosition={(axis, value) => setAxis(axis, value, 'translation')}
            onRangeStart={(event) => { if (event.button === 0) startControlGesture(event.pointerId); }}
            body={rigReady ? { bones: rig.bones, selected: joint, rotations: pose.rotations, getGuide: () => stage.viewport.current?.guidePositions() ?? null,
              onOrbit: (dx, dy) => stage.viewport.current?.orbitGuide(dx, dy),
              onIKStart: (id) => stage.viewport.current?.beginIK(id) ?? false, onIKMove: moveIK,
              onIKEnd: () => stage.viewport.current?.endIK(), onSelect: selectJoint,
              angles: jointAngles, onRotate: rotateJoint, onGestureStart: startControlGesture, onGestureEnd: endControlGesture } : undefined}
            reset={resetJoint} keyframe={writeKey} armed={armed} disabled={controlDisabled}
            canKey={!controlDisabled && (!selectedClip?.track.locked || module?.kind !== 'keyframes')}
            keyHint={selectedClip && module?.kind === 'keyframes' ? '写入选中模块的源时间' : '新建关键帧片段'} />}
          {inspector === 'expression' && <ExpressionPanel key={project.modelId} controls={facialControls}
            eyes={eyes} pose={pose.expressions} manual={Object.keys(manual.expressions).length > 0} selected={joint}
            loading={stage.loading} loaded={rigReady && !stage.loading} error={stage.error} armed={armed}
            canKey={!!face && !controlDisabled && (!selectedClip?.track.locked || module?.kind !== 'keyframes')}
            onSelect={setJoint} onChange={changeExpression}
            onRangeStart={(event) => { if (event.button === 0) startControlGesture(event.pointerId); }}
            follow={() => updateManual({ ...livePose.current, expressions: {} })} keyframe={writeKey} />}
          {inspector === 'pose' && bone && <PartPreview key={`${project.modelId}:bone:${bone.id}`} id={bone.id} label={bone.label} kind="bone" pose={basePose} modelId={project.modelId} restDirections={rig?.retarget} limitsEnabled={jointLimitsEnabled} disabled={controlDisabled || armed || transport.playing} onPreview={setPreviewPose} onCreate={addMotion} />}
          {inspector === 'expression' && face && <PartPreview key={`${project.modelId}:expression:${face.id}`} id={face.id} label={face.label} kind="expression" pose={basePose} defaultWeight={face.defaultValue} modelId={project.modelId} restDirections={rig?.retarget} disabled={controlDisabled || armed || transport.playing} onPreview={setPreviewPose} onCreate={addMotion} />}
          {(inspector === 'pose' || inspector === 'expression') && <TransitionControls pose={basePose} modelId={project.modelId} projectId={project.id}
            defaults={Object.fromEntries(facialControls.map(control => [control.id, control.defaultValue ?? 0]))}
            restDirections={rig?.retarget} disabled={controlDisabled || armed}
            onCreate={item => { addMotion(item); updateManual(emptyPose()); setNotice('已插入姿势过渡片段'); }} />}
          {inspector === 'clip' && selectedClip && <ClipPanel clip={selectedClip.clip} track={selectedClip.track} module={module}
            fps={project.fps} time={transport.time} onChange={(patch) => editClip(selectedClip.clip.id, patch)}
            disabled={inputsLocked || selectedClip.track.locked} onKey={editKey}
            onRename={(name) => { if (module?.kind === 'keyframes') updateKeyModule({ ...module, name }); }} />}
          {inspector === 'track' && trackForPanel && <TrackPanel track={trackForPanel} regions={regions} disabled={inputsLocked}
            onChange={(patch) => updateTrack(trackForPanel.id, patch)} onMove={(delta) => {
              const tracks = [...project.tracks];
              const index = tracks.indexOf(trackForPanel);
              if (!tracks[index + delta]) return;
              [tracks[index + delta], tracks[index]] = [tracks[index], tracks[index + delta]];
              commit({ ...project, tracks });
            }} onDelete={() => {
              commit({ ...project, tracks: project.tracks.filter((track) => track.id !== trackForPanel.id) });
              setActiveTrack('');
              setSelected([]);
            }} />}
          {rig && <details className="rig-report"><summary>模型能力 · {rig.bones.length} 关节 / {facialControls.length} 表情</summary>
            {[...rig.warnings, ...rig.physics].map((warning) => <p key={warning}>{warning}</p>)}
            {currentWarnings.map(({ name, warning }) => <p key={name}>{name} · {warning}</p>)}
          </details>}
          {rigReady && <MappingPanel rig={rig} mapping={mapping} disabled={inputsLocked} update={(value) => {
            updateManual(emptyPose());
            commit({ ...project, mappings: { ...project.mappings, [project.modelId]: value } });
          }} />}
          {conflicts.length > 0 && <details className="rig-report"><summary>当前有 {conflicts.length} 个通道重叠</summary>
            {conflicts.map((conflict) => <p key={`${conflict.type}:${conflict.key}`}>{conflict.key} · {conflict.clipIds.length} 片段 · 按优先级与混合顺序</p>)}</details>}
        </div>
      </aside>,
      timeline: <Timeline project={project} transport={{ ...transport, seek, toggle: togglePlay }} selected={selected} activeTrack={selectedTrack?.id ?? ''}
        setActiveTrack={(id) => { setActiveTrack(id); setInspector('track'); }} select={selectClips} duration={duration} recording={armed}
        addModule={(id, track, start) => { const item = modules.find((entry) => entry.id === id); if (item) addMotion(item, track, start); }}
        updateTrack={updateTrack} addTrack={(region) => {
          const track = createTrack(regionLabel(region), region);
          commit({ ...project, tracks: [...project.tracks, track] });
          setActiveTrack(track.id);
          setInspector('track');
        }} moveClips={moveClips} editClip={editClip} copy={copy} paste={paste} split={split} remove={remove}
        hasClipboard={hasClipboard} disabled={inputsLocked} trackRegions={regions} />,
    }} />
    <footer className="statusbar">
      <span role="status"><i className={`status-dot ${rigReady ? 'ready' : ''}`} />{notice || (rigReady ? `${rig.label} · 本地工作区` : '等待角色资源')}</span>
      <span>{selectedClips.length ? `${selectedClips.length} 片段已选` : '时间线'} · {duration.toFixed(2)} 秒
        <StudioSelect aria-label="帧率" value={project.fps} disabled={armed} onChange={(event) => setFps(Number(event.target.value) as Project['fps'])}>
          <option value={24}>24 FPS</option><option value={30}>30 FPS</option><option value={60}>60 FPS</option>
        </StudioSelect></span>
    </footer>
    {projectDialog && <ProjectDialog mode={projectDialog} submit={submitModel} close={() => setProjectDialog(null)}
      choices={modelChoices.filter(({ id }) => !id.startsWith('local:') || localFiles.current.has(id))}
      current={rigReady ? project.modelId : noModelId}
      assetName={project.asset?.name ?? models.find(({ id }) => id === project.modelId)?.filename} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Studio />);
