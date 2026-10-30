import React, {useEffect, useRef, useState} from 'react';
import {CheckCircle2, ChevronDown, KeyRound, LoaderCircle, Plus, RefreshCw, Search} from 'lucide-react';
import Select from './Select';
import './api-settings.css';

const messageOf = error => String(error?.message || error || '操作失败，请稍后重试。').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const originOf = base => {try {return new URL(base).origin;} catch {return '';}};
const providerFor = (profile, catalog) => catalog.find(p => p.id === profile.providerId) || catalog.find(p => p.base && profile.base?.replace(/\/$/, '').replace(/\/chat\/completions$/, '') === p.base) || catalog.find(p => p.id === 'custom');

export default function ApiSettings({api, state, onChange, keyIds = [], onKeyIds, busy = false,editingProfileId,onProfileSelect}) {
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState(null);
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState(null);
  const [connection, setConnection] = useState('untested');
  const [query, setQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [manual, setManual] = useState(false);
  const latest = useRef(state);
  const sequence = useRef(0);
  const mounted = useRef(true);
  latest.current = state;
  const profile = state.profiles.find(p => p.id === (editingProfileId||state.activeProfile)) || state.profiles[0];
  const provider = providerFor(profile || {}, catalog);
  const locked = busy || Boolean(working);
  const savedKey = keyIds.includes(profile?.id);

  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => {
      if (!api?.apiProviders) throw new Error('请在桌面客户端中配置 API。');
      return api.apiProviders();
    }).then(value => {if (mounted.current) setCatalog(value);}).catch(error => {if (mounted.current) setCatalogError(messageOf(error));});
    return () => {mounted.current = false; sequence.current++;};
  }, [api]);
  useEffect(() => {
    sequence.current++;
    setSecret(''); setResult(null); setQuery(''); setNotice(null); setManual(false); setWorking(''); setConnection('untested');
  }, [profile?.id]);

  function patchState(patch) {
    latest.current = {...latest.current, ...patch};
    onChange(patch);
  }
  function updateProfile(patch) {
    if ('base' in patch || 'providerId' in patch || 'model' in patch) setConnection('untested');
    patchState({profiles:latest.current.profiles.map(p => p.id === profile.id ? {...p, ...patch} : p)});
  }
  function invalidate() {sequence.current++; setResult(null); setNotice(null); setQuery(''); setConnection('untested');}
  function selectProvider(id) {
    const next = catalog.find(p => p.id === id);
    if (!next) return;
    invalidate(); setSecret(''); setManual(false);
    const base = id === 'custom' ? profile.base : next.base;
    updateProfile({providerId:id, base, model:'',visionEnabled:false});
    if (savedKey && originOf(base) !== originOf(profile.base)) setNotice({tone:'info', text:next.keyOptional ? '已更换服务商。若新服务无需密钥，请在高级设置中删除已存密钥；否则填写新密钥。' : '已更换服务商。请输入对应的密钥；原服务商的密钥不会发送到新地址。'});
  }
  function changeBase(base) {
    invalidate(); setSecret('');
    updateProfile({base,visionEnabled:false});
    if (savedKey && originOf(base) !== originOf(profile.base)) setNotice({tone:'info', text:provider?.keyOptional ? '地址已更改。若新服务无需密钥，请在高级设置中删除已存密钥；否则填写新密钥。' : '地址已更改，请重新输入此地址对应的密钥。'});
  }
  function changeSecret(value) {invalidate(); setSecret(value);}
  function currentProfile() {return latest.current.profiles.find(p => p.id === profile.id);}
  function rememberKey(id) {onKeyIds?.([...new Set([...keyIds, id])]);}
  function fail(error, operation) {if (mounted.current && operation === sequence.current) setNotice({tone:'error', text:messageOf(error)});}

  async function discover() {
    const operation = ++sequence.current;
    const snapshot = currentProfile();
    const newKey = secret.trim();
    setWorking('discover'); setNotice(null); setResult(null);
    try {
      const response = await api.apiModels({profileId:snapshot.id, base:snapshot.base, providerId:provider?.id || 'custom', ...(newKey ? {key:newKey} : {})});
      if (!mounted.current || operation !== sequence.current) return;
      if (response.verified && newKey) {
        await api.save(latest.current);
        await api.saveKey(snapshot.id, newKey, snapshot.base);
        if (!mounted.current || operation !== sequence.current) return;
        rememberKey(snapshot.id); setSecret('');
      }
      setResult(response); setNotice({tone:response.verified ? 'success' : 'info', text:response.message});
      if (response.status === 'unsupported') setAdvanced(true);
      const choices = response.models || [];
      if (!snapshot.model && choices.length === 1) updateProfile({model:choices[0].id});
    } catch (error) {fail(error, operation);}
    finally {if (mounted.current && operation === sequence.current) setWorking('');}
  }

  async function save(test = false) {
    const operation = ++sequence.current;
    const snapshot = currentProfile();
    setWorking(test ? 'test' : 'save'); setNotice(null); if(test) setConnection('checking');
    try {
      await api.save(latest.current);
      if (secret.trim()) {
        await api.saveKey(snapshot.id, secret.trim(), snapshot.base);
        if (!mounted.current || operation !== sequence.current) return;
        rememberKey(snapshot.id); setSecret('');
      }
      const text = test ? await api.test(snapshot.id) : '配置已保存。选择模型后可测试对话连接。';
      if (mounted.current && operation === sequence.current) {setNotice({tone:'success', text}); if(test) setConnection('ready');}
    } catch (error) {if(test && mounted.current && operation === sequence.current) setConnection('error'); fail(error, operation);}
    finally {if (mounted.current && operation === sequence.current) setWorking('');}
  }

  function addProfile() {
    const id = crypto.randomUUID();
    patchState({profiles:[...latest.current.profiles, {id, name:`API 配置 ${latest.current.profiles.length + 1}`, providerId:'custom', base:'', model:''}],...(onProfileSelect?{}:{activeProfile:id})});
    onProfileSelect?.(id);
  }
  async function removeProfile() {
    const operation = ++sequence.current;
    setWorking('delete'); setNotice(null);
    try {
      // Delete the encrypted key first. It never enters component state.
      await api.saveKey(profile.id, '', profile.base);
      if (!mounted.current || operation !== sequence.current) return;
      onKeyIds?.(keyIds.filter(id => id !== profile.id));
      const profiles = latest.current.profiles.filter(p => p.id !== profile.id);
      patchState({profiles, activeProfile:latest.current.activeProfile===profile.id?profiles[0].id:latest.current.activeProfile});
      onProfileSelect?.(profiles[0].id);
    } catch (error) {fail(error, operation);}
    finally {if (mounted.current && operation === sequence.current) setWorking('');}
  }

  async function clearSavedKey() {
    const operation = ++sequence.current;
    setWorking('clearKey'); setNotice(null);
    try {
      await api.saveKey(profile.id, '', profile.base);
      if (!mounted.current || operation !== sequence.current) return;
      onKeyIds?.(keyIds.filter(id => id !== profile.id));
      setSecret(''); setResult(null); setQuery(''); setConnection('untested');
      setNotice({tone:'success', text:'已删除此配置的本机密钥。可以重新填写密钥，或直接连接无需密钥的本机服务。'});
    } catch (error) {fail(error, operation);}
    finally {if (mounted.current && operation === sequence.current) setWorking('');}
  }

  if (!profile) return <p className="api-notice" role="status">尚无 API 配置。</p>;
  const choices = result?.status === 'unsupported' ? result.suggestions || [] : result?.models || [];
  const matching = choices.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  // Keep the selected model visible even when a search or refreshed list excludes it.
  const selected = choices.find(model => model.id === profile.model);
  const showCurrent = Boolean(profile.model && !matching.some(model => model.id === profile.model));
  const modelOptions = showCurrent ? [{id:profile.model, name:selected?.name || `${profile.model} · 当前配置`}, ...matching] : matching;
  const canDiscover = Boolean(profile.base.trim()) && (Boolean(secret.trim()) || savedKey || provider?.keyOptional);

  return <div className="api-settings">
    <div className="api-intro"><KeyRound size={19}/><div><strong>连接你的模型</strong><p>选择服务商，验证密钥，再从列表选择模型。</p></div></div>
    <div className={'api-connection-status '+connection} role="status"><i aria-hidden="true"/><span>对话连接：{connection==='ready'?'本次测试成功':connection==='checking'?'正在测试':connection==='error'?'本次测试失败':'本次尚未测试'}</span></div>
    <label className="field">当前配置
      <div className="profile-picker">
        <Select aria-label="当前 API 配置" value={profile.id} disabled={locked} onChange={e => onProfileSelect?onProfileSelect(e.target.value):patchState({activeProfile:e.target.value})}>
          {state.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <button className="secondary api-add" type="button" disabled={locked} onClick={addProfile} aria-label="新增 API 配置"><Plus size={16}/></button>
      </div>
    </label>
    <fieldset disabled={locked}>
      <label className="field">服务商
        <Select aria-label="API 服务商" value={provider?.id || 'custom'} disabled={locked || !catalog.length} onChange={e => selectProvider(e.target.value)}>
          {catalog.length ? catalog.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="custom">正在载入服务商…</option>}
        </Select>
        <small>{provider?.note || '选择兼容 Chat Completions 的服务商。'}</small>
      </label>
      {catalogError && <p className="api-notice error" role="alert">服务商列表载入失败：{catalogError}</p>}
      {provider?.id === 'custom' && <label className="field">API 地址<input value={profile.base} onChange={e => changeBase(e.target.value)} placeholder="https://api.example.com/v1" spellCheck="false" autoComplete="off"/></label>}
      <label className="field">API 密钥 {savedKey && <span className="api-saved"><CheckCircle2 size={13}/> 已加密保存</span>}
        <input type="password" value={secret} onChange={e => changeSecret(e.target.value)} autoComplete="new-password" spellCheck="false" maxLength={8192}
          placeholder={savedKey ? '留空使用此地址已保存的密钥；输入可替换' : provider?.keyOptional ? '如服务需要，请填写密钥' : '粘贴此服务商的 API Key'}/>
        <small>密钥仅在本机加密保存。更换服务商或地址时需要重新验证。</small>
      </label>
      <button type="button" className="primary api-discover" disabled={locked || !canDiscover} onClick={discover}>
        {working === 'discover' ? <LoaderCircle size={15} className="api-spinner"/> : <RefreshCw size={15}/>}
        {working === 'discover' ? '正在获取模型…' : provider?.id === 'local' ? '获取本机模型' : '验证密钥并获取模型'}
      </button>
      <div className="field api-model-field"><label htmlFor="api-model-picker">对话模型</label>
        {choices.length > 12 && <div className="api-search"><Search size={15}/><input aria-label="搜索模型" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型名称"/></div>}
        <Select id="api-model-picker" aria-label="对话模型" value={profile.model || ''} disabled={locked || !modelOptions.length} onChange={e => updateProfile({model:e.target.value,visionEnabled:false})}>
          <option value="" disabled>{result ? '请选择模型' : profile.model ? '当前模型' : '先验证密钥并获取模型'}</option>
          {modelOptions.map(model => <option key={model.id} value={model.id}>{model.name === model.id ? model.id : `${model.name} · ${model.id}`}</option>)}
        </Select>
        {query && !matching.length && <small>没有匹配结果，请尝试其他名称。</small>}
        {result?.status === 'unsupported' && <small>下拉内容为服务商文档预设，尚未验证你的账户可用性。请点击「测试对话连接」。</small>}
        {result?.verified && <small>模型列表已获取；具体的对话权限和兼容性以连接测试为准。</small>}
      </div>
      <label className="row"><div><strong>视觉 API 能力确认</strong><small>我确认此模型支持 Chat Completions 图片输入；截图仍需每次预览和确认发送。</small></div><input type="checkbox" role="switch" checked={profile.visionEnabled===true} disabled={locked} onChange={e=>updateProfile({visionEnabled:e.target.checked})}/></label>
      <button type="button" className="text-link api-advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><ChevronDown size={14} className={advanced ? 'expanded' : ''}/>高级设置</button>
      {advanced && <div className="api-advanced">
        <label className="field">配置名称<input value={profile.name} onChange={e => updateProfile({name:e.target.value})} maxLength={80}/></label>
        {provider?.id !== 'custom' && <label className="field">API 地址<input value={profile.base} onChange={e => changeBase(e.target.value)} spellCheck="false" autoComplete="off"/><small>支持基础地址或完整的 /chat/completions 地址。本机 HTTP 可用，远程地址须使用 HTTPS。</small></label>}
        {savedKey && <div className="field"><span>已保存的密钥</span><button className="secondary api-clear-key" type="button" disabled={locked} onClick={clearSavedKey}>{working === 'clearKey' ? '正在删除…' : '删除已存密钥'}</button><small>换成无需密钥的本机服务时，可在这里清除旧密钥。配置地址和模型仍会保留。</small></div>}
        <label className="api-manual-toggle"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)}/>手动指定模型（服务没有列表或使用自定义模型时）</label>
        {manual && <label className="field">模型 ID<input value={profile.model} onChange={e => updateProfile({model:e.target.value,visionEnabled:false})} maxLength={256} spellCheck="false" autoComplete="off" placeholder="以服务商提供的模型 ID 为准"/></label>}
      </div>}
      <div className="button-row api-actions">
        <button className="secondary" type="button" disabled={locked || !profile.base.trim()} onClick={() => save(false)}>{working === 'save' ? '正在保存…' : '保存配置'}</button>
        <button className="secondary" type="button" disabled={locked || !profile.base.trim() || !profile.model.trim()} onClick={() => save(true)}>{working === 'test' ? '正在测试…' : '测试对话连接'}</button>
        {state.profiles.length > 1 && <button className="text-link api-delete" type="button" disabled={locked} onClick={removeProfile}>删除配置</button>}
      </div>
    </fieldset>
    {notice && <div className={`api-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
  </div>;
}
