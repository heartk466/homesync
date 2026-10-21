// Shared logic for: editing an expense, soft-deleting it, follow-up payments
// and refunds. Used by BOTH ExpensesScreen and GroupDetailScreen so they
// behave identically.
//
// Money model (see homesync_expense_upgrade.sql):
//   expense_splits.paid_amount = what the member currently has paid (net).
//     - goes UP only when the admin approves a proof (original / follow-up)
//     - goes DOWN when the admin sends a refund
//   status: unpaid | pending_verification | partly_paid | approved
//   "Overpaid" = approved && paid_amount > share_amount (calculated, not stored)

import { supabase } from '../supabaseClient';

// ───────────────────────── small helpers ─────────────────────────
export const num = (v) => Number(v) || 0;
export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const money = (v) =>
  `₱${num(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const getTodayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};
export const fmtDate = (str) =>
  str
    ? new Date(`${str}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

/** Overpaid amount for a split (0 when not overpaid). */
export const overpaidOf = (split) =>
  split && split.status === 'approved'
    ? Math.max(round2(num(split.paid_amount) - num(split.share_amount)), 0)
    : 0;

/** Follow-up amount still due for a partly-paid split. */
export const followupDueOf = (split) =>
  split && split.status === 'partly_paid'
    ? Math.max(round2(num(split.share_amount) - num(split.paid_amount)), 0)
    : 0;

/** Money (or a pending payment) is tied to this split. The payer doesn't owe themselves. */
export const isMoneyLocked = (split, expense) =>
  split.user_id !== expense?.paid_by &&
  (num(split.paid_amount) > 0 || ['pending_verification', 'partly_paid'].includes(split.status));

/** Share can't change while the admin still has to approve/reject a proof. */
export const isShareLocked = (split) => split.status === 'pending_verification';

/** Label + colours for one split row. */
export const splitStatusMeta = (split) => {
  const over = overpaidOf(split);
  if (over > 0) return { label: `Overpaid ${money(over)}`, color: '#2B6CB0', bg: '#EBF8FF' };
  switch (split.status) {
    case 'approved': return { label: 'Paid', color: '#065F46', bg: '#D1FAE5' };
    case 'partly_paid': return { label: 'Partly Paid', color: '#c05621', bg: '#FEEBC8' };
    case 'pending_verification': return { label: 'Pending', color: '#856404', bg: '#FFF3CD' };
    default: return { label: 'Unpaid', color: '#e53e3e', bg: '#FEE2E2' };
  }
};

// ───────────────────────── split maths ─────────────────────────
/**
 * Equal split of `total` among `ids`. `fixed` = { userId: amount } for members
 * whose share is locked; the rest is divided equally among the others.
 * Cents are balanced so the shares always add up to the total.
 */
export function distributeEqual(total, ids, fixed = {}) {
  const out = {};
  let fixedSum = 0;
  ids.forEach((id) => {
    if (id in fixed) { out[id] = round2(fixed[id]); fixedSum += out[id]; }
  });
  const flex = ids.filter((id) => !(id in fixed));
  if (!flex.length) return out;
  const remaining = round2(num(total) - fixedSum);
  const base = Math.floor((remaining / flex.length) * 100) / 100;
  flex.forEach((id) => { out[id] = base; });
  const leftover = round2(remaining - base * flex.length);
  const last = flex[flex.length - 1];
  out[last] = round2(out[last] + leftover);
  return out;
}

