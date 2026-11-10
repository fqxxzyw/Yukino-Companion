import type { RigControl } from './viewport.ts';

export type Eye = 'blink' | 'blinkLeft' | 'blinkRight';
export type ExpressionWeights = Record<string, number>;

export function eyeCapabilities(controls: RigControl[]) {
  const ids = new Set(controls.map(({ id }) => id));
  const left = ids.has('blinkLeft');
  const right = ids.has('blinkRight');
  return { blink: ids.has('blink') || (left && right), blinkLeft: left, blinkRight: right };
}

export function expressionWeight(weights: ExpressionWeights, id: string, fallback = 0) {
  if (id === 'blinkLeft' || id === 'blinkRight') {
    return (weights.blink ?? 0) > 0 ? weights.blink! : weights[id] ?? weights.blink ?? fallback;
  }
  if (id === 'blink' && !(weights.blink && weights.blink > 0)
    && (weights.blinkLeft !== undefined || weights.blinkRight !== undefined)) {
    return Math.min(weights.blinkLeft ?? weights.blink ?? fallback, weights.blinkRight ?? weights.blink ?? fallback);
  }
  return weights[id] ?? fallback;
}

export function expressionInput(
  id: string, value: number, eyes: ReturnType<typeof eyeCapabilities>,
): ExpressionWeights {
  if (id === 'blink' && eyes.blinkLeft && eyes.blinkRight) return { blinkLeft: value, blinkRight: value };
  return { [id]: value };
}

export function overlayExpressions(
  timeline: ExpressionWeights, manual: ExpressionWeights, eyes: ReturnType<typeof eyeCapabilities>,
): ExpressionWeights {
  const result = { ...timeline, ...manual };
  if (manual.blink !== undefined) {
    delete result.blinkLeft;
    delete result.blinkRight;
  } else if (manual.blinkLeft !== undefined || manual.blinkRight !== undefined) {
    // When a timeline blink is bilateral, route its remaining half to the untouched eye.
    if (eyes.blinkLeft && eyes.blinkRight && timeline.blink !== undefined) {
      result.blinkLeft = manual.blinkLeft ?? expressionWeight(timeline, 'blinkLeft');
      result.blinkRight = manual.blinkRight ?? expressionWeight(timeline, 'blinkRight');
    }
    delete result.blink;
  }
  return result;
}
