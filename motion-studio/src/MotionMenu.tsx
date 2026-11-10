import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export type MenuAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
  shortcut?: string;
  separated?: boolean;
};

export function MotionMenu({ menus }: { menus: { label: string; actions: MenuAction[] }[] }) {
  const host = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const focusMenu = useRef(false);
  useEffect(() => {
    if (open === null) return;
    if (focusMenu.current) host.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    focusMenu.current = false;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(null);
    }
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function focusTrigger(index: number) {
    host.current?.querySelector<HTMLButtonElement>(`#motion-menu-${index}`)?.focus();
  }
  function close(index: number) {
    setOpen(null);
    focusTrigger(index);
  }
  function keys(event: KeyboardEvent, index: number, inMenu: boolean) {
    const key = event.key;
    if (key === 'Escape' && open !== null) {
      event.preventDefault();
      event.stopPropagation();
      close(index);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const next = (index + (key === 'ArrowLeft' ? -1 : 1) + menus.length) % menus.length;
      if (open !== null) setOpen(next);
      focusTrigger(next);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    if (!inMenu) {
      if (open !== index) {
        focusMenu.current = true;
        setOpen(index);
      } else {
        host.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
      }
      return;
    }
    const items = Array.from(host.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = key === 'Home' ? 0 : key === 'End' ? items.length - 1
      : (current + (key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[target]?.focus();
  }

  return <nav className="motion-menubar" ref={host} aria-label="应用菜单"
    onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(null); }}>
    {menus.map(({ label, actions }, index) => <div className="motion-menu" key={label}>
      <button type="button" className="motion-menu-trigger" id={`motion-menu-${index}`} aria-haspopup="menu" aria-expanded={open === index}
        onClick={(event) => {
          focusMenu.current = open !== index && event.detail === 0;
          setOpen(open === index ? null : index);
        }}
        onPointerEnter={() => { if (open !== null && open !== index) setOpen(index); }}
        onKeyDown={(event) => keys(event, index, false)}>{label}</button>
      {open === index && <div className="motion-menu-items" role="menu" aria-labelledby={`motion-menu-${index}`}>
        {actions.map((action) => <button type="button" role="menuitem" key={action.label} disabled={action.disabled}
          className={action.separated ? 'motion-menu-separated' : undefined}
          onKeyDown={(event) => keys(event, index, true)} onClick={() => { close(index); action.run(); }}>
          <span>{action.label}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}
        </button>)}
      </div>}
    </div>)}
  </nav>;
}
