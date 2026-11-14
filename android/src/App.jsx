import { useEffect, useMemo, useRef, useState } from "react";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";
import { SceneBackdrop, SCENES } from "./components/SceneBackdrop.jsx";
import { CharacterViewport } from "./components/CharacterViewport.jsx";
import { OutfitPicker } from "./components/OutfitPicker.jsx";
import { TabBar } from "./components/TabBar.jsx";
import { DEFAULT_OUTFIT_ID, listOutfits, loadManifest } from "./model/characterModelConfig.js";
import { Icon } from "./components/icons.jsx";
import { loadState, saveState, newId, serviceFor, serviceLabel, emptyState } from "./storage.js";
import { PROVIDERS, TASKS, providerById, validateBase } from "./api/providers.js";
import { testConnection } from "./api/chat.js";
import { sendCompanionMessage, ensureConversation } from "./conversation.js";
import { audioUrlFromData, synthesizeSpeech, transcribeAudio } from "./api/speech.js";
import { describeImage } from "./api/vision.js";

const TABBED = new Set(["companion", "chat", "characters", "settings"]);

export function App() {
  const [store, setStore] = useState(null);
  const [route, setRoute] = useState("companion");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [editing, setEditing] = useState(null);
  const [outfits, setOutfits] = useState([]);
  const audioRef = useRef(null);

  useEffect(() => {
    loadState().then((state) => {
      const wanted = new URLSearchParams(window.location.search).get("outfit");
      if (wanted) {
        setStore({ ...state, settings: { ...state.settings, outfit: wanted } });
      } else {
        setStore(state);
      }
    });
    loadManifest().then((manifest) => setOutfits(listOutfits(manifest))).catch(() => setOutfits([]));
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setOverlaysWebView?.({ overlay: true }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (store) saveState(store);
  }, [store]);

  useEffect(() => {
    if (!notice && !error) return;
    const t = setTimeout(() => { setNotice(""); setError(""); }, 4200);
    return () => clearTimeout(t);
  }, [notice, error]);

  if (!store) return <div className="app" />;

  const character = store.characters.find((item) => item.id === store.activeCharacter) || store.characters[0];
  const chatService = serviceFor(store, "chat");
  const conversation = store.conversations.find((item) => item.id === store.activeConversation && item.characterId === character.id)
    || store.conversations.find((item) => item.characterId === character.id);
  const lastAssistant = [...(conversation?.messages || [])].reverse().find((item) => item.role === "assistant");
  const scene = store.settings.scene || "classroom";
  const outfitIds = new Set(outfits.map((item) => item.id));
  const queryOutfit = new URLSearchParams(window.location.search).get("outfit");
  const outfitId = (queryOutfit && outfitIds.has(queryOutfit) ? queryOutfit : null)
    || (outfitIds.has(store.settings.outfit) ? store.settings.outfit : null)
    || DEFAULT_OUTFIT_ID;
  const ice = !["companion", "chat"].includes(route) && route !== "characters";

  const speakText = async (reply) => {
    const tts = serviceFor(store, "tts");
    if (!tts || !store.settings.autoSpeak || !reply) return;
    const text = character.ttsLanguage === "ja" ? (reply.contentJa || reply.contentZh) : (reply.contentZh || reply.contentJa);
    if (!text) return;
    try {
      setSpeaking(true);
      const data = await synthesizeSpeech({ service: tts, text, voice: character.voice || store.settings.ttsVoice, speed: store.settings.voiceRate || 1 });
      const url = audioUrlFromData(data);
      const audio = new Audio(url);
      audio.volume = store.settings.voiceVolume ?? 0.7;
      audioRef.current?.pause();
      audioRef.current = audio;
      await audio.play();
      audio.onended = () => setSpeaking(false);
    } catch (err) {
      setSpeaking(false);
      setError(err.message || "朗读失败");
    }
  };

  const send = async (text) => {
    const value = String(text || draft).trim();
    if (!value || busy) return;
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const result = await sendCompanionMessage({
        state: store,
        character,
        text: value,
        onStatus: ({ conversation: current }) => setStore((prev) => ({ ...prev, conversations: [current, ...prev.conversations.filter((item) => item.id !== current.id)], activeConversation: current.id }))
      });
      setStore(result.state);
      await speakText(result.reply);
    } catch (err) {
      setError(err.message || "发送失败");
    } finally {
      setBusy(false);
    }
  };

  const startVoice = async () => {
    const asr = serviceFor(store, "asr");
    if (!asr) {
      setError("请先配置语音识别服务。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();
      setNotice("正在倾听…再次点击麦克风结束");
      window.__yukinoRec = { recorder, stream, chunks, stopped };
    } catch {
      setError("无法使用麦克风，请检查权限。");
    }
  };

  const stopVoice = async () => {
    const rec = window.__yukinoRec;
    if (!rec) return;
    rec.recorder.stop();
    rec.stream.getTracks().forEach((track) => track.stop());
    await rec.stopped;
    window.__yukinoRec = null;
    const blob = new Blob(rec.chunks, { type: rec.chunks[0]?.type || "audio/webm" });
    setBusy(true);
    try {
      const text = await transcribeAudio({ service: serviceFor(store, "asr"), blob });
      await send(text);
    } catch (err) {
      setError(err.message || "识别失败");
      setBusy(false);
    }
  };

  const onMic = () => window.__yukinoRec ? stopVoice() : startVoice();

  const patchSettings = (partial) => setStore((prev) => ({ ...prev, settings: { ...prev.settings, ...partial } }));

  const ctx = { store, setStore, character, chatService, conversation, lastAssistant, scene, ice, route, setRoute, draft, setDraft, busy, send, onMic, speaking, patchSettings, setError, setNotice, setEditing, editing, speakText, outfits, outfitId };

  return (
    <div className={`app${store.settings.motion ? "" : " reduce-motion"}`}>
      <SceneBackdrop scene={route === "characters" ? "sakura" : scene} variant={ice ? "ice" : route === "characters" ? "full" : "full"} />
      {["companion", "chat"].includes(route) && route === "chat" && <div className="veil" />}
      {route === "companion" && <CompanionScreen {...ctx} />}
      {route === "chat" && <ChatScreen {...ctx} />}
      {route === "characters" && <CharactersScreen {...ctx} />}
      {route === "settings" && <SettingsScreen {...ctx} />}
      {route === "api" && <ApiScreen {...ctx} />}
      {route === "api-add" && <ApiAddScreen {...ctx} />}
      {route === "translation" && <TranslationScreen {...ctx} />}
      {route === "voice" && <VoiceScreen {...ctx} />}
      {route === "scenes" && <ScenesScreen {...ctx} />}
      {route === "memory" && <MemoryScreen {...ctx} />}
      {route === "vision" && <VisionScreen {...ctx} />}
      {route === "character-edit" && <CharacterEditScreen {...ctx} />}
      {TABBED.has(route) && <TabBar current={route} onChange={setRoute} />}
      {(error || notice) && <div className={`toast glass ${error ? "error" : ""}`}>{error || notice}</div>}
    </div>
  );
}

function CompanionScreen({ character, chatService, lastAssistant, scene, draft, setDraft, send, busy, onMic, speaking, setRoute, store, outfitId, outfits }) {
  const currentOutfit = outfits.find((item) => item.id === outfitId);
  return (
    <div className="screen">
      <CharacterViewport outfitId={outfitId} motion={store.settings.motion} speaking={speaking} listening={busy} />
      <div className="top-pills">
        <div className="pill glass">{SCENES.find((item) => item.id === scene)?.label || "场景"}</div>
        {currentOutfit && <button className="pill glass" onClick={() => setRoute("characters")}>{currentOutfit.label}</button>}
        <div className={`pill glass${chatService ? "" : " warn"}`}>
          <span className="dot" />
          {chatService ? `${chatService.name} · 在线` : "未配置 API"}
        </div>
        <button className="icon-btn glass" onClick={() => setRoute("settings")} aria-label="设置"><Icon name="settings" size={16} /></button>
      </div>
      {lastAssistant && (
        <div className="speech glass">
          <span className="sheen" />
          <div className="zh">{lastAssistant.contentZh}</div>
          {lastAssistant.contentJa && <div className="ja">{lastAssistant.contentJa}</div>}
          <div className="meta">
            {speaking && <span className="wave"><b /><b /><b /><b /><b /></span>}
            {speaking ? "正在朗读" : "上一句"}
          </div>
        </div>
      )}
      {!lastAssistant && (
        <div className="speech glass">
          <div className="zh">放课后还留在教室，是有什么事吗。</div>
          <div className="ja">放課後まで残っているなんて、何か用かしら。</div>
        </div>
      )}
      <Composer draft={draft} setDraft={setDraft} send={send} busy={busy} onMic={onMic} setRoute={setRoute} placeholder={`和${character.name.replace(/^雪之下/, "")}说点什么…`} />
    </div>
  );
}

function ChatScreen({ store, character, chatService, conversation, draft, setDraft, send, busy, onMic, setRoute }) {
  const box = useRef(null);
  const messages = conversation?.messages || [];
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [messages.length, busy]);
  return (
    <div className="screen">
      <div className="chat-head glass">
        <div className="avatar"><img src="./icon.png" alt="" /></div>
        <div>
          <div className="who">{character.name}</div>
          <div className="sub">{chatService ? `${chatService.name} · ${langLabel(store.settings.bubbleLanguage)}` : "尚未配置对话 API"}</div>
        </div>
        <div className="spacer" />
      </div>
      <div className="transcript" ref={box}>
        <div className="dayline">今天 · 与{character.name}的对话</div>
        {!messages.length && <div className="empty-hint">还没有消息。在下面说第一句话吧。</div>}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg ${msg.role === "user" ? "me" : "bot glass"}`}>
            <div className="zh">{msg.contentZh || msg.content}</div>
            {msg.contentJa && <div className="ja">{msg.contentJa}</div>}
            <div className="time">{formatTime(msg.time)}</div>
          </div>
        ))}
        {busy && <div className="msg bot glass"><div className="zh">正在组织语言…</div></div>}
      </div>
      <Composer draft={draft} setDraft={setDraft} send={send} busy={busy} onMic={onMic} setRoute={setRoute} placeholder="继续对话…" />
    </div>
  );
}

function Composer({ draft, setDraft, send, busy, onMic, setRoute, placeholder }) {
  return (
    <div className="composer-wrap">
      <div className="composer glass">
        <span className="sheen" />
        <button className="add" onClick={() => setRoute("vision")} aria-label="发送图片"><Icon name="plus" size={18} /></button>
        <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} disabled={busy} />
        <button className="go" onClick={() => send()} disabled={busy || !draft.trim()} aria-label="发送"><Icon name="send" size={16} /></button>
      </div>
      <button className={`mic-btn glass${typeof window !== "undefined" && window.__yukinoRec ? " hot" : ""}`} onClick={onMic} aria-label="语音输入"><Icon name="mic" size={18} /></button>
    </div>
  );
}

function CharactersScreen({ store, setStore, character, setRoute, setEditing, outfits, outfitId, patchSettings }) {
  return (
    <div className="screen">
      <div className="nav-head">
        <h2>角色</h2>
        <div className="desc">设定保存在本机，说话与朗读都走云端服务。</div>
      </div>
      <div className="scroll">
        {store.characters.map((item) => (
          <button key={item.id} className={`char-card glass${item.id === character.id ? " on" : ""}`} onClick={() => {
            const next = ensureConversation({ ...store, activeCharacter: item.id }, item.id);
            setStore(next.state);
          }}>
            <div className="big-av" style={{ width: 52, height: 52, borderRadius: 18 }}><img src="./icon.png" alt="" style={{ width: 32 }} /></div>
            <div className="label" style={{ flex: 1 }}>
              <b style={{ fontSize: 16 }}>{item.name}</b>
              <em>{item.id === character.id ? "当前陪伴" : "轻触切换"} · {item.ttsLanguage === "ja" ? "日语朗读" : "中文朗读"}</em>
            </div>
            {item.id === character.id && <span className="task-pill">使用中</span>}
          </button>
        ))}
        <OutfitPicker outfits={outfits} value={outfitId} onChange={(id) => patchSettings({ outfit: id })} />
        <div className="card glass" style={{ padding: "12px 14px" }}>
          <Row label="角色设定" hint="性格、口吻与不可逾越的边界" onClick={() => { setEditing(character); setRoute("character-edit"); }} />
          <Row label="朗读语言" hint="日语使用译文，中文使用原文" value={character.ttsLanguage === "ja" ? "日本語" : "中文"} onClick={() => setStore((prev) => ({ ...prev, characters: prev.characters.map((item) => item.id === character.id ? { ...item, ttsLanguage: item.ttsLanguage === "ja" ? "zh" : "ja" } : item) }))} />
          <Row label="音色" hint="使用语音合成服务中的音色名" value={character.voice || "默认"} onClick={() => { setEditing(character); setRoute("character-edit"); }} />
        </div>
        <button className="plus-card glass" onClick={() => { setEditing({ id: newId(), name: "", title: "", persona: "", ttsLanguage: "ja", voice: "", builtin: false }); setRoute("character-edit"); }}>＋  新建角色</button>
        <p className="hint">新建时只需名字和设定。对话会使用你在「模型与 API」里分配的对话服务。</p>
      </div>
    </div>
  );
}

function CharacterEditScreen({ editing, setEditing, setStore, setRoute }) {
  if (!editing) return null;
  const isNew = !editing.builtin && !arguments[0];
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("characters")}>‹ 角色</button>
        <h2>{editing.builtin ? "角色设定" : editing.name || "新建角色"}</h2>
        <div className="desc">这些文字只保存在这台设备上。</div>
      </div>
      <div className="scroll no-tab">
        <div className="card glass">
          <div className="field"><label>名字</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例如 雪乃" disabled={editing.builtin} /></div>
          <div className="field"><label>角色设定</label><textarea value={editing.persona} onChange={(e) => setEditing({ ...editing, persona: e.target.value })} placeholder={editing.builtin ? "可选：补充你希望她记住的相处方式" : "写下性格、口吻与不能越过的边界"} /></div>
          <div className="field"><label>音色名（可选）</label><input value={editing.voice} onChange={(e) => setEditing({ ...editing, voice: e.target.value })} placeholder="留空则使用服务默认音色" /></div>
        </div>
        <button className="cta" onClick={() => {
          if (!editing.name.trim()) return;
          setStore((prev) => {
            const exists = prev.characters.some((item) => item.id === editing.id);
            const characters = exists ? prev.characters.map((item) => item.id === editing.id ? editing : item) : [...prev.characters, editing];
            return { ...prev, characters, activeCharacter: editing.id };
          });
          setRoute("characters");
        }}>保存</button>
        {!editing.builtin && <button className="cta ghost" onClick={() => {
          setStore((prev) => ({ ...prev, characters: prev.characters.filter((item) => item.id !== editing.id), activeCharacter: "yukino" }));
          setRoute("characters");
        }}>删除角色</button>}
      </div>
    </div>
  );
}

function SettingsScreen({ store, character, setRoute }) {
  const hours = Math.max(1, Math.round(store.conversations.reduce((sum, item) => sum + item.messages.length, 0) / 8));
  return (
    <div className="screen">
      <div className="nav-head">
        <h2>设置</h2>
        <div className="desc">服务、角色与外观都在这里，不再管理本机模型。</div>
      </div>
      <div className="scroll">
        <div className="profile glass">
          <div className="big-av"><img src="./icon.png" alt="" /></div>
          <div>
            <h3>{character.name}</h3>
            <p>当前陪伴 · 设定保存在本机</p>
          </div>
        </div>
        <div className="stats">
          <div className="stat glass"><b>{hours} 时</b><span>对话规模</span></div>
          <div className="stat glass"><b>{langLabel(store.settings.bubbleLanguage)}</b><span>显示语言</span></div>
          <div className="stat glass"><b>云端</b><span>全部服务</span></div>
        </div>
        <div className="card tight glass">
          <Row glyph="钥" color="#2d5fa3" label="模型与 API" hint="密钥、接口与任务分配" value={serviceFor(store, "chat")?.name || "未配置"} onClick={() => setRoute("api")} />
          <Row glyph="译" color="#2e7d78" label="双语与翻译" hint="显示语言与云端翻译" value="中 / 日" onClick={() => setRoute("translation")} />
          <Row glyph="声" color="#6b4aa0" label="语音" hint="识别与朗读，全部走 API" value={serviceFor(store, "tts")?.name || "未配置"} onClick={() => setRoute("voice")} />
          <Row glyph="视" color="#c46b32" label="视觉" hint="相册或摄像头，确认后再发送" onClick={() => setRoute("vision")} />
        </div>
        <div className="card tight glass">
          <Row glyph="角" color="#3d516c" label="角色管理" hint="设定、音色与人物" onClick={() => setRoute("characters")} />
          <Row glyph="忆" color="#b85a72" label="个人记忆" hint="由你决定哪些事被记住" onClick={() => setRoute("memory")} />
          <Row glyph="景" color="#3d8a52" label="外观与场景" hint="服装与课堂、夜色、樱道" value={SCENES.find((item) => item.id === store.settings.scene)?.label} onClick={() => setRoute("scenes")} />
        </div>
      </div>
    </div>
  );
}

function ApiScreen({ store, setStore, setRoute, setEditing, setError, setNotice }) {
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("settings")}>‹ 设置</button>
        <h2>模型与 API</h2>
        <div className="desc">一项服务可被多个任务共用，密钥只保存在本机。</div>
      </div>
      <div className="scroll no-tab">
        <div className="card glass" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#51657e", marginBottom: 10 }}>任务分配</div>
          {TASKS.map((task) => {
            const service = serviceFor(store, task.id);
            return <Row key={task.id} label={task.label} hint={task.hint} value={service ? serviceLabel(service) : "未配置"} onClick={() => {
              if (!store.services.length) { setRoute("api-add"); return; }
              const ids = ["", ...store.services.map((item) => item.id)];
              const current = store.routes[task.id] || "";
              const next = ids[(ids.indexOf(current) + 1) % ids.length];
              setStore((prev) => ({ ...prev, routes: { ...prev.routes, [task.id]: next } }));
            }} />;
          })}
        </div>
        {store.services.length > 0 && (
          <div className="card tight glass">
            {store.services.map((item) => (
              <Row key={item.id} glyph={providerById(item.providerId).mark} color={providerById(item.providerId).color} label={item.name} hint={item.base.replace(/^https?:\/\//, "")} value={item.verified ? "已连接" : "已保存"} onClick={() => { setEditing(item); setRoute("api-add"); }} />
            ))}
          </div>
        )}
        <button className="cta" onClick={() => { setEditing(null); setRoute("api-add"); }}>添加 API</button>
        <p className="hint">不再提供本机对话模型。所有回复、翻译和语音都通过上面的任务路由发送到对应服务。轻触任务行可在已保存的服务之间轮换。</p>
      </div>
    </div>
  );
}

function ApiAddScreen({ store, setStore, setRoute, editing, setEditing, setError, setNotice }) {
  const initial = editing && editing.base ? editing : { id: newId(), providerId: "deepseek", name: "DeepSeek", base: providerById("deepseek").base, key: "", model: providerById("deepseek").defaultModel, speechModel: "", verified: false };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pick = (providerId) => {
    const provider = providerById(providerId);
    setForm((prev) => ({ ...prev, providerId, name: provider.name, base: provider.base || prev.base, model: provider.defaultModel || prev.model }));
  };
  const save = (verified = form.verified) => {
    const problem = validateBase(form.base);
    if (problem) { setError(problem); return; }
    if (!form.key.trim()) { setError("请填写 API 密钥"); return; }
    const entry = { ...form, verified, name: form.name || providerById(form.providerId).name };
    setStore((prev) => {
      const exists = prev.services.some((item) => item.id === entry.id);
      const services = exists ? prev.services.map((item) => item.id === entry.id ? entry : item) : [...prev.services, entry];
      const routes = { ...prev.routes };
      if (!routes.chat) routes.chat = entry.id;
      return { ...prev, services, routes };
    });
    setRoute("api");
    setNotice("已保存到本机");
  };
  const test = async () => {
    setBusy(true);
    try {
      const result = await testConnection({ service: form });
      setNotice(result.message);
      if (result.models?.length && !form.model) setForm((prev) => ({ ...prev, model: result.models[0], verified: true }));
      else setForm((prev) => ({ ...prev, verified: true }));
    } catch (err) {
      setError(err.message || "连接失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("api")}>‹ 模型与 API</button>
        <h2>{editing?.base ? "编辑服务" : "添加服务"}</h2>
        <div className="desc">选择服务商，填写接口与密钥，测试后再保存。</div>
      </div>
      <div className="scroll no-tab">
        <div className="provider-grid">
          {PROVIDERS.map((item) => (
            <button key={item.id} className={`tile glass${form.providerId === item.id ? " on" : ""}`} onClick={() => pick(item.id)}>
              <div className="mark" style={{ background: item.color }}>{item.mark}</div>
              {item.name}
            </button>
          ))}
        </div>
        <div className="card glass">
          <div className="field"><label>接口地址</label><input value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} placeholder="https://" /></div>
          <div className="field"><label>API 密钥</label><input type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="只保存在这台设备上" /></div>
          <div className="field"><label>默认模型</label><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="例如 deepseek-chat" /></div>
        </div>
        <button className="cta ghost" onClick={test} disabled={busy}>{busy ? "正在测试…" : "测试连接"}</button>
        <button className="cta" onClick={() => save(form.verified)}>保存并用于对话</button>
        {editing?.base && <button className="cta ghost" onClick={() => {
          setStore((prev) => ({
            ...prev,
            services: prev.services.filter((item) => item.id !== form.id),
            routes: Object.fromEntries(Object.entries(prev.routes).map(([task, id]) => [task, id === form.id ? "" : id]))
          }));
          setRoute("api");
        }}>删除此服务</button>}
      </div>
    </div>
  );
}

function TranslationScreen({ store, patchSettings, setRoute }) {
  const service = serviceFor(store, "translation") || serviceFor(store, "chat");
  const lang = store.settings.bubbleLanguage;
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("settings")}>‹ 设置</button>
        <h2>双语与翻译</h2>
        <div className="desc">本地翻译模型已移除，译文只通过 API 生成。</div>
      </div>
      <div className="scroll no-tab">
        <div className="card glass">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#51657e", marginBottom: 8 }}>显示语言</div>
          <div className="seg glass">
            {[["zh", "中文"], ["bilingual", "双语"], ["ja", "日本語"]].map(([id, label]) => (
              <button key={id} className={lang === id ? "on" : ""} onClick={() => patchSettings({ bubbleLanguage: id })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="card tight glass">
          <Row label="翻译服务" hint="关闭双语或未配置时只保留原文，不会悄悄计费" value={service ? service.name : "未配置"} onClick={() => setRoute("api")} />
          <Row label="使用模型" value={service?.model || "—"} />
        </div>
        <div className="card glass">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#51657e", marginBottom: 8 }}>气泡预览</div>
          <div className="msg bot glass" style={{ maxWidth: "100%" }}>
            <div className="zh">随你。不过不要发出那种影响看书的声音。</div>
            {lang !== "zh" && <div className="ja">好きにすればいいわ。ただし、読書の邪魔になる音は立てないで。</div>}
          </div>
        </div>
        <p className="hint">翻译失败时，中文回复仍会显示，不会为了朗读而自动改走别的收费服务。</p>
      </div>
    </div>
  );
}

function VoiceScreen({ store, patchSettings, setRoute, character, setNotice, setError, speakText, lastAssistant }) {
  const asr = serviceFor(store, "asr");
  const tts = serviceFor(store, "tts");
  const trial = lastAssistant || { contentZh: "放课后还留在教室，是有什么事吗。", contentJa: "放課後まで残っているなんて、何か用かしら。" };
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("settings")}>‹ 设置</button>
        <h2>语音</h2>
        <div className="desc">识别与合成都走云端。本机语音引擎已移除。</div>
      </div>
      <div className="scroll no-tab">
        <div className="card tight glass">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#51657e", padding: "10px 4px 0" }}>语音输入</div>
          <Row label="识别服务" value={asr ? asr.name : "未配置"} onClick={() => setRoute("api")} />
          <Row label="说话方式" value="点击麦克风开始，再次点击结束" />
        </div>
        <div className="card tight glass">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#51657e", padding: "10px 4px 0" }}>语音输出</div>
          <Row label="合成服务" value={tts ? tts.name : "未配置"} onClick={() => setRoute("api")} />
          <Row label="自动朗读" onClick={() => patchSettings({ autoSpeak: !store.settings.autoSpeak })} trailing={<Toggle on={store.settings.autoSpeak} />} />
          <div className="row">
            <div className="label"><b>音量</b></div>
            <input className="slider" type="range" min="0" max="1" step="0.05" value={store.settings.voiceVolume} style={{ "--pct": `${store.settings.voiceVolume * 100}%` }} onChange={(e) => patchSettings({ voiceVolume: Number(e.target.value) })} />
          </div>
        </div>
        <button className="cta ghost" onClick={() => speakText({ ...trial, contentZh: character.ttsLanguage === "zh" ? trial.contentZh : trial.contentZh, contentJa: trial.contentJa }).catch((err) => setError(err.message))}>试听当前音色</button>
        <p className="hint">朗读使用角色设置中的语言。日语朗读需要可用的译文；未配置翻译时不会自动改走其他收费服务。</p>
      </div>
    </div>
  );
}

function ScenesScreen({ store, patchSettings, setRoute, outfits, outfitId }) {
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("settings")}>‹ 设置</button>
        <h2>外观与场景</h2>
        <div className="desc">场景在设备上绘制。天气接口可按需开启。</div>
      </div>
      <div className="scroll no-tab">
        <OutfitPicker outfits={outfits} value={outfitId} onChange={(id) => patchSettings({ outfit: id })} title="服装" />
        <div className="section-kicker">场景</div>
        <div className="scene-grid">
          {SCENES.map((item) => (
            <button key={item.id} className={`scene-tile ${item.thumb}${store.settings.scene === item.id ? " on" : ""}`} onClick={() => patchSettings({ scene: item.id })}>
              <b>{item.label}</b>
            </button>
          ))}
        </div>
        <div className="card tight glass">
          <Row label="流动光泽" hint="玻璃表面的慢速折射动画" onClick={() => patchSettings({ motion: !store.settings.motion })} trailing={<Toggle on={store.settings.motion} />} />
          <Row label="真实日光与天气" hint="暂未接入定位，预留云端天气开关" onClick={() => patchSettings({ weather: !store.settings.weather })} trailing={<Toggle on={store.settings.weather} />} />
        </div>
      </div>
    </div>
  );
}

function MemoryScreen({ store, setStore, setRoute }) {
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("settings")}>‹ 设置</button>
        <h2>个人记忆</h2>
        <div className="desc">由你决定哪些事被记住，并只保存在这台设备上。</div>
      </div>
      <div className="scroll no-tab">
        <div className="card glass">
          <div className="field">
            <label>希望角色记住的事</label>
            <textarea value={store.memory} onChange={(e) => setStore((prev) => ({ ...prev, memory: e.target.value }))} placeholder="例如：我平时晚上才有空聊天。" />
          </div>
          <Row label="在对话中使用这些记忆" onClick={() => setStore((prev) => ({ ...prev, settings: { ...prev.settings, useMemory: !prev.settings.useMemory } }))} trailing={<Toggle on={store.settings.useMemory} />} />
        </div>
        <button className="cta ghost" onClick={() => setStore((prev) => ({ ...prev, memory: "" }))}>清空记忆</button>
      </div>
    </div>
  );
}

function VisionScreen({ store, setStore, setRoute, setError, character }) {
  const [preview, setPreview] = useState("");
  const [prompt, setPrompt] = useState("请用中文说明这张图片中的内容。");
  const [busy, setBusy] = useState(false);
  const sendImage = async () => {
    const vision = serviceFor(store, "vision") || serviceFor(store, "chat");
    if (!vision) { setError("请先配置视觉或对话服务。"); return; }
    if (!preview) { setError("请先选择一张图片。"); return; }
    setBusy(true);
    try {
      const text = await describeImage({ service: vision, dataUrl: preview, prompt });
      const started = ensureConversation(store, character.id);
      const message = { id: newId(), role: "assistant", contentZh: text, content: text, time: Date.now() };
      const user = { id: newId(), role: "user", contentZh: "[图片] " + prompt, content: "[图片] " + prompt, time: Date.now() };
      const conversation = { ...started.conversation, messages: [...started.conversation.messages, user, message] };
      setStore({ ...started.state, conversations: [conversation, ...started.state.conversations.filter((item) => item.id !== conversation.id)], activeConversation: conversation.id });
      setRoute("chat");
    } catch (err) {
      setError(err.message || "视觉请求失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <div className="nav-head">
        <button className="back" onClick={() => setRoute("settings")}>‹ 设置</button>
        <h2>视觉</h2>
        <div className="desc">先预览，确认后才会把画面发给你配置的视觉服务。</div>
      </div>
      <div className="scroll no-tab">
        <label className="cta ghost">
          选择图片
          <input type="file" accept="image/*" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setPreview(String(reader.result || ""));
            reader.readAsDataURL(file);
          }} />
        </label>
        {preview && <img src={preview} alt="预览" style={{ width: "100%", borderRadius: 20, maxHeight: 280, objectFit: "cover" }} />}
        <div className="field"><label>要问的话</label><input value={prompt} onChange={(e) => setPrompt(e.target.value)} /></div>
        <button className="cta" onClick={sendImage} disabled={busy || !preview}>{busy ? "正在发送…" : "确认发送"}</button>
      </div>
    </div>
  );
}

function Row({ glyph, color, label, hint, value, onClick, trailing }) {
  const content = (
    <>
      {glyph && <div className="glyph" style={{ background: color || "#2d5fa3" }}>{glyph}</div>}
      <div className="label"><b>{label}</b>{hint && <em>{hint}</em>}</div>
      {value && <div className={`value${value === "已连接" ? " ok" : ""}`}>{value}</div>}
      {trailing}
      {onClick && !trailing && <span className="chev" />}
    </>
  );
  return onClick ? <button className="row" onClick={onClick}>{content}</button> : <div className="row">{content}</div>;
}

function Toggle({ on }) {
  return <span className={`toggle${on ? "" : " off"}`}><i /></span>;
}

function langLabel(value) {
  if (value === "ja") return "日本語";
  if (value === "zh") return "中文";
  return "双语";
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// attach character editor route inside App via extra branch
const _CharacterEdit = CharacterEditScreen;
export { _CharacterEdit as CharacterEditScreen };
