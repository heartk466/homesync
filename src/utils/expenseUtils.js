import { supabase } from '../supabaseClient';

// Categories that count as utilities
export const UTILITY_CATEGORIES = ['Electricity', 'Water', 'Gas', 'Internet', 'Power'];

// Check if a category is utility-related
export const isUtilityCategory = (category) => {
  return UTILITY_CATEGORIES.includes(category);
};

// ─── DUPLICATE DETECTION ───────────────────────────────────────────────────

export const checkDuplicate = async (householdId, category, amount, date) => {
  try {
    // Get start and end of the same month
    const inputDate = new Date(date);
    const monthStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), 1)
      .toISOString().split('T')[0];
    const monthEnd = new Date(inputDate.getFullYear(), inputDate.getMonth() + 1, 0)
      .toISOString().split('T')[0];

    // Check expenses table
    const { data: expenseDupes } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', householdId)
      .eq('category', category)
      .eq('amount', amount)
      .gte('expense_date', monthStart)
      .lte('expense_date', monthEnd)
      .neq('approval_status', 'rejected');

    // Check utilities table
    const { data: utilityDupes } = await supabase
      .from('utilities')
      .select('*')
      .eq('household_id', householdId)
      .eq('utility_type', category)
      .eq('amount', amount)
      .gte('billing_date', monthStart)
      .lte('billing_date', monthEnd);

    const allDupes = [
      ...(expenseDupes || []).map(d => ({ ...d, source: 'expenses' })),
      ...(utilityDupes || []).map(d => ({ ...d, source: 'utilities' })),
    ];

    return allDupes;
  } catch (err) {
    console.error('Duplicate check error:', err);
    return [];
  }
};

// ─── MERGE EXPENSE + UTILITY ────────────────────────────────────────────────

export const mergeItems = async (expenseId, utilityId) => {
  try {
    // Update expense to mark as merged and link utility
    await supabase
      .from('expenses')
      .update({
        source: 'merged',
        utility_id: utilityId,
        is_merged: true,
      })
      .eq('id', expenseId);

    // Delete utility since expense now represents both
    await supabase
      .from('utilities')
      .delete()
      .eq('id', utilityId);

    return { success: true };
  } catch (err) {
    console.error('Merge error:', err);
    return { success: false };
  }
};

// ─── FETCH ALL EXPENSES FOR A HOUSEHOLD (including utilities) ───────────────

export const fetchAllHouseholdExpenses = async (householdId) => {
  try {
    // Fetch regular expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', householdId)
      .neq('approval_status', 'rejected')
      .order('created_at', { ascending: false });

    // Fetch utilities and convert to expense-like format
    const { data: utilities } = await supabase
      .from('utilities')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });

    // Convert utilities to expense format for display
    const utilitiesAsExpenses = (utilities || []).map(u => ({
      id: u.id,
      title: `${u.utility_type}(${u.provider_name})`,
      amount: u.amount,
      category: u.utility_type,
      expense_date: u.billing_date,
      location: u.location,
      status: u.status,
      members_split: u.members_split,
      paid_by: u.created_by,
      household_id: u.household_id,
      source: 'utilities',
      utility_id: u.id,
      approval_status: 'approved',
      created_at: u.created_at,
    }));

    // Combine — filter out merged expenses from utilities
    // (merged ones are already in expenses table)
    const mergedUtilityIds = (expenses || [])
      .filter(e => e.is_merged && e.utility_id)
      .map(e => e.utility_id);

    const filteredUtilities = utilitiesAsExpenses.filter(
      u => !mergedUtilityIds.includes(u.id)
    );

    return [...(expenses || []), ...filteredUtilities];
  } catch (err) {
    console.error('Fetch all expenses error:', err);
    return [];
  }
};

// ─── FETCH UTILITY-RELATED ITEMS FOR UTILITIES SCREEN ───────────────────────

