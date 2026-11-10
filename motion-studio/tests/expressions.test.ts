import assert from 'node:assert/strict';
import test from 'node:test';
import { expressionInput, expressionWeight, overlayExpressions } from '../src/expressions.ts';

const independent = { blink: true, blinkLeft: true, blinkRight: true };

test('bilateral buttons remain independently editable and leave mouth weights alone', () => {
  const both = expressionInput('blink', 1, independent);
  assert.deepEqual(both, { blinkLeft: 1, blinkRight: 1 });
  const leftOpen = { ...both, ...expressionInput('blinkLeft', 0, independent) };
  const result = overlayExpressions({ smile: 0.27 }, leftOpen, independent);
  assert.deepEqual(result, { blinkLeft: 0, blinkRight: 1, smile: 0.27 });
  assert.equal(expressionWeight(result, 'blink'), 0);
});

test('manual mouth weights coexist with native blink, and a unilateral override preserves its opposite eye', () => {
  const timeline = { blink: 0.86, blinkRight: 0, smile: 0.1 };
  assert.equal(expressionWeight(timeline, 'blinkRight'), 0.86);
  assert.deepEqual(overlayExpressions(timeline, { smile: 0.42 }, independent), { ...timeline, smile: 0.42 });
  assert.deepEqual(overlayExpressions(timeline, { blinkLeft: 0, smile: 0.42 }, independent),
    { blinkLeft: 0, blinkRight: 0.86, smile: 0.42 });
  assert.equal(expressionWeight({}, 'smile', 0.09645), 0.09645);
});
