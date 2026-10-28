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
import { resolvePaymentProofUrls, uploadPaymentProof } from './paymentProofStorage';
import { formatMoney, formatDate } from './format';
import { notifyPendingChanged } from './pendingEvents';

// ───────────────────────── small helpers ─────────────────────────
export const num = (v) => Number(v) || 0;
export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
// Kept as aliases so existing callers share the formatters in utils/format.js.
export const money = formatMoney;

export const getTodayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};
export const fmtDate = formatDate;

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

// paid_as_owner: the former owner paid this while they were the owner (to
// themselves), so deleting never needs a refund for it.
export const isExpenseDeleteLocked = (split, actorId) =>
  split.user_id !== actorId && !split.paid_as_owner &&
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
  return uploadPaymentProof(file, userId, prefix, expenseId);
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
  notifyPendingChanged();
}

// ───────────────────────── extras (follow-ups + refunds) ─────────────────────────
/** Returns { followups: {expenseId: []}, refunds: {expenseId: []} }.
 *  RLS already limits members to their own rows; the admin sees all. */
export async function fetchExpenseExtras(expenseIds, autoVerifyUserId = null) {
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

  let followupRows = fu.data || [];
  const ownerPendingProofs = autoVerifyUserId
    ? followupRows.filter((proof) => proof.user_id === autoVerifyUserId && proof.status === 'pending_verification')
    : [];

  if (ownerPendingProofs.length) {
    const reviewedAt = new Date().toISOString();
    const { data: verifiedProofs, error } = await supabase
      .from('expense_followup_proofs')
      .update({ status: 'verified', reviewed_by: autoVerifyUserId, reviewed_at: reviewedAt })
      .in('id', ownerPendingProofs.map((proof) => proof.id))
      .eq('user_id', autoVerifyUserId)
      .eq('status', 'pending_verification')
      .select('id, expense_id');
    if (error) throw new Error(`Could not confirm the owner's follow-up proof: ${error.message}`);

    const verifiedIds = new Set((verifiedProofs || []).map((proof) => proof.id));
    if (verifiedIds.size !== ownerPendingProofs.length) {
      throw new Error('Could not confirm all pending owner follow-up proofs. Please refresh and try again.');
    }

    const verifiedExpenseIds = [...new Set(ownerPendingProofs.map((proof) => proof.expense_id))];
    await Promise.all(verifiedExpenseIds.map(recalculateExpenseStatus));
    followupRows = followupRows.map((proof) => (
      verifiedIds.has(proof.id)
        ? { ...proof, status: 'verified', reviewed_by: autoVerifyUserId, reviewed_at: reviewedAt }
        : proof
    ));
  }

  const [followups, refunds] = await Promise.all([
    resolvePaymentProofUrls(followupRows),
    resolvePaymentProofUrls(rf.data || []),
  ]);
  followups.forEach((p) => { (result.followups[p.expense_id] ||= []).push(p); });
  refunds.forEach((r) => { (result.refunds[r.expense_id] ||= []).push(r); });
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
 * values: { title, amount, category, billing_period, due_date, split_type, shares: {userId: number} }
 * Category is a label only; a category change is logged and announced to the
 * whole household/group by the DB trigger (log_expense_history), not here.
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
      billing_period: values.billing_period ?? null,
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
    // Nothing changed for this member (e.g. only the category — the trigger tells everyone)
    if (!changes.length && round2(old.share_amount) === newShare) return;
    // The title says what the edit means for this member, not just "updated".
    let extra = '';
    let title = '✏️ Expense Updated';
    const paid = num(old.paid_amount);
    if (uid !== expense.paid_by && paid > 0) {
      if (newShare > paid + 0.005) {
        title = '⚠️ Expense Updated — You Need to Pay More';
        extra = ` You already paid ${money(paid)} — a follow-up payment of ${money(newShare - paid)} is needed.`;
      } else if (newShare < paid - 0.005) {
        title = '💸 Expense Updated — You Overpaid';
        extra = ` You paid ${money(paid)}, which is ${money(paid - newShare)} more than your new share — the admin will refund the difference. You can also tap "Request refund" on the expense.`;
      } else {
        extra = ' Your payment covers your new share.';
      }
    }
    rows.push({
      user_id: uid,
      title,
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

  // ── tell the admin who now has to be refunded ──
  // Read the shares fresh (the DB trigger has applied the new amounts) and list
  // members whose payment is now more than their share. The admin's own share
  // never needs a refund.
  const { data: freshSplits } = await supabase
    .from('expense_splits')
    .select('user_id, share_amount, paid_amount, status, profiles:user_id (full_name)')
    .eq('expense_id', expense.id);
  const overpaid = (freshSplits || []).filter((s) => s.user_id !== actor.id && overpaidOf(s) > 0);
  if (overpaid.length) {
    const who = overpaid.map((s) => `${s.profiles?.full_name || 'A member'} (${money(overpaidOf(s))})`).join(', ');
    // Household expenses open the Expenses screen; group expenses their group screen.
    const adminLink = expense.household_id
      ? { link_path: '/expenses', link_query: `householdId=${expense.household_id}&expenseId=${expense.id}` }
      : link;
    rows.push({
      user_id: actor.id,
      title: '💸 Refund Needed',
      message: `After your edit, "${values.title}" has overpaid ${overpaid.length === 1 ? 'share' : 'shares'}: ${who}. Send the refund${overpaid.length === 1 ? '' : 's'} from the expense.`,
      type: 'refund_needed',
      ...adminLink,
    });
  }

  await notify(rows);
}

// ───────────────────────── DELETE (soft) ─────────────────────────
/** Blocks on every non-admin paid/pending split and sent-but-unconfirmed refund. */
export async function softDeleteExpense({ expense, actor }) {
  // Re-read splits so we never trust stale UI state
  const { data: freshSplits, error: splitsError } = await supabase
    .from('expense_splits')
    .select('*, profiles:user_id (id, full_name)')
    .eq('expense_id', expense.id);
  if (splitsError) throw new Error(splitsError.message);
  const splits = freshSplits || [];

  const blocked = splits.filter((s) => isExpenseDeleteLocked(s, actor.id));
  if (blocked.length) return { blocked };

  const { data: sentRefunds, error: refundsError } = await supabase
    .from('expense_refunds')
    .select('id, user_id, amount')
    .eq('expense_id', expense.id)
    .eq('status', 'sent')
    .neq('user_id', actor.id);
  if (refundsError) throw new Error(refundsError.message);
  if (sentRefunds?.length) return { pendingRefunds: sentRefunds };

  const { error } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.id })
    .eq('id', expense.id);
  if (error) throw new Error(error.message);

  // Everyone in the household/group is notified (and it's logged) by the DB
  // trigger log_expense_history.
  return { ok: true };
}

