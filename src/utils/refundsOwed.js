// Overpayment refunds the household owner still owes. A member is owed a refund
// when their approved split is paid past its share. Sending a refund lowers
// paid_amount right away (apply_refund trigger), but it isn't settled until the
// member confirms it — so refunds still awaiting their review ('sent') are
// added back and keep counting as owed. A rejected refund already puts the
// money back on paid_amount.
import { supabase } from '../supabaseClient';

const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

const isOverpaymentRefund = (r) => r.refund_type !== 'expense_deletion';

/** Sent, not-yet-confirmed overpayment refunds to one member on one expense. */
const awaitingRefundSum = (refunds, userId) =>
  r2((refunds || []).filter((r) => r.user_id === userId && r.status === 'sent' && isOverpaymentRefund(r))
    .reduce((sum, r) => sum + num(r.amount), 0));

/**
 * What is still owed to the member on this split: { amount, awaiting }.
 * `awaiting` = the part already sent and waiting for the member to confirm.
 */
export function owedRefundOf(split, refunds) {
  if (!split) return { amount: 0, awaiting: 0 };
  const awaiting = awaitingRefundSum(refunds, split.user_id);
  if (split.status !== 'approved' && awaiting <= 0) return { amount: 0, awaiting: 0 };
  const amount = Math.max(r2(num(split.paid_amount) + awaiting - num(split.share_amount)), 0);
  return { amount, awaiting: Math.min(awaiting, amount) };
}

/**
 * expenses   – the household's expenses (only approved, non-deleted ones count)
 * splitsMap  – { expenseId: [expense_splits rows] }
 * ownerId    – household owner (their own share never needs a refund)
 * refundsMap – { expenseId: [expense_refunds rows] } (only 'sent' ones matter)
 * Returns [{ expense, user_id, name, amount, awaiting }], newest expense first.
 */
export function owedRefundsFrom(expenses, splitsMap, ownerId, refundsMap = {}) {
  const list = [];
  (expenses || []).forEach((e) => {
    if (e.approval_status && e.approval_status !== 'approved') return;
    if (e.deleted_at) return;
    (splitsMap[e.id] || []).forEach((s) => {
      if (s.user_id === ownerId) return;
      const { amount, awaiting } = owedRefundOf(s, refundsMap[e.id]);
      if (amount > 0) list.push({ expense: e, user_id: s.user_id, name: s.profiles?.full_name || null, amount, awaiting });
    });
  });
  return list.sort((a, b) => String(b.expense.expense_date).localeCompare(String(a.expense.expense_date)));
}

/** { expenseId: [sent refunds] } for these expenses. */
export async function fetchAwaitingRefundsMap(expenseIds) {
  const map = {};
  if (!expenseIds?.length) return map;
  const { data } = await supabase
    .from('expense_refunds')
    .select('expense_id, user_id, amount, status, refund_type')
    .in('expense_id', expenseIds)
    .eq('status', 'sent');
  (data || []).forEach((r) => { (map[r.expense_id] ||= []).push(r); });
  return map;
}

export async function fetchOwedRefunds(householdId, ownerId) {
  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, title, category, amount, expense_date, approval_status')
    .eq('household_id', householdId)
    .eq('approval_status', 'approved')
    .is('deleted_at', null);
  if (!expenses?.length) return [];
  const ids = expenses.map((e) => e.id);
  const [{ data: splits }, refundsMap] = await Promise.all([
    supabase
      .from('expense_splits')
      .select('expense_id, user_id, share_amount, paid_amount, status, profiles:user_id (full_name)')
      .in('expense_id', ids)
      .neq('user_id', ownerId),
    fetchAwaitingRefundsMap(ids),
  ]);
  const splitsMap = {};
  (splits || []).forEach((s) => { (splitsMap[s.expense_id] ||= []).push(s); });
  return owedRefundsFrom(expenses, splitsMap, ownerId, refundsMap);
}

