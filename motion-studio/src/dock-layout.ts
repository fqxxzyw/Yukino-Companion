export const panelIds = ['library', 'preview', 'inspector', 'timeline'] as const;
export type PanelId = typeof panelIds[number];
export type Axis = 'x' | 'y';
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type DockDestination = { kind: 'edge'; side: DockSide } | { kind: 'swap'; target: PanelId };

export type DockLayout = PanelId | { axis: Axis; ratio: number; first: DockLayout; second: DockLayout };
export type Size = { width: number; height: number };
export type Rect = Size & { left: number; top: number };
type Splitter = Rect & {
  path: string; axis: Axis; position: number; available: number;
  minimum: number; maximum: number; before: PanelId; after: PanelId;
};

export const defaultDock = {
  axis: 'y', ratio: 0.63, second: 'timeline',
  first: { axis: 'x', ratio: 0.15, first: 'library', second: { axis: 'x', ratio: 0.78, first: 'preview', second: 'inspector' } },
} satisfies DockLayout;

const gap = 6;
const sizes: Record<PanelId, Size> = {
  library: { width: 156, height: 145 },
  preview: { width: 290, height: 220 },
  inspector: { width: 208, height: 172 },
  timeline: { width: 386, height: 172 },
};

export function readDock(text: string | null): DockLayout {
  if (!text) return defaultDock;
  const seen = new Set<PanelId>();
  function parse(input: unknown, depth: number): DockLayout {
    if (typeof input === 'string' && panelIds.includes(input as PanelId) && !seen.has(input as PanelId)) {
      seen.add(input as PanelId);
      return input as PanelId;
    }
    if (depth >= panelIds.length - 1 || !input || typeof input !== 'object') throw new Error('布局数据无效');
    const { axis, ratio, first, second } = input as Record<string, unknown>;
    if ((axis !== 'x' && axis !== 'y') || typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
      throw new Error('布局比例无效');
    }
    return { axis, ratio, first: parse(first, depth + 1), second: parse(second, depth + 1) };
  }
  try {
    const layout = parse(JSON.parse(text), 0);
    return seen.size === panelIds.length ? layout : defaultDock;
  } catch {
    return defaultDock;
  }
}

export function minimumSize(layout: DockLayout): Size {
  if (typeof layout === 'string') return sizes[layout];
  const first = minimumSize(layout.first);
  const second = minimumSize(layout.second);
  return layout.axis === 'x'
    ? { width: first.width + second.width + gap, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + second.height + gap };
}

function extent(rect: Size, axis: Axis) { return axis === 'x' ? rect.width : rect.height; }
function edgePanel(layout: DockLayout, branch: 'first' | 'second'): PanelId {
  return typeof layout === 'string' ? layout : edgePanel(layout[branch], branch);
}

export function measureDock(layout: DockLayout, viewport: Size) {
  const minimum = minimumSize(layout);
  const canvas = { width: Math.max(viewport.width, minimum.width), height: Math.max(viewport.height, minimum.height) };
  const panels = new Map<PanelId, Rect>();
  const splitters: Splitter[] = [];
  function measure(node: DockLayout, rect: Rect, path: string) {
    if (typeof node === 'string') { panels.set(node, rect); return; }
    const { axis, first, second } = node;
    const available = extent(rect, axis) - gap;
    const minimum = extent(minimumSize(first), axis);
    const maximum = available - extent(minimumSize(second), axis);
    const position = Math.max(minimum, Math.min(maximum, Math.round(available * node.ratio)));
    const common = { path, axis, available, position, minimum, maximum, before: edgePanel(first, 'second'), after: edgePanel(second, 'first') };
    if (axis === 'x') {
      measure(first, { ...rect, width: position }, `${path}1`);
      splitters.push({ ...common, ...rect, left: rect.left + position, width: gap });
      measure(second, { ...rect, left: rect.left + position + gap, width: available - position }, `${path}2`);
    } else {
      measure(first, { ...rect, height: position }, `${path}1`);
      splitters.push({ ...common, ...rect, top: rect.top + position, height: gap });
      measure(second, { ...rect, top: rect.top + position + gap, height: available - position }, `${path}2`);
    }
  }
  measure(layout, { left: 0, top: 0, ...canvas }, '');
  return { canvas, panels, splitters };
}

export function resizeDock(layout: DockLayout, path: string, ratio: number): DockLayout {
  if (typeof layout === 'string') return layout;
  if (!path) return { ...layout, ratio };
  const child = path[0] === '1' ? 'first' : 'second';
  return { ...layout, [child]: resizeDock(layout[child], path.slice(1), ratio) };
}

function removePane(layout: DockLayout, moving: PanelId): DockLayout | null {
  if (typeof layout === 'string') return layout === moving ? null : layout;
  const first = removePane(layout.first, moving);
  const second = removePane(layout.second, moving);
  return first && second ? { ...layout, first, second } : first ?? second;
}

export function dockPanel(layout: DockLayout, moving: PanelId, destination: DockDestination): DockLayout {
  if (destination.kind === 'swap') {
    const { target } = destination;
    if (moving === target) return layout;
    function swap(node: DockLayout): DockLayout {
      if (typeof node !== 'string') return { ...node, first: swap(node.first), second: swap(node.second) };
      if (node === moving) return target;
      return node === target ? moving : node;
    }
    return swap(layout);
  }
  const { side } = destination;
  const axis = side === 'left' || side === 'right' ? 'x' : 'y';
  const before = side === 'left' || side === 'top';
  if (typeof layout !== 'string' && layout.axis === axis && layout[before ? 'first' : 'second'] === moving) return layout;
  const remaining = removePane(layout, moving);
  if (!remaining) return layout;
  const proportions: Record<PanelId, Record<Axis, number>> = {
    library: { x: 0.18, y: 0.25 }, preview: { x: 0.52, y: 0.56 },
    inspector: { x: 0.23, y: 0.3 }, timeline: { x: 0.4, y: 0.37 },
  };
  const proportion = proportions[moving][axis];
  return { axis, ratio: before ? proportion : 1 - proportion, first: before ? moving : remaining, second: before ? remaining : moving };
}

export function findDockDestination(
  x: number, y: number, workspace: Rect, panels: ReadonlyMap<PanelId, Rect>, moving: PanelId,
): DockDestination | null {
  const { left, top, width, height } = workspace;
  const distances: [DockSide, number][] = [['left', x - left], ['right', left + width - x], ['top', y - top], ['bottom', top + height - y]];
  const [side, distance] = distances.reduce((nearest, candidate) => candidate[1] < nearest[1] ? candidate : nearest);
  if (distance < 0) return null;
  const edgeWidth = Math.min(32, width * 0.08, height * 0.08);
  if (distance <= edgeWidth) return { kind: 'edge', side };
  for (const [panel, rect] of panels) {
    if (panel === moving) continue;
    const inset = Math.min(20, rect.width * 0.14, rect.height * 0.14);
    if (x >= rect.left + inset && x <= rect.left + rect.width - inset && y >= rect.top + inset && y <= rect.top + rect.height - inset) {
      return { kind: 'swap', target: panel };
    }
  }
  return null;
}
