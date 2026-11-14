const KEY = "yukino.companion.state.v1";

export const defaultCharacter = {
  id: "yukino",
  name: "雪之下雪乃",
  title: "侍奉委员长",
  persona: "",
  ttsLanguage: "ja",
  voice: "",
  builtin: true
};

export function emptyState() {
  return {
    services: [],
    routes: { chat: "", translation: "", asr: "", tts: "", vision: "" },
    settings: {
      bubbleLanguage: "bilingual",
      autoSpeak: true,
      holdToTalk: true,
      voiceVolume: 0.7,
      voiceRate: 1,
      ttsVoice: "",
      theme: "system",
      motion: true,
      weather: false,
      useMemory: true,
      scene: "classroom",
      outfit: "summer-uniform"
    },
    characters: [defaultCharacter],
    activeCharacter: "yukino",
    memory: "",
    conversations: [],
    activeConversation: ""
  };
}

export function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const services = Array.isArray(raw.services) ? raw.services.filter((item) => item && item.id && item.base).map((item) => ({
    id: String(item.id),
    providerId: String(item.providerId || "custom"),
    name: String(item.name || "未命名服务"),
    base: String(item.base || ""),
    key: String(item.key || ""),
    model: String(item.model || ""),
    speechModel: String(item.speechModel || ""),
    verified: Boolean(item.verified)
  })) : [];
  const routes = { ...base.routes, ...(raw.routes || {}) };
  for (const task of Object.keys(routes)) {
    if (routes[task] && !services.some((item) => item.id === routes[task])) routes[task] = "";
  }
  const characters = Array.isArray(raw.characters) && raw.characters.length
    ? raw.characters.map((item) => ({
        id: String(item.id || cryptoRandom()),
        name: String(item.name || "未命名角色"),
        title: String(item.title || ""),
        persona: String(item.persona || ""),
        ttsLanguage: item.ttsLanguage === "zh" ? "zh" : "ja",
        voice: String(item.voice || ""),
        builtin: Boolean(item.builtin)
      }))
    : [defaultCharacter];
  if (!characters.some((item) => item.id === "yukino")) characters.unshift(defaultCharacter);
  const conversations = Array.isArray(raw.conversations) ? raw.conversations : [];
  return {
    services,
    routes,
    settings: { ...base.settings, ...(raw.settings || {}) },
    characters,
    activeCharacter: characters.some((item) => item.id === raw.activeCharacter) ? raw.activeCharacter : characters[0].id,
    memory: String(raw.memory || ""),
    conversations,
    activeConversation: String(raw.activeConversation || "")
  };
}

function cryptoRandom() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export { cryptoRandom as newId };

export async function loadState() {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(KEY);
      return normalizeState(raw ? JSON.parse(raw) : null);
    }
  } catch {}
  return emptyState();
}

export async function saveState(state) {
  const normalized = normalizeState(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn("保存设置失败", error);
  }
  return normalized;
}

export function serviceFor(state, task) {
  const id = state.routes?.[task];
  return state.services.find((item) => item.id === id) || null;
}

export function serviceLabel(service) {
  if (!service) return "未配置";
  return service.model ? `${service.name} · ${service.model}` : service.name;
}
