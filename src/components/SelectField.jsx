import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import './ExpenseModals.css';

/**
 * Purple dropdown that replaces a native <select> (whose open list can't be
 * styled). Same look as the category picker (cf-* styles).
 *
 * props:
 *   options   [{ value, label, avatar? }]  avatar = { url, name } → photo or initials
 *   value     selected option value
 *   onChange  (value) => void
 *   label     accessible name for the list
 */
const initialsOf = (name) =>
  (name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();

const Avatar = ({ avatar }) => (
  <span className="sf-avatar" aria-hidden="true">
    {avatar.url ? <img src={avatar.url} alt="" /> : initialsOf(avatar.name)}
  </span>
);

export default function SelectField({ options, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openList = () => { setActive(value); setOpen(true); };
  const pick = (v) => { onChange(v); setOpen(false); triggerRef.current?.focus(); };

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    const i = options.findIndex((o) => o.value === active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(options[(i + step + options.length) % options.length].value);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="cf-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`cf-trigger${open ? ' cf-trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="sf-label">
          {selected?.avatar && <Avatar avatar={selected.avatar} />}
          <span>{selected?.label}</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" className={`cf-chevron${open ? ' open' : ''}`} />
      </button>

      {open && (
        <ul id={listId} className="cf-list" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`cf-option${o.value === value ? ' cf-option--selected' : ''}${active === o.value ? ' cf-option--active' : ''}`}
              onMouseEnter={() => setActive(o.value)}
              onClick={() => pick(o.value)}
            >
              <span className="cf-option-row">
                <span className="sf-label">
                  {o.avatar && <Avatar avatar={o.avatar} />}
                  <span>{o.label}</span>
                </span>
                {o.value === value && <Check size={14} aria-hidden="true" />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
