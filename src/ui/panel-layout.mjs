export const MIN_CHARACTER_WIDTH = 168;
export const MAX_CHARACTER_WIDTH = 460;
export const MIN_CHAT_WIDTH = 310;
export function characterWidthBounds(contentWidth, gap = 18) {
  const available = Math.max(0, Number(contentWidth) || 0);
  return {min:MIN_CHARACTER_WIDTH, max:Math.max(MIN_CHARACTER_WIDTH, Math.min(MAX_CHARACTER_WIDTH, available - MIN_CHAT_WIDTH - gap))};
}
export function clampCharacterWidth(width, contentWidth, gap = 18) {
  const bounds = characterWidthBounds(contentWidth, gap);
  const candidate = Number.isFinite(Number(width)) ? Number(width) : 290;
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, candidate)));
}
export function sideFromPointer(clientX, left, width) {
  return clientX < left + width / 2 ? 'left' : 'right';
}
