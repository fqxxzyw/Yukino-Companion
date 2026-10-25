export function formatDuration(ms = 0) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (minutes < 1) return '不到 1 分钟';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ''}` : `${minutes} 分钟`;
}
export const CLOSE_ACTIONS = [
  { value: 'ask', label: '每次询问' },
  { value: 'quit', label: '完全退出' },
  { value: 'model', label: '只留下人物模型' },
  { value: 'pet', label: '只留下 Q 版桌宠' },
  { value: 'both', label: '人物模型与桌宠都保留' },
];
export const DESKTOP_MODES = [
  { value: 'none', label: '暂不显示' },
  { value: 'model', label: '人物模型' },
  { value: 'pet', label: 'Q 版桌宠' },
  { value: 'both', label: '同时显示' },
];
