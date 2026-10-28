// Approving / rejecting an expense a member proposed. Shared by
// GroupDetailScreen and ExpensesScreen so both do exactly the same thing.
//
// `link` = { link_path, link_state } for the household/group the expense
// belongs to — every notification sent here opens that screen.

import { supabase } from '../supabaseClient';
import { formatMoney } from './format';

/**
 * Approve: mark the expense approved and create its splits.
 * Payer rules (nobody is Paid without a proof):
 *   • owner is the payer            → Unpaid until the owner uploads proof (verified instantly)
 *   • member is the payer + proof   → Pending (owner reviews the proof)
 *   • member is the payer, no proof → Unpaid (member must submit proof)
 */
export async function approveMemberExpense({ expense, ownerId, actorId, link }) {
  const splits = expense.members_split || {};
  const memberIds = Object.keys(splits);
  const payerIsOwner = expense.paid_by === ownerId;

  const { error: approveError } = await supabase.from('expenses')
    .update({ approval_status: 'approved', status: 'pending' })
    .eq('id', expense.id);
  if (approveError) throw new Error(approveError.message);

  // If the member attached proof when creating the expense ("Submit Expense + Proof"),
  // link it to their split so it shows up for the owner to approve/reject.
  let upfrontProof = null;
  if (expense.paid_by && !payerIsOwner) {
    const { data: proofs } = await supabase
      .from('payment_proofs')
      .select('id')
      .eq('expense_id', expense.id)
      .eq('submitted_by', expense.paid_by)
      .eq('status', 'pending_verification')
      .limit(1);
    upfrontProof = proofs?.[0] || null;
  }

  const splitRows = memberIds.map(uid => {
    const upfront = uid === expense.paid_by && !payerIsOwner && upfrontProof;
    return {
      expense_id: expense.id,
      user_id: uid,
      share_amount: Number(splits[uid]),
      status: upfront ? 'pending_verification' : 'unpaid',
      proof_id: upfront ? upfrontProof.id : null,
      updated_at: new Date().toISOString(),
    };
  });
  // upsert (not insert): a DB trigger may already have created the rows
  await supabase.from('expense_splits').upsert(splitRows, { onConflict: 'expense_id,user_id' });

  const linkTo = { ...link, link_query: `expenseId=${expense.id}` };
  const needsProof = !payerIsOwner && !upfrontProof;
  const creatorIsPayer = expense.created_by === expense.paid_by;
  const amount = formatMoney(expense.amount);
  const notifications = [{
    user_id: expense.created_by,
    title: '✅ Expense Approved!',
    message: !expense.paid_by
      ? `Your expense "${expense.title}" for ${amount} was approved and is marked Unpaid. Upload your proof of payment for your share — it is marked paid once the owner approves it.`
      : needsProof && creatorIsPayer
      ? `Your expense "${expense.title}" for ${amount} was approved. Please upload your proof of payment — it is marked paid once the owner approves it.`
      : `Your expense "${expense.title}" for ${amount} was approved by the owner.${upfrontProof && creatorIsPayer ? ' Your proof is now waiting for the owner\'s review.' : ''}`,
    type: 'expense_approved',
    ...linkTo,
  }];

  // Someone else was named as the payer → tell them to upload their proof
  if (needsProof && !creatorIsPayer && expense.paid_by) {
    notifications.push({
      user_id: expense.paid_by,
      title: '📸 Upload your proof of payment',
      message: `"${expense.title}" (${amount}) was approved and you are the payer. Please upload your proof of payment.`,
      type: 'expense_approved',
      ...linkTo,
    });
  }

  // No payer: every member submits proof for their own share, so let them know
  if (!expense.paid_by) {
    memberIds
      .filter(uid => uid !== expense.created_by && uid !== actorId)
      .forEach(uid => notifications.push({
        user_id: uid,
        title: 'New Expense Added',
        message: `"${expense.title}" for ${amount} was added and is marked Unpaid. Your share: ${formatMoney(splits[uid])}. Upload your proof of payment once you pay.`,
        type: 'expense_added',
        ...linkTo,
      }));
  }

  const { error: notifError } = await supabase.from('notifications').insert(notifications);
  if (notifError) console.error('Failed to send approval notifications:', notifError);
}

/**
 * Reject: soft-delete the proposed expense with the reason, then tell the
 * member who proposed it. The delete runs first — if it fails we stop, so the
 * member is never told "rejected" about an expense that still exists.
 */
export async function rejectMemberExpense({ expense, reason, actorId, actorName, link }) {
  const trimmed = reason?.trim();
  if (!trimmed) throw new Error('Please provide a rejection reason');

  const { error: deleteError } = await supabase
    .from('expenses')
    .update({
      approval_status: 'rejected',
      rejection_reason: trimmed,
      deleted_at: new Date().toISOString(),
      deleted_by: actorId,
    })
    .eq('id', expense.id);
  if (deleteError) throw new Error('Could not reject the expense. Please try again.');

  if (expense.created_by && expense.created_by !== actorId) {
    const { error: notifError } = await supabase.from('notifications').insert({
      user_id: expense.created_by,
      title: '❌ Expense Rejected',
      message: `${actorName || 'The owner'} (owner) rejected your proposed expense "${expense.title}" for ${formatMoney(expense.amount)}. Reason: ${trimmed}`,
      type: 'expense_rejected',
      ...link,
    });
    if (notifError) console.error('Failed to notify member of rejected expense:', notifError);
  }
}
