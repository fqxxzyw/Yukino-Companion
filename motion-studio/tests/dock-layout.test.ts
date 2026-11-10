import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDock, dockPanel, findDockDestination, measureDock, minimumSize, panelIds, readDock, resizeDock } from '../src/dock-layout.ts';

const viewport = { width: 1520, height: 900 };

test('outer docking makes a full row or column without removing or duplicating panes', () => {
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const layout = dockPanel(defaultDock, 'timeline', { kind: 'edge', side });
    const { panels, splitters } = measureDock(layout, viewport);
    assert.equal(splitters.length, 3);
    assert.deepEqual([...panels.keys()].sort(), [...panelIds].sort());
    const moved = panels.get('timeline')!;
    if (side === 'left' || side === 'right') {
      assert.equal(moved.top, 0);
      assert.equal(moved.height, viewport.height);
      assert.equal(side === 'left' ? moved.left : moved.left + moved.width, side === 'left' ? 0 : viewport.width);
    } else {
      assert.equal(moved.left, 0);
      assert.equal(moved.width, viewport.width);
      assert.equal(side === 'top' ? moved.top : moved.top + moved.height, side === 'top' ? 0 : viewport.height);
    }
  }
  assert.equal(dockPanel(defaultDock, 'timeline', { kind: 'edge', side: 'bottom' }), defaultDock);
});

test('both axes resize independently and cramped viewports preserve minimum pane sizes', () => {
  const changed = resizeDock(resizeDock(defaultDock, '', 0.56), '1', 0.22);
  const before = measureDock(defaultDock, viewport).panels;
  const after = measureDock(changed, viewport).panels;
  assert.ok(after.get('library')!.width > before.get('library')!.width);
  assert.ok(after.get('timeline')!.height > before.get('timeline')!.height);
  const crowded = measureDock(changed, { width: 100, height: 100 });
  assert.deepEqual(crowded.canvas, minimumSize(changed));
  for (const pane of crowded.panels.values()) assert.ok(pane.width > 0 && pane.height > 0);
});

test('layout persists across JSON round-trip and invalid or duplicate panels restore defaults', () => {
  const custom = dockPanel(defaultDock, 'inspector', { kind: 'edge', side: 'top' });
  assert.deepEqual(readDock(JSON.stringify(custom)), custom);
  assert.equal(readDock('{'), defaultDock);
  assert.equal(readDock(JSON.stringify({ ...defaultDock, second: 'library' })), defaultDock);
  assert.equal(readDock(JSON.stringify({ ...defaultDock, ratio: 1 })), defaultDock);
});

test('center swaps preserve slots and only work inside a different pane', () => {
  const bounds = { ...viewport, left: 0, top: 0 };
  const { panels } = measureDock(defaultDock, viewport);
  const inspector = panels.get('inspector')!;
  const library = panels.get('library')!;
  const destination = findDockDestination(inspector.left + inspector.width / 2, inspector.top + inspector.height / 2, bounds, panels, 'library');
  assert.deepEqual(destination, { kind: 'swap', target: 'inspector' });
  const moved = measureDock(dockPanel(defaultDock, 'library', destination!), viewport).panels;
  assert.deepEqual(moved.get('library'), inspector);
  assert.deepEqual(moved.get('inspector'), library);
  assert.equal(findDockDestination(library.left + library.width / 2, library.top + library.height / 2, bounds, panels, 'library'), null);
  assert.equal(findDockDestination(inspector.left - 3, inspector.top + 50, bounds, panels, 'library'), null);
});

test('only the visible workspace edges create rows or columns, and outside drops cancel', () => {
  const { panels } = measureDock(defaultDock, viewport);
  const bounds = { ...viewport, left: 8, top: 10 };
  assert.deepEqual(findDockDestination(14, 300, bounds, panels, 'inspector'), { kind: 'edge', side: 'left' });
  assert.deepEqual(findDockDestination(1510, 300, bounds, panels, 'inspector'), { kind: 'edge', side: 'right' });
  assert.deepEqual(findDockDestination(500, 16, bounds, panels, 'inspector'), { kind: 'edge', side: 'top' });
  assert.deepEqual(findDockDestination(500, 905, bounds, panels, 'inspector'), { kind: 'edge', side: 'bottom' });
  assert.equal(findDockDestination(500, 9, bounds, panels, 'inspector'), null);
});
