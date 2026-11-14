import { joinEndpoint } from "./providers.js";
import { apiRequest, authHeaders, apiErrorMessage } from "./http.js";

export function defaultSpeechModel(task, providerId) {
  if (task === "tts") {
    if (providerId === "aliyun") return "qwen-tts";
    if (providerId === "siliconflow") return "FunAudioLLM/CosyVoice2-0.5B";
    return "tts-1";
  }
  if (providerId === "aliyun") return "paraformer-realtime-v2";
  if (providerId === "siliconflow") return "FunAudioLLM/SenseVoiceSmall";
  return "whisper-1";
}

export async function synthesizeSpeech({ service, text, voice = "", speed = 1 }) {
  const input = String(text || "").trim();
  if (!input) throw new Error("没有可朗读的文字。");
  if (!service?.base || !service?.key) throw new Error("请先配置语音合成服务和密钥。");
  const model = service.speechModel || service.model || defaultSpeechModel("tts", service.providerId);
  const url = joinEndpoint(service.base, "/v1/audio/speech");
  const res = await apiRequest({
    url,
    method: "POST",
    headers: authHeaders(service.key),
    body: { model, input, voice: voice || "alloy", speed },
    timeout: 60000,
    responseType: "bytes"
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(apiErrorMessage(res.status, typeof res.data === "string" ? res.data : res.data));
  }
  return res.data;
}

export function audioUrlFromData(data, mime = "audio/mpeg") {
  if (typeof data === "string") {
    const raw = data.startsWith("data:") ? data : `data:${mime};base64,${data}`;
    return raw;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  return URL.createObjectURL(blob);
}

export async function transcribeAudio({ service, blob, language = "zh" }) {
  if (!service?.base || !service?.key) throw new Error("请先配置语音识别服务和密钥。");
  if (!blob) throw new Error("没有录到声音。");
  const model = service.speechModel || service.model || defaultSpeechModel("asr", service.providerId);
  const url = joinEndpoint(service.base, "/v1/audio/transcriptions");
  const form = new FormData();
  form.append("file", blob, "speech.webm");
  form.append("model", model);
  if (language) form.append("language", language);

  // CapacitorHttp does not reliably send multipart FormData; use fetch on both
  // web and native when CapacitorHttp patch is enabled it still supports FormData
  // via native fetch for some versions. We try fetch first.
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${service.key}` },
    body: form
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  if (!res.ok) throw new Error(apiErrorMessage(res.status, data));
  const transcript = data.text || data.data?.text || "";
  if (!String(transcript).trim()) throw new Error("识别服务没有返回文字。");
  return String(transcript).trim();
}
