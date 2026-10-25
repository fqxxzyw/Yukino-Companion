import React, {Children, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown} from 'lucide-react';

// Keep keyboard focus on the trigger while the menu floats above scrollable panels.
// This also keeps the surrounding dialog's focus trap intact.
export default function Select({children, value, onChange, disabled, className = '', ...props}) {
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);
  const typeahead = useRef({text:'',time:0});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({});
  const options = Children.toArray(children).filter(React.isValidElement).map(child => ({
    value: String(child.props.value ?? child.props.children),
    label: child.props.children,
    disabled: Boolean(child.props.disabled),
  }));
  const selected = options.findIndex(option => option.value === String(value));

  function reveal() {
    if (disabled || trigger.current?.matches(':disabled') || !options.length) return;
    setActive(selected >= 0 ? selected : Math.max(0, options.findIndex(option => !option.disabled)));
    setOpen(true);
  }
  function choose(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange?.({target:{value:option.value}, currentTarget:{value:option.value}});
    setOpen(false);
    trigger.current?.focus();
  }
  function move(step) {
    for (let offset = 1; offset <= options.length; offset++) {
      const next = (active + step * offset + options.length) % options.length;
      if (!options[next].disabled) {setActive(next); break;}
    }
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === 'Tab') {setOpen(false); return;}
    if (['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
      event.preventDefault();
      if (!open) {reveal(); return;}
      if (event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Home') setActive(options.findIndex(option => !option.disabled));
      else if (event.key === 'End') setActive(options.findLastIndex(option => !option.disabled));
      else choose(active);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typeahead.current = {text:(now-typeahead.current.time < 700 ? typeahead.current.text : '') + event.key.toLowerCase(),time:now};
      const match = options.findIndex(option => !option.disabled && String(option.label).toLowerCase().startsWith(typeahead.current.text));
      if (!open) reveal();
      if (match >= 0) setActive(match);
    }
  }
  useLayoutEffect(() => {
    if (!open) return;
    function locate() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const theme = getComputedStyle(trigger.current);
      const width = Math.min(Math.max(rect.width, 210), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const desired = Math.min(options.length * 44 + 12, 300);
      const upwards = below < desired && above > below;
      const maxHeight = Math.max(64, Math.min(300, upwards ? above : below));
      const variables = Object.fromEntries(['--surface','--surface-soft','--text','--secondary','--accent-text','--line','--shadow','--hover','--scheme'].map(name => [name, theme.getPropertyValue(name)]));
      setPosition({...variables,width,maxHeight,animation:trigger.current.closest('.reduce')?'none':undefined,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),
        ...(upwards ? {bottom:window.innerHeight-rect.top+7} : {top:rect.bottom+7})});
    }
    function outside(event) {
      if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    }
    locate();
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block:'nearest'});
  }, [open, active, id]);
  useEffect(() => {if (disabled) setOpen(false);}, [disabled]);

  return <div className={`select-control ${className}`}>
    <button {...props} type="button" ref={trigger} className="select-trigger" role="combobox"
      disabled={disabled} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `${id}-menu` : undefined}
      aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onClick={() => open ? setOpen(false) : reveal()} onKeyDown={onKeyDown}>
      <span>{options[selected]?.label ?? '请选择'}</span><ChevronDown size={15}/>
    </button>
    {open && createPortal(<div id={`${id}-menu`} ref={menu} className="select-menu" role="listbox"
      aria-label={props['aria-label'] || '可选项目'} style={position}>
      {options.map((option,index) => <div key={`${option.value}-${index}`} id={`${id}-option-${index}`}
        role="option" aria-selected={index === selected} aria-disabled={option.disabled || undefined}
        className={`select-option ${index === active ? 'highlighted' : ''}`}
        onMouseMove={() => !option.disabled && setActive(index)}
        onMouseDown={event => event.preventDefault()}
        onClick={event => {event.preventDefault();choose(index);}}>
        <span>{option.label}</span>{index === selected && <Check size={15}/>}</div>)}
    </div>,document.body)}
  </div>;
}
