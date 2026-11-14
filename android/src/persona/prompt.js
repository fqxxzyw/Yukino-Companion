import compactText from "./compact.md?raw";

export { compactText };

export function personaForCharacter(character) {
  if (character?.id === "yukino" || character?.builtin) {
    const extra = character?.persona ? `\n\n【这一次额外的设定】\n${character.persona}` : "";
    return compactText + extra;
  }
  const name = character?.name || "角色";
  const body = character?.persona || `请以${name}的身份与用户进行日常交流。`;
  return `你现在是「${name}」。用第一人称自然交谈，不要主动声明自己是 AI 或数字人。\n\n${body}`;
}
