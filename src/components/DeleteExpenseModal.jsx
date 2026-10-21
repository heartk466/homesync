import React from 'react';
import { Trash2, Lock } from 'lucide-react';
import { money, fmtDate, num, isMoneyLocked, splitStatusMeta } from '../utils/expenseEditUtils';
import './ExpenseModals.css';

/**
 * Shows WHICH expense is about to be deleted (name, category, amount, due date,
 * who splits it and each person's share). Deleting is blocked while any member
 * (other than the payer) has paid or has a payment pending — refund first.
 *
 * props: expense, splits, icon, color, loading, onConfirm, onClose,
 *        onRefund(split)  – optional: opens the refund modal for a blocking member
 */
export default function DeleteExpenseModal({
  expense, splits, icon = '📦', color = '#3B2AAB', loading, onConfirm, onClose, onRefund,
}) {
  const blockers = splits.filter((s) => isMoneyLocked(s, expense));
  const blocked = blockers.length > 0;

  return (
    <div className="xm-overlay">
      <div className="xm-card">
        <div className="xm-body xm-center" style={{ padding: '22px 20px 18px' }}>
          {blocked ? (
            <div className="xm-lock-icon"><Lock size={24} /></div>
          ) : (
            <div className="xm-lock-icon"><Trash2 size={24} /></div>
          )}
          <h2 className="xm-title">{blocked ? 'Can’t delete yet' : 'Delete Expense?'}</h2>

          {/* What is being deleted */}
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
            </div>

            <p className="xm-section-title" style={{ margin: '12px 0 2px' }}>
              Split between {splits.length} member{splits.length === 1 ? '' : 's'}
            </p>
            {splits.map((s) => {
              const meta = splitStatusMeta(s);
              return (
                <div className="xm-split-row" key={s.id}>
                  <span className="xm-split-name">{s.profiles?.full_name || 'Member'}</span>
                  <strong>{money(s.share_amount)}</strong>
                  <span className="xm-badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                </div>
              );
            })}
          </div>

          {blocked ? (
            <>
              <div className="xm-box xm-red" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
                <strong>Refund these members first.</strong> They’ve paid (or have a payment waiting) for this expense:
                {blockers.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                    <span>
                      {s.profiles?.full_name || 'Member'} · {num(s.paid_amount) > 0 ? `paid ${money(s.paid_amount)}` : 'payment pending'}
                    </span>
                    {onRefund && num(s.paid_amount) > 0 && (
                      <button className="xm-btn-sm" onClick={() => onRefund(s)}>Refund</button>
                    )}
                  </div>
                ))}
                {blockers.some((s) => num(s.paid_amount) === 0) && (
                  <div style={{ marginTop: 6 }}>Approve or reject any pending proofs, then try again.</div>
                )}
              </div>
              <button className="xm-btn xm-danger" disabled>Delete Expense</button>
            </>
          ) : (
            <>
              <div className="xm-box xm-yellow" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
                📢 Everyone in this expense will be notified. The expense will be hidden, but its records are kept.
              </div>
              <button className="xm-btn xm-danger" onClick={onConfirm} disabled={loading}>
                {loading ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </>
          )}
          <button className="xm-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}