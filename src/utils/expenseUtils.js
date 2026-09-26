import { supabase } from '../supabaseClient';

export const UTILITY_CATEGORIES = ['Electricity', 'Water', 'Internet', 'Entertainment', 'Power', 'Gas', 'Subscription'];

export const isUtilityCategory = (category) => UTILITY_CATEGORIES.includes(category);

// ── Subscription presets ──────────────────────────────────────────────────────
export const SUBSCRIPTION_PRESETS = [
  { name: 'Netflix',          icon: '🎬', suggestedAmount: 549  },
  { name: 'Spotify',          icon: '🎵', suggestedAmount: 179  },
  { name: 'YouTube Premium',  icon: '▶️',  suggestedAmount: 179  },
  { name: 'Disney+',          icon: '✨', suggestedAmount: 279  },
  { name: 'HBO Go',           icon: '📺', suggestedAmount: 299  },
  { name: 'Apple TV+',        icon: '🍎', suggestedAmount: 225  },
  { name: 'Amazon Prime',     icon: '📦', suggestedAmount: 400  },
  { name: 'Canva Pro',        icon: '🎨', suggestedAmount: 499  },
  { name: 'Adobe CC',         icon: '🖌️', suggestedAmount: 799  },
  { name: 'ChatGPT Plus',     icon: '🤖', suggestedAmount: 1150 },
  { name: 'Claude Pro',       icon: '🧠', suggestedAmount: 1150 },
  { name: 'iCloud+',          icon: '☁️', suggestedAmount: 49   },
  { name: 'Google One',       icon: '🔵', suggestedAmount: 99   },
  { name: 'Microsoft 365',    icon: '📊', suggestedAmount: 399  },
  { name: 'Notion',           icon: '📝', suggestedAmount: 500  },
  { name: 'Figma',            icon: '🖼️', suggestedAmount: 750  },
  { name: 'GitHub Copilot',   icon: '💻', suggestedAmount: 500  },
  { name: 'Duolingo Plus',    icon: '🦉', suggestedAmount: 399  },
  { name: 'VPN',              icon: '🔒', suggestedAmount: 250  },
  { name: 'Dropbox',          icon: '📂', suggestedAmount: 599  },
];
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllHouseholdExpenses(householdId) {
  if (!householdId) return [];
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('household_id', householdId)
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
    .eq('expense_date', date);

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

export async function mergeItems(duplicateId, newId) {
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
}

// Submits payment proof for a utility/expense item and puts it through the
// same verify-then-approve flow used on ExpensesScreen and GroupDetailScreen:
// proof goes in as 'pending_verification', the member's split is marked
// 'pending_verification', and the expense-level status is recalculated from
// all splits — it is NOT force-marked 'paid' here. The household owner still
// has to review and confirm the proof (from the Expenses screen's Pending
// Approvals list) before it flips to 'approved'/'paid'.
// Returns true on success, false if something failed.
export async function markItemAsPaid(item, screenshotUrl, note, userId) {
  const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
    expense_id: item.id,
    submitted_by: userId,
    screenshot_url: screenshotUrl,
    note,
    status: 'pending_verification',
  }).select().single();
  if (proofError) return false;

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
  if (splitError) return false;

  if (item.source === 'expenses') {
    await recalculateExpenseStatus(item.id);
  } else {
    // Legacy 'utilities'-table items have no expense_splits of their own to
    // derive a status from, so they fall back to a direct 'verifying' flag.
    // (UtilitiesScreen's current data flow reads everything from
    // 'expenses', so this branch is a safety net rather than the live path.)
    await supabase.from('utilities').update({ status: 'verifying' }).eq('id', item.id);
  }

  return true;
}