// ───────────────────────── files ─────────────────────────
export async function uploadProofFile(file, prefix, expenseId, userId) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = `${prefix}-${expenseId}-${userId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('payment-proofs').upload(fileName, file, { upsert: true });
  if (error) throw new Error('Failed to upload screenshot.');
  return supabase.storage.from('payment-proofs').getPublicUrl(fileName).data.publicUrl;
}

// ───────────────────────── status recalculation ─────────────────────────
export async function recalculateExpenseStatus(expenseId) {
  const { data: allSplits } = await supabase
    .from('expense_splits')
    .select('status')
    .eq('expense_id', expenseId);
  if (!allSplits || allSplits.length === 0) return;
  let status;
  if (allSplits.every((s) => s.status === 'approved')) status = 'paid';
  else if (allSplits.some((s) => s.status === 'pending_verification')) status = 'verifying';
  else status = 'pending';
  await supabase.from('expenses').update({ status }).eq('id', expenseId);
}

// ───────────────────────── extras (follow-ups + refunds) ─────────────────────────
/** Returns { followups: {expenseId: []}, refunds: {expenseId: []} }.
 *  RLS already limits members to their own rows; the admin sees all. */
export async function fetchExpenseExtras(expenseIds) {
  const result = { followups: {}, refunds: {} };
  if (!expenseIds?.length) return result;

  const [fu, rf] = await Promise.all([
    supabase
      .from('expense_followup_proofs')
      .select('*, profiles:user_id (id, full_name, avatar_url)')
      .in('expense_id', expenseIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('expense_refunds')
      .select('*')
      .in('expense_id', expenseIds)
      .order('created_at', { ascending: true }),
  ]);

  (fu.data || []).forEach((p) => { (result.followups[p.expense_id] ||= []).push(p); });
  (rf.data || []).forEach((r) => { (result.refunds[r.expense_id] ||= []).push(r); });
  return result;
}

// ───────────────────────── notifications ─────────────────────────
async function notify(rows) {
  const clean = rows.filter((r) => r.user_id);
  if (!clean.length) return;
  const { error } = await supabase.from('notifications').insert(clean);
  if (error) console.error('Notification error:', error);
}

// ───────────────────────── EDIT ─────────────────────────
/**
 * values: { title, amount, category, due_date, split_type, shares: {userId: number} }
 * The DB trigger (handle_expense_splits_upsert) syncs expense_splits from
 * members_split WITHOUT wiping paid status / proofs, flips paid members whose
 * share went up to `partly_paid`, and removes only members with nothing paid.
 */
export async function saveExpenseEdit({ expense, oldSplits, values, actor, linkFor }) {
  const membersSplit = {};
  Object.entries(values.shares).forEach(([uid, v]) => { membersSplit[uid] = round2(v).toFixed(2); });

  const { error } = await supabase
    .from('expenses')
    .update({
      title: values.title,
      amount: round2(values.amount),
      category: values.category,
      due_date: values.due_date || null,
      split_type: values.split_type,
      members_split: membersSplit,
    })
    .eq('id', expense.id);
  if (error) throw new Error(error.message);

  await recalculateExpenseStatus(expense.id);

  // ── notifications to everyone involved ──
  const oldById = Object.fromEntries(oldSplits.map((s) => [s.user_id, s]));
  const newIds = Object.keys(values.shares);
  const changes = [];
  if (values.title !== expense.title) changes.push(`name is now "${values.title}"`);
  if (round2(values.amount) !== round2(expense.amount)) changes.push(`amount ${money(expense.amount)} → ${money(values.amount)}`);
  if (values.category !== expense.category) changes.push(`category is now ${values.category}`);
  if ((values.due_date || '') !== (expense.due_date || '')) {
    changes.push(values.due_date ? `due date is now ${fmtDate(values.due_date)}` : 'due date removed');
  }
  const changeText = changes.length ? changes.join('; ') : 'split updated';
  const link = linkFor(expense.id);
  const rows = [];

  newIds.forEach((uid) => {
    if (uid === actor.id) return;
    const old = oldById[uid];
    const newShare = round2(values.shares[uid]);
    if (!old) {
      rows.push({
        user_id: uid,
        title: '➕ Added to an expense',
        message: `${actor.name} added you to "${values.title}" (${money(values.amount)}). Your share: ${money(newShare)}.${values.due_date ? ` Due ${fmtDate(values.due_date)}.` : ''}`,
        type: 'expense_added',
        ...link,
      });
      return;
    }
    let extra = '';
    const paid = num(old.paid_amount);
    if (uid !== expense.paid_by && paid > 0) {
      if (newShare > paid + 0.005) extra = ` You already paid ${money(paid)} — a follow-up payment of ${money(newShare - paid)} is needed.`;
      else if (newShare < paid - 0.005) extra = ` You paid ${money(paid)}, which is ${money(paid - newShare)} more than your new share — the admin will refund the difference.`;
      else extra = ' Your payment covers your new share.';
    }
    rows.push({
      user_id: uid,
      title: '✏️ Expense Updated',
      message: `${actor.name} updated "${values.title}": ${changeText}. Your share: ${money(old.share_amount)} → ${money(newShare)}.${extra}`,
      type: 'expense_updated',
      ...link,
    });
  });

  oldSplits.forEach((old) => {
    if (newIds.includes(old.user_id) || old.user_id === actor.id) return;
    rows.push({
      user_id: old.user_id,
      title: '➖ Removed from an expense',
      message: `${actor.name} removed you from "${expense.title}". You no longer owe anything for it.`,
      type: 'expense_removed',
      ...link,
    });
  });

  await notify(rows);
}

// ───────────────────────── DELETE (soft) ─────────────────────────
/** Returns { blocked: [splits] } when money is still tied up, else { ok: true }. */
export async function softDeleteExpense({ expense, actor, linkFor }) {
  // Re-read splits so we never trust stale UI state
  const { data: freshSplits } = await supabase
    .from('expense_splits')
    .select('*, profiles:user_id (id, full_name)')
    .eq('expense_id', expense.id);
  const splits = freshSplits || [];

  const blocked = splits.filter((s) => isMoneyLocked(s, expense));
  if (blocked.length) return { blocked };

  const { error } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.id })
    .eq('id', expense.id);
  if (error) throw new Error(error.message);

  const link = linkFor(expense.id);
  await notify(
    splits
      .filter((s) => s.user_id !== actor.id)
      .map((s) => ({
        user_id: s.user_id,
        title: '🗑️ Expense Deleted',
        message: `${actor.name} deleted "${expense.title}" (${money(expense.amount)}).`,
        type: 'expense_deleted',
        ...link,
      }))
  );
  return { ok: true };
}

// ───────────────────────── FOLLOW-UP PAYMENT ─────────────────────────
export async function submitFollowupProof({ expense, split, user, userName, adminId, file, note, linkFor }) {
  const due = followupDueOf(split);
  if (due <= 0) throw new Error('Nothing is due for this expense.');
  const url = await uploadProofFile(file, 'followup', expense.id, user.id);

  const { data: proof, error } = await supabase
    .from('expense_followup_proofs')
    .insert({ expense_id: expense.id, user_id: user.id, amount: due, screenshot_url: url, note: note || null })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await recalculateExpenseStatus(expense.id);

  if (adminId && adminId !== user.id) {
    await notify([{
      user_id: adminId,
      title: 'Follow-up Payment Submitted 📸',
      message: `${userName} submitted a follow-up payment of ${money(due)} for "${expense.title}".`,
      type: 'followup_submitted',
      ...linkFor(expense.id),
    }]);
  }
  return proof;
}

export async function reviewFollowupProof({ proof, approve, reason, expense, actor, linkFor }) {
  const { error } = await supabase
    .from('expense_followup_proofs')
    .update({
      status: approve ? 'verified' : 'rejected',
      rejection_reason: approve ? null : reason,
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', proof.id);
  if (error) throw new Error(error.message);

  await recalculateExpenseStatus(proof.expense_id);

  await notify([{
    user_id: proof.user_id,
    title: approve ? 'Follow-up Payment Confirmed ✅' : 'Follow-up Payment Rejected ❌',
    message: approve
      ? `Your follow-up payment of ${money(proof.amount)} for "${expense?.title}" was approved.`
      : `Your follow-up payment for "${expense?.title}" was rejected. Reason: ${reason}`,
    type: approve ? 'followup_confirmed' : 'followup_rejected',
    ...linkFor(proof.expense_id),
  }]);
}

// ───────────────────────── REFUND ─────────────────────────
export async function sendRefund({ expense, split, amount, file, note, actor, linkFor }) {
  const amt = round2(amount);
  if (amt <= 0) throw new Error('Enter a refund amount.');
  if (amt > num(split.paid_amount) + 0.001) throw new Error(`The most you can refund is ${money(split.paid_amount)}.`);
  if (!file) throw new Error('Please upload a screenshot of the refund.');

  const url = await uploadProofFile(file, 'refund', expense.id, split.user_id);
  const { error } = await supabase.from('expense_refunds').insert({
    expense_id: expense.id,
    user_id: split.user_id,
    amount: amt,
    screenshot_url: url,
    note: note || null,
  });
  if (error) throw new Error(error.message);

  await recalculateExpenseStatus(expense.id);

  await notify([{
    user_id: split.user_id,
    title: '💸 Refund Sent',
    message: `${actor.name} sent you a refund of ${money(amt)} for "${expense.title}". Please confirm once you receive it.`,
    type: 'refund_sent',
    ...linkFor(expense.id),
  }]);
}

export async function confirmRefund({ refund, expense, user, userName, adminId, linkFor }) {
  const { error } = await supabase
    .from('expense_refunds')
    .update({ status: 'confirmed' })
    .eq('id', refund.id);
  if (error) throw new Error(error.message);

  if (adminId && adminId !== user.id) {
    await notify([{
      user_id: adminId,
      title: 'Refund Received ✅',
      message: `${userName} confirmed receiving the ${money(refund.amount)} refund for "${expense?.title}".`,
      type: 'refund_confirmed',
      ...linkFor(refund.expense_id),
    }]);
  }
}

// ───────────────────────── soft-delete safety net ─────────────────────────
/** Removes expenses that were soft-deleted (deleted_at set), even if the
 *  query that produced `list` didn't select that column. */
export async function dropDeletedExpenses(list) {
  if (!list || !list.length) return list || [];
  const ids = list.map((e) => e.id);
  const { data } = await supabase
    .from('expenses')
    .select('id')
    .in('id', ids)
    .not('deleted_at', 'is', null);
  const gone = new Set((data || []).map((r) => r.id));
  return list.filter((e) => !gone.has(e.id));
}