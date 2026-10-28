import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import './DatePickerField.css';

/**
 * Date field with our own calendar, so it looks and behaves the same on iOS,
 * Android and desktop (native <input type="date"> ignores `min` in the iOS
 * calendar and can't be styled consistently).
 *
 * Dates are plain 'YYYY-MM-DD' strings and are never converted through UTC,
 * so there is no off-by-one-day problem in UTC+8.
 *
 * Tap the month/year title to jump by year and month.
 *
 * props:
 *   value       'YYYY-MM-DD' or ''
 *   onChange    (value: string) => void   ('' when cleared)
 *   min         'YYYY-MM-DD' – every earlier day is greyed out and unclickable
 *   max         'YYYY-MM-DD' – every later day is greyed out and unclickable
 *   placeholder text shown when empty
 *   disabled    read-only look (e.g. the auto-set "Date" field)
 *   hasError    red border
 *   allowClear  show the Clear button (default true)
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n) => String(n).padStart(2, '0');
const toStr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
};
const localToday = () => {
  const n = new Date();
  return toStr(n.getFullYear(), n.getMonth(), n.getDate());
};
const pretty = (s) =>
  new Date(`${s}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

export default function DatePickerField({
  value = '', onChange, min, max, placeholder = 'Select date',
  disabled = false, hasError = false, allowClear = true,
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parse(value || min || localToday()));
  const [mode, setMode] = useState('days'); // 'days' | 'months'
  const rootRef = useRef(null);
  const today = localToday();

  // close on outside tap / Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open) { setView(parse(value || min || today)); setMode('days'); } // always open on the relevant month
    setOpen((o) => !o);
  };

  const isBlocked = (str) => (Boolean(min) && str < min) || (Boolean(max) && str > max);

  const minParts = min ? parse(min) : null;
  const atFirstMonth = Boolean(minParts) && (view.y < minParts.y || (view.y === minParts.y && view.m <= minParts.m));

  const maxParts = max ? parse(max) : null;
  const atLastMonth = Boolean(maxParts) && (view.y > maxParts.y || (view.y === maxParts.y && view.m >= maxParts.m));

  const atFirstYear = Boolean(minParts) && view.y <= minParts.y;
  const atLastYear = Boolean(maxParts) && view.y >= maxParts.y;
  const monthBlocked = (y, m) => (Boolean(minParts) && (y < minParts.y || (y === minParts.y && m < minParts.m)))
    || (Boolean(maxParts) && (y > maxParts.y || (y === maxParts.y && m > maxParts.m)));
  const shiftYear = (delta) => setView((v) => ({ ...v, y: v.y + delta, d: 1 }));
  const pickMonth = (m) => {
    if (monthBlocked(view.y, m)) return;
    setView((v) => ({ ...v, m, d: 1 }));
    setMode('days');
  };

  const shiftMonth = (delta) => {
    setView((v) => {
      const total = v.y * 12 + v.m + delta;
      return { y: Math.floor(total / 12), m: total % 12, d: 1 };
    });
  };

  const pick = (str) => {
    if (isBlocked(str)) return;
    onChange?.(str);
    setOpen(false);
  };

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="dpf" ref={rootRef}>
      <button
        type="button"
        className={`dpf-field${open ? ' dpf-open' : ''}${hasError ? ' dpf-error' : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={value ? 'dpf-value' : 'dpf-placeholder'}>{value ? pretty(value) : placeholder}</span>
        <Calendar size={16} className="dpf-icon" />
      </button>

      {open && (
        <div className="dpf-panel" role="dialog" aria-label="Choose a date">
          {mode === 'days' ? (
            <>
              <div className="dpf-head">
                <button type="button" className="dpf-nav" onClick={() => shiftMonth(-1)} disabled={atFirstMonth} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="dpf-title-btn" onClick={() => setMode('months')} aria-label="Choose month and year">
                  {MONTHS[view.m]} {view.y} <ChevronDown size={14} />
                </button>
                <button type="button" className="dpf-nav" onClick={() => shiftMonth(1)} disabled={atLastMonth} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="dpf-grid">
                {WEEKDAYS.map((w) => <span key={w} className="dpf-wd">{w}</span>)}
                {cells.map((d, i) => {
                  if (d === null) return <span key={`e${i}`} />;
                  const str = toStr(view.y, view.m, d);
                  const blocked = isBlocked(str);
                  const cls = ['dpf-day', str === value && 'dpf-selected', str === today && 'dpf-today'].filter(Boolean).join(' ');
                  return (
                    <button key={str} type="button" className={cls} disabled={blocked} onClick={() => pick(str)}>
                      {d}
                    </button>
                  );
                })}
              </div>

              <div className="dpf-foot">
                {allowClear && value ? (
                  <button type="button" className="dpf-link" onClick={() => { onChange?.(''); setOpen(false); }}>Clear</button>
                ) : <span />}
                <button type="button" className="dpf-link" disabled={isBlocked(today)} onClick={() => pick(today)}>Today</button>
              </div>
            </>
          ) : (
            <>
              <div className="dpf-head">
                <button type="button" className="dpf-nav" onClick={() => shiftYear(-1)} disabled={atFirstYear} aria-label="Previous year">
                  <ChevronLeft size={16} />
                </button>
                <span className="dpf-title">{view.y}</span>
                <button type="button" className="dpf-nav" onClick={() => shiftYear(1)} disabled={atLastYear} aria-label="Next year">
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="dpf-months">
                {SHORT_MONTHS.map((name, m) => {
                  const cls = ['dpf-month', m === view.m && 'dpf-selected', (view.y === parse(today).y && m === parse(today).m) && 'dpf-today']
                    .filter(Boolean).join(' ');
                  return (
                    <button key={name} type="button" className={cls} disabled={monthBlocked(view.y, m)} onClick={() => pickMonth(m)}>
                      {name}
                    </button>
                  );
                })}
              </div>

              <div className="dpf-foot">
                <button type="button" className="dpf-link" onClick={() => setMode('days')}>Back to days</button>
                <span />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}