import React, { useState } from 'react';
import { X, Plus, Lock } from 'lucide-react';
import {
  num, round2, money, getTodayStr, distributeEqual, isMoneyLocked, isShareLocked,
  splitStatusMeta, saveExpenseEdit,
} from '../utils/expenseEditUtils';
import './ExpenseModals.css';

const initialsOf = (name) =>
  (name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();

const Avatar = ({ profile }) => (
  <div className="xm-avatar">
    {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initialsOf(profile?.full_name)}
  </div>
);

/**
 * Admin-only. Edit amount, name, category, due date, who is in the expense
 * and how it is split.
 *
 * props:
 *  expense   – the expenses row
 *  splits    – its expense_splits rows (with .profiles)
 *  members   – every eligible member: [{ user_id, profiles }]
 *  actor     – { id, name }  (the admin)
 *  linkFor   – (expenseId) => { link_path, link_state, link_query }
 *  categories– selectable category names ('Other' included)
 */
export default function EditExpenseModal({
  expense, splits, members, actor, linkFor, categories, onClose, onSaved, showToast,
}) {
  const known = categories.includes(expense.category);
  const [title, setTitle] = useState(expense.title || '');
  const [amount, setAmount] = useState(String(expense.amount ?? ''));
  const [category, setCategory] = useState(known ? expense.category : 'Other');
  const [otherType, setOtherType] = useState(known ? '' : expense.category || '');
  const [dueDate, setDueDate] = useState(expense.due_date || '');
  const [splitType, setSplitType] = useState(expense.split_type === 'custom' ? 'custom' : 'equal');
  const [included, setIncluded] = useState(splits.map((s) => s.user_id));
  const [custom, setCustom] = useState(() =>
    Object.fromEntries(splits.map((s) => [s.user_id, String(s.share_amount)])));
  const [saving, setSaving] = useState(false);

  const splitsById = Object.fromEntries(splits.map((s) => [s.user_id, s]));
  const memberById = Object.fromEntries(members.map((m) => [m.user_id, m]));
  const profileOf = (uid) => memberById[uid]?.profiles || splitsById[uid]?.profiles;

  const total = round2(num(amount));

  // Members whose proof is waiting for approval keep their current share
  const fixed = {};
  included.forEach((uid) => {
    const s = splitsById[uid];
    if (s && isShareLocked(s)) fixed[uid] = num(s.share_amount);
  });

  const equalShares = distributeEqual(total, included, fixed);
  const shares = splitType === 'equal'
    ? equalShares
    : Object.fromEntries(included.map((uid) => [uid, uid in fixed ? fixed[uid] : round2(num(custom[uid]))]));

  const sharesSum = round2(Object.values(shares).reduce((a, b) => a + num(b), 0));
  const remaining = round2(total - sharesSum);

  // ── validation ──
  const errors = {};
  if (!title.trim()) errors.title = 'Description is required';
  if (!(total > 0)) errors.amount = 'Enter an amount greater than 0';
  if (dueDate && dueDate !== (expense.due_date || '') && dueDate < getTodayStr()) {
    errors.due = 'Due date cannot be in the past';
  }
  if (included.length === 0) errors.members = 'Keep at least one member in this expense';
  if (Object.values(shares).some((v) => v < 0)) errors.split = 'Locked shares are more than the new amount';
  if (splitType === 'custom' && Math.abs(remaining) > 0.01 && !errors.split) {
    errors.split = `${money(Math.abs(remaining))} ${remaining > 0 ? 'still unassigned' : 'over the amount'}`;
  }
  const hasErrors = Object.keys(errors).length > 0;

  // ── per-member helper text ──
  const effectOf = (uid) => {
    const old = splitsById[uid];
    const nw = round2(shares[uid]);
    if (!old) return { text: 'New member · starts unpaid', cls: 'xm-info' };
    if (isShareLocked(old)) return { text: '🔒 Proof awaiting approval — share locked', cls: 'xm-warn' };
    const paid = num(old.paid_amount);
    if (uid !== expense.paid_by && paid > 0) {
      if (nw > paid + 0.005) return { text: `Paid ${money(paid)} → follow-up ${money(nw - paid)} needed`, cls: 'xm-warn' };
      if (nw < paid - 0.005) return { text: `Paid ${money(paid)} → overpaid ${money(paid - nw)} (refund)`, cls: 'xm-info' };
      return { text: `Paid ${money(paid)} ✓`, cls: '' };
    }
    return { text: uid === expense.paid_by ? 'Payer' : '', cls: '' };
  };

  const removeReason = (uid) => {
    const old = splitsById[uid];
    if (!old) return null;                       // newly added → can always be un-added
    if (uid === expense.paid_by) return 'The payer can’t be removed';
    if (isMoneyLocked(old, expense)) return 'Refund this member before removing';
    return null;
  };

  const remove = (uid) => setIncluded((prev) => prev.filter((id) => id !== uid));
  const add = (uid) => setIncluded((prev) => [...prev, uid]);
  const notIncluded = members.filter((m) => !included.includes(m.user_id));

  const switchToCustom = () => {
    if (splitType === 'equal') {
      setCustom((prev) => {
        const next = { ...prev };
        included.forEach((uid) => { next[uid] = String(equalShares[uid]); });
        return next;
      });
    }
    setSplitType('custom');
  };

  const fillEqually = () => {
    const next = {};
    included.forEach((uid) => { next[uid] = String(equalShares[uid]); });
    setCustom(next);
  };

  const handleSave = async () => {
    if (hasErrors) { showToast?.(Object.values(errors)[0], 'error'); return; }
    setSaving(true);
    try {
      const vals = Object.values(shares).map(num);
      const looksEqual = vals.length > 0 && Math.max(...vals) - Math.min(...vals) <= 0.011;
      await saveExpenseEdit({
        expense,
        oldSplits: splits,
        values: {
          title: title.trim(),
          amount: total,
          category: category === 'Other' && otherType.trim() ? otherType.trim() : category,
          due_date: dueDate,
          split_type: splitType === 'equal' && looksEqual ? 'equal' : 'custom',
          shares,
        },
        actor,
        linkFor,
      });
      showToast?.('Expense updated and members notified! ✅');
      onSaved?.();
    } catch (err) {
      console.error(err);
      showToast?.(err.message || 'Could not save changes', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="xm-overlay">
      <div className="xm-card">
        <div className="xm-header">
          <h2>✏️ Edit Expense</h2>
          <button className="xm-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="xm-body">
          <div className="xm-field">
            <label>Description</label>
            <input
              className={`xm-input${errors.title ? ' xm-error' : ''}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {errors.title && <span className="xm-err-text">{errors.title}</span>}
          </div>

          <div className="xm-field">
            <label>Amount <span style={{ fontWeight: 400, color: '#9E8FCC' }}>(was {money(expense.amount)})</span></label>
            <div className={`xm-amount-wrap${errors.amount ? ' xm-error' : ''}`}>
              <span className="xm-peso">₱</span>
              <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            {errors.amount && <span className="xm-err-text">{errors.amount}</span>}
          </div>

          <div className="xm-field">
            <label>Category</label>
            <select className="xm-select" value={category} onChange={(e) => { setCategory(e.target.value); if (e.target.value !== 'Other') setOtherType(''); }}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            {category === 'Other' && (
              <input
                className="xm-input"
                placeholder="Type of expense (optional)"
                value={otherType}
                onChange={(e) => setOtherType(e.target.value)}
              />
            )}
          </div>

          <div className="xm-field">
            <label>Due date <span style={{ fontWeight: 400, color: '#9E8FCC' }}>(optional)</span></label>
            <input
              type="date"
              className={`xm-input${errors.due ? ' xm-error' : ''}`}
              value={dueDate}
              min={dueDate && dueDate === expense.due_date ? undefined : getTodayStr()}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {errors.due && <span className="xm-err-text">{errors.due}</span>}
          </div>

          <p className="xm-section-title">How to split</p>
          <div className="xm-toggle">
            <button className={splitType === 'equal' ? 'active' : ''} onClick={() => setSplitType('equal')}>Equal (auto)</button>
            <button className={splitType === 'custom' ? 'active' : ''} onClick={switchToCustom}>Custom (manual)</button>
          </div>

          <p className="xm-section-title">Members in this expense ({included.length})</p>
          {included.map((uid) => {
            const reason = removeReason(uid);
            const eff = effectOf(uid);
            const old = splitsById[uid];
            const meta = old ? splitStatusMeta(old) : null;
            const locked = uid in fixed;
            return (
              <div className="xm-member" key={uid}>
                <Avatar profile={profileOf(uid)} />
                <div className="xm-member-info">
                  <p className="xm-member-name">{profileOf(uid)?.full_name || 'Member'}</p>
                  {eff.text && <p className={`xm-member-note ${eff.cls}`}>{eff.text}</p>}
                  {meta && (
                    <span className="xm-badge" style={{ color: meta.color, background: meta.bg, display: 'inline-block', marginTop: 3 }}>
                      {meta.label}
                    </span>
                  )}
                </div>
                {splitType === 'custom' ? (
                  <input
                    className="xm-share-input"
                    type="number"
                    inputMode="decimal"
                    value={locked ? String(fixed[uid]) : (custom[uid] ?? '')}
                    disabled={locked}
                    placeholder="0.00"
                    onChange={(e) => setCustom((prev) => ({ ...prev, [uid]: e.target.value }))}
                  />
                ) : (
                  <span className="xm-member-share">{money(shares[uid])}</span>
                )}
                <button
                  className="xm-icon-btn"
                  disabled={!!reason}
                  title={reason || 'Remove from this expense'}
                  onClick={() => remove(uid)}
                >
                  {reason ? <Lock size={12} /> : <X size={14} />}
                </button>
              </div>
            );
          })}
          {errors.members && <span className="xm-err-text">{errors.members}</span>}

          {notIncluded.length > 0 && (
            <>
              <p className="xm-section-title">Add a member</p>
              <div className="xm-chip-row">
                {notIncluded.map((m) => (
                  <button className="xm-chip" key={m.user_id} onClick={() => add(m.user_id)}>
                    <Plus size={12} /> {m.profiles?.full_name || 'Member'}
                  </button>
                ))}
              </div>
            </>
          )}

          {splitType === 'custom' && (
            <>
              <div className={`xm-box ${Math.abs(remaining) <= 0.01 ? 'xm-green' : 'xm-red'}`}>
                {Math.abs(remaining) <= 0.01
                  ? '✅ Split total matches!'
                  : `${money(Math.abs(remaining))} ${remaining > 0 ? 'still unassigned' : 'over the amount'}`}
              </div>
              <button className="xm-btn xm-soft" style={{ padding: '9px 0', fontSize: 12 }} onClick={fillEqually}>
                Auto-fill: split equally
              </button>
            </>
          )}
          {errors.split && splitType === 'equal' && <div className="xm-box xm-red">{errors.split}</div>}

          {included.some((uid) => removeReason(uid) === 'Refund this member before removing') && (
            <div className="xm-box xm-purple">
              🔒 Members who already paid can’t be removed until you refund them. You can still change their share —
              they’ll get a follow-up payment request (higher) or an overpayment refund (lower).
            </div>
          )}

          <div className="xm-box xm-yellow">📢 Everyone in this expense will be notified of the changes.</div>

          <button className="xm-btn" onClick={handleSave} disabled={saving || hasErrors}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button className="xm-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}