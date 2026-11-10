import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, ReactNode, SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './studio-select.css';

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string };
type Item = { value: string; label: ReactNode; text: string; disabled: boolean; group?: string };
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'value' | 'defaultValue'> & {
  children: ReactNode; value?: string | number; defaultValue?: string | number;
};

/** Companion-style select with the same keyboard interaction, adapted to compact editor panels. */
export function StudioSelect({ children, value, defaultValue, onChange, onBlur, disabled, autoFocus, className,
  title, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [internal, setInternal] = useState(String(defaultValue ?? ''));
  const [position, setPosition] = useState<React.CSSProperties>({});
  const options: Item[] = [];
  function collect(nodes: ReactNode, group?: string) {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<OptionProps>(child)) return;
      if (child.type === 'optgroup') { collect(child.props.children, child.props.label); return; }
      if (child.type !== 'option') return;
      const label = child.props.children;
      options.push({ value: String(child.props.value ?? label ?? ''), label, text: String(label ?? ''),
        disabled: !!child.props.disabled, group });
    });
  }
  collect(children);
  const current = String(value ?? internal);
  const selected = options.findIndex((option) => option.value === current);
  function reveal() {
    if (disabled || trigger.current?.matches(':disabled') || !options.length) return;
    setActive(selected >= 0 && !options[selected].disabled ? selected : Math.max(0, options.findIndex((option) => !option.disabled)));
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (value === undefined) setInternal(option.value);
    onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    trigger.current?.focus();
  }
  function move(step: number) {
    for (let offset = 1; offset <= options.length; offset++) {
      const next = (active + step * offset + options.length) % options.length;
      if (!options[next].disabled) { setActive(next); break; }
    }
  }
  function keyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { reveal(); return; }
      if (event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Home') setActive(Math.max(0, options.findIndex((option) => !option.disabled)));
      else if (event.key === 'End') setActive(Math.max(0, options.length - 1 - [...options].reverse().findIndex((option) => !option.disabled)));
      else choose(active);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typeahead.current = { text: (now - typeahead.current.time < 700 ? typeahead.current.text : '') + event.key.toLowerCase(), time: now };
      const match = options.findIndex((option) => !option.disabled && option.text.toLowerCase().startsWith(typeahead.current.text));
      if (!open) reveal();
      if (match >= 0) setActive(match);
    }
  }
  useLayoutEffect(() => {
    if (!open) return;
    function locate() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 210), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
      const upwards = below < Math.min(options.length * 38 + 12, 300) && above > below;
      setPosition({ width, maxHeight: Math.max(64, Math.min(300, upwards ? above : below)),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 7 } : { top: rect.bottom + 7 }) });
    }
    function outside(event: globalThis.PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    }
    locate(); window.addEventListener('resize', locate); window.addEventListener('scroll', locate, true);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', locate); window.removeEventListener('scroll', locate, true); document.removeEventListener('pointerdown', outside); };
  }, [open, options.length]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, id]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  let group: string | undefined;
  const popup = open && <div id={`${id}-menu`} ref={menu} className="studio-select-menu" role="listbox"
    aria-label={ariaLabel || '可选项目'} style={position} onPointerDown={(event) => event.stopPropagation()}>
    {options.map((option, index) => {
      const heading = option.group && option.group !== group ? option.group : undefined;
      group = option.group;
      return <div key={`${option.value}-${index}`}>
        {heading && <div className="studio-select-group" aria-hidden="true">{heading}</div>}
        <div id={`${id}-option-${index}`} data-value={option.value} role="option" aria-selected={index === selected}
          aria-disabled={option.disabled || undefined} className={`studio-select-option ${index === active ? 'highlighted' : ''}`}
          onMouseMove={() => !option.disabled && setActive(index)} onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => { event.preventDefault(); choose(index); }}>
          <span>{option.label}</span>{index === selected && <Check size={14} />}
        </div>
      </div>;
    })}
  </div>;
  return <span className={`studio-select-control ${className ?? ''}`}>
    <button type="button" ref={trigger} className="studio-select-trigger" role="combobox" title={title} autoFocus={autoFocus}
      disabled={disabled} aria-label={ariaLabel} aria-labelledby={labelledBy} aria-expanded={open} aria-haspopup="listbox"
      aria-controls={open ? `${id}-menu` : undefined} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>)}
      onClick={() => open ? setOpen(false) : reveal()} onKeyDown={keyDown}>
      <span>{options[selected]?.label ?? options[0]?.label ?? '请选择'}</span><ChevronDown size={14} />
    </button>
    {popup && createPortal(popup, trigger.current?.closest('dialog[open]') ?? document.body)}
  </span>;
}