// ───────────────────────── FOLLOW-UP PAYMENT ─────────────────────────
export async function submitFollowupProof({ expense, split, user, userName, adminId, isExpenseAdmin = false, file, note, linkFor }) {
  const due = followupDueOf(split);
  if (due <= 0) throw new Error('Nothing is due for this expense.');
  const url = await uploadProofFile(file, 'followup', expense.id, user.id);

  const { data: proof, error } = await supabase
    .from('expense_followup_proofs')
    .insert({ expense_id: expense.id, user_id: user.id, amount: due, screenshot_url: url, note: note || null })
    .select()
    .single();
  if (error) throw new Error(error.message);

  let submittedProof = proof;
  if (isExpenseAdmin) {
    const { data: verifiedProof, error: verificationError } = await supabase
      .from('expense_followup_proofs')
      .update({
        status: 'verified',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', proof.id)
      .select()
      .single();
    if (verificationError) throw new Error(verificationError.message);
    submittedProof = verifiedProof;
  }

  await recalculateExpenseStatus(expense.id);

  if (adminId && !isExpenseAdmin) {
    await notify([{
      user_id: adminId,
      title: 'Follow-up Payment Submitted 📸',
      message: `${userName} submitted a follow-up payment of ${money(due)} for "${expense.title}".`,
      type: 'followup_submitted',
      ...linkFor(expense.id),
    }]);
  }
  return submittedProof;
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
export async function sendRefund({ expense, split, amount, file, note, refundType = 'expense_deletion', actor, linkFor }) {
  if (split.user_id === actor.id) {
    throw new Error('You cannot send a refund to yourself. Select the member who paid.');
  }
  const amt = round2(amount);
  if (amt <= 0) throw new Error('Enter a refund amount.');
  if (amt > num(split.paid_amount) + 0.001) throw new Error(`The most you can refund is ${money(split.paid_amount)}.`);
  if (refundType === 'overpayment' && amt > overpaidOf(split) + 0.001) {
    throw new Error('An overpayment refund cannot exceed the member’s overpaid amount. Refresh and try again.');
  }
  if (!file) throw new Error('Please upload a screenshot of the refund.');

  // Block duplicates: one refund of this type may await the member's review at a time.
  const { data: awaiting, error: awaitingError } = await supabase
    .from('expense_refunds')
    .select('id')
    .eq('expense_id', expense.id)
    .eq('user_id', split.user_id)
    .eq('refund_type', refundType)
    .eq('status', 'sent')
    .limit(1);
  if (awaitingError) throw new Error(awaitingError.message);
  if (awaiting?.length) {
    throw new Error('A refund proof is already awaiting this member’s review. Wait for them to approve or reject it.');
  }

  const url = await uploadProofFile(file, 'refund', expense.id, actor.id);
  const refundId = crypto.randomUUID();
  const { error } = await supabase.from('expense_refunds').insert({
    id: refundId,
    expense_id: expense.id,
    user_id: split.user_id,
    amount: amt,
    refund_type: refundType,
    screenshot_url: url,
    note: note || null,
  });
  if (error) throw new Error(error.message);

  await recalculateExpenseStatus(expense.id);

  // Household refunds open the member's Expenses screen (the refund card in
  // Pending Approvals first, the expense once it's handled).
  const notificationLink = await householdRefundLink(expense, expense.id, linkFor);
  const notificationParams = new URLSearchParams(notificationLink.link_query || '');
  notificationParams.set('refundId', refundId);
  await notify([{
    user_id: split.user_id,
    title: refundType === 'overpayment' ? '💸 Overpayment Refund Sent' : '🗑️ Refund for Deletion of Expense',
    message: refundType === 'overpayment'
      ? `${actor.name} sent you a refund for the overpaid amount of ${money(amt)} for "${expense.title}". Review the proof and approve or reject it.`
      : `${actor.name} wants to delete "${expense.title}" and sent you a refund of ${money(amt)} for what you paid. Review the proof and approve or reject it — the expense can only be deleted once your refund is confirmed.`,
    type: 'refund_sent',
    ...notificationLink,
    link_query: notificationParams.toString(),
  }]);
}

/** Refund notifications for a household expense link to the Expenses screen
 *  (the expense stays listed until every deletion refund is confirmed);
 *  group expenses keep their group screen link. */
async function householdRefundLink(expense, expenseId, linkFor) {
  let householdId = expense?.household_id;
  if (householdId === undefined) {
    const { data } = await supabase.from('expenses').select('household_id').eq('id', expenseId).maybeSingle();
    householdId = data?.household_id;
  }
  return householdId
    ? { link_path: '/expenses', link_query: `householdId=${householdId}&expenseId=${expenseId}` }
    : linkFor(expenseId);
}

export async function reviewRefund({ refund, expense, approve, reason, user, userName, adminId, linkFor }) {
  if (!approve && !reason?.trim()) throw new Error('Please provide a reason for rejecting this refund.');
  if (!approve && reason.trim().length > 500) {
    throw new Error('Please keep the rejection reason to 500 characters or fewer.');
  }

  const { data: reviewedRefund, error } = await supabase
    .from('expense_refunds')
    .update({
      status: approve ? 'confirmed' : 'rejected',
      rejection_reason: approve ? null : reason.trim(),
    })
    .eq('id', refund.id)
    .eq('user_id', user.id)
    .eq('status', 'sent')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!reviewedRefund) throw new Error('This refund is no longer awaiting your review. Refresh the page and try again.');

  await recalculateExpenseStatus(refund.expense_id);

  if (adminId && adminId !== user.id) {
    const refundPurpose = refund.refund_type === 'overpayment' ? 'overpayment refund' : 'expense deletion refund';
    // A rejected household refund (overpayment or expense deletion) opens the
    // Expenses screen: resend form on the first tap, the expense once resent.
    const notificationLink = !approve
      ? await householdRefundLink(expense, refund.expense_id, linkFor)
      : linkFor(refund.expense_id);
    const notificationParams = new URLSearchParams(notificationLink.link_query || '');
    if (!approve) notificationParams.set('refundId', refund.id);
    await notify([{
      user_id: adminId,
      title: approve ? 'Refund Received ✅' : 'Refund Rejected ❌',
      message: approve
        ? `${userName} confirmed receiving the ${money(refund.amount)} ${refundPurpose} for "${expense?.title}".`
        : `${userName} rejected the ${money(refund.amount)} ${refundPurpose} for "${expense?.title}". Reason: ${reason.trim()}`,
      type: approve ? 'refund_confirmed' : 'refund_rejected',
      ...notificationLink,
      link_query: notificationParams.toString(),
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