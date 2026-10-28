import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { supabase } from '../supabaseClient';
import {
  Search, Filter, X, Check, Plus,
  Trash2, AlertCircle, ChevronDown, Camera, Pencil, Eye, MoreVertical
} from 'lucide-react';
import './ExpensesScreen.css';
import '../styles/pendingApprovals.css';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import PayOnlineModal from '../components/PayOnlineModal';
import EditExpenseModal from '../components/EditExpenseModal';
import DeleteExpenseModal from '../components/DeleteExpenseModal';
import AddExpenseModal from '../components/AddExpenseModal';
import DatePickerField from '../components/DatePickerField';
import { withFormerMemberNames } from '../utils/formerMembers';
import FollowupPaymentModal from '../components/FollowupPaymentModal';
import RefundModal from '../components/RefundModal';
import PaymentHistoryModal from '../components/PaymentHistoryModal';
import ProofViewModal from '../components/ProofViewModal';
import ReviewExpenseModal from '../components/ReviewExpenseModal';
import RejectExpenseModal from '../components/RejectExpenseModal';
import RequestRefundButton from '../components/RequestRefundButton';
import { approveMemberExpense, rejectMemberExpense } from '../utils/expenseApproval';
import {
  fetchExpenseExtras, softDeleteExpense, submitFollowupProof, reviewFollowupProof,
  sendRefund, reviewRefund, followupDueOf, overpaidOf,
  num as toNum,
} from '../utils/expenseEditUtils';
import { formatMoney, formatDate } from '../utils/format';
import { owedRefundsFrom, owedRefundsByPerson, deletionStateOf, DELETION_STATUS_META } from '../utils/refundsOwed';
import { notifyPendingChanged } from '../utils/pendingEvents';
import { resolvePaymentProofUrls, uploadPaymentProof } from '../utils/paymentProofStorage';
import {
  fetchAllHouseholdExpenses, categoryLabel,
} from '../utils/expenseUtils';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';
import { useCachedState, useScreenLoad, isScreenLoaded } from '../utils/screenCache';
import { LoadGate, ExpensesSkeleton, ExpenseListSkeleton } from '../components/Skeleton';

// All selectable categories — Other always last
const ALL_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Internet',
  'Food', 'Grocery', 'Transport', 'Entertainment', 'Subscription', 'Other',
];

// Category filter options
const CATEGORY_KEYS = ['Rent', 'Electricity', 'Water', 'Internet', 'Food', 'Grocery', 'Other', 'Transport', 'Entertainment', 'Subscription', 'Gas', 'Mobile', 'Cable', 'Other utility'];

const CATEGORY_COLORS = {
  Rent: '#3B2AAB', Electricity: '#2B6CB0', Water: '#2C7A7B',
  Internet: '#6B46C1', Food: '#C05621', Grocery: '#276749',
  Other: '#718096', Transport: '#DD6B20', Entertainment: '#D53F8C',
  Subscription: '#9B2C87',
  Gas: '#C05621', Mobile: '#3B2AAB', Cable: '#2C7A7B', 'Other utility': '#718096',
};

// Local (device) date as YYYY-MM-DD. toISOString() uses UTC, which returns
// "yesterday" before 8 AM in the Philippines (UTC+8).
const getTodayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};
const fmtDate = formatDate;
// Admin still has to act: a member (not the owner) is overpaid and no refund to
// them is waiting for their review (none sent yet, or the last one was rejected).
const needsRefundOf = (splits = [], refunds = [], ownerId) => splits.some(sp => (
  sp.user_id !== ownerId
  && overpaidOf(sp) > 0
  && !refunds.some(r => r.user_id === sp.user_id && r.status === 'sent')
));

// Notification jump: "/expenses?householdId=…&expenseId=…" (e.g. "Refund Needed")
// selects that household, scrolls to the expense and pulses it, then clears the
// params. A child component so the screen itself needs no extra hooks.
// With "&refundId=…" ("Refund Rejected"), the admin's first tap also opens the
// resend form; once it was resent (or nothing is left to refund) it only jumps.
function NotificationJump({
  households, selectedHouseholdId, expenses, refunds, expenseSplits, proofs, userId, isAdmin, pendingCount,
  onSelectHousehold, onReveal, onResendRefund, showToast,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // Each step runs once per notification (the callbacks are new every render).
  const doneRef = useRef({ key: null, selected: false, revealed: false });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const householdId = params.get('householdId');
    const expenseId = params.get('expenseId');
    if (!expenseId) return undefined;
    if (doneRef.current.key !== location.search) doneRef.current = { key: location.search, selected: false, revealed: false };
    const done = doneRef.current;

    if (householdId && householdId !== selectedHouseholdId) {
      const target = households.find(h => h.id === householdId);
      if (target && !done.selected) { done.selected = true; onSelectHousehold(target); }
      return undefined; // runs again once that household's expenses load
    }
    if (!expenses.some(e => e.id === expenseId)) return undefined; // still loading (or gone)

    // Member + "Overpayment Refund Sent": while the refund still waits for their
    // review, go to its card in Pending Approvals (opening the dropdown); once
    // they approved / rejected it, fall through to the expense card below.
    const memberRefundId = !isAdmin ? params.get('refundId') : null;
    let memberMessage = null;
    if (memberRefundId) {
      if (!expenseSplits[expenseId]) return undefined; // refunds + splits still loading
      const refund = (refunds[expenseId] || []).find(r => r.id === memberRefundId);
      if (refund?.status === 'sent') {
        const section = document.getElementById('pending-approvals');
        if (!section) return undefined; // section renders once the data is in
        const timer = setTimeout(() => {
          section.dispatchEvent(new CustomEvent('pending-open'));
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const card = document.getElementById(`refund-approval-${refund.id}`);
            if (!card) return;
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('notif-pulse-card');
            setTimeout(() => card.classList.remove('notif-pulse-card'), 3600);
          }));
          navigate('/expenses', { replace: true });
        }, 0);
        return () => clearTimeout(timer);
      }
      if (refund) memberMessage = refund.status === 'confirmed' ? 'You already confirmed receiving this refund.' : 'You already rejected this refund.';
    }

    // Admin + "Payment Proof Submitted": while that proof still waits for review,
    // go to its card in Pending Approvals; once approved / rejected, fall through
    // to the expense card below.
    const proofId = isAdmin ? params.get('proofId') : null;
    if (proofId) {
      const splits = expenseSplits[expenseId];
      if (!splits) return undefined; // still loading
      const waiting = splits.some(s => s.status === 'pending_verification' && s.proof_id === proofId);
      if (waiting) {
        const section = document.getElementById('pending-approvals');
        if (!section || !pendingCount) return undefined; // the section renders once its data is in
        const timer = setTimeout(() => {
          section.dispatchEvent(new CustomEvent('pending-open'));
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const card = document.getElementById(`proof-approval-${proofId}`);
            if (!card) return;
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('notif-pulse-card');
            setTimeout(() => card.classList.remove('notif-pulse-card'), 3600);
          }));
          navigate('/expenses', { replace: true });
        }, 0);
        return () => clearTimeout(timer);
      }
      memberMessage = 'This payment proof was already reviewed.';
    }

    // Member + "Payment Proof Rejected": while they still have to resubmit, go to
    // the rejected card in Pending Approvals; once a new proof was sent (here or
    // on the household screen), fall through to the expense card below.
    const rejectedProofId = !isAdmin ? params.get('proofId') : null;
    if (rejectedProofId) {
      const split = (expenseSplits[expenseId] || []).find(s => s.user_id === userId);
      const own = proofs.filter(p => p.expense_id === expenseId && p.submitted_by === userId);
      if (!split || !own.some(p => p.id === rejectedProofId)) return undefined; // still loading
      const latest = [...own].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      const mustResubmit = split.status === 'unpaid' && latest?.status === 'rejected'
        && !deletionStateOf(split, refunds[expenseId]);
      if (mustResubmit) {
        const section = document.getElementById('pending-approvals');
        if (!section) return undefined; // section renders once the data is in
        const timer = setTimeout(() => {
          section.dispatchEvent(new CustomEvent('pending-open'));
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const card = document.getElementById(`proof-rejected-${expenseId}`);
            if (!card) return;
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('notif-pulse-card');
            setTimeout(() => card.classList.remove('notif-pulse-card'), 3600);
          }));
          navigate('/expenses', { replace: true });
        }, 0);
        return () => clearTimeout(timer);
      }
      memberMessage = latest?.status === 'rejected' ? null : 'You already resubmitted your payment proof.';
    }

    const el = document.getElementById(`expense-card-${expenseId}`);
    if (!el) {
      // hidden by search/filter — clear them once and retry
      if (!done.revealed) { done.revealed = true; onReveal(); }
      return undefined;
    }

    // Refund jump: wait for splits (they load after the refunds) so the lookup is reliable.
    const refundId = params.get('refundId');
    let resend = null;
    let message = memberMessage;
    if (refundId && isAdmin) {
      const splits = expenseSplits[expenseId];
      if (!splits) return undefined;
      const refund = (refunds[expenseId] || []).find(r => r.id === refundId);
      if (refund && isAdmin) {
        // Same rule as the household screen: resend only while this rejected
        // refund is the newest of its type and something is still overpaid.
        const split = splits.find(s => s.user_id === refund.user_id);
        const supersededBy = (refunds[expenseId] || []).find(r => (
          r.id !== refund.id && r.user_id === refund.user_id && r.refund_type === refund.refund_type
          && Date.parse(r.created_at) > Date.parse(refund.created_at)
        ));
        const nothingLeft = refund.refund_type === 'overpayment' && overpaidOf(split) <= 0.001;
        if (refund.status === 'rejected' && split && !supersededBy && !nothingLeft) {
          resend = {
            expense: expenses.find(e => e.id === expenseId),
            split,
            refundType: refund.refund_type === 'overpayment' ? 'overpayment' : 'expense_deletion',
            resending: true,
            initialAmount: refund.amount,
          };
        } else if (refund.status === 'rejected') {
          message = supersededBy ? 'You already resent this refund — it’s now awaiting the member’s review.' : 'Nothing left to refund for this member.';
        } else {
          message = refund.status === 'confirmed' ? 'The member already confirmed receiving this refund.' : 'This refund is awaiting the member’s review.';
        }
      }
    }

    const timer = setTimeout(() => {
      // open the card first, then scroll once its details are rendered
      el.dispatchEvent(new CustomEvent('expense-open'));
      requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' })));
      el.classList.add('notif-pulse-card');
      setTimeout(() => el.classList.remove('notif-pulse-card'), 3600);
      if (resend) onResendRefund(resend);
      else if (message) showToast(message, 'success');
      navigate('/expenses', { replace: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [location.search, households, selectedHouseholdId, expenses, refunds, expenseSplits, proofs, userId, isAdmin, pendingCount, onSelectHousehold, onReveal, onResendRefund, showToast, navigate]);

  return null;
}

// Whole days from today to a YYYY-MM-DD date (negative = past).
const daysUntil = (dateStr) =>
  Math.round((new Date(`${dateStr}T00:00:00`) - new Date(`${getTodayStr()}T00:00:00`)) / 86400000);

// ── Search ──
// Everything a search can match for one expense: name, category, status words
// (paid / pending / verifying / partly paid / overpaid / needs refund /
// awaiting approval), due state (overdue / due today / due soon / due in N
// days) and the date it was added (month, short month, day, year, M/D/YYYY).
// Every word typed must start a word of the expense ("water october",
// "overdue rent", "due today"), so "paid" doesn't also find "unpaid". Status
// phrases are kept as one word ("partly paid" → partly-paid).
const SEARCH_PHRASES = ['partly paid', 'fully paid', 'due today', 'due soon', 'past due', 'needs refund',
  'awaiting approval', 'pending approval', 'pending verification'];
const phraseToken = (p) => p.replace(/ /g, '-');
const searchTermsOf = (query) => {
  let q = query.trim().toLowerCase();
  SEARCH_PHRASES.forEach(p => { q = q.split(p).join(phraseToken(p)); });
  return q.split(/\s+/).filter(Boolean);
};
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function expenseSearchText(e, { splits = [], isAdmin, myId, ownerId, needsRefund }) {
  const words = [e.title, e.category, categoryLabel(e.category), e.profiles?.full_name, e.location];
  const relevant = splits.filter(sp => isAdmin || sp.user_id === myId);

  if (e.approval_status === 'pending_approval') words.push('awaiting-approval pending-approval approval');
  else if (e.approval_status === 'rejected') words.push('rejected');
  if (e.status === 'paid') words.push('paid fully-paid settled');
  else if (e.status === 'verifying') words.push('verifying pending-verification');
  else words.push('pending unpaid');
  if (relevant.some(sp => sp.status === 'partly_paid')) words.push('partly-paid partial');
  if (relevant.some(sp => sp.user_id !== ownerId && overpaidOf(sp) > 0)) words.push('overpaid');
  if (needsRefund) words.push('needs-refund refund');

  if (e.due_date && e.status !== 'paid' && e.approval_status === 'approved') {
    const d = daysUntil(e.due_date);
    if (d < 0) words.push('overdue late past-due');
    else if (d === 0) words.push('due due-today due-soon today');
    else if (d <= 3) words.push(`due due-soon soon in ${d} day${d === 1 ? '' : 's'}`);
    else words.push('due upcoming');
  }

  if (e.expense_date) {
    const [y, m, day] = e.expense_date.split('-').map(Number);
    const month = MONTH_NAMES[m - 1] || '';
    words.push(month, month.slice(0, 3), String(y), `${month} ${day}`, `${month.slice(0, 3)} ${day}`,
      `${m}/${day}/${y}`, e.expense_date);
  }
  const amount = Number(e.amount) || 0;
  words.push(String(amount), amount.toLocaleString('en-PH', { minimumFractionDigits: 2 }));
  return words.filter(Boolean).join(' ').toLowerCase().split(/\s+/);
}

// Admin's "Pending Approvals" section — same cards as the household screen:
// members' proposed expenses (Review → approve / reject) first, then the
// payment-proof cards passed in as children. Loads its own pending expenses
// (and reloads whenever `refreshKey` changes) so the screen needs no extra state.
function PendingApprovalsSection({
  householdId, members, ownerId, actor, refreshKey, paymentCount, onChanged, showToast, children,
}) {
  const [pendingExpenses, setPendingExpenses] = useState([]);
  const [reviewExpense, setReviewExpense] = useState(null);
  const [rejectingExpense, setRejectingExpense] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!householdId) return undefined;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('expenses')
        .select('*')
        .eq('household_id', householdId)
        .eq('approval_status', 'pending_approval')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (!cancelled) setPendingExpenses(data || []);
    })();
    return () => { cancelled = true; };
  }, [householdId, refreshKey, reloadTick]);

  const link = { link_path: `/groups/${householdId}?type=household`, link_state: JSON.stringify({ type: 'household' }) };
  const creatorName = (uid) => members.find(m => m.user_id === uid)?.profiles?.full_name || 'A member';
  const withCreator = (expense) => ({ ...expense, profiles: { full_name: creatorName(expense.created_by) } });

  const finish = (message) => {
    showToast(message);
    setReloadTick(t => t + 1);
    onChanged();
  };

  const approve = async (expense) => {
    setBusy(true);
    try {
      await approveMemberExpense({ expense, ownerId, actorId: actor.id, link });
      setReviewExpense(null);
      finish('Expense approved!');
    } catch (err) {
      showToast(err.message || 'Could not approve the expense.', 'error');
    }
    setBusy(false);
  };

  const reject = async (reason) => {
    setBusy(true);
    try {
      await rejectMemberExpense({ expense: rejectingExpense, reason, actorId: actor.id, actorName: actor.name, link });
      setRejectingExpense(null);
      finish('Expense rejected — member notified');
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusy(false);
  };

  const total = pendingExpenses.length + paymentCount;
  return (
    <>
      {total > 0 && (
        <PendingSectionShell total={total}>
            {pendingExpenses.map(expense => (
              <div key={`exp-${expense.id}`} className="pa-card">
                <div
                  className="pa-top pa-top-tap"
                  role="button"
                  tabIndex={0}
                  onClick={() => setReviewExpense(withCreator(expense))}
                  onKeyDown={(e) => { if (e.key === 'Enter') setReviewExpense(withCreator(expense)); }}
                >
                  <div className="pa-icon pa-icon-expense"><CategoryIcon category={expense.category} tile={false} /></div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">{expense.title}</span>
                      <span className="pa-amount">{formatMoney(expense.amount)}</span>
                    </div>
                    <div className="pa-meta">
                      by {creatorName(expense.created_by)} · {formatDate(expense.expense_date)}{expense.due_date ? ` · Due ${formatDate(expense.due_date)}` : ''}
                    </div>
                    <span className="pa-tag pa-tag-expense">New expense</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-proof" onClick={() => setReviewExpense(withCreator(expense))}>
                    <Eye size={14} /> Review details
                  </button>
                </div>
              </div>
            ))}
            {children}
        </PendingSectionShell>
      )}

      {reviewExpense && (
        <ReviewExpenseModal
          expense={reviewExpense}
          members={members}
          icon={<CategoryIcon category={reviewExpense.category} tile={false} />}
          color={CATEGORY_COLORS[reviewExpense.category] || '#3B2AAB'}
          loading={busy}
          onApprove={approve}
          onReject={(exp) => { setReviewExpense(null); setRejectingExpense(exp); }}
          onClose={() => setReviewExpense(null)}
        />
      )}
      {rejectingExpense && (
        <RejectExpenseModal
          expense={rejectingExpense}
          loading={busy}
          onConfirm={reject}
          onClose={() => setRejectingExpense(null)}
        />
      )}
    </>
  );
}

