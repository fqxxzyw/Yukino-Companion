import { moduleRequirements } from './motion/index.ts';
import type { MotionModule } from './motion/index.ts';
import type { RigInfo } from './viewport.ts';

export function compatibility(module: MotionModule, rig: RigInfo | null) {
  if (!rig) return '';
  if (module.modelId && module.modelId !== rig.id) return '需要原始角色资源';
  const missing = moduleRequirements(module).filter(({ type, key }) => {
    const controls = type === 'expression' ? rig.expressions : rig.bones;
    if (type === 'expression' && key === 'blink' && ['blinkLeft', 'blinkRight'].every((side) => controls.some((control) => control.id === side))) {
      return false;
    }
    return !controls.some((control) => control.id === key);
  });
  return missing.length ? `缺少 ${missing.map((item) => item.key).join('、')}` : '';
}
