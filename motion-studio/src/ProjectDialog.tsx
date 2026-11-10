import { StudioSelect } from './StudioSelect.tsx';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { modelFileAccept } from './local-model.ts';
import type { ModelFiles } from './local-model.ts';
import { noModelId } from './model-catalog.ts';
import './project-dialog.css';

export interface NewProjectSelection {
  name: string;
  model: string | ModelFiles;
}

const importChoice = 'import-local';

export function ProjectDialog({ mode, choices = [], current = noModelId, assetName, submit, close }: {
  mode: 'new' | 'import' | 'relink';
  choices?: { id: string; label: string }[];
  current?: string;
  assetName?: string;
  submit: (selection: NewProjectSelection) => Promise<void>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('未命名动作');
  const [choice, setChoice] = useState(mode === 'new' ? current : importChoice);
  const [model, setModel] = useState<File>();
  const [dependencies, setDependencies] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = mode === 'new' ? '新建工程' : mode === 'relink' ? '定位本地模型' : '导入模型';
  const label = mode === 'new' ? '创建工程' : mode === 'relink' ? '定位模型' : '载入模型';
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || (choice === importChoice && !model)) return;
    setBusy(true);
    setError('');
    try {
      await submit({ name: name.trim() || '未命名动作', model: choice === importChoice ? { model: model!, dependencies } : choice });
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }
  return <dialog ref={dialog} className="project-dialog" aria-labelledby="project-dialog-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) close(); }} onKeyDown={(event) => event.stopPropagation()}>
    <form onSubmit={(event) => { void save(event); }}>
      <header><h2 id="project-dialog-title">{title}</h2><button type="button" aria-label="关闭窗口" onClick={close} disabled={busy}><X size={18} /></button></header>
      <fieldset disabled={busy}>
        {mode === 'new' && <>
          <label>工程名称<input aria-label="新工程名称" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus /></label>
          <label>起始模型<StudioSelect aria-label="起始模型" value={choice} onChange={(event) => { setChoice(event.target.value); setError(''); }}>
            <option value={noModelId}>暂不选择模型</option>
            {choices.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            <option value={importChoice}>从本地文件导入</option>
          </StudioSelect></label>
        </>}
        {mode === 'relink' && assetName && <p>请选择工程原先引用的 {assetName}。文件内容须与保存的指纹匹配。</p>}
        {choice === importChoice && <>
          <label>模型文件<input aria-label="模型文件" type="file" accept={modelFileAccept} onChange={(event) => {
            setModel(event.target.files?.[0]); setDependencies([]); setError('');
          }} /></label>
          <p>支持 VRM 和已经绑定骨架或表情的 GLB、glTF 2.0。</p>
          {model && /\.gltf$/i.test(model.name) && <>
            <label>glTF 依赖文件<input key={model.name} aria-label="glTF 依赖文件" type="file" multiple onChange={(event) => setDependencies(Array.from(event.target.files ?? []))} /></label>
            <label>或选择依赖文件夹<input key={`${model.name}:folder`} aria-label="glTF 依赖文件夹" type="file" multiple
              ref={(input) => { input?.setAttribute('webkitdirectory', ''); }} onChange={(event) => setDependencies(Array.from(event.target.files ?? []))} /></label>
            <p>{dependencies.length ? `已选择 ${dependencies.length} 个本地文件。` : '如果 glTF 使用外置 .bin 或贴图，请一并选择。'}</p>
          </>}
        </>}
      </fieldset>
      {error && <p className="project-dialog-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={close} disabled={busy}>取消</button>
        <button className="primary" type="submit" disabled={busy || (choice === importChoice && !model)}>{busy ? '正在读取模型…' : label}</button></footer>
    </form>
  </dialog>;
}