// ───────────────────────── deletion refunds ─────────────────────────
// Sending a deletion refund lowers paid_amount to what's left (that's what lets
// the admin delete the expense afterwards), which would make the member look
// "Unpaid". The member isn't unpaid — the expense is being deleted — so screens
// and reports show this state instead:
//   'verifying' – a deletion refund is waiting for the member to confirm
//                 (their payment still counts as paid)
//   'refunded'  – the member confirmed it (settled; nothing to pay, not pending)
const newestFirst = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);

export function deletionStateOf(split, refunds) {
  if (!split) return null;
  const mine = (refunds || []).filter((r) => r.user_id === split.user_id && r.refund_type === 'expense_deletion');
  if (!mine.length) return null;
  if (mine.some((r) => r.status === 'sent')) return 'verifying';
  const latest = [...mine].sort(newestFirst)[0];
  return latest.status === 'confirmed' && num(split.paid_amount) <= 0.001 ? 'refunded' : null;
}

/** Deletion refunds still waiting for the member — added back to "paid". */
export const deletionRefundAwaiting = (split, refunds) =>
  r2((refunds || []).filter((r) => r.user_id === split?.user_id && r.refund_type === 'expense_deletion' && r.status === 'sent')
    .reduce((sum, r) => sum + num(r.amount), 0));

export const DELETION_STATUS_META = {
  verifying: { label: 'Verifying for deletion', color: '#6B46C1', bg: '#EDE9FF' },
  refunded: { label: 'Refunded for deletion', color: '#2C7A7B', bg: '#E6FFFA' },
};

/** { expenseId: [deletion refunds] } for these expenses (sent + confirmed). */
export async function fetchDeletionRefundsMap(expenseIds) {
  const map = {};
  if (!expenseIds?.length) return map;
  const { data } = await supabase
    .from('expense_refunds')
    .select('id, expense_id, user_id, amount, status, refund_type, created_at')
    .in('expense_id', expenseIds)
    .eq('refund_type', 'expense_deletion')
    .in('status', ['sent', 'confirmed', 'rejected']);
  (data || []).forEach((r) => { (map[r.expense_id] ||= []).push(r); });
  return map;
}

/**
 * Refunds members confirmed for a household's expenses dated in [from, to] —
 * including expenses that have since been deleted. refundType:
 * 'expense_deletion' (default) or 'overpayment'. Returns [{ refund_id,
 * expense_id, title, category, expense_date, user_id, amount, deleted }].
 */
export async function fetchConfirmedDeletionRefunds(householdId, from, to, refundType = 'expense_deletion') {
  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, title, category, expense_date, deleted_at')
    .eq('household_id', householdId)
    .gte('expense_date', from)
    .lte('expense_date', to);
  if (!expenses?.length) return [];
  const byId = Object.fromEntries(expenses.map((e) => [e.id, e]));
  const { data: refunds } = await supabase
    .from('expense_refunds')
    .select('id, expense_id, user_id, amount, created_at')
    .in('expense_id', expenses.map((e) => e.id))
    .eq('refund_type', refundType)
    .eq('status', 'confirmed');
  return (refunds || []).map((r) => {
    const e = byId[r.expense_id];
    return {
      refund_id: r.id,
      expense_id: r.expense_id, title: e.title, category: e.category, expense_date: e.expense_date,
      user_id: r.user_id, amount: r2(r.amount), deleted: !!e.deleted_at,
    };
  }).sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
}

/** Sum the refunds per person: [{ user_id, name, amount, awaiting }]. */
export function owedRefundsByPerson(list) {
  const byUser = {};
  (list || []).forEach((r) => {
    const cur = byUser[r.user_id] || (byUser[r.user_id] = { user_id: r.user_id, name: r.name, amount: 0, awaiting: 0 });
    cur.amount = r2(cur.amount + r.amount);
    cur.awaiting = r2(cur.awaiting + (r.awaiting || 0));
  });
  return Object.values(byUser);
}
