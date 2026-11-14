export const PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", mark: "DS", color: "#1648a0", base: "https://api.deepseek.com", defaultModel: "deepseek-chat", tasks: ["chat", "translation"] },
  { id: "aliyun", name: "阿里云", mark: "云", color: "#ff6a00", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus", tasks: ["chat", "translation", "asr", "tts", "vision"] },
  { id: "openai", name: "OpenAI", mark: "AI", color: "#111111", base: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", tasks: ["chat", "translation", "asr", "tts", "vision"] },
  { id: "siliconflow", name: "硅基流动", mark: "硅", color: "#6c5ce7", base: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-7B-Instruct", tasks: ["chat", "translation", "asr", "tts"] },
  { id: "moonshot", name: "Kimi", mark: "K", color: "#1a1a1a", base: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-auto", tasks: ["chat", "translation"] },
  { id: "zhipu", name: "智谱", mark: "智", color: "#1a7aff", base: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash", tasks: ["chat", "translation", "vision"] },
  { id: "openrouter", name: "OpenRouter", mark: "OR", color: "#3b82f6", base: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini", tasks: ["chat", "translation", "vision"] },
  { id: "custom", name: "兼容接口", mark: "自", color: "#2d5fa3", base: "", defaultModel: "", tasks: ["chat", "translation", "asr", "tts", "vision"] }
];

export const TASKS = [
  { id: "chat", label: "对话", hint: "生成角色回复" },
  { id: "translation", label: "翻译", hint: "中文到日语" },
  { id: "asr", label: "语音识别", hint: "说话转文字" },
  { id: "tts", label: "语音合成", hint: "角色朗读" },
  { id: "vision", label: "视觉", hint: "理解图片" }
];

export function providerById(id) {
  return PROVIDERS.find((item) => item.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

export function normalizeBase(base) {
  return String(base || "").trim().replace(/\/+$/, "");
}

export function joinEndpoint(base, path) {
  const root = normalizeBase(base);
  if (!root) throw new Error("请先填写接口地址");
  let suffix = path.startsWith("/") ? path : `/${path}`;
  if (/\/v\d+$/.test(root) && /^\/v\d+\//.test(suffix)) suffix = suffix.replace(/^\/v\d+/, "");
  return root + suffix;
}

export function validateBase(base) {
  const value = normalizeBase(base);
  let url;
  try { url = new URL(value); } catch { return "接口地址无效"; }
  if (!["https:", "http:"].includes(url.protocol)) return "接口地址必须是 http 或 https";
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return "仅本机地址可以使用 http，其他地址请使用 https";
  if (url.username || url.password || url.search || url.hash) return "接口地址不要包含密钥、查询参数或片段";
  return "";
}
