import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, Check } from 'lucide-react';
import {
  fetchTakenBillingSlots, isBillingCategory, billingPeriodOf, monthNameOf,
} from '../utils/expenseUtils';
import './ExpenseModals.css';

/**
 * Category picker shared by the Add (Expenses / household-group screens) and
 * Edit forms. Category is a label only — it never touches amount or splits.
 *
 *  • lockReason  – string → picker disabled with a lock + that message
 *  • Electricity / Water: one per billing month. A taken option can't be
 *    picked; hovering (or tapping) it shows which expense has the month and a
 *    link to it (onOpenExpense).
 *  • onConflictChange(expense|null) – the chosen category's month is taken
 *
 * props: categories, value, onChange, lockReason, householdId, groupId,
 *        excludeId, billingMonth ('YYYY-MM'), onBillingMonthChange,
 *        onOpenExpense, onConflictChange, labelOf (value → display label),
 *        placeholder (shown while no category is chosen), hasError
 */
export default function CategoryField({
  categories, value, onChange, lockReason, householdId, groupId, excludeId,
  billingMonth, onBillingMonthChange, onOpenExpense, onConflictChange, labelOf = (c) => c,
  placeholder = 'Choose category', hasError = false,
}) {
  const [taken, setTaken] = useState({});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);   // highlighted option (hover / arrows / tap)
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const period = billingPeriodOf(billingMonth);
  const month = monthNameOf(period);

  useEffect(() => {
    let alive = true;
    fetchTakenBillingSlots({ householdId, groupId, period, excludeId }).then((slots) => {
      if (alive) setTaken(slots);
    });
    return () => { alive = false; };
  }, [householdId, groupId, period, excludeId]);

  const conflict = !lockReason && isBillingCategory(value) ? taken[value] || null : null;
  useEffect(() => { onConflictChange?.(conflict); }, [conflict, onConflictChange]);

  // Close on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const isTaken = (c) => !!taken[c] && c !== value;
  const openList = () => { setActive(value); setOpen(true); };
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const pick = (c) => {
    if (isTaken(c)) { setActive(c); return; }   // tap on a taken one → show why
    onChange(c);
    close();
  };
  const openExisting = (expense) => { setOpen(false); onOpenExpense?.(expense); };

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    const i = categories.indexOf(active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(categories[(i + step + categories.length) % categories.length]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (active) pick(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="cf-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`cf-trigger${open ? ' cf-trigger--open' : ''}${hasError ? ' aem-input--error' : ''}`}
        disabled={!!lockReason}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="cf-listbox"
        aria-describedby={lockReason ? 'cf-lock-msg' : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {value ? <span>{labelOf(value)}</span> : <span className="cf-placeholder">{placeholder}</span>}
        {lockReason
          ? <Lock size={14} aria-hidden="true" className="cf-lock-icon" />
          : <ChevronDown size={15} aria-hidden="true" className={`cf-chevron${open ? ' open' : ''}`} />}
      </button>

      {open && (
        <ul id="cf-listbox" className="cf-list" role="listbox" aria-label="Category" onMouseLeave={() => setActive(value)}>
          {categories.map((c) => {
            const existing = isTaken(c) ? taken[c] : null;
            const showInfo = existing && active === c;
            return (
              <li
                key={c}
                role="option"
                aria-selected={c === value}
                aria-disabled={!!existing}
                className={`cf-option${c === value ? ' cf-option--selected' : ''}${active === c ? ' cf-option--active' : ''}${existing ? ' cf-option--taken' : ''}`}
                onMouseEnter={() => setActive(c)}
                onClick={() => pick(c)}
              >
                <span className="cf-option-row">
                  <span>{labelOf(c)}</span>
                  {existing
                    ? <span className="cf-taken-tag">{month} taken</span>
                    : c === value && <Check size={14} aria-hidden="true" />}
                </span>
                {showInfo && (
                  <span className="cf-option-info" role="note">
                    <span>{c} already exists for {month}. Edit that expense instead.</span>
                    {onOpenExpense && (
                      <button type="button" className="cf-link" onClick={(e) => { e.stopPropagation(); openExisting(existing); }}>
                        Open “{existing.title}” →
                      </button>
                    )}
                    <span className="cf-hint">For a correction bill, edit the amount there.</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {lockReason && (
        <div id="cf-lock-msg" className="cf-note cf-lock" role="note">
          <Lock size={13} aria-hidden="true" className="cf-lock-icon" />
          <span>{lockReason}</span>
        </div>
      )}

      {!lockReason && isBillingCategory(value) && (
        <label className="cf-month">
          <span>Billing month</span>
          <input
            type="month"
            className="xm-input"
            value={billingMonth || ''}
            onChange={(e) => e.target.value && onBillingMonthChange(e.target.value)}
          />
        </label>
      )}

      {/* Only when the chosen category's month is already taken (e.g. picked from the description) */}
      {conflict && (
        <div className="cf-note cf-dup--active" role="alert">
          <span>{conflict.category} already exists for {month}. Edit that expense instead.</span>
          {onOpenExpense && (
            <button type="button" className="cf-link" onClick={() => openExisting(conflict)}>
              Open “{conflict.title}” →
            </button>
          )}
          <span className="cf-hint">For a correction bill, edit the amount there.</span>
        </div>
      )}
    </div>
  );
}