// " Pending Approvals" box shared by the admin and member sections. With 3 or
// more items the header becomes a dropdown (closed at first) so the list
// doesn't push the expenses far down.
function PendingSectionShell({ total, children }) {
  const sectionRef = useRef(null);
  const collapsible = total >= 3;
  const [open, setOpen] = useState(false);
  const showList = !collapsible || open;

  // A notification jump to one of these cards opens the dropdown first.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return undefined;
    const onOpen = () => setOpen(true);
    el.addEventListener('pending-open', onOpen);
    return () => el.removeEventListener('pending-open', onOpen);
  }, []);

  return (
    <div ref={sectionRef} id="pending-approvals" className={`pending-section${collapsible ? ' pending-section--collapsible' : ''}`}>
      {collapsible ? (
        <button type="button" className="pending-section-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <span className="pending-section-title"><InlineIcon as={ICONS.pending} /> Pending Approvals</span>
          <span className="pending-count-chip">{total}</span>
          <ChevronDown size={18} className={`pending-chevron${open ? ' open' : ''}`} aria-hidden="true" />
        </button>
      ) : (
        <p className="pending-section-title"><InlineIcon as={ICONS.pending} /> Pending Approvals ({total})</p>
      )}
      {!showList && <p className="pending-section-hint">{total} items need your attention — tap to view</p>}
      {showList && <div className="pa-list">{children}</div>}
    </div>
  );
}

// Collapsible expense card — same look as the household screen's: icon, title,
// amount and a "2/3 paid" bar; tap to show the details. Keeps its own open
// state; NotificationJump opens it with an 'expense-open' DOM event.
function CollapsibleExpenseCard({ expense, splits, className, style, pills, attention, children }) {
  const cardRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const onOpen = () => setOpen(true);
    el.addEventListener('expense-open', onOpen);
    return () => el.removeEventListener('expense-open', onOpen);
  }, []);

  const paidCount = splits.filter(s => s.status === 'approved').length;
  const progress = splits.length ? Math.round((paidCount / splits.length) * 100) : 0;
  const bodyId = `expense-card-body-${expense.id}`;

  return (
    <div ref={cardRef} id={`expense-card-${expense.id}`} className={`expense-item xc-card ${className || ''}`} style={style}>
      {attention && <span className="xc-attention" role="status" aria-label="Needs your action" title="Needs your action" />}
      <button type="button" className="xc-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(v => !v)}>
        <span className="xc-icon" style={{ background: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}>
          <CategoryIcon category={expense.category} tile={false} />
        </span>
        <span className="xc-head-info">
          <span className="xc-head-top">
            <span className="xc-title">{expense.title}</span>
            <span className="xc-amount">{formatMoney(expense.amount)}</span>
          </span>
          <span className="xc-progress">
            <span className="xc-progress-text">{paidCount}/{splits.length} paid</span>
            <span className="xc-progress-track" role="progressbar" aria-label={`${paidCount} of ${splits.length} members paid`} aria-valuemin={0} aria-valuemax={splits.length} aria-valuenow={paidCount}>
              <span className="xc-progress-fill" style={{ width: `${progress}%` }} />
            </span>
          </span>
          {pills && <span className="xc-pills">{pills}</span>}
        </span>
        <ChevronDown size={18} className={`xc-chevron${open ? ' open' : ''}`} aria-hidden="true" />
      </button>
      {open && <div id={bodyId} className="xc-body">{children}</div>}
    </div>
  );
}

