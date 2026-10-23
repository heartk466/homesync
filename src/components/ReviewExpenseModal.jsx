import React from 'react';
import { ClipboardCheck, Check, X } from 'lucide-react';
import { money, fmtDate, num } from '../utils/expenseEditUtils';
import './ExpenseModals.css';

/**
 * Admin review of an expense a member created, shown BEFORE it is approved.
 * Same look as DeleteExpenseModal: category, amount, date pills and the
 * per-member split.
 *
 * A pending expense has no expense_splits rows yet (they are created on
 * approval), so the split is built from `expense.members_split`
 * ({ [user_id]: share }) and member names come from the `members` list.
 *
 * props: expense   – pending expense row (with .profiles = creator)
 *        members   – [{ user_id, role, profiles: { full_name, avatar_url } }]
 *        icon, color, loading
 *        onApprove(expense), onReject(expense), onClose()
 */
export default function ReviewExpenseModal({
  expense, members = [], icon = '📦', color = '#3B2AAB', loading, onApprove, onReject, onClose,
}) {
  const memberOf = (uid) => members.find((m) => m.user_id === uid);
  const nameOf = (uid) => memberOf(uid)?.profiles?.full_name || 'Member';

  const shares = Object.entries(expense.members_split || {});
  const total = shares.reduce((sum, [, v]) => sum + num(v), 0);
  const mismatch = shares.length > 0 && Math.abs(total - num(expense.amount)) > 0.01;

  const creatorName = expense.profiles?.full_name || nameOf(expense.created_by);
  const payerName = expense.paid_by ? nameOf(expense.paid_by) : null;

  return (
    <div className="xm-overlay">
      <div className="xm-card">
        <div className="xm-body xm-center" style={{ padding: '22px 20px 18px' }}>
          <div className="xm-lock-icon" style={{ background: '#F0EDFF', color: '#3B2AAB' }}>
            <ClipboardCheck size={24} />
          </div>
          <h2 className="xm-title">Review Expense</h2>
          <p className="xm-sub">Submitted by <strong>{creatorName}</strong></p>

          <div className="xm-summary">
            <div className="xm-summary-top">
              <div className="xm-cat-icon" style={{ background: `${color}22` }}>{icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="xm-summary-title">{expense.title}</p>
                <p className="xm-summary-amount">{money(expense.amount)}</p>
              </div>
            </div>

            <div className="xm-meta-row">
              <span className="xm-meta-pill">{icon} {expense.category}</span>
              {expense.due_date && <span className="xm-meta-pill">Due {fmtDate(expense.due_date)}</span>}
              {expense.expense_date && <span className="xm-meta-pill">Added {fmtDate(expense.expense_date)}</span>}
              <span className="xm-meta-pill">{expense.split_type === 'custom' ? 'Custom split' : 'Equal split'}</span>
              <span className="xm-meta-pill">{payerName ? `Paid by ${payerName}` : 'No payer yet'}</span>
            </div>

            <p className="xm-section-title" style={{ margin: '12px 0 2px' }}>
              Split between {shares.length} member{shares.length === 1 ? '' : 's'}
            </p>
            {shares.map(([uid, share]) => (
              <div className="xm-split-row" key={uid}>
                <span className="xm-split-name">{nameOf(uid)}</span>
                <strong>{money(share)}</strong>
                {uid === expense.paid_by && (
                  <span className="xm-badge" style={{ color: '#3B2AAB', background: '#F0EDFF' }}>Payer</span>
                )}
              </div>
            ))}
          </div>

          {mismatch && (
            <div className="xm-box xm-red" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
              ⚠️ The shares add up to {money(total)}, but the expense is {money(expense.amount)}.
            </div>
          )}

          <div className="xm-box xm-purple" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
            Approving shares this expense with everyone above. Rejecting asks you for a reason and notifies {creatorName}.
          </div>

          <div className="xm-actions" style={{ width: '100%' }}>
            <button className="xm-btn-sm xm-green" disabled={loading} onClick={() => onApprove(expense)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Check size={14} /> Approve
            </button>
            <button className="xm-btn-sm xm-red" disabled={loading} onClick={() => onReject(expense)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <X size={14} /> Reject
            </button>
          </div>
          <button className="xm-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}