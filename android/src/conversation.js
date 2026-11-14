import { newId } from "./storage.js";
import { buildSystemPrompt, completeChat, historyToMessages, parseBilingual } from "./api/chat.js";
import { translateToJapanese } from "./api/translation.js";
import { personaForCharacter } from "./persona/prompt.js";

export function ensureConversation(state, characterId) {
  const existing = state.conversations.find((item) => item.id === state.activeConversation && item.characterId === characterId);
  if (existing) return { state, conversation: existing };
  const open = state.conversations.find((item) => item.characterId === characterId);
  if (open) return { state: { ...state, activeConversation: open.id }, conversation: open };
  const conversation = { id: newId(), characterId, title: "新对话", messages: [], updatedAt: Date.now() };
  return {
    state: { ...state, conversations: [conversation, ...state.conversations], activeConversation: conversation.id },
    conversation
  };
}

export function upsertConversation(state, conversation) {
  const rest = state.conversations.filter((item) => item.id !== conversation.id);
  return { ...state, conversations: [{ ...conversation, updatedAt: Date.now() }, ...rest], activeConversation: conversation.id };
}

export async function sendCompanionMessage({ state, character, text, onStatus }) {
  const chat = service(state, "chat");
  if (!chat) throw new Error("请先在「模型与 API」中配置对话服务。");
  const bilingual = state.settings.bubbleLanguage === "bilingual";
  const jaOnly = state.settings.bubbleLanguage === "ja";
  const sameTranslator = !state.routes.translation || state.routes.translation === state.routes.chat;
  const started = ensureConversation(state, character.id);
  let next = started.state;
  let conversation = {
    ...started.conversation,
    messages: [...started.conversation.messages, { id: newId(), role: "user", content: text, contentZh: text, time: Date.now() }]
  };
  onStatus?.({ phase: "chat", conversation });
  const system = buildSystemPrompt({
    personaText: personaForCharacter(character),
    extraPersona: "",
    memory: next.memory,
    useMemory: next.settings.useMemory,
    bilingual: bilingual && sameTranslator
  });
  const raw = await completeChat({
    service: chat,
    messages: [{ role: "system", content: system }, ...historyToMessages(conversation.messages)]
  });
  let zh = raw, ja = "";
  if (bilingual && sameTranslator) {
    const parsed = parseBilingual(raw);
    zh = parsed.zh || raw;
    ja = parsed.ja;
  } else {
    zh = raw;
  }
  if ((bilingual || (jaOnly && character.ttsLanguage === "ja")) && !ja) {
    const translator = service(next, "translation") || (sameTranslator ? null : null);
    const translationService = service(next, "translation");
    if (translationService) {
      onStatus?.({ phase: "translate", conversation });
      try { ja = await translateToJapanese({ service: translationService, text: zh, characterHint: character.name }); }
      catch (error) { console.warn(error); }
    }
  }
  if (jaOnly && ja) zh = ja;
  conversation = {
    ...conversation,
    title: conversation.messages.length <= 1 ? text.slice(0, 18) : conversation.title,
    messages: [...conversation.messages, { id: newId(), role: "assistant", contentZh: zh, contentJa: ja, content: zh, time: Date.now() }]
  };
  next = upsertConversation(next, conversation);
  return { state: next, conversation, reply: conversation.messages.at(-1) };
}

function service(state, task) {
  const id = state.routes[task];
  return state.services.find((item) => item.id === id) || null;
}
