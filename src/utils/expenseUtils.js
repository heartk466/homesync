import { supabase } from '../supabaseClient';
import { notifyPendingChanged } from './pendingEvents';

export const UTILITY_CATEGORIES = [
  'Electricity', 'Water', 'Internet', 'Entertainment', 'Power', 'Gas', 'Subscription',
  'Mobile', 'Cable', 'Other utility',
];

// Categories offered when adding from the Utilities screen (AddExpenseModal
// categoryScope="utilities"); stored values stay short, labels are friendlier.
export const UTILITY_SCOPE_CATEGORIES = ['Electricity', 'Water', 'Internet', 'Gas', 'Entertainment', 'Mobile', 'Cable', 'Other utility'];
export const CATEGORY_LABELS = {
  Gas: 'Gas/LPG',
  Entertainment: 'Entertainment/Streaming',
  Mobile: 'Mobile/Load',
  Cable: 'Cable/TV',
};
export const categoryLabel = (category) => CATEGORY_LABELS[category] || category;

// Dates (this user's own reminder days) on which a reminder will fire for a due
// date. Only days still in the future are listed.
export const getReminderPreview = (dueDate, days, todayStr) => {
  if (!dueDate || !days?.length) return [];
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date(`${todayStr}T00:00:00`);
  return [...days]
    .sort((a, b) => b - a)
    .map(d => { const dt = new Date(due); dt.setDate(dt.getDate() - d); return dt; })
    .filter(dt => dt >= today)
    .map(dt => dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
};
export const getMyReminderDays = (profile) =>
  Array.isArray(profile?.reminder_days) ? profile.reminder_days : [profile?.default_reminder_days || 3];

export const isUtilityCategory = (category) => UTILITY_CATEGORIES.includes(category);

// ── Category rules (enforced again by the DB trigger guard_expense_category) ──
// Electricity / Water: one expense per household (or group) per billing month.
export const BILLING_CATEGORIES = ['Electricity', 'Water'];
export const isBillingCategory = (category) => BILLING_CATEGORIES.includes(category);
// 'YYYY-MM' → 'YYYY-MM-01' (the stored billing_period)
export const billingPeriodOf = (month) => (month ? `${month.slice(0, 7)}-01` : null);
export const monthNameOf = (period) =>
  period ? new Date(`${period.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long' }) : '';

export const CATEGORY_LOCK_PAYMENTS = 'Category is locked because payments exist. Delete and recreate the expense to fix it.';
export const CATEGORY_LOCK_LINKED = 'Category is locked because this expense is linked to a utility provider or subscription.';

/**
 * Why the category can't change (null = editable). The admin's own share
 * (adminId) doesn't count — only payments / proofs from other members lock it.
 */
export const categoryLockReason = (expense, splits = [], adminId = null) => {
  if (expense?.utility_id || (expense?.source && expense.source !== 'expenses')) return CATEGORY_LOCK_LINKED;
  if (splits.some(s => s.user_id !== adminId && (s.status !== 'unpaid' || Number(s.paid_amount) > 0))) return CATEGORY_LOCK_PAYMENTS;
  return null;
};

/**
 * Electricity / Water expenses already in a billing month for this household
 * or group: { Electricity: expense, Water: expense }. excludeId = the expense
 * being edited.
 */
export async function fetchTakenBillingSlots({ householdId, groupId, period, excludeId }) {
  if (!period || (!householdId && !groupId)) return {};
  let query = supabase
    .from('expenses')
    .select('id, title, category, billing_period, household_id, group_id')
    .in('category', BILLING_CATEGORIES)
    .eq('billing_period', period)
    .is('deleted_at', null);
  query = householdId ? query.eq('household_id', householdId) : query.eq('group_id', groupId);
  if (excludeId) query = query.neq('id', excludeId);
  const { data } = await query;
  return Object.fromEntries((data || []).map(e => [e.category, e]));
}

// ── Subscription presets ──────────────────────────────────────────────────────
export const SUBSCRIPTION_PRESETS = [
  { name: 'Netflix',          suggestedAmount: 549  },
  { name: 'Spotify',          suggestedAmount: 179  },
  { name: 'YouTube Premium',  suggestedAmount: 179  },
  { name: 'Disney+',          suggestedAmount: 279  },
  { name: 'HBO Go',           suggestedAmount: 299  },
  { name: 'Apple TV+',        suggestedAmount: 225  },
  { name: 'Amazon Prime',     suggestedAmount: 400  },
  { name: 'Canva Pro',        suggestedAmount: 499  },
  { name: 'Adobe CC',         suggestedAmount: 799  },
  { name: 'ChatGPT Plus',     suggestedAmount: 1150 },
  { name: 'Claude Pro',       suggestedAmount: 1150 },
  { name: 'iCloud+',          suggestedAmount: 49   },
  { name: 'Google One',       suggestedAmount: 99   },
  { name: 'Microsoft 365',    suggestedAmount: 399  },
  { name: 'Notion',           suggestedAmount: 500  },
  { name: 'Figma',            suggestedAmount: 750  },
  { name: 'GitHub Copilot',   suggestedAmount: 500  },
  { name: 'Duolingo Plus',    suggestedAmount: 399  },
  { name: 'VPN',              suggestedAmount: 250  },
  { name: 'Dropbox',          suggestedAmount: 599  },
];
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllHouseholdExpenses(householdId) {
  if (!householdId) return [];
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('household_id', householdId)
    .is('deleted_at', null)   // soft-deleted expenses stay in the database but are hidden
    .order('expense_date', { ascending: false });
  if (error) return [];
  return data;
}

export async function fetchAllUtilityItems(householdId) {
  if (!householdId) return { utilities: [], fromExpenses: [] };

  const { data: utilities, error: utilsError } = await supabase
    .from('utilities')
    .select('*')
    .eq('household_id', householdId)
    .order('billing_date', { ascending: false });
  if (utilsError) return { utilities: [], fromExpenses: [] };

  const { data: expenses, error: expError } = await supabase
    .from('expenses')
    .select('*')
    .eq('household_id', householdId)
    .in('category', UTILITY_CATEGORIES)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false });
  if (expError) return { utilities: utilities || [], fromExpenses: [] };

  const fromExpenses = (expenses || []).map(exp => ({
    id: exp.id,
    household_id: exp.household_id,
    utility_type: exp.category,
    provider_name: exp.title,
    amount: exp.amount,
    billing_date: exp.expense_date,
    split_method: exp.split_type,
    members_split: exp.members_split,
    status: exp.status,
    approval_status: exp.approval_status,
    location: exp.location || '',
    source: 'expenses',
    is_merged: exp.is_merged || false,
    created_at: exp.created_at,
  }));

  return { utilities: utilities || [], fromExpenses };
}

export async function fetchHouseholdUtilitiesTotal(householdId) {
  if (!householdId) return 0;
  const { data, error } = await supabase
    .from('utilities')
    .select('amount')
    .eq('household_id', householdId)
    .eq('status', 'paid');
  if (error) return 0;
  return (data || []).reduce((sum, u) => sum + Number(u.amount), 0);
}

export async function checkDuplicate(householdId, category, amount, date) {
  const { data: existingExpenses } = await supabase
    .from('expenses')
    .select('id, title, amount, expense_date, category')
    .eq('household_id', householdId)
    .eq('category', category)
    .eq('amount', amount)
    .eq('expense_date', date)
    .is('deleted_at', null);

  const { data: existingUtilities } = await supabase
    .from('utilities')
    .select('id, provider_name, amount, billing_date, utility_type')
    .eq('household_id', householdId)
    .eq('utility_type', category)
    .eq('amount', amount)
    .eq('billing_date', date);

  const dupes = [];
  if (existingExpenses?.length) dupes.push(...existingExpenses.map(e => ({ ...e, source: 'expenses' })));
  if (existingUtilities?.length) dupes.push(...existingUtilities.map(u => ({ ...u, source: 'utilities' })));
  return dupes;
}

// Placeholder: merging duplicates isn't implemented yet (callers pass the two ids).
export async function mergeItems() {
  return true;
}

// Recomputes expense.status from all its expense_splits rows. Shared by
// every screen that can change a split's status (submit proof, approve,
// reject) so the whole-expense badge is always derived fresh instead of
// being force-set by whichever action ran last and going stale.
export async function recalculateExpenseStatus(expenseId) {
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
}

// Submits payment proof for a utility/expense item and puts it through the
// same verify-then-approve flow used on ExpensesScreen and GroupDetailScreen:
// proof goes in as 'pending_verification', the member's split is marked
// 'pending_verification', and the expense-level status is recalculated from
// all splits — it is NOT force-marked 'paid' here. The household owner still
// has to review and confirm the proof (from the Expenses screen's Pending
// Approvals list) before it flips to 'approved'/'paid'.
// Returns the inserted proof row on success (so the caller can link a
// notification to it), or null if something failed.
export async function markItemAsPaid(item, screenshotUrl, note, userId) {
  const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
    expense_id: item.id,
    submitted_by: userId,
    screenshot_url: screenshotUrl,
    note,
    status: 'pending_verification',
  }).select().single();
  if (proofError) return null;

  const { data: existingSplit } = await supabase
    .from('expense_splits')
    .select('id')
    .eq('expense_id', item.id)
    .eq('user_id', userId)
    .maybeSingle();

  let splitError = null;
  if (existingSplit) {
    const { error } = await supabase
      .from('expense_splits')
      .update({ status: 'pending_verification', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
      .eq('id', existingSplit.id);
    splitError = error;
  } else {
    const myShare = item.members_split?.[userId];
    const { error } = await supabase.from('expense_splits').insert({
      expense_id: item.id,
      user_id: userId,
      share_amount: Number(myShare) || 0,
      status: 'pending_verification',
      proof_id: insertedProof.id,
      updated_at: new Date().toISOString(),
    });
    splitError = error;
  }
  if (splitError) return null;

  if (item.source === 'expenses') {
    await recalculateExpenseStatus(item.id);
  } else {
    // Legacy 'utilities'-table items have no expense_splits of their own to
    // derive a status from, so they fall back to a direct 'verifying' flag.
    // (UtilitiesScreen's current data flow reads everything from
    // 'expenses', so this branch is a safety net rather than the live path.)
    await supabase.from('utilities').update({ status: 'verifying' }).eq('id', item.id);
  }

  return insertedProof;
}