export const fetchAllUtilityItems = async (householdId) => {
  try {
    // Fetch utilities from utilities table
    const { data: utilities } = await supabase
      .from('utilities')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });

    // Fetch utility-related expenses from expenses table
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', householdId)
      .in('category', UTILITY_CATEGORIES)
      .neq('approval_status', 'rejected')
      .order('created_at', { ascending: false });

    // Get merged utility IDs to avoid showing both
    const mergedUtilityIds = (expenses || [])
      .filter(e => e.is_merged && e.utility_id)
      .map(e => e.utility_id);

    // Filter out utilities that have been merged
    const filteredUtilities = (utilities || []).filter(
      u => !mergedUtilityIds.includes(u.id)
    );

    // Convert expenses to utility-like format for display
    const expensesAsUtilities = (expenses || [])
      .filter(e => !e.is_merged)
      .map(e => ({
        id: e.id,
        utility_type: e.category,
        provider_name: e.title,
        amount: e.amount,
        billing_date: e.expense_date,
        location: e.location,
        status: e.status,
        members_split: e.members_split,
        created_by: e.paid_by,
        household_id: e.household_id,
        source: 'expenses',
        approval_status: e.approval_status,
        created_at: e.created_at,
      }));

    return {
      utilities: filteredUtilities.map(u => ({ ...u, source: u.source || 'utilities' })),
      fromExpenses: expensesAsUtilities,
    };
  } catch (err) {
    console.error('Fetch utility items error:', err);
    return { utilities: [], fromExpenses: [] };
  }
};

// ─── FETCH TOTAL UTILITIES COST FOR GROUP CARD ──────────────────────────────

export const fetchHouseholdUtilitiesTotal = async (householdId) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().split('T')[0];

    // From utilities table
    const { data: utilities } = await supabase
      .from('utilities')
      .select('amount, utility_id:id')
      .eq('household_id', householdId)
      .gte('billing_date', monthStart)
      .lte('billing_date', monthEnd);

    // From expenses table (utility categories only, not merged)
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount')
      .eq('household_id', householdId)
      .in('category', UTILITY_CATEGORIES)
      .eq('is_merged', false)
      .gte('expense_date', monthStart)
      .lte('expense_date', monthEnd)
      .neq('approval_status', 'rejected');

    const utilitiesTotal = (utilities || [])
      .reduce((sum, u) => sum + Number(u.amount), 0);
    const expensesTotal = (expenses || [])
      .reduce((sum, e) => sum + Number(e.amount), 0);

    return utilitiesTotal + expensesTotal;
  } catch (err) {
    console.error('Fetch utilities total error:', err);
    return 0;
  }
};

// ─── MARK AS PAID (works from any screen) ───────────────────────────────────

export const markItemAsPaid = async (item, screenshotUrl, note, submittedBy) => {
  try {
    if (item.source === 'utilities') {
      // Update utilities table
      await supabase
        .from('utilities')
        .update({ status: 'verifying' })
        .eq('id', item.id);
    } else {
      // Update expenses table
      await supabase
        .from('expenses')
        .update({ status: 'verifying' })
        .eq('id', item.id);
    }

    // Insert payment proof
    await supabase.from('payment_proofs').insert({
      expense_id: item.source === 'expenses' ? item.id : null,
      utility_id: item.source === 'utilities' ? item.id : null,
      submitted_by: submittedBy,
      screenshot_url: screenshotUrl,
      note: note,
      status: 'pending_verification',
    });

    return { success: true };
  } catch (err) {
    console.error('Mark as paid error:', err);
    return { success: false };
  }
};

// ─── ADMIN CONFIRM PAYMENT (works from any screen) ──────────────────────────

export const adminConfirmPayment = async (proof, notifyUserId, itemTitle) => {
  try {
    if (proof.utility_id) {
      await supabase
        .from('utilities')
        .update({ status: 'paid' })
        .eq('id', proof.utility_id);
    }

    if (proof.expense_id) {
      await supabase
        .from('expenses')
        .update({ status: 'paid' })
        .eq('id', proof.expense_id);
    }

    await supabase
      .from('payment_proofs')
      .update({ status: 'verified' })
      .eq('id', proof.id);

    await supabase.from('notifications').insert({
      user_id: notifyUserId,
      title: 'Payment Confirmed! ✅',
      message: `Your payment for "${itemTitle}" has been verified!`,
      type: 'payment_confirmed',
    });

    return { success: true };
  } catch (err) {
    console.error('Admin confirm payment error:', err);
    return { success: false };
  }
};