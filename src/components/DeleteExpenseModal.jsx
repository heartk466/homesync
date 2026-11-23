import React from 'react';
import { Trash2, Lock } from 'lucide-react';
import { money, fmtDate, num, isExpenseDeleteLocked, splitStatusMeta } from '../utils/expenseEditUtils';
import './ExpenseModals.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON, categoryIconOf } from '../utils/iconMap';

/**
 * Shows WHICH expense is about to be deleted (name, category, amount, due date,
 * who splits it and each person's share). Deleting is blocked while a non-owner
 * member has paid, has a payment pending, or has an unconfirmed refund.
 *
 * props: expense, splits, pendingRefunds, icon, color, loading, onConfirm, onClose,
 *        onRefund(split)  – optional: opens the refund modal for a blocking member
 */
export default function DeleteExpenseModal({
  expense, splits, currentUserId, pendingRefunds = [], icon = null, color = '#3B2AAB', loading, onConfirm, onClose, onRefund,
}) {
  const blockers = splits.filter((s) => isExpenseDeleteLocked(s, currentUserId));
  const memberRefunds = pendingRefunds.filter((refund) => refund.user_id !== currentUserId);
  const blocked = blockers.length > 0 || memberRefunds.length > 0;

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
              <div className="xm-cat-icon" style={{ background: `${color}22`, color }}>{icon || <CategoryIcon category={expense.category} tile={false} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="xm-summary-title">{expense.title}</p>
                <p className="xm-summary-amount">{money(expense.amount)}</p>
              </div>
            </div>
            <div className="xm-meta-row">
              <span className="xm-meta-pill"><InlineIcon as={categoryIconOf(expense.category)} size={12} /> {expense.category}</span>
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
                  <span className="xm-badge" style={{ color: meta.color, background: meta.bg }}><StatusIcon status={meta.label} />{meta.label}</span>
                  {s.paid_as_owner && s.user_id !== currentUserId && (
                    <span className="xm-badge" style={{ color: '#6B46C1', background: '#EDE9FF' }}>Paid as owner</span>
                  )}
                </div>
              );
            })}
          </div>

          {splits.some((s) => s.paid_as_owner && s.user_id !== currentUserId) && (
            <div className="xm-box xm-purple" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box', background: '#F3F0FF', color: '#4C1D95', border: '1px solid #DDD6FE' }}>
              {splits.filter((s) => s.paid_as_owner && s.user_id !== currentUserId).map((s) => s.profiles?.full_name || 'The former owner').join(', ')}
              {' '}paid while they were the household owner — no refund is needed to delete this expense.
            </div>
          )}

          {blocked ? (
            <>
              <div className="xm-box xm-red" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
                <strong>Resolve member payments first.</strong>
                {blockers.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                    <span>
                      {s.profiles?.full_name || 'Member'} · {num(s.paid_amount) > 0 ? `paid ${money(s.paid_amount)}` : 'payment pending'}
                    </span>
                    {onRefund && s.user_id !== currentUserId && num(s.paid_amount) > 0 && (
                      <button className="xm-btn-sm" onClick={() => onRefund(s)}>Refund</button>
                    )}
                  </div>
                ))}
                {blockers.some((s) => num(s.paid_amount) === 0) && (
                  <div style={{ marginTop: 6 }}>Approve or reject any pending proofs, then try again.</div>
                )}
                {memberRefunds.map((refund) => {
                  const member = splits.find((s) => s.user_id === refund.user_id);
                  return (
                    <div key={refund.id} style={{ marginTop: 6 }}>
                      Refund of {money(refund.amount)} to {member?.profiles?.full_name || 'a member'} was sent. Waiting for the member to confirm receipt.
                    </div>
                  );
                })}
              </div>
              <button className="xm-btn xm-danger" disabled>Delete Expense</button>
            </>
          ) : (
            <>
              <div className="xm-box xm-yellow" style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
                <InlineIcon as={ICONS.notify} /> Everyone in this expense will be notified. The expense will be hidden, but its records are kept.
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