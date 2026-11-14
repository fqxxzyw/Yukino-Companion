import { completeChat } from "./chat.js";

export const TRANSLATION_SYSTEM = "你是严谨的中日翻译。把用户给出的中文译为自然、口语化的日语，语气与原文一致。只输出日语译文，不要解释，不要重复中文。";

export async function translateToJapanese({ service, text, characterHint = "" }) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (!service?.base || !service?.key) throw new Error("请先配置翻译服务和密钥。");
  const system = characterHint
    ? `${TRANSLATION_SYSTEM}\n译文需要符合以下角色的说话方式：${characterHint}`
    : TRANSLATION_SYSTEM;
  const translated = await completeChat({
    service,
    messages: [
      { role: "system", content: system },
      { role: "user", content: source }
    ]
  });
  return String(translated).trim();
}
