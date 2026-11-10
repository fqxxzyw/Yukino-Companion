import { StudioSelect } from './StudioSelect.tsx';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Pause, Play, Repeat2, SkipBack } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { evaluateProject, emptyPose, projectDuration, readRuntime } from './motion/index.ts';
import type { Project } from './motion/index.ts';
import { models } from './viewport.ts';
import { noModelId } from './model-catalog.ts';
import { readLocalModel } from './local-model.ts';
import { ProjectDialog } from './ProjectDialog.tsx';
import type { NewProjectSelection } from './ProjectDialog.tsx';
import { compatibility } from './compatibility.ts';
import { messageOf, Stage, timecode, useTransport, useViewport } from './session.tsx';
import { StudioBrand, ThemeButton, WindowControls } from './WindowChrome.tsx';
import './style.css';
import { previewTime } from './preview-time.ts';

function Player() {
  const [project, setProject] = useState<Project | null>(null);
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('打开编辑器导出的 .motion.json 文件。');
  const packet = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const stage = useViewport();
  const duration = project ? projectDuration(project) : 0;
  const transport = useTransport(duration);
  const loaded = stage.rig?.id === model;
  const fps = project?.fps ?? 30;
  const pose = project && loaded ? evaluateProject({ ...project, modelId: model }, previewTime(transport.time, duration), stage.rig?.retarget) : emptyPose();
  const localId = project?.modelId.startsWith('local:') ? project.modelId : undefined;
  const modelsList = localId ? [...models, { id: localId, label: localId.slice(6) }] : models;
  const incompatible = project?.modules.filter((module) => compatibility(module, stage.rig)) ?? [];
  useEffect(() => {
    if (model === noModelId) stage.clear();
    else if (model && !model.startsWith('local:')) {
      const expected = model === project?.modelId ? project.asset?.sha256 : undefined;
      if (expected && expected !== models.find((item) => item.id === model)?.sha256) stage.clear('动作包引用的模型指纹不同，请定位原文件。');
      else void stage.load(model, project?.mappings?.[model]);
    }
    else if (model) stage.clear('请定位动作包引用的本地模型。');
  }, [model, project]);
  async function open(file: File) {
    try {
      const next = readRuntime(await file.text());
      transport.setPlaying(false);
      transport.seek(0);
      setProject(next);
      setModel(next.modelId);
      setMessage(next.modelId.startsWith('local:') ? '请定位动作包引用的本地模型。' : `已加载动作包 · ${next.name}`);
    } catch (reason) { setMessage(messageOf(reason)); }
  }
  async function locate({ model: files }: NewProjectSelection) {
    if (!project || typeof files === 'string') return;
    const expectedHash = (model === project.modelId ? project.asset?.sha256 : undefined) ?? models.find((item) => item.id === model)?.sha256;
    const source = await readLocalModel(files, { id: model, sha256: expectedHash });
    if (!await stage.load(source, project.mappings?.[model], true)) throw new Error('模型载入已取消，请重试。');
    setMessage(`已定位 ${files.model.name}`);
  }
  return <main className="player">
    <header className="topbar">
      <StudioBrand subtitle="独立动作包播放器" home />
      <span className="player-title">{project?.name ?? '等待动作包'}</span>
      <div className="window-drag-space" aria-hidden="true" />
      <div className="header-actions">
        <button className="action-button export" onClick={() => packet.current?.click()}><FolderOpen size={16} /> 打开动作包</button>
        <ThemeButton />
        <input hidden ref={packet} aria-label="动作包文件" type="file" accept=".json" onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void open(file);
        }} />
      </div>
      <WindowControls />
    </header>
    <div className="model-bar">
      <div><span className={`status-dot ${loaded ? 'ready' : ''}`} />
        <StudioSelect aria-label="播放角色模型" value={model || noModelId} disabled={!project} onChange={(event) => {
          transport.setPlaying(false);
          setModel(event.target.value);
        }}>
          <option value={noModelId}>选择模型</option>{modelsList.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </StudioSelect>
      </div>
      <div>{model && model !== noModelId && !loaded && !stage.loading && <button onClick={() => setLocating(true)}>定位本地模型</button>}
        <span title={incompatible.map((item) => item.name).join('、')}>{message}{incompatible.length > 0 ? ` · ${incompatible.length} 个模块有兼容性限制` : ''}</span></div>
    </div>
    {locating && <ProjectDialog mode="relink" submit={locate} close={() => setLocating(false)}
      assetName={(model === project?.modelId ? project?.asset?.name : undefined) ?? models.find(({ id }) => id === model)?.filename} />}
    <Stage session={stage} pose={pose} time={timecode(transport.time, fps)}
      simulationTime={transport.time} simulationPlaying={transport.playing}
      extra={<span className="viewport-mode">{transport.playing ? '播放中' : '动作包预览'}</span>} />
    <div className="player-controls">
      <button title="回到起点" aria-label="回到起点" disabled={!loaded} onClick={() => { transport.setPlaying(false); transport.seek(0); }}><SkipBack size={17} /></button>
      <button className="play-button" aria-label={transport.playing ? '暂停' : '播放'} disabled={!loaded || duration <= 0} onClick={transport.toggle}>{transport.playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button aria-label="循环播放" aria-pressed={transport.loop} onClick={() => transport.setLoop(!transport.loop)}><Repeat2 size={17} /></button>
      <input type="range" aria-label="播放器进度" min="0" max={duration || 1} step={1 / fps} value={transport.time} disabled={!loaded}
        onChange={(event) => { transport.setPlaying(false); transport.seek(event.target.valueAsNumber); }} />
      <output>{timecode(transport.time, fps)} / {timecode(duration, fps)}</output>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Player />);
