// Keep the last visible pose at the end of a stopped preview. Individual clips
// still release normally when they end before the project does.
export function previewTime(time: number, duration: number) {
  return duration > 0 && time >= duration ? Math.max(0, duration - 0.000001) : time;
}