// Member's "Pending Approvals" section — same cards as the household screen:
//   • rejected payment proofs they still have to resubmit (newest proof is the
//     rejected one and their share is still unpaid)
//   • refunds the admin sent that are waiting for their approve / reject
function MemberPendingApprovals({ expenses, expenseSplits, refunds, proofs, userId, onResubmit, onViewProof, onReviewRefund }) {
  const rejected = expenses.flatMap((expense) => {
    const split = (expenseSplits[expense.id] || []).find(s => s.user_id === userId);
    if (!split || split.status !== 'unpaid') return [];
    if (deletionStateOf(split, refunds[expense.id])) return []; // being deleted — nothing to resubmit
    const latest = proofs
      .filter(p => p.expense_id === expense.id && p.submitted_by === userId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    return latest?.status === 'rejected' ? [{ expense, split, proof: latest }] : [];
  });
  const refundsToReview = expenses.flatMap((expense) => (
    (refunds[expense.id] || [])
      .filter(r => r.user_id === userId && r.status === 'sent')
      .map(refund => ({ refund, expense, split: (expenseSplits[expense.id] || []).find(s => s.user_id === userId) }))
  ));

  const total = rejected.length + refundsToReview.length;
  if (!total) return null;
  return (
    <PendingSectionShell total={total}>
        {rejected.map(({ expense, split, proof }) => (
          <div key={`rejected-${proof.id}`} id={`proof-rejected-${expense.id}`} className="pa-card">
            <div className="pa-top">
              <div className="pa-icon pa-icon-rejected"><Icon as={ICONS.rejected} /></div>
              <div className="pa-info">
                <div className="pa-title-row">
                  <span className="pa-title">{expense.title}</span>
                  <span className="pa-amount">{formatMoney(split.share_amount)}</span>
                </div>
                <div className="pa-meta">Your proof was rejected{proof.rejection_reason ? `: ${proof.rejection_reason}` : ''}</div>
                <span className="pa-tag pa-tag-rejected">Resubmit needed</span>
              </div>
            </div>
            <div className="pa-actions">
              <button className="pa-btn pa-btn-reject" onClick={() => onResubmit(expense)}>
                <Camera size={14} /> Resubmit
              </button>
              <button className="pa-btn pa-btn-approve" style={{ background: 'white', color: '#3B2AAB', borderColor: '#E0D9FF' }} onClick={() => onViewProof(proof, split)}>
                <Eye size={14} /> View proof
              </button>
            </div>
          </div>
        ))}
        {refundsToReview.map(({ refund, expense, split }) => (
          <div key={`refund-${refund.id}`} id={`refund-approval-${refund.id}`} className="pa-card">
            <div className="pa-top">
              <div className="pa-icon pa-icon-payment"><Icon as={ICONS.refund} /></div>
              <div className="pa-info">
                <div className="pa-title-row">
                  <span className="pa-title">{expense.title}</span>
                  <span className="pa-amount">{formatMoney(refund.amount)}</span>
                </div>
                <div className="pa-meta">
                  {refund.refund_type === 'overpayment' ? 'Overpayment refund' : 'Deletion refund'} from the admin
                </div>
                <span className="pa-tag pa-tag-payment">Refund proof</span>
              </div>
            </div>
            <div className="pa-actions">
              <button className="pa-btn pa-btn-proof" onClick={() => split && onReviewRefund(expense, split)}>
                <Eye size={14} /> Review refund
              </button>
            </div>
          </div>
        ))}
    </PendingSectionShell>
  );
}

// Summary cards: horizontal scroll-snap row with pagination dots.
function StatCarousel({ labels, children }) {
  const rowRef = useRef(null);
  const [page, setPage] = useState(0);

  const onScroll = (e) => {
    const row = e.currentTarget;
    const cards = [...row.children];
    const offsetOf = (card) => Math.abs(card.offsetLeft - row.offsetLeft - row.scrollLeft);
    let nearest = cards.reduce((best, card, i) => (offsetOf(card) < offsetOf(cards[best]) ? i : best), 0);
    // The last card can't snap to the start, so reaching the end means "last".
    if (row.scrollLeft + row.clientWidth >= row.scrollWidth - 2) nearest = cards.length - 1;
    if (nearest !== page) setPage(nearest);
  };

  const goTo = (i) => {
    const row = rowRef.current;
    const card = row?.children[i];
    if (card) row.scrollTo({ left: card.offsetLeft - row.offsetLeft, behavior: 'smooth' });
  };

  return (
    <>
      <div className="stat-cards-row" ref={rowRef} onScroll={onScroll}>{children}</div>
      <div className="stat-dots" role="tablist" aria-label="Summary cards">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={page === i}
            aria-label={label}
            className={`stat-dot${page === i ? ' active' : ''}`}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </>
  );
}

// "You Owe" summary card. Stays compact; hovering it (or tapping, on phones)
// opens a breakdown: unpaid expenses and who paid them, plus refunds the admin
// still has to send. The breakdown is portalled so the carousel can't clip it.
// Placeholder bar while a household's numbers load (instead of a misleading ₱0.00)
const AmountSkeleton = () => <span className="stat-skeleton" aria-label="Loading" />;

function OweCard({ total, details, loading }) {
  const cardRef = useRef(null);
  const closeTimer = useRef(null);
  const [pos, setPos] = useState(null); // null = closed
  const owes = details.filter(d => !d.refund);
  const refunds = details.filter(d => d.refund);
  const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  const open = () => {
    clearTimeout(closeTimer.current);
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect || !details.length) return;
    const width = Math.min(300, window.innerWidth - 24);
    setPos({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
  };
  const close = () => setPos(null);
  const closeSoon = () => { closeTimer.current = setTimeout(close, 150); };

  useEffect(() => {
    if (!pos) return undefined;
    const onAway = (e) => {
      if (cardRef.current?.contains(e.target) || e.target.closest?.('.owe-popover')) return;
      setPos(null);
    };
    const onMove = (e) => { if (!e?.target?.closest?.('.owe-popover')) setPos(null); };
    document.addEventListener('pointerdown', onAway);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onAway);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [pos]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const summary = [
    owes.length ? `${owes.length} unpaid` : null,
    refunds.length ? `${refunds.length} refund${refunds.length === 1 ? '' : 's'} to send` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      ref={cardRef}
      className={`stat-card stat-card--amber owe-card${details.length ? ' owe-card--interactive' : ''}`}
      onMouseEnter={() => { if (canHover()) open(); }}
      onMouseLeave={() => { if (canHover()) closeSoon(); }}
      onClick={() => { if (!canHover()) { if (pos) close(); else open(); } }}
      role={details.length ? 'button' : undefined}
      aria-expanded={details.length ? !!pos : undefined}
    >
      <div className="stat-card-top">
        <span className="stat-card-emoji"><Icon as={ICONS.owe} size={18} /></span>
        <span className="stat-card-label">You Owe</span>
      </div>
      <p className="stat-card-amount">{loading ? <AmountSkeleton /> : formatMoney(total)}</p>
      <p className="stat-card-sub">
        {loading ? '' : details.length ? (
          <>
            <span className="stat-reimburse-line">{summary}</span>
            <span className="owe-card-hint">{canHover() ? 'Hover for details' : 'Tap for details'} ›</span>
          </>
        ) : 'Nothing to pay'}
      </p>
      {pos && createPortal(
        <div
          className="owe-popover"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => clearTimeout(closeTimer.current)}
          onMouseLeave={() => { if (canHover()) closeSoon(); }}
        >
          {owes.length > 0 && (
            <div className="owe-popover-section">
              <p className="owe-popover-title">Unpaid expenses</p>
              {owes.map((d, i) => (
                <div key={`o${i}`} className="owe-popover-row">
                  <div className="owe-popover-info">
                    <span className="owe-popover-name">{d.expense?.title || 'Expense'}</span>
                    <span className="owe-popover-meta">{d.payer?.full_name ? `Pay → ${d.payer.full_name}` : 'Unpaid'}</span>
                  </div>
                  <span className="owe-popover-amt">{formatMoney(d.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {refunds.length > 0 && (
            <div className="owe-popover-section">
              <p className="owe-popover-title">Overpayment refunds to send</p>
              {refunds.map((d, i) => (
                <div key={`r${i}`} className="owe-popover-row">
                  <div className="owe-popover-info">
                    <span className="owe-popover-name">Refund → {d.payer?.full_name}</span>
                    {d.awaiting > 0 && (
                      <span className="owe-popover-meta">{formatMoney(d.awaiting)} sent · awaiting their confirmation</span>
                    )}
                  </div>
                  <span className="owe-popover-amt owe-popover-amt--refund">{formatMoney(d.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// "⋮" menu for an expense card (admin): Edit, Delete. Delete opens the
// screen's DeleteExpenseModal, which is the confirm step.
function ExpenseCardMenu({ title, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="expense-admin-col expense-menu" ref={wrapRef}>
      <button
        className="icon-btn expense-menu-btn"
        aria-label={`More actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="expense-menu-list" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>
            <Pencil size={13} /> Edit
          </button>
          <button role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete(); }}>
            <Trash2 size={13} /> Delete…
          </button>
        </div>
      )}
    </div>
  );
}

export default function ExpensesScreen() {
  const navigate = useNavigate();
  const proofInputRef = useRef(null);
  const initialHouseholdSet = useRef(false);

  const [profile, setProfile] = useCachedState('expenses', 'profile', null);
  const [households, setHouseholds] = useCachedState('expenses', 'households', []);
  const [selectedHousehold, setSelectedHousehold] = useCachedState('expenses', 'selectedHousehold', null);
  const [currentUser, setCurrentUser] = useCachedState('expenses', 'currentUser', null);
  const [isAdmin, setIsAdmin] = useCachedState('expenses', 'isAdmin', false);
  const [expenses, setExpenses] = useCachedState('expenses', 'expenses', []);
  const [expenseSplits, setExpenseSplits] = useCachedState('expenses', 'expenseSplits', {});
  const [householdMembers, setHouseholdMembers] = useCachedState('expenses', 'householdMembers', []);
  const [notifications, setNotifications] = useCachedState('expenses', 'notifications', []);
  const [unreadCount, setUnreadCount] = useCachedState('expenses', 'unreadCount', 0);
  const [pendingApprovals, setPendingApprovals] = useCachedState('expenses', 'pendingApprovals', []);
  const [pendingPaymentProofs, setPendingPaymentProofs] = useCachedState('expenses', 'pendingPaymentProofs', []);

  // Summary
  const [totalShared, setTotalShared] = useCachedState('expenses', 'totalShared', 0);
  const [toReimburse, setToReimburse] = useCachedState('expenses', 'toReimburse', 0);
  const [totalSaved, setTotalSaved] = useCachedState('expenses', 'totalSaved', 0);
  const [reimburseDetails, setReimburseDetails] = useCachedState('expenses', 'reimburseDetails', []);

  // UI State
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectProofModal, setShowRejectProofModal] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedSplit, setSelectedSplit] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null);

  // Edit / follow-up / refund / proofs (shared modals)
  const [editExpense, setEditExpense] = useState(null);
  const [extras, setExtras] = useCachedState('expenses', 'extras', { followups: {}, refunds: {} });
  const [allProofs, setAllProofs] = useCachedState('expenses', 'allProofs', []);
  const [followupFor, setFollowupFor] = useState(null);   // { expense, split }
  const [showFollowupPayOnline, setShowFollowupPayOnline] = useState(false);
  const [refundFor, setRefundFor] = useState(null);       // { expense, split }
  const [proofsFor, setProofsFor] = useState(null);       // { expense, split }
  const [xmLoading, setXmLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [householdSearch, setHouseholdSearch] = useState('');
  const [loading, setLoading] = useState(false);
  // a household's expenses are loading (first visit only — revisits show the stored list)
  const [dataLoading, setDataLoading] = useState(() => !isScreenLoaded('expenses'));
  const load = useScreenLoad('expenses');
  const { done: loadDone, fail: loadFail } = load;
  const contentReady = load.loaded && !load.showSkeleton;
  const loadedHouseholdRef = useRef(selectedHousehold?.id ?? null);                 // reloads of the same household keep the list
  const [toast, setToast] = useState(null);

  // Filter state
  const [filterStatus, setFilterStatus] = useState([]);
  const [filterCategory, setFilterCategory] = useState([]);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Payment proof form
  const [proofForm, setProofForm] = useState({ note: '', screenshot: null, screenshotPreview: null });
  const [showPayOnlineModal, setShowPayOnlineModal] = useState(false);
  const [rejectProofReason, setRejectProofReason] = useState('');
  // Proof flows (same as GroupDetailScreen)
  const [showUploadAfterAdd, setShowUploadAfterAdd] = useState(false);
  const [justAddedExpense, setJustAddedExpense] = useState(null);
  const [showOwnerProofModal, setShowOwnerProofModal] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchExpenseSplits = useCallback(async (expenseIds) => {
    if (!expenseIds.length) return {};
    const { data, error } = await supabase
      .from('expense_splits')
      .select(`*, profiles:user_id (id, full_name, avatar_url)`)
      .in('expense_id', expenseIds);
    if (error) { console.error(error); return {}; }
    const grouped = {};
    // people who left the household keep their name on old expenses
    (await withFormerMemberNames(data)).forEach(split => {
      if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
      grouped[split.expense_id].push(split);
    });
    setExpenseSplits(grouped);
    return grouped;
  }, [setExpenseSplits]);

  // ========== FIXED: fetchExpensesData with correct summary calculations ==========
  const fetchExpensesData = useCallback(async (profileData, user, adminStatus, memberData, householdId) => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Fetch all expenses for this household (including pending approval, but summary only for approved).
    // The query already leaves out soft-deleted expenses.
    const expensesData = await fetchAllHouseholdExpenses(householdId);
    if (!expensesData) { setDataLoading(false); loadDone(); return; }
    const approvedExpenses = expensesData.filter(e => e.approval_status === 'approved');
    const allIds = expensesData.map(e => e.id);

    // Everything below depends only on the ids → load it at the same time instead
    // of one request after another (this was most of the wait).
    const [expenseExtras, groupedSplitsRaw, { data: proofsAll }, { data: proofsPending }] = await Promise.all([
      fetchExpenseExtras(allIds, adminStatus ? user.id : null),
      fetchExpenseSplits(allIds),
      allIds.length ? supabase.from('payment_proofs').select('*').in('expense_id', allIds) : Promise.resolve({ data: [] }),
      allIds.length
        ? supabase.from('payment_proofs').select('*, profiles(*)').eq('status', 'pending_verification').in('expense_id', allIds)
        : Promise.resolve({ data: [] }),
    ]);
    const groupedSplits = groupedSplitsRaw || {};
    const [resolvedAll, resolvedPending] = await Promise.all([
      resolvePaymentProofUrls(proofsAll || []),
      resolvePaymentProofUrls(proofsPending || []),
    ]);
    // Show the cards only once their splits are here (no "0/0 paid" flash)
    setExtras(expenseExtras);
    setExpenses(approvedExpenses);
    setAllProofs(resolvedAll);
    setPendingPaymentProofs(resolvedPending);

    // Pending approvals (splits with status pending_verification) – for owner
    let pendingSplits = [];
    for (const exp of expensesData) {
      const splits = groupedSplits[exp.id] || [];
      const pending = splits.filter(s => (
        s.status === 'pending_verification'
        && !(adminStatus && s.user_id === user.id)
      ));
      pendingSplits.push(...pending);
    }
    setPendingApprovals(pendingSplits);

    // ========== SUMMARY CALCULATIONS ==========
    // Total Shared = sum of all approved expense amounts in the current month (household total)
    // To Reimburse = sum of user's unpaid splits (split.status !== 'approved') for approved expenses in current month
    // Total Saved = same as Total Shared (as requested)
    let householdTotal = 0;
    let userUnpaidTotal = 0;
    const reimburseList = [];

    for (const expense of expensesData) {
      // Only consider approved expenses
      if (expense.approval_status !== 'approved') continue;
      const expenseDate = expense.expense_date;
      if (!(expenseDate >= firstDay && expenseDate <= lastDay)) continue;

      // Add full expense amount to household total
      householdTotal += Number(expense.amount);

      // Find user's split
      const splits = groupedSplits[expense.id] || [];
      const mySplit = splits.find(s => s.user_id === user.id);
      // a deletion refund sent / confirmed means nothing is owed (the expense is being deleted)
      if (mySplit && mySplit.status !== 'approved' && !deletionStateOf(mySplit, expenseExtras.refunds[expense.id])) {
        // only what is still owed: share minus what the admin already approved
        const owedNow = Math.max(toNum(mySplit.share_amount) - toNum(mySplit.paid_amount), 0);
        userUnpaidTotal += owedNow;
        // Members always pay the household's CURRENT owner (Pay Online / proofs go
        // to them) — not whoever originally paid the bill, which changes nothing
        // after an ownership transfer. Roles come fresh from household_members.
        const owner = memberData?.find(m => m.role === 'owner');
        reimburseList.push({
          expense,
          amount: owedNow,
          // the owner's own share has nobody to pay → just "Unpaid"
          payer: owner && owner.user_id !== user.id ? owner.profiles : null,
        });
      }
    }

    // The admin also owes members refunds for overpaid shares (any month — it's still owed).
    if (adminStatus) {
      owedRefundsByPerson(owedRefundsFrom(approvedExpenses, groupedSplits, user.id, expenseExtras.refunds)).forEach((r) => {
        userUnpaidTotal += r.amount;
        reimburseList.push({ refund: true, amount: r.amount, awaiting: r.awaiting, payer: { full_name: r.name || 'a member' } });
      });
    }

    setTotalShared(householdTotal);
    setToReimburse(userUnpaidTotal);
    setReimburseDetails(reimburseList);
    setTotalSaved(householdTotal); // Same as Total Shared
    loadedHouseholdRef.current = householdId;
    setDataLoading(false);
    loadDone();
  }, [fetchExpenseSplits, loadDone, setAllProofs, setExpenses, setExtras, setPendingApprovals, setPendingPaymentProofs, setReimburseDetails, setToReimburse, setTotalSaved, setTotalShared]);

  const fetchNotifications = async (userId) => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifications(data || []);
    setUnreadCount((data || []).filter(n => !n.is_read).length);
  };

  const handleHouseholdSelect = useCallback(async (household, activeUser, activeProfile) => {
    // placeholders only on first load / switching household — not after every action
    if (loadedHouseholdRef.current !== household.id) setDataLoading(true);

    setSelectedHousehold(household);
    setSearchQuery('');
    setFilterStatus([]);
    setFilterCategory([]);
    setFilterFrom('');
    setFilterTo('');

    const { data: memberRows } = await supabase
      .from('household_members')
      .select('user_id, role, status')
      .eq('household_id', household.id)
      .eq('status', 'active');

    let membersList = [];
    if (memberRows && memberRows.length > 0) {
      const userIds = memberRows.map(m => m.user_id);
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds);
      membersList = memberRows.map(m => ({
        user_id: m.user_id,
        role: m.role,
        status: m.status,
        profiles: profilesData?.find(p => p.id === m.user_id) || { full_name: 'Unknown', email: '' }
      }));
    }
    setHouseholdMembers(membersList);

    const userMember = membersList.find(m => m.user_id === activeUser?.id);
    const adminStatus = userMember?.role === 'owner';
    setIsAdmin(adminStatus);

    try {
      await fetchExpensesData(activeProfile, activeUser, adminStatus, membersList, household.id);
    } catch (err) {
      // never leave the screen stuck on placeholders
      loadFail(err);
      setDataLoading(false);
    }
  }, [fetchExpensesData, loadFail, setHouseholdMembers, setIsAdmin, setSelectedHousehold]);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      const { data: memberHouseholds } = await supabase
        .from('household_members')
        .select('household_id, role')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (!memberHouseholds || memberHouseholds.length === 0) { setDataLoading(false); loadDone(); return; }

      const householdIds = memberHouseholds.map(mh => mh.household_id);
      const { data: householdsData } = await supabase
        .from('households')
        .select('*')
        .in('id', householdIds);
      setHouseholds(householdsData || []);
      await fetchNotifications(user.id);

      if (householdsData && householdsData.length > 0 && !initialHouseholdSet.current) {
        const firstHH = householdsData[0];
        await handleHouseholdSelect(firstHH, user, profileData);
        initialHouseholdSet.current = true;
      }
    } catch (err) {
      loadFail(err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable cache setters / plain helper (adding it would refetch every render)
  }, [navigate, handleHouseholdSelect, loadDone, loadFail]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);
  useEffect(() => {
    if (!currentUser || !selectedHousehold) return;
    const channel = supabase
      .channel(`expenses-realtime-${selectedHousehold.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `household_id=eq.${selectedHousehold.id}` }, () => {
        if (profile && currentUser) handleHouseholdSelect(selectedHousehold, currentUser, profile);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => {
        if (profile && currentUser) handleHouseholdSelect(selectedHousehold, currentUser, profile);
      })
      // a member confirming a refund settles it (the splits don't change then)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_refunds' }, () => {
        if (profile && currentUser) handleHouseholdSelect(selectedHousehold, currentUser, profile);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, (payload) => {
        setNotifications(prev => [payload.new, ...prev]);
        setUnreadCount(prev => prev + 1);
        showToast(payload.new.message, 'info');
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, selectedHousehold, profile, handleHouseholdSelect, setNotifications, setUnreadCount]);

  const filterOwnerId = selectedHousehold?.created_by;
  const filterMyId = currentUser?.id;
  const refundsMap = extras.refunds;
  const filteredExpenses = useMemo(() => {
    let result = [...expenses];
    const terms = searchTermsOf(searchQuery);
    if (terms.length) {
      result = result.filter(e => {
        const words = expenseSearchText(e, {
          splits: expenseSplits[e.id], isAdmin, myId: filterMyId, ownerId: filterOwnerId,
          needsRefund: isAdmin && needsRefundOf(expenseSplits[e.id], refundsMap[e.id], filterOwnerId),
        });
        return terms.every(t => words.some(w => w.startsWith(t)));
      });
    }
    if (filterStatus.length > 0) {
      // Overpaid / Partly paid come from the shares: the admin sees every
      // member's, a member only their own. The owner's own share is never
      // "overpaid" (they can't refund themselves).
      const relevantSplits = (e) => (expenseSplits[e.id] || []).filter(sp => isAdmin || sp.user_id === filterMyId);
      const matches = (e, s) => {
        if (s === 'overpaid') return relevantSplits(e).some(sp => sp.user_id !== filterOwnerId && overpaidOf(sp) > 0);
        if (s === 'partly_paid') return relevantSplits(e).some(sp => sp.status === 'partly_paid');
        return e.status === s;
      };
      result = result.filter(e => filterStatus.some(s => matches(e, s)));
    }
    if (filterCategory.length > 0) result = result.filter(e => filterCategory.includes(e.category));
    if (filterFrom) result = result.filter(e => e.expense_date >= filterFrom);
    if (filterTo) result = result.filter(e => e.expense_date <= filterTo);
    // Admin: expenses with a member waiting for a refund come first (needs attention).
    // Then unpaid before paid; within each, soonest due date first (no due date
    // last), then newest first.
    // Expenses I'm part of (I have a share) come before ones I'm not in.
    const needsRefund = (e) => isAdmin && needsRefundOf(expenseSplits[e.id], refundsMap[e.id], filterOwnerId);
    const mine = (e) => (expenseSplits[e.id] || []).some(sp => sp.user_id === filterMyId);
    return result.sort((a, b) => (
      needsRefund(b) - needsRefund(a)
      || mine(b) - mine(a)
      || (a.status === 'paid') - (b.status === 'paid')
      || (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1)
      || (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0)
      || (b.expense_date || '').localeCompare(a.expense_date || '')
    ));
  }, [searchQuery, filterStatus, filterCategory, filterFrom, filterTo, expenses, expenseSplits, isAdmin, filterMyId, filterOwnerId, refundsMap]);

  const activeFilterCount = filterStatus.length + filterCategory.length + (filterFrom || filterTo ? 1 : 0);


  // The shared AddExpenseModal inserted it — same follow-ups as before
  const handleExpenseAdded = async (inserted, { paidUpfront, isAdmin: addedAsAdmin }) => {
    setShowAddExpense(false);
    if (paidUpfront) {
      // Whoever marked themselves as the payer gets the "upload proof now" step.
      setJustAddedExpense(inserted);
      setProofForm({ note: '', screenshot: null, screenshotPreview: null });
      setShowUploadAfterAdd(true);
    } else {
      showToast(addedAsAdmin ? 'Expense added!' : 'Expense submitted for approval!');
    }
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  // Recomputes the whole-expense status from the current state of ALL its
  // splits, instead of any single action force-setting it. Call this after
  // every split status change (submit proof, approve, reject) so the badge
  // never goes stale or gets stuck on an old value.
  const recalculateExpenseStatus = async (expenseId) => {
    const { data: allSplits } = await supabase
      .from('expense_splits')
      .select('status')
      .eq('expense_id', expenseId);
    if (!allSplits || allSplits.length === 0) return;

    let newStatus;
    if (allSplits.every(s => s.status === 'approved')) {
      newStatus = 'paid';
    } else if (allSplits.some(s => s.status === 'pending_verification')) {
      newStatus = 'verifying';
    } else {
      newStatus = 'pending';
    }
    await supabase.from('expenses').update({ status: newStatus }).eq('id', expenseId);
    notifyPendingChanged();
  };

  // ── shared helpers for the edit / follow-up / refund / delete flows ──
  const flowLink = (expenseId) => ({
    link_path: `/groups/${selectedHousehold?.id}?type=household`,
    link_state: JSON.stringify({ type: 'household' }),
    link_query: `expenseId=${expenseId}`,
  });
  const flowActor = () => ({ id: currentUser.id, name: profile?.full_name || 'The admin' });
  const reloadAll = () => handleHouseholdSelect(selectedHousehold, currentUser, profile);

  const handleDeleteExpense = async () => {
    if (!selectedExpense) return;
    setXmLoading(true);
    try {
      const res = await softDeleteExpense({ expense: selectedExpense, actor: flowActor(), linkFor: flowLink });
      if (res.blocked) {
        showToast('Refund the members who paid first.', 'error');
      } else if (res.pendingRefunds?.length) {
        showToast('Wait for the member to confirm the refund before deleting this expense.', 'error');
      } else {
        setShowDeleteModal(false);
        setSelectedExpense(null);
        showToast('Expense deleted.');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not delete expense', 'error');
    }
    setXmLoading(false);
    await reloadAll();
  };

  const handleSubmitFollowup = async ({ file, note }) => {
    setXmLoading(true);
    try {
      const proof = await submitFollowupProof({
        expense: followupFor.expense, split: followupFor.split, user: currentUser,
        userName: profile?.full_name || 'A member', adminId: selectedHousehold?.created_by, isExpenseAdmin: isAdmin,
        file, note, linkFor: flowLink,
      });
      showToast(proof.status === 'verified' ? 'Follow-up payment confirmed!' : 'Follow-up proof submitted!');
      setFollowupFor(null);
      await reloadAll();
    } catch (err) {
      showToast(err.message || 'Could not submit follow-up', 'error');
    }
    setXmLoading(false);
  };

  const handleReviewFollowup = async (proof, approve, reason) => {
    setXmLoading(true);
    try {
      await reviewFollowupProof({ proof, approve, reason, expense: proofsFor?.expense, actor: flowActor(), linkFor: flowLink });
      showToast(approve ? 'Follow-up payment approved!' : 'Follow-up payment rejected.');
      setProofsFor(null);
      await reloadAll();
    } catch (err) {
      showToast(err.message || 'Could not update follow-up', 'error');
    }
    setXmLoading(false);
  };

  const handleSendRefund = async ({ amount, file, note }) => {
    setXmLoading(true);
    try {
      await sendRefund({
        expense: refundFor.expense,
        split: refundFor.split,
        amount,
        file,
        note,
        refundType: refundFor.refundType,
        actor: flowActor(),
        linkFor: flowLink,
      });
      showToast(refundFor.refundType === 'overpayment' ? 'Overpayment refund sent and member notified!' : 'Refund sent and member notified!');
      setRefundFor(null);
      await reloadAll();
    } catch (err) {
      showToast(err.message || 'Could not send refund', 'error');
    }
    setXmLoading(false);
  };

  const handleReviewRefund = async (refund, approve, reason = '') => {
    setXmLoading(true);
    try {
      await reviewRefund({
        refund,
        expense: proofsFor?.expense,
        approve,
        reason,
        user: currentUser,
        userName: profile?.full_name || 'A member',
        adminId: selectedHousehold?.created_by,
        linkFor: flowLink,
      });
      showToast(approve ? 'Refund approved. The admin has been notified.' : 'Refund rejected. The admin has been notified.');
      setProofsFor(null);
      await reloadAll();
    } catch (err) {
      showToast(err.message || 'Could not review refund', 'error');
    }
    setXmLoading(false);
  };

  // original proof for a member's split (for the history modal)
  const originalProofFor = (split) =>
    allProofs.find(p => p.id === split.proof_id)
    || [...allProofs].reverse().find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);

  // Every main proof the member submitted for this expense (rejected ones included),
  // plus the one linked to the split in case someone else submitted it.
  const mainProofsFor = (split) => {
    const linked = originalProofFor(split);
    const own = allProofs.filter(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);
    return linked && !own.some(p => p.id === linked.id) ? [...own, linked] : own;
  };

  // Everything Payment History would list for this member on this expense.
  const proofCountFor = (split) =>
    mainProofsFor(split).length
    + (extras.followups[split.expense_id] || []).filter(f => f.user_id === split.user_id).length
    + (extras.refunds[split.expense_id] || []).filter(r => r.user_id === split.user_id).length;

  const handleSubmitProof = async () => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot.', 'error'); return; }
    setLoading(true);
    let objectPath;
    try {
      objectPath = await uploadPaymentProof(proofForm.screenshot, currentUser.id, 'expenses', selectedExpense.id);
    } catch (uploadError) {
      showToast(`Failed to upload screenshot: ${uploadError.message}`, 'error');
      setLoading(false);
      return;
    }

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: objectPath,
      note: proofForm.note,
      status: 'pending_verification',
    }).select().single();

    if (proofError) {
      showToast('Failed to save proof', 'error');
      setLoading(false);
      return;
    }

    await supabase
      .from('expense_splits')
      .update({ status: 'pending_verification', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
      .eq('expense_id', selectedExpense.id)
      .eq('user_id', currentUser.id);

    await recalculateExpenseStatus(selectedExpense.id);

    if (selectedHousehold?.created_by) {
      await supabase.from('notifications').insert({
        user_id: selectedHousehold.created_by,
        title: 'Payment Proof Submitted 📸',
        message: `${profile?.full_name} submitted payment proof for "${selectedExpense.title}"`,
        type: 'payment_proof',
        // Expenses screen: the Pending Approvals card first, the expense once reviewed
        link_path: '/expenses',
        link_query: `householdId=${selectedHousehold.id}&expenseId=${selectedExpense.id}&proofId=${insertedProof.id}`,
      });
    }
    setShowPaymentProofModal(false);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
    setSelectedExpense(null);
    showToast('Payment proof submitted!');
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  // Member paid upfront and chose to attach proof while creating the expense.
  // The proof is stored now and linked to their split when the owner approves the expense.
  const closeUploadAfterAdd = () => {
    setShowUploadAfterAdd(false);
    setJustAddedExpense(null);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
  };

  const handleUploadProofAfterAdd = async () => {
    if (!proofForm.screenshot || !justAddedExpense) return;
    if (isAdmin) {
      // Owner's proof needs no approval — verified instantly.
      if (!(await confirmOwnerPayment(justAddedExpense))) return;
      closeUploadAfterAdd();
      showToast('Expense added and your payment is confirmed!');
      return;
    }
    setLoading(true);
    let objectPath;
    try {
      objectPath = await uploadPaymentProof(proofForm.screenshot, currentUser.id, 'expenses', justAddedExpense.id);
    } catch (uploadError) {
      showToast(`Upload failed: ${uploadError.message}`, 'error');
      setLoading(false);
      return;
    }
    const { error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: justAddedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: objectPath,
      note: proofForm.note || '',
      status: 'pending_verification',
    });
    if (proofError) { showToast('Failed to save proof', 'error'); setLoading(false); return; }
    closeUploadAfterAdd();
    showToast('Expense submitted with proof!');
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  const handleSkipProofAfterAdd = async () => {
    closeUploadAfterAdd();
    showToast(isAdmin
      ? 'Expense added — your share stays Unpaid until you upload proof'
      : 'Submitted for approval — upload your proof after the owner approves');
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  // Owner submits their own proof: verified immediately (the owner is the approver).
  // Used from the expense card and right after the owner adds an expense they paid. Returns true on success.
  const confirmOwnerPayment = async (expense) => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot.', 'error'); return false; }
    setLoading(true);
    let objectPath;
    try {
      objectPath = await uploadPaymentProof(proofForm.screenshot, currentUser.id, 'expenses', expense.id);
    } catch (uploadError) {
      showToast(`Upload failed: ${uploadError.message}`, 'error');
      setLoading(false);
      return false;
    }

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: expense.id,
      submitted_by: currentUser.id,
      screenshot_url: objectPath,
      note: proofForm.note,
      status: 'verified',
    }).select().single();
    if (proofError) { showToast('Failed to save proof', 'error'); setLoading(false); return false; }

    await supabase
      .from('expense_splits')
      .update({ status: 'approved', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
      .eq('expense_id', expense.id)
      .eq('user_id', currentUser.id);

    await recalculateExpenseStatus(expense.id);

    const { data: allSplits } = await supabase.from('expense_splits').select('user_id').eq('expense_id', expense.id);
    const others = (allSplits || []).filter(sp => sp.user_id !== currentUser.id);
    if (others.length) {
      await supabase.from('notifications').insert(others.map(sp => ({
        user_id: sp.user_id,
        // The owner paid their OWN share (or the whole bill) — not the member's payment.
        title: '📸 Owner Paid Their Share',
        message: expense.paid_by === currentUser.id
          ? `${profile?.full_name || 'The owner'} paid the bill for "${expense.title}" and uploaded the receipt. Tap to view proof.`
          : `${profile?.full_name || 'The owner'} uploaded proof of paying their share for "${expense.title}". Tap to view proof.`,
        type: 'payment_confirmed',
        link_path: `/groups/${selectedHousehold.id}?type=household`,
        link_state: JSON.stringify({ type: 'household' }),
        link_query: `openProof=${expense.id}&proofId=${insertedProof.id}`,
      })));
    }

    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
    return true;
  };

  const handleOwnerSubmitProof = async () => {
    if (!(await confirmOwnerPayment(selectedExpense))) return;
    setShowOwnerProofModal(false);
    setSelectedExpense(null);
    showToast('Payment confirmed and proof saved!');
  };

  const handleConfirmPayment = async (proof, split) => {
    setLoading(true);
    await supabase.from('payment_proofs').update({ status: 'verified' }).eq('id', proof.id);
    await supabase.from('expense_splits').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', split.id);

    const { data: expense } = await supabase
      .from('expenses')
      .select('approval_status')
      .eq('id', split.expense_id)
      .single();
    if (expense && expense.approval_status === 'pending_approval') {
      await supabase
        .from('expenses')
        .update({ approval_status: 'approved' })
        .eq('id', split.expense_id);
    }

    await recalculateExpenseStatus(split.expense_id);

    await supabase.from('notifications').insert({
      user_id: proof.submitted_by,
      title: 'Payment Confirmed! ✅',
      message: `Your payment has been verified!`,
      type: 'payment_confirmed',
      link_path: `/groups/${selectedHousehold.id}?type=household`,
      link_state: JSON.stringify({ type: 'household' }),
      link_query: `openProof=${split.expense_id}&proofId=${proof.id}`,
    });

    setShowViewProofModal(false);
    showToast('Payment confirmed!');
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  const handleRejectProof = async () => {
    if (!rejectProofReason.trim()) { showToast('Please provide a rejection reason.', 'error'); return; }
    setLoading(true);
    await supabase.from('payment_proofs').update({ status: 'rejected', rejection_reason: rejectProofReason }).eq('id', selectedProof.id);
    await supabase.from('expense_splits').update({ status: 'unpaid', proof_id: null, rejection_reason: rejectProofReason, updated_at: new Date().toISOString() }).eq('id', selectedSplit.id);
    await recalculateExpenseStatus(selectedProof.expense_id);
    await supabase.from('notifications').insert({
      user_id: selectedProof.submitted_by,
      title: 'Payment Proof Rejected ❌',
      message: `Your payment proof was rejected. Reason: ${rejectProofReason}`,
      type: 'payment_rejected',
      link_path: '/expenses',
      link_query: `householdId=${selectedHousehold.id}&expenseId=${selectedProof.expense_id}&proofId=${selectedProof.id}`,
    });
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    setSelectedSplit(null);
    showToast('Payment proof rejected.');
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  const markNotificationsRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const getStatusBadge = (expense, splits = []) => {
    if (expense.approval_status === 'pending_approval') return { label: 'Waiting Approval', color: '#3B2AAB', bg: '#F0EDFF' };
    if (expense.approval_status === 'rejected') return { label: 'Rejected', color: '#e53e3e', bg: '#ffe5e5' };
    if (expense.status === 'paid') return { label: 'Paid', color: '#38a169', bg: '#f0fff4' };
    if (expense.status === 'verifying') return { label: 'Verifying', color: '#c05621', bg: '#fffaf0' };
    if (splits.some(s => s.status === 'partly_paid')) return { label: 'Partly Paid', color: '#c05621', bg: '#FEEBC8' };
    // "Who Paid: None" — nobody has paid yet, then shares get approved one by one
    if (!expense.paid_by && splits.length > 0) {
      const paidCount = splits.filter(s => s.status === 'approved').length;
      if (paidCount === 0) return { label: 'Unpaid', color: '#e53e3e', bg: '#FEE2E2' };
      return { label: `${paidCount}/${splits.length} Paid`, color: '#856404', bg: '#fff3cd' };
    }
    return { label: 'Pending', color: '#856404', bg: '#fff3cd' };
  };

  const getMemberAvatar = (member) => {
    const p = member?.profiles;
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="member-avatar-img" />;
    const initials = p?.full_name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
    return <div className="member-avatar-initials">{initials}</div>;
  };

  return (
    <div className="expenses-screen">
      <input type="file" ref={proofInputRef} style={{ display: 'none' }} accept="image/*" onChange={e => {
        const file = e.target.files[0];
        if (file) setProofForm(prev => ({ ...prev, screenshot: file, screenshotPreview: URL.createObjectURL(file) }));
      }} />

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <TopBar
        profile={profile}
        setProfile={setProfile}
        household={selectedHousehold}
        currentUser={currentUser}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markNotificationsRead}
        title="Expenses"
        showBell={true}
      />

      {/* ── Sticky header: household tabs + stat cards + search ── */}
      {contentReady && (
      <div className="expenses-sticky-header">
        {households.length > 0 && (
          <>
            {households.length > 3 && (
            <div className="hh-search-row">
              <div className="hh-search-input-wrap">
                <Search size={14} className="hh-search-icon" />
                <input
                  type="text"
                  placeholder="Search households…"
                  value={householdSearch}
                  onChange={e => setHouseholdSearch(e.target.value)}
                  className="hh-search-input"
                />
                {householdSearch !== '' && (
                  <button aria-label="Clear search"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
                    onClick={() => setHouseholdSearch('')}
                  >
                    <X size={12} color="#9E8FCC" />
                  </button>
                )}
              </div>
            </div>
            )}
            <div className="hh-toggle-row">
              {households
                .filter(hh => households.length <= 3 || householdSearch === '' || hh.name.toLowerCase().includes(householdSearch.toLowerCase()))
                .map(hh => (
                  <button
                    key={hh.id}
                    className={`hh-toggle-pill${selectedHousehold?.id === hh.id ? ' active' : ''}`}
                    onClick={() => handleHouseholdSelect(hh, currentUser, profile)}
                  >
                    <InlineIcon as={ICONS.household} /> {hh.name}
                    {selectedHousehold?.id === hh.id && <span className="hh-pill-dot" />}
                  </button>
                ))}
              {households.length > 3 && householdSearch !== '' &&
                households.filter(hh => hh.name.toLowerCase().includes(householdSearch.toLowerCase())).length === 0 && (
                  <p style={{ fontSize: 12, color: '#9E8FCC', padding: '8px 4px' }}>No household found</p>
                )}
            </div>
          </>
        )}

        <NotificationJump
          households={households}
          selectedHouseholdId={selectedHousehold?.id}
          expenses={expenses}
          refunds={extras.refunds}
          expenseSplits={expenseSplits}
          proofs={allProofs}
          userId={currentUser?.id}
          isAdmin={isAdmin}
          pendingCount={pendingApprovals.length}
          onSelectHousehold={(hh) => handleHouseholdSelect(hh, currentUser, profile)}
          onReveal={() => { setSearchQuery(''); setFilterStatus([]); setFilterCategory([]); setFilterFrom(''); setFilterTo(''); }}
          onResendRefund={setRefundFor}
          showToast={showToast}
        />
        <StatCarousel labels={['Shared', 'You owe', 'Saved']}>
          <div className="stat-card stat-card--indigo">
            <div className="stat-card-top">
              <span className="stat-card-emoji"><Icon as={ICONS.wallet} size={18} /></span>
              <span className="stat-card-label">Shared</span>
            </div>
            <p className="stat-card-amount">{dataLoading ? <AmountSkeleton /> : formatMoney(totalShared)}</p>
            <p className="stat-card-sub">this month · {selectedHousehold?.name || '—'}</p>
          </div>

          <OweCard total={toReimburse} details={reimburseDetails} loading={dataLoading} />

          <div className="stat-card stat-card--emerald">
            <div className="stat-card-top">
              <span className="stat-card-emoji"><Icon as={ICONS.saved} size={18} /></span>
              <span className="stat-card-label">Saved</span>
            </div>
            <p className="stat-card-amount">{dataLoading ? <AmountSkeleton /> : formatMoney(totalSaved)}</p>
            <p className="stat-card-sub">vs solo</p>
          </div>
        </StatCarousel>

        {/* Search + Filter share one pill */}
        <div className="search-filter-row search-filter-merged">
          <Search size={14} className="search-icon" aria-hidden="true" />
          <input type="search" placeholder="Search expenses, categories, status, dates" aria-label="Search expenses, categories, status, dates" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          <button className="filter-btn" onClick={() => setShowFilter(true)} aria-label={activeFilterCount ? `Filter, ${activeFilterCount} active` : 'Filter'}>
            <Filter size={14} /> Filter{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          </button>
        </div>
      </div>
      )}

      {/* ── Scrollable expense list ── */}
      <div className="expenses-content">
        <LoadGate load={load} skeleton={<ExpensesSkeleton />} onRetry={fetchData}>
        {!isAdmin && (
          <MemberPendingApprovals
            expenses={expenses}
            expenseSplits={expenseSplits}
            refunds={extras.refunds}
            proofs={allProofs}
            userId={currentUser?.id}
            onResubmit={(expense) => {
              setSelectedExpense(expense);
              setProofForm({ note: '', screenshot: null, screenshotPreview: null });
              setShowPaymentProofModal(true);
            }}
            onViewProof={(proof, split) => { setSelectedProof(proof); setSelectedSplit(split); setShowViewProofModal(true); }}
            onReviewRefund={(expense, split) => setProofsFor({ expense, split })}
          />
        )}

        {isAdmin && selectedHousehold && (
          <PendingApprovalsSection
            householdId={selectedHousehold.id}
            members={householdMembers}
            ownerId={selectedHousehold.created_by}
            actor={{ id: currentUser?.id, name: profile?.full_name }}
            refreshKey={expenses}
            paymentCount={pendingApprovals.length}
            onChanged={reloadAll}
            showToast={showToast}
          >
            {pendingApprovals.map(split => {
              const expense = expenses.find(e => e.id === split.expense_id);
              const proof = pendingPaymentProofs.find(p => p.id === split.proof_id);
              const pendingFollowup = (extras.followups[split.expense_id] || []).find(f => f.user_id === split.user_id && f.status === 'pending_verification');
              // Same card layout as the household screen's Pending Approvals.
              return (
                <div key={split.id} id={`proof-approval-${split.proof_id}`} className="pa-card">
                  <div className="pa-top">
                    <div className="pa-icon pa-icon-payment"><Icon as={ICONS.proof} /></div>
                    <div className="pa-info">
                      <div className="pa-title-row">
                        <span className="pa-title">{expense?.title}</span>
                        <span className="pa-amount">{formatMoney(pendingFollowup ? pendingFollowup.amount : split.share_amount)}</span>
                      </div>
                      <div className="pa-meta">{split.profiles?.full_name}{pendingFollowup ? "'s follow-up payment" : "'s share"}</div>
                      <span className="pa-tag pa-tag-payment">{pendingFollowup ? 'Follow-up proof' : 'Payment proof'}</span>
                    </div>
                  </div>
                  <div className="pa-actions">
                    {pendingFollowup ? (
                      <button className="pa-btn pa-btn-proof" onClick={() => expense && setProofsFor({ expense, split })}>
                        <Eye size={14} /> Review
                      </button>
                    ) : proof && (
                      <button className="pa-btn pa-btn-proof" onClick={() => { setSelectedProof(proof); setSelectedSplit(split); setShowViewProofModal(true); }}>
                        <Eye size={14} /> View Proof
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </PendingApprovalsSection>
        )}

        {dataLoading && (
          <div aria-busy="true">
            <span className="sk-sr-only">Loading</span>
            <ExpenseListSkeleton count={3} />
          </div>
        )}

        {!dataLoading && filteredExpenses.length === 0 && (
          <div className="expenses-empty">
            <span className="expenses-empty-icon"><Icon as={ICONS.expenses} size={40} /></span>
            <p className="expenses-empty-title">No expenses yet</p>
            <p className="expenses-empty-sub">Tap + to add your first expense for {selectedHousehold?.name || 'this household'}.</p>
          </div>
        )}

        {!dataLoading && filteredExpenses.map(expense => {
          const splits = expenseSplits[expense.id] || [];
          const mySplit = splits.find(s => s.user_id === currentUser?.id);
          const badge = getStatusBadge(expense, splits);
          const expenseMembers = splits.map(split => ({
            user_id: split.user_id,
            profiles: split.profiles
          }));
          const isApprovedExpense = expense.approval_status === 'approved';
          const iAmPayer = expense.paid_by === currentUser?.id;
          // Members (and the owner's non-payer share) pay with proof; owner has its own button below
          // Deletion refund sent / confirmed for my share: no Pay / Upload proof — the expense is being deleted.
          const myDeletionState = deletionStateOf(mySplit, extras.refunds[expense.id]);
          const isOwed = !isAdmin && isApprovedExpense && mySplit && mySplit.status === 'unpaid' && expense.status !== 'paid' && !myDeletionState;
          const isPaid = expense.status === 'paid';
          // Owner's primary button only while their own share is still unpaid
          const ownerCanSubmitProof = isAdmin && isApprovedExpense && mySplit && mySplit.status === 'unpaid' && !isPaid && !myDeletionState;
          // Urgency (unpaid cards only): overdue, or due within 3 days
          const dueIn = isApprovedExpense && !isPaid && expense.due_date ? daysUntil(expense.due_date) : null;
          const overdue = dueIn !== null && dueIn < 0;
          const dueSoon = dueIn !== null && dueIn >= 0 && dueIn <= 3;
          const somePaid = splits.some(s => s.status === 'approved' || toNum(s.paid_amount) > 0);
          // Left border = status: paid green, overdue red, partly paid amber, otherwise neutral.
          // Expenses awaiting approval keep the .needs-approval colour.
          const borderColor = isPaid ? '#38a169' : overdue ? '#e53e3e' : somePaid ? '#D69E2E' : '#E0D9FF';
          const needsRefund = isAdmin && needsRefundOf(splits, extras.refunds[expense.id], selectedHousehold?.created_by);
          // Red dot = this expense is part of the Expenses badge (same rules as BottomNav):
          // admin → a member's proof to review, a refund to send, or a rejected
          //         deletion refund to resend;
          // member → a refund to review or a rejected proof to resubmit.
          const latestOwnProof = allProofs
            .filter(p => p.expense_id === expense.id && p.submitted_by === currentUser?.id)
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
          const deletionResendNeeded = isAdmin && splits.some(s => {
            const latest = (extras.refunds[expense.id] || [])
              .filter(r => r.user_id === s.user_id && r.refund_type === 'expense_deletion')
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
            return latest?.status === 'rejected';
          });
          const needsAction = isAdmin
            ? needsRefund || deletionResendNeeded || splits.some(s => s.user_id !== selectedHousehold?.created_by && s.status === 'pending_verification')
            : (extras.refunds[expense.id] || []).some(r => r.user_id === currentUser?.id && r.status === 'sent')
              || (mySplit?.status === 'unpaid' && latestOwnProof?.status === 'rejected' && !myDeletionState);
          // Urgent pills stay visible on the closed card
          const pills = (needsRefund || overdue || dueSoon) ? (
            <>
              {needsRefund && <span className="due-pill due-pill--refund"><InlineIcon as={ICONS.refund} size={12} />Needs refund</span>}
              {overdue && <span className="due-pill due-pill--overdue"><StatusIcon status="overdue" />Overdue</span>}
              {dueSoon && <span className="due-pill due-pill--soon"><StatusIcon status="due" />{dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}</span>}
            </>
          ) : null;
          return (
            <CollapsibleExpenseCard
              key={expense.id}
              expense={expense}
              splits={splits}
              pills={pills}
              attention={needsAction}
              className={expense.approval_status === 'pending_approval' ? 'needs-approval' : ''}
              style={expense.approval_status === 'pending_approval' ? undefined : { borderLeftColor: borderColor }}
            >
                <div className="xc-body-top">
                  <p className="expense-meta">{formatDate(expense.expense_date)} · {selectedHousehold?.name || expense.location || ''}{expense.due_date ? ` · Due ${fmtDate(expense.due_date)}` : ''}</p>
                  {isAdmin && (
                    <ExpenseCardMenu
                      title={expense.title}
                      onEdit={() => setEditExpense(expense)}
                      onDelete={() => { setSelectedExpense(expense); setShowDeleteModal(true); }}
                    />
                  )}
                </div>
                <div className="expense-footer-row">
                  <div className="expense-members">
                    {expenseMembers.slice(0, 3).map((m, i) => (
                      <div key={i} className="member-avatar-wrap">{getMemberAvatar(m)}</div>
                    ))}
                    {expenseMembers.length > 3 && <div className="member-avatar-more">+{expenseMembers.length - 3}</div>}
                  </div>
                  <span className="expense-badges">
                    {/* No "Pending" once my share was refunded for deletion — nothing is owed */}
                    {myDeletionState !== 'refunded' && (
                      <span className="status-badge" style={{ color: badge.color, background: badge.bg }}><StatusIcon status={badge.label} />{badge.label}</span>
                    )}
                  </span>
                </div>
                {expense.approval_status === 'rejected' && <p className="rejection-reason">Reason: {expense.rejection_reason}</p>}
                {isOwed && (
                  <div className="reimburse-row">
                    <span className="owe-text">
                      {iAmPayer ? 'You paid this bill — upload your proof' : `You owe ${formatMoney(mySplit.share_amount)}`}
                    </span>
                    <button className="pay-btn" onClick={() => { setSelectedExpense(expense); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); setShowPaymentProofModal(true); }}>
                      {iAmPayer ? 'Upload proof' : 'Pay'}
                    </button>
                  </div>
                )}
                {ownerCanSubmitProof && (
                  <div className="reimburse-row">
                    <span className="owe-text">Your share: {formatMoney(mySplit.share_amount)}</span>
                    <button className="pay-btn" onClick={() => { setSelectedExpense(expense); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); setShowOwnerProofModal(true); }}>
                      Upload proof
                    </button>
                  </div>
                )}
                {myDeletionState && (
                  <div className="reimburse-row">
                    <span className="owe-text">
                      {myDeletionState === 'verifying' ? 'The admin sent a refund to delete this expense — confirm it once received' : 'Your payment was refunded — this expense will soon be deleted'}
                    </span>
                    <span className="status-badge" style={{ color: DELETION_STATUS_META[myDeletionState].color, background: DELETION_STATUS_META[myDeletionState].bg }}>
                      {DELETION_STATUS_META[myDeletionState].label}
                    </span>
                  </div>
                )}
                {mySplit?.status === 'pending_verification' && (
                  <div className="reimburse-row">
                    <span className="owe-text"><InlineIcon as={ICONS.pending} /> Proof submitted, awaiting approval</span>
                  </div>
                )}
                {/* Follow-up / overpaid / history rows (admin sees every member, a member sees only themselves) */}
                {splits
                  .filter(sp => (isAdmin || sp.user_id === currentUser?.id) && (
                    // the owner's own overpaid share needs no refund line (they can't refund themselves)
                    sp.status === 'partly_paid' || (overpaidOf(sp) > 0 && sp.user_id !== selectedHousehold?.created_by)
                    || (extras.followups[expense.id] || []).some(f => f.user_id === sp.user_id)
                    || (extras.refunds[expense.id] || []).some(r => r.user_id === sp.user_id)))
                  .map(sp => {
                    const mine = sp.user_id === currentUser?.id;
                    const due = followupDueOf(sp);
                    const over = sp.user_id === selectedHousehold?.created_by ? 0 : overpaidOf(sp);
                    const splitRefunds = (extras.refunds[expense.id] || []).filter(r => r.user_id === sp.user_id);
                    const latestRefund = splitRefunds
                      .slice()
                      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
                    const rejectedRefund = latestRefund?.status === 'rejected' ? latestRefund : null;
                    const refundPending = latestRefund?.status === 'sent';
                    const unconfirmed = mine && splitRefunds.some(refund => refund.status === 'sent');
                    return (
                      <div key={sp.id} className="xm-pay-line">
                        <div className="xm-pay-line-top">
                          <p className="xm-pay-line-name">
                            {mine ? 'You' : (sp.profiles?.full_name || 'Member')}
                            {!mine && !householdMembers.some(m => m.user_id === sp.user_id) && <span className="former-member-pill">Former member</span>}
                            {deletionStateOf(sp, extras.refunds[expense.id]) && (() => {
                              const meta = DELETION_STATUS_META[deletionStateOf(sp, extras.refunds[expense.id])];
                              return <span className="deletion-pill" style={{ color: meta.color, background: meta.bg }}><StatusIcon status={meta.label} />{meta.label}</span>;
                            })()}
                          </p>
                          <span className="xm-pay-line-text">Paid {formatMoney(toNum(sp.paid_amount))} of {formatMoney(toNum(sp.share_amount))}</span>
                        </div>
                        {due > 0 && <p className="xm-pay-line-text" style={{ color: '#c05621', fontWeight: 600 }}>{mine ? `Follow-up payment due: ${formatMoney(due)}` : `Needs to pay ${formatMoney(due)} more`}</p>}
                        {/* Admin: skipped while the "Refund overpayment ₱X" button is shown — it already says it */}
                        {over > 0 && !(isAdmin && !mine && !rejectedRefund && !refundPending) && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}>{mine ? `You overpaid ${formatMoney(over)} — the admin will refund you` : `Overpaid ${formatMoney(over)} — refund needed`}</p>}
                        {mine && unconfirmed && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}><InlineIcon as={ICONS.refund} /> A refund was sent — please confirm once received</p>}
                        <div className="xm-pay-line-actions">
                          {mine && due > 0 && (
                            <button className="xm-btn-sm" onClick={() => setFollowupFor({ expense, split: sp })}>Follow-up Payment</button>
                          )}
                          {mine && !isAdmin && over > 0 && !refundPending && (
                            <RequestRefundButton
                              expense={expense}
                              amount={over}
                              adminId={selectedHousehold?.created_by}
                              memberName={profile?.full_name}
                              link={{ link_path: `/groups/${selectedHousehold?.id}?type=household`, link_state: JSON.stringify({ type: 'household' }) }}
                              showToast={showToast}
                            />
                          )}
                          {isAdmin && sp.user_id !== currentUser?.id && rejectedRefund && (
                            <button
                              className="xm-btn-sm"
                              onClick={() => setRefundFor({
                                expense,
                                split: sp,
                                refundType: rejectedRefund.refund_type === 'overpayment' ? 'overpayment' : 'expense_deletion',
                                resending: true,
                                initialAmount: rejectedRefund.amount,
                              })}
                            >{rejectedRefund.refund_type === 'overpayment' ? <><InlineIcon as={ICONS.refund} /> Resend refund proof</> : <><InlineIcon as={ICONS.delete} /> Resend refund proof for deletion</>}</button>
                          )}
                          {isAdmin && sp.user_id !== currentUser?.id && over > 0 && !rejectedRefund && !refundPending && (
                            <button className="xm-btn-sm" onClick={() => setRefundFor({ expense, split: sp, refundType: 'overpayment' })}>Refund overpayment {formatMoney(over)}</button>
                          )}
                          <button className="xm-btn-sm xm-soft" onClick={() => setProofsFor({ expense, split: sp })}>
                            <Eye size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                            {unconfirmed && mine ? 'Confirm refund' : `Proofs · ${proofCountFor(sp)}`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
            </CollapsibleExpenseCard>
          );
        })}
        </LoadGate>
      </div>

      <button aria-label="Add" className="fab-btn" onClick={() => setShowAddExpense(true)}><Plus size={24} /></button>

      {/* Add Expense Modal (shared with GroupDetailScreen / UtilitiesScreen) */}
      {showAddExpense && selectedHousehold && (
        <AddExpenseModal
          context={{ type: 'household', id: selectedHousehold.id, name: selectedHousehold.name, ownerId: selectedHousehold.created_by }}
          members={householdMembers}
          categories={ALL_CATEGORIES}
          defaultCategory="Rent"
          currentUser={currentUser}
          profile={profile}
          showToast={showToast}
          onOpenExpense={e => { setShowAddExpense(false); navigate(`/expenses?householdId=${e.household_id}&expenseId=${e.id}`); }}
          onAdded={handleExpenseAdded}
          onClose={() => setShowAddExpense(false)}
        />
      )}

      {/* Filter Modal */}
      {showFilter && (
        <div className="modal-overlay">
          <div className="filter-modal">
            <div className="modal-header"><h2>Filter</h2><button aria-label="Close" className="modal-close" onClick={() => setShowFilter(false)}><X size={18} /></button></div>
            {(() => {
              const statusOptions = [
                { key: 'paid', label: 'Paid' },
                { key: 'pending', label: 'Pending' },
                { key: 'verifying', label: 'Verifying' },
                { key: 'partly_paid', label: 'Partly paid' },
                { key: 'overpaid', label: 'Overpaid' },
              ];
              const categoryOptions = CATEGORY_KEYS;
              const allStatuses = statusOptions.every(o => filterStatus.includes(o.key));
              const allCategories = categoryOptions.every(c => filterCategory.includes(c));
              return (
                <>
                  <div className="form-group">
                    <div className="filter-group-head">
                      <label>Status</label>
                      <button type="button" className="filter-select-all" onClick={() => setFilterStatus(allStatuses ? [] : statusOptions.map(o => o.key))}>
                        {allStatuses ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                    <div className="checkbox-group">{statusOptions.map(({ key: s, label }) => (<label key={s} className="checkbox-label"><input type="checkbox" checked={filterStatus.includes(s)} onChange={e => { if (e.target.checked) setFilterStatus([...filterStatus, s]); else setFilterStatus(filterStatus.filter(x => x !== s)); }} />{label}</label>))}</div>
                  </div>
                  <div className="form-group">
                    <div className="filter-group-head">
                      <label>Category</label>
                      <button type="button" className="filter-select-all" onClick={() => setFilterCategory(allCategories ? [] : categoryOptions)}>
                        {allCategories ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                    <div className="checkbox-group">{categoryOptions.map(c => (<label key={c} className="checkbox-label"><input type="checkbox" checked={filterCategory.includes(c)} onChange={e => { if (e.target.checked) setFilterCategory([...filterCategory, c]); else setFilterCategory(filterCategory.filter(x => x !== c)); }} />{c}</label>))}</div>
                  </div>
                </>
              );
            })()}
            <div className="form-group">
              <label>Date From</label>
              <DatePickerField value={filterFrom} max={filterTo || undefined} placeholder="Any date" onChange={setFilterFrom} />
            </div>
            <div className="form-group">
              <label>Date To</label>
              <DatePickerField value={filterTo} min={filterFrom || undefined} placeholder="Any date" onChange={setFilterTo} />
            </div>
            <div className="filter-actions"><button className="filter-reset-btn" onClick={() => { setFilterStatus([]); setFilterCategory([]); setFilterFrom(''); setFilterTo(''); setShowFilter(false); }}>Reset</button><button className="filter-apply-btn" onClick={() => setShowFilter(false)}>Apply</button></div>
          </div>
        </div>
      )}

      {/* Delete Expense Modal */}
      {/* Delete Expense (shows what is being deleted; blocked until paid members are refunded) */}
      {showDeleteModal && selectedExpense && (
        <DeleteExpenseModal
          expense={selectedExpense}
          splits={expenseSplits[selectedExpense.id] || []}
          currentUserId={currentUser?.id}
          pendingRefunds={(extras.refunds[selectedExpense.id] || []).filter(refund => refund.status === 'sent')}
          icon={<CategoryIcon category={selectedExpense.category} tile={false} />}
          color={CATEGORY_COLORS[selectedExpense.category] || '#3B2AAB'}
          loading={xmLoading}
          onConfirm={handleDeleteExpense}
          onClose={() => { setShowDeleteModal(false); setSelectedExpense(null); }}
          onRefund={(split) => { setShowDeleteModal(false); setRefundFor({ expense: selectedExpense, split, refundType: 'expense_deletion' }); }}
        />
      )}

      {/* Upload proof right after a member who paid upfront adds an expense */}
      {showUploadAfterAdd && justAddedExpense && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Upload Payment Proof</h2>
            <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
              You marked yourself as the payer for "<strong>{justAddedExpense.title}</strong>".{' '}
              {isAdmin
                ? 'Upload a screenshot of your payment — as the owner, your share is marked Paid right away. You can also skip and upload it later from the expense card.'
                : 'Upload a screenshot of your payment now, or do it after the owner approves.'}
            </p>
            {proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />}
            <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}>
              <Camera size={16} /> {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
            </button>
            <button className="add-expense-btn" onClick={handleUploadProofAfterAdd} disabled={!proofForm.screenshot || loading}>
              {loading ? 'Submitting…' : isAdmin ? 'Confirm Payment' : 'Submit Expense + Proof'}
            </button>
            <button className="edit-cancel-btn" onClick={handleSkipProofAfterAdd}>Skip for now</button>
          </div>
        </div>
      )}

      {/* Owner Proof Modal (verified immediately) */}
      {showOwnerProofModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Confirm Payment</h2>
            {proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />}
            <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}>
              <Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}
            </button>
            <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="reject-textarea" />
            <button className="add-expense-btn" onClick={handleOwnerSubmitProof} disabled={loading}>{loading ? 'Confirming…' : 'Confirm Payment'}</button>
            <button className="edit-cancel-btn" onClick={() => { setShowOwnerProofModal(false); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Payment Proof Submission Modal */}
      {showPaymentProofModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Submit Payment Proof</h2>
            {proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />}
            <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> Upload Screenshot</button>
            {selectedExpense?.paid_by !== currentUser?.id && (
              <button className="pom-trigger-btn" onClick={() => { setShowPaymentProofModal(false); setShowPayOnlineModal(true); }}><InlineIcon as={ICONS.payment} /> Pay Online</button>
            )}
            <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="reject-textarea" />
            <button className="add-expense-btn" onClick={handleSubmitProof} disabled={loading}>{loading ? 'Submitting…' : 'Submit'}</button>
            <button className="edit-cancel-btn" onClick={() => { setShowPaymentProofModal(false); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); }}>Cancel</button>
          </div>
        </div>
      )}

      <PayOnlineModal
        show={showPayOnlineModal}
        onClose={() => { setShowPayOnlineModal(false); setShowPaymentProofModal(true); }}
        receiverId={selectedHousehold?.created_by}
        itemTitle={selectedExpense?.title}
        amount={selectedExpense?.amount}
        onProceed={() => { setShowPayOnlineModal(false); setShowPaymentProofModal(true); }}
      />

      {/* View Proof Modal */}
      {showViewProofModal && selectedProof && (
        <ProofViewModal
          proof={selectedProof}
          submitterName={selectedSplit?.profiles?.full_name}
          loading={loading}
          canReview={isAdmin && selectedProof.status === 'pending_verification' && selectedProof.submitted_by !== currentUser?.id}
          canResubmit={!isAdmin && selectedProof.status === 'rejected' && selectedProof.submitted_by === currentUser?.id}
          onConfirm={() => handleConfirmPayment(selectedProof, selectedSplit)}
          onReject={() => { setShowViewProofModal(false); setShowRejectProofModal(true); }}
          onResubmit={() => {
            setShowViewProofModal(false);
            const expense = expenses.find(e => e.id === selectedProof.expense_id);
            if (expense) {
              setSelectedExpense(expense);
              setProofForm({ note: '', screenshot: null, screenshotPreview: null });
              setShowPaymentProofModal(true);
            }
          }}
          onClose={() => setShowViewProofModal(false)}
        />
      )}

      {/* Reject Proof Modal */}
      {showRejectProofModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Reject Payment Proof</h2>
            <textarea placeholder="Reason" value={rejectProofReason} onChange={e => setRejectProofReason(e.target.value)} className="reject-textarea" />
            <button className="add-expense-btn" onClick={handleRejectProof}>Confirm</button>
            <button className="edit-cancel-btn" onClick={() => setShowRejectProofModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Edit Expense (admin only) */}
      {editExpense && isAdmin && (
        <EditExpenseModal
          expense={editExpense}
          splits={expenseSplits[editExpense.id] || []}
          members={householdMembers}
          actor={flowActor()}
          linkFor={flowLink}
          categories={ALL_CATEGORIES}
          showToast={showToast}
          onOpenExpense={e => { setEditExpense(null); navigate(`/expenses?householdId=${e.household_id}&expenseId=${e.id}`); }}
          onClose={() => setEditExpense(null)}
          onSaved={async () => { setEditExpense(null); await reloadAll(); }}
        />
      )}

      {/* Follow-up payment (member) */}
      {followupFor && (
        <FollowupPaymentModal
          hidden={showFollowupPayOnline}
          expense={followupFor.expense}
          split={followupFor.split}
          loading={xmLoading}
          onSubmit={handleSubmitFollowup}
          onClose={() => setFollowupFor(null)}
          onPayOnline={() => setShowFollowupPayOnline(true)}
        />
      )}
      <PayOnlineModal
        show={showFollowupPayOnline}
        onClose={() => setShowFollowupPayOnline(false)}
        receiverId={selectedHousehold?.created_by}
        itemTitle={followupFor?.expense?.title}
        amount={followupDueOf(followupFor?.split)}
        onProceed={() => setShowFollowupPayOnline(false)}
      />

      {/* Refund (admin) */}
      {refundFor && isAdmin && (
        <RefundModal
          expense={refundFor.expense}
          split={refundFor.split}
          refundType={refundFor.refundType}
          resending={refundFor.resending}
          initialAmount={refundFor.initialAmount}
          loading={xmLoading}
          onSubmit={handleSendRefund}
          onClose={() => setRefundFor(null)}
        />
      )}

      {/* Payment history: original proof, follow-ups, refunds */}
      {proofsFor && (
        <PaymentHistoryModal
          expense={proofsFor.expense}
          split={(expenseSplits[proofsFor.expense.id] || []).find(x => x.id === proofsFor.split.id) || proofsFor.split}
          mainProofs={mainProofsFor(proofsFor.split)}
          followups={(extras.followups[proofsFor.expense.id] || []).filter(f => f.user_id === proofsFor.split.user_id)}
          refunds={(extras.refunds[proofsFor.expense.id] || []).filter(r => r.user_id === proofsFor.split.user_id)}
          isAdmin={isAdmin && proofsFor.split.user_id !== currentUser?.id}
          currentUserId={currentUser?.id}
          loading={xmLoading}
          onReviewFollowup={handleReviewFollowup}
          onReviewRefund={handleReviewRefund}
          onResendRefund={(refund) => {
            const refundType = refund.refund_type === 'overpayment' ? 'overpayment' : 'expense_deletion';
            setRefundFor({ ...proofsFor, refundType, resending: true, initialAmount: refund.amount });
            setProofsFor(null);
          }}
          onHidden={reloadAll}
          onClose={() => setProofsFor(null)}
        />
      )}

      <BottomNav active="expenses" />
    </div>
  );
}