import { StudioSelect } from './StudioSelect.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { GripHorizontal, RotateCcw } from 'lucide-react';
import { defaultDock, dockPanel, findDockDestination, measureDock, panelIds, readDock, resizeDock } from './dock-layout.ts';
import type { DockDestination, DockSide, PanelId } from './dock-layout.ts';
import './workspace.css';

const storageKey = 'yukino-motion-workspace-v1';
const panelTitles: Record<PanelId, string> = { library: '动作资源', preview: '三维预览', inspector: '属性', timeline: '时间线' };
const directions: Record<DockSide, string> = { left: '左侧', right: '右侧', top: '上方', bottom: '下方' };
type Splitter = ReturnType<typeof measureDock>['splitters'][number];
type Press = {
  panel: PanelId; id: number; capture: HTMLElement;
  x: number; y: number; scrollLeft: number; scrollTop: number; moved: boolean;
};
type Lifted = { panel: PanelId; x: number; y: number; destination: DockDestination | null };

function destinationLabel(destination: DockDestination) {
  return destination.kind === 'edge' ? `停靠到工作区${directions[destination.side]}` : `与${panelTitles[destination.target]}交换位置`;
}

export function Workspace({ panels, trackCount, resetRevision }: {
  panels: Record<PanelId, ReactNode>; trackCount: number; resetRevision?: number;
}) {
  const [layout, setLayout] = useState(() => {
    try { return readDock(localStorage.getItem(storageKey)); }
    catch { return defaultDock; }
  });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ panel: PanelId; destination: DockSide | PanelId } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const workspace = useRef<HTMLDivElement>(null);
  const dockCanvas = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const blockedClick = useRef<PanelId | null>(null);
  const resetSeen = useRef(resetRevision);
  const pointerResize = useRef<{ id: number; coordinate: number; splitter: Splitter } | null>(null);
  const { canvas, panels: rects, splitters } = measureDock(layout, viewport);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(([{ contentRect }]) => setViewport({ width: contentRect.width, height: contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(layout)); }
    catch { /* The current layout is still usable when storage is unavailable. */ }
  }, [layout]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-dock-menu], .studio-select-menu')) setMenu(null);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  const cancelDrag = useCallback(() => {
    const current = press.current;
    press.current = null;
    if (current?.capture.hasPointerCapture(current.id)) current.capture.releasePointerCapture(current.id);
    setLifted(null);
  }, []);
  const resetLayout = useCallback(() => {
    cancelDrag();
    pointerResize.current = null;
    setResizing(null);
    setLayout(defaultDock);
    setMenu(null);
    setAnnouncement('已恢复默认工作区布局');
  }, [cancelDrag]);
  useEffect(() => {
    if (resetSeen.current === resetRevision) return;
    resetSeen.current = resetRevision;
    resetLayout();
  }, [resetLayout, resetRevision]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !press.current) return;
      event.preventDefault();
      cancelDrag();
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancelDrag);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancelDrag);
    };
  }, [cancelDrag]);

  function closeMenu(panel: PanelId) {
    setMenu(null);
    workspace.current?.querySelector<HTMLButtonElement>(`[data-dock-panel="${panel}"] .dock-grip`)?.focus({ preventScroll: true });
  }
  function move(panel: PanelId, destination: DockDestination) {
    setLayout((current) => dockPanel(current, panel, destination));
    setAnnouncement(`${panelTitles[panel]}已${destinationLabel(destination)}`);
  }
  function destinationAt(clientX: number, clientY: number, panel: PanelId) {
    const root = workspace.current;
    const canvasRect = dockCanvas.current?.getBoundingClientRect();
    if (!root || !canvasRect) return null;
    const rootRect = root.getBoundingClientRect();
    return findDockDestination(clientX - canvasRect.left, clientY - canvasRect.top, {
      left: rootRect.left + root.clientLeft - canvasRect.left, top: rootRect.top + root.clientTop - canvasRect.top,
      width: root.clientWidth, height: root.clientHeight,
    }, rects, panel);
  }
  function startDrag(event: PointerEvent<HTMLElement>, panel: PanelId) {
    const root = workspace.current;
    if (!root || press.current || pointerResize.current || event.button !== 0 || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest('.dock-menu')) return;
    blockedClick.current = null;
    const grip = event.target instanceof Element && event.target.closest<HTMLElement>('.dock-grip');
    const capture = grip || event.currentTarget;
    capture.setPointerCapture(event.pointerId);
    press.current = { panel, id: event.pointerId, capture, x: event.clientX, y: event.clientY,
      scrollLeft: root.scrollLeft, scrollTop: root.scrollTop, moved: false };
  }
  function updateDrag(event: PointerEvent<HTMLElement>) {
    const current = press.current;
    const root = workspace.current;
    if (!root || !current || event.pointerId !== current.id) return;
    const x = event.clientX - current.x + root.scrollLeft - current.scrollLeft;
    const y = event.clientY - current.y + root.scrollTop - current.scrollTop;
    if (!current.moved) {
      if (Math.hypot(x, y) < 5) return;
      current.moved = true;
      blockedClick.current = current.panel;
      setMenu(null);
    }
    setLifted({ panel: current.panel, x, y, destination: destinationAt(event.clientX, event.clientY, current.panel) });
  }
  function endDrag(event: PointerEvent<HTMLElement>, place: boolean) {
    const current = press.current;
    if (!current || event.pointerId !== current.id) return;
    const destination = place && current.moved && destinationAt(event.clientX, event.clientY, current.panel);
    if (destination) move(current.panel, destination);
    cancelDrag();
  }
  function startResize(event: PointerEvent<HTMLDivElement>, splitter: Splitter) {
    if (event.button !== 0 || press.current || splitter.maximum <= splitter.minimum) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const coordinate = splitter.axis === 'x' ? event.clientX : event.clientY;
    pointerResize.current = { id: event.pointerId, coordinate, splitter };
    setResizing(splitter.path);
    setMenu(null);
  }
  function resize(splitter: Splitter, pixels: number) {
    const position = Math.max(splitter.minimum, Math.min(splitter.maximum, pixels));
    setLayout((current) => resizeDock(current, splitter.path, position / splitter.available));
  }
  function resizeFromPointer(event: PointerEvent<HTMLDivElement>) {
    const active = pointerResize.current;
    if (!active || event.pointerId !== active.id) return;
    const { splitter, coordinate } = active;
    const current = splitter.axis === 'x' ? event.clientX : event.clientY;
    resize(splitter, splitter.position + current - coordinate);
  }
  function endResize(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== pointerResize.current?.id) return;
    pointerResize.current = null;
    setResizing(null);
  }

  return <div className={`dock-workspace${resizing !== null ? ' is-resizing' : ''}${lifted ? ' is-dragging' : ''}`} ref={workspace} aria-label="可停靠工作区"
    data-dock-edge={lifted?.destination?.kind === 'edge' ? lifted.destination.side : undefined}>
    <div className="dock-canvas" ref={dockCanvas} style={canvas}>
      {panelIds.map((panel) => <section key={panel} className="dock-pane" data-dock-panel={panel} data-dragging={lifted?.panel === panel}
        data-dock-target={lifted?.destination?.kind === 'swap' && lifted.destination.target === panel}
        data-menu-align={rects.get(panel)!.left + rects.get(panel)!.width < 200 ? 'left' : 'right'}
        aria-label={`${panelTitles[panel]}面板`}
        style={{ ...rects.get(panel), transform: lifted?.panel === panel ? `translate3d(${lifted.x}px, ${lifted.y}px, 0)` : undefined }}>
        <header className="dock-pane-heading" data-dock-menu onPointerDown={(event) => startDrag(event, panel)} onPointerMove={updateDrag}
          onPointerUp={(event) => endDrag(event, true)} onPointerCancel={(event) => endDrag(event, false)} onLostPointerCapture={(event) => endDrag(event, false)}>
          <span className="dock-pane-name">{panelTitles[panel]}</span>
          {lifted?.panel === panel && lifted.destination ? <span className="dock-pane-detail">{destinationLabel(lifted.destination)}</span>
            : panel === 'timeline' && <span className="dock-pane-detail">{trackCount} 轨道</span>}
          <button type="button" className="dock-grip" aria-label={`移动${panelTitles[panel]}面板`} title="拖动面板，点击选择停靠位置"
            aria-expanded={menu?.panel === panel} onClick={(event) => {
              if (event.detail && blockedClick.current === panel) { blockedClick.current = null; return; }
              setMenu((current) => current?.panel === panel ? null : { panel, destination: 'right' });
            }}><GripHorizontal size={17} /></button>
          {menu?.panel === panel && <form className="dock-menu" onKeyDown={(event) => { if (event.key === 'Escape') closeMenu(panel); }}
            onSubmit={(event) => {
              event.preventDefault();
              const { destination } = menu;
              move(panel, destination in directions ? { kind: 'edge', side: destination as DockSide } : { kind: 'swap', target: destination as PanelId });
              closeMenu(panel);
            }}>
            <label>停靠位置 <StudioSelect aria-label="停靠位置" value={menu.destination} onChange={(event) => setMenu({ ...menu, destination: event.target.value as DockSide | PanelId })}>
              <optgroup label="工作区边缘">{Object.entries(directions).map(([side, title]) => <option key={side} value={side}>工作区{title}</option>)}</optgroup>
              <optgroup label="交换位置">{panelIds.filter((item) => item !== panel).map((item) => <option key={item} value={item}>与{panelTitles[item]}交换</option>)}</optgroup>
            </StudioSelect></label>
            <div className="dock-menu-actions">
              <button type="button" title="恢复默认工作区布局" onClick={() => { resetLayout(); closeMenu(panel); }}><RotateCcw size={13} /> 恢复布局</button>
              <button type="submit" className="dock-confirm">移动</button>
            </div>
          </form>}
        </header>
        <div className="dock-pane-content">{panels[panel]}</div>
      </section>)}
      {splitters.map((splitter) => <div key={splitter.path} className="dock-splitter" data-axis={splitter.axis} data-resizing={resizing === splitter.path}
        style={{ left: splitter.left, top: splitter.top, width: splitter.width, height: splitter.height }} role="separator" tabIndex={0}
        aria-label={`调整${panelTitles[splitter.before]}与${panelTitles[splitter.after]}的尺寸`}
        aria-orientation={splitter.axis === 'x' ? 'vertical' : 'horizontal'} aria-valuenow={splitter.position}
        aria-valuemin={splitter.minimum} aria-valuemax={splitter.maximum}
        onPointerDown={(event) => startResize(event, splitter)} onPointerMove={resizeFromPointer}
        onPointerUp={(event) => { resizeFromPointer(event); endResize(event); }} onPointerCancel={endResize} onLostPointerCapture={endResize}
        onKeyDown={(event) => {
          const backward = splitter.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
          const forward = splitter.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
          const step = event.shiftKey ? 36 : 12;
          const position = ({ [backward]: splitter.position - step, [forward]: splitter.position + step,
            Home: splitter.minimum, End: splitter.maximum })[event.key];
          if (position === undefined) return;
          event.preventDefault();
          resize(splitter, position);
        }} />)}
    </div>
    <span className="dock-live" aria-live="polite">{announcement}</span>
  </div>;
}
