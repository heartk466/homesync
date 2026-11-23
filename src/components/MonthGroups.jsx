// Expense list grouped into collapsible month sections ("OCTOBER 2026 · 3").
// The current month comes first and starts open; other months follow newest
// first and start closed. A month is forced open while it holds the card a
// notification jumps to (openFor), and every month opens while the list is
// searched / filtered (expandAll) so matches are never hidden.
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './MonthGroups.css';

const monthKeyOf = (date) => (date ? String(date).slice(0, 7) : 'none');
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const labelOf = (key) => (key === 'none'
  ? 'No date'
  : new Date(`${key}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }));

/**
 * items       expenses, already in the order they should appear within a month
 * dateOf      (item) => 'YYYY-MM-DD'      (default: expense_date)
 * renderItem  (item) => element (keyed)
 * openFor     id of an item whose month must be open (notification jump)
 * expandAll   true while searching / filtering
 */
export default function MonthGroups({ items, dateOf = (e) => e.expense_date, renderItem, openFor, expandAll = false }) {
  const current = currentMonthKey();
  const groups = new Map();
  items.forEach((item) => {
    const key = monthKeyOf(dateOf(item));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === current) return -1;
    if (b === current) return 1;
    if (a === 'none') return 1;
    if (b === 'none') return -1;
    return b.localeCompare(a);   // newest first
  });

  // default: this month open (or the newest month when this month is empty)
  const [toggled, setToggled] = useState({});   // key → open/closed chosen by the user
  const defaultOpen = groups.has(current) ? current : keys[0];
  const targetKey = openFor ? keys.find(k => groups.get(k).some(i => i.id === openFor)) : null;
  // keep a jumped-to month open after the screen clears the notification params
  const [pinned, setPinned] = useState(null);
  if (targetKey && targetKey !== pinned) {
    setPinned(targetKey);
    setToggled(prev => ({ ...prev, [targetKey]: true }));
  }
  const isOpen = (key) => expandAll || key === targetKey || (key in toggled ? toggled[key] : key === defaultOpen);

  return (
    <div className="mg-list">
      {keys.map((key) => {
        const open = isOpen(key);
        const list = groups.get(key);
        return (
          <section key={key} className={`mg-section${open ? ' mg-section--open' : ''}`}>
            <button
              type="button"
              className="mg-header"
              aria-expanded={open}
              onClick={() => setToggled(prev => ({ ...prev, [key]: !open }))}
            >
              <span className="mg-title">
                {labelOf(key)}
                {key === current && <span className="mg-now">This month</span>}
              </span>
              <span className="mg-meta">
                <span className="mg-count">{list.length}</span>
                <ChevronDown size={16} className="mg-chevron" aria-hidden="true" />
              </span>
            </button>
            {open && <div className="mg-items">{list.map(renderItem)}</div>}
          </section>
        );
      })}
    </div>
  );
}
