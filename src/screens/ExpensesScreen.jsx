import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Search, Filter, X, Check, Plus,
  Trash2, AlertCircle, ChevronDown, Camera, Pencil, Eye
} from 'lucide-react';
import './ExpensesScreen.css';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import PayOnlineModal from '../components/PayOnlineModal';
import EditExpenseModal from '../components/EditExpenseModal';
import DeleteExpenseModal from '../components/DeleteExpenseModal';
import FollowupPaymentModal from '../components/FollowupPaymentModal';
import RefundModal from '../components/RefundModal';
import ExpenseProofsModal from '../components/ExpenseProofsModal';
import {
  fetchExpenseExtras, softDeleteExpense, submitFollowupProof, reviewFollowupProof,
  sendRefund, confirmRefund, dropDeletedExpenses, followupDueOf, overpaidOf,
  num as toNum,
} from '../utils/expenseEditUtils';
import { detectCategory } from '../utils/categoryDetection';
import {
  fetchAllHouseholdExpenses,
  checkDuplicate,
  mergeItems,
  isUtilityCategory,
  UTILITY_CATEGORIES,
  SUBSCRIPTION_PRESETS,
} from '../utils/expenseUtils';

// All selectable categories — Other always last
const ALL_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Internet',
  'Food', 'Grocery', 'Transport', 'Entertainment', 'Subscription', 'Other',
];

const CATEGORY_ICONS = {
  Rent: '🏠', Electricity: '⚡', Water: '💧', Internet: '📶',
  Food: '🍽️', Grocery: '🛒', Other: '📦', Transport: '🚗',
  Entertainment: '🎬', Subscription: '📱',
};

const CATEGORY_COLORS = {
  Rent: '#3B2AAB', Electricity: '#2B6CB0', Water: '#2C7A7B',
  Internet: '#6B46C1', Food: '#C05621', Grocery: '#276749',
  Other: '#718096', Transport: '#DD6B20', Entertainment: '#D53F8C',
  Subscription: '#9B2C87',
};

// Local (device) date as YYYY-MM-DD. toISOString() uses UTC, which returns
// "yesterday" before 8 AM in the Philippines (UTC+8).
const getTodayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};
const fmtDate = (str) =>
  str ? new Date(`${str}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Dates (this user's own reminder days) on which a reminder will fire for a due date.
// Only days that are still in the future are listed.
const getReminderPreview = (dueDate, days) => {
  if (!dueDate || !days?.length) return [];
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date(`${getTodayStr()}T00:00:00`);
  return [...days]
    .sort((a, b) => b - a)
    .map(d => { const dt = new Date(due); dt.setDate(dt.getDate() - d); return dt; })
    .filter(dt => dt >= today)
    .map(dt => dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
};
const getMyReminderDays = (profile) =>
  Array.isArray(profile?.reminder_days) ? profile.reminder_days : [profile?.default_reminder_days || 3];

export default function ExpensesScreen() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const proofInputRef = useRef(null);
  const initialHouseholdSet = useRef(false);

  const [profile, setProfile] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [selectedHousehold, setSelectedHousehold] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [expenseSplits, setExpenseSplits] = useState({});
  const [filteredExpenses, setFilteredExpenses] = useState([]);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingPaymentProofs, setPendingPaymentProofs] = useState([]);

  // Summary
  const [totalShared, setTotalShared] = useState(0);
  const [toReimburse, setToReimburse] = useState(0);
  const [totalSaved, setTotalSaved] = useState(0);
  const [reimburseDetails, setReimburseDetails] = useState([]);

  // UI State
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectProofModal, setShowRejectProofModal] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedSplit, setSelectedSplit] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null);

  // Edit / follow-up / refund / proofs (shared modals)
  const [editExpense, setEditExpense] = useState(null);
  const [extras, setExtras] = useState({ followups: {}, refunds: {} });
  const [allProofs, setAllProofs] = useState([]);
  const [followupFor, setFollowupFor] = useState(null);   // { expense, split }
  const [showFollowupPayOnline, setShowFollowupPayOnline] = useState(false);
  const [refundFor, setRefundFor] = useState(null);       // { expense, split }
  const [proofsFor, setProofsFor] = useState(null);       // { expense, split }
  const [xmLoading, setXmLoading] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateItem, setDuplicateItem] = useState(null);
  const [pendingExpenseData, setPendingExpenseData] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [householdSearch, setHouseholdSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Filter state
  const [filterStatus, setFilterStatus] = useState([]);
  const [filterCategory, setFilterCategory] = useState([]);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Add expense form
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    category: 'Rent',
    expense_date: getTodayStr(),
    due_date: '',
    who_paid: '',
    split_type: 'equal',
    selected_members: [],
    custom_splits: {},
  });
  const [expenseErrors, setExpenseErrors] = useState({});
  // Category auto-detect: stops overriding once the user picks a category themselves
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [categoryAutoDetected, setCategoryAutoDetected] = useState(false);

  // Nobody to split with when the household has a single member
  const isSolo = householdMembers.length <= 1;

  // Payment proof form
  const [proofForm, setProofForm] = useState({ note: '', screenshot: null, screenshotPreview: null });
  const [showPayOnlineModal, setShowPayOnlineModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectProofReason, setRejectProofReason] = useState('');
  // "Other" category custom type label
  const [otherType, setOtherType] = useState('');
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
    data.forEach(split => {
      if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
      grouped[split.expense_id].push(split);
    });
    setExpenseSplits(grouped);
    return grouped;
  }, []);

  // ========== FIXED: fetchExpensesData with correct summary calculations ==========
  const fetchExpensesData = useCallback(async (profileData, user, adminStatus, memberData, householdId) => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Fetch all expenses for this household (including pending approval, but summary only for approved)
    const rawExpenses = await fetchAllHouseholdExpenses(householdId);
    if (!rawExpenses) return;
    // soft-deleted expenses stay in the database but are hidden here
    const expensesData = await dropDeletedExpenses(rawExpenses);

    // Only show approved expenses in the main list
    const approvedExpenses = expensesData.filter(e => e.approval_status === 'approved');
    setExpenses(approvedExpenses);
    setFilteredExpenses(approvedExpenses);
    const groupedSplits = (await fetchExpenseSplits(expensesData.map(e => e.id))) || {};

    // follow-up proofs, refunds and every original proof (for the history modal)
    const allIds = expensesData.map(e => e.id);
    setExtras(await fetchExpenseExtras(allIds));
    if (allIds.length) {
      const { data: proofsAll } = await supabase.from('payment_proofs').select('*').in('expense_id', allIds);
      setAllProofs(proofsAll || []);
    } else {
      setAllProofs([]);
    }

    // Pending approvals (splits with status pending_verification) – for owner
    let pendingSplits = [];
    for (const exp of expensesData) {
      const splits = groupedSplits[exp.id] || [];
      const pending = splits.filter(s => s.status === 'pending_verification');
      pendingSplits.push(...pending);
    }
    setPendingApprovals(pendingSplits);

    // Fetch payment proofs for pending view
    const expenseIds = expensesData.map(e => e.id);
    if (expenseIds.length > 0) {
      const { data: proofs } = await supabase
        .from('payment_proofs')
        .select('*, profiles(*)')
        .eq('status', 'pending_verification')
        .in('expense_id', expenseIds);
      setPendingPaymentProofs(proofs || []);
    } else {
      setPendingPaymentProofs([]);
    }

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
      if (mySplit && mySplit.status !== 'approved') {
        // only what is still owed: share minus what the admin already approved
        const owedNow = Math.max(toNum(mySplit.share_amount) - toNum(mySplit.paid_amount), 0);
        userUnpaidTotal += owedNow;
        const payer = memberData?.find(m => m.user_id === expense.paid_by);
        reimburseList.push({
          expense,
          amount: owedNow,
          payer: payer?.profiles,
        });
      }
    }

    setTotalShared(householdTotal);
    setToReimburse(userUnpaidTotal);
    setReimburseDetails(reimburseList);
    setTotalSaved(householdTotal); // Same as Total Shared

  }, [fetchExpenseSplits]);

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

  const handleHouseholdSelect = useCallback(async (household, user, profileData) => {
    const activeUser = user || currentUser;
    const activeProfile = profileData || profile;

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

    setExpenseForm({
      title: '',
      amount: '',
      category: 'Rent',
      expense_date: getTodayStr(),
    due_date: '',
      who_paid: adminStatus && activeUser ? activeUser.id : '',
      split_type: 'equal',
      selected_members: [],
      custom_splits: {},
    });
    setExpenseErrors({});
    setCategoryTouched(false);
    setCategoryAutoDetected(false);

    await fetchExpensesData(activeProfile, activeUser, adminStatus, membersList, household.id);
  }, [currentUser, profile, fetchExpensesData]);

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

      if (!memberHouseholds || memberHouseholds.length === 0) return;

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
      console.error(err);
    }
  }, [navigate, handleHouseholdSelect]);

  useEffect(() => { fetchData(); }, []);
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, (payload) => {
        setNotifications(prev => [payload.new, ...prev]);
        setUnreadCount(prev => prev + 1);
        showToast(payload.new.message, 'info');
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id, selectedHousehold?.id, profile?.id, handleHouseholdSelect]);

  useEffect(() => {
    let result = [...expenses];
    if (searchQuery) result = result.filter(e => e.title?.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterStatus.length > 0) result = result.filter(e => filterStatus.includes(e.status));
    if (filterCategory.length > 0) result = result.filter(e => filterCategory.includes(e.category));
    if (filterFrom) result = result.filter(e => e.expense_date >= filterFrom);
    if (filterTo) result = result.filter(e => e.expense_date <= filterTo);
    setFilteredExpenses(result);
  }, [searchQuery, filterStatus, filterCategory, filterFrom, filterTo, expenses]);

  // Typing in Description picks a matching category — until the user chooses one by hand
  const handleTitleChange = (value) => {
    const hit = categoryTouched ? null : detectCategory(value);
    setExpenseForm(prev => ({ ...prev, title: value, ...(hit ? { category: hit.category } : {}) }));
    if (hit) {
      setCategoryAutoDetected(true);
      setOtherType(hit.category === 'Other' ? (hit.otherType || '') : '');
    }
  };

  const proceedAddExpense = async () => {
    // Single-member household: that member is the only participant
    const participants = isSolo ? householdMembers.map(m => m.user_id) : expenseForm.selected_members;
    const splitType = isSolo ? 'equal' : expenseForm.split_type;
    // "None" = nobody has paid yet
    const payerId = expenseForm.who_paid === 'none' ? null : expenseForm.who_paid;
    const splits = {};
    const totalAmount = Number(expenseForm.amount);
    if (splitType === 'equal') {
      const share = totalAmount / participants.length;
      participants.forEach(id => { splits[id] = share.toFixed(2); });
    } else {
      let customTotal = 0;
      participants.forEach(id => {
        const val = Number(expenseForm.custom_splits[id]) || 0;
        splits[id] = val.toFixed(2);
        customTotal += val;
      });
      if (Math.abs(customTotal - totalAmount) > 0.01) {
        showToast(`Custom split total (₱${customTotal.toFixed(2)}) does not equal total amount (₱${totalAmount.toFixed(2)})`, 'error');
        setLoading(false);
        return;
      }
    }

    const finalCategory = expenseForm.category === 'Other' && otherType.trim()
      ? otherType.trim()
      : expenseForm.category;

    const insertData = {
      household_id: selectedHousehold.id,
      created_by: currentUser.id,
      title: expenseForm.title.trim(),
      amount: totalAmount,
      category: finalCategory,
      expense_type: finalCategory,
      expense_date: getTodayStr(),              // auto: the day it was created (not editable)
      due_date: expenseForm.due_date || null,   // optional
      location: selectedHousehold.name,         // always the household whose tab is selected
      paid_by: payerId,
      split_type: splitType,
      members_split: splits,
      status: 'pending',
      approval_status: isAdmin ? 'approved' : 'pending_approval',
    };

    const { data: insertedExpense, error } = await supabase
      .from('expenses')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      showToast('Failed to add expense: ' + error.message, 'error');
      return;
    }

    // Deep-link: TopBar sends the user  current screen → /groups → /group-detail/<id>
    // and GroupDetailScreen highlights the expense (same as notifications made there).
    const notifLink = (linkQuery) => ({
      link_path: `/groups/${selectedHousehold.id}?type=household`,
      link_state: JSON.stringify({ type: 'household' }),
      link_query: linkQuery,
    });

    if (isAdmin) {
      // Owner-created expenses are approved right away, so create the split rows now
      // (same as GroupDetailScreen) and tell every member who owes a share.
      const splitRows = participants.map(uid => ({
        expense_id: insertedExpense.id,
        user_id: uid,
        share_amount: Number(splits[uid]),
        // Owner as payer = automatically paid. A member payer starts Unpaid and
        // must submit proof (which the owner then approves/rejects).
        status: (uid === expenseForm.who_paid && uid === selectedHousehold.created_by) ? 'approved' : 'unpaid',
        updated_at: new Date().toISOString(),
      }));
      // upsert (not insert): the DB trigger may already have created the rows
      const { error: splitError } = await supabase
        .from('expense_splits')
        .upsert(splitRows, { onConflict: 'expense_id,user_id' });
      if (splitError) console.error('Failed to create splits:', splitError);

      const dueText = expenseForm.due_date ? ` Due ${fmtDate(expenseForm.due_date)}.` : '';
      const notifRows = participants
        .filter(uid => uid !== currentUser.id)
        .map(uid => ({
          user_id: uid,
          title: 'New Expense Added',
          message: `${profile?.full_name} added "${insertedExpense.title}" for ₱${totalAmount.toFixed(2)}. Your share: ₱${Number(splits[uid]).toFixed(2)}.${dueText}${!payerId ? ' It is marked unpaid — please upload your proof of payment once you pay your share.' : ''}${uid === expenseForm.who_paid && uid !== selectedHousehold.created_by ? ' You are marked as the payer — please upload your proof of payment.' : ''}`,
          type: 'expense_added',
          ...notifLink(`expenseId=${insertedExpense.id}`),
        }));
      if (notifRows.length) {
        const { error: notifError } = await supabase.from('notifications').insert(notifRows);
        if (notifError) console.error('Failed to notify members:', notifError);
      }
    } else if (selectedHousehold?.created_by) {
      await supabase.from('notifications').insert({
        user_id: selectedHousehold.created_by,
        title: 'New Expense Pending Approval',
        message: `${profile?.full_name} submitted "${insertedExpense.title}" for ₱${totalAmount.toFixed(2)}. Tap to review.`,
        type: 'approval_request',
        ...notifLink(`expenseId=${insertedExpense.id}`),
      });
    }

    const memberPaidUpfront = !isAdmin && expenseForm.who_paid === currentUser.id;
    if (memberPaidUpfront) {
      setJustAddedExpense(insertedExpense);
      setProofForm({ note: '', screenshot: null, screenshotPreview: null });
      setShowUploadAfterAdd(true);
    } else {
      showToast(isAdmin ? 'Expense added! ✅' : 'Expense submitted for approval! ⏳');
    }
    setShowAddExpense(false);
    setExpenseForm({
      title: '',
      amount: '',
      category: 'Rent',
      expense_date: getTodayStr(),
      due_date: '',
      who_paid: isAdmin ? currentUser.id : '',
      split_type: 'equal',
      selected_members: [],
      custom_splits: {},
    });
    setOtherType('');
    setCategoryTouched(false);
    setCategoryAutoDetected(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  const handleAddExpense = async () => {
    const errors = {};
    if (!expenseForm.title.trim()) errors.title = 'Title is required';
    if (!expenseForm.amount || isNaN(expenseForm.amount)) errors.amount = 'Valid amount is required';
    if (expenseForm.due_date && expenseForm.due_date < getTodayStr()) errors.due_date = 'Due date cannot be in the past';
    if (!expenseForm.who_paid) errors.who_paid = 'Please select who paid';
    if (!isSolo && expenseForm.selected_members.length === 0) errors.members = 'Select at least one member to split with';

    if (Object.keys(errors).length > 0) {
      setExpenseErrors(errors);
      showToast(Object.values(errors)[0], 'error');
      return;
    }

    if (!selectedHousehold) {
      showToast('No household selected', 'error');
      return;
    }

    setLoading(true);

    if (isUtilityCategory(expenseForm.category)) {
      const dupes = await checkDuplicate(
        selectedHousehold.id,
        expenseForm.category,
        Number(expenseForm.amount),
        getTodayStr()
      );
      if (dupes.length > 0) {
        setDuplicateItem(dupes[0]);
        setShowDuplicateModal(true);
        setLoading(false);
        return;
      }
    }

    await proceedAddExpense();
    setLoading(false);
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
  };

  const handleApproveSplit = async (split) => {
    setLoading(true);
    const { error } = await supabase
      .from('expense_splits')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', split.id);
    if (!error) {
      await recalculateExpenseStatus(split.expense_id);
      showToast('Payment approved!');
      await handleHouseholdSelect(selectedHousehold, currentUser, profile);
    } else {
      showToast('Error approving payment', 'error');
    }
    setLoading(false);
  };

  const handleRejectSplit = async () => {
    if (!rejectReason.trim()) { showToast('Please provide a rejection reason.', 'error'); return; }
    setLoading(true);
    const { error } = await supabase
      .from('expense_splits')
      .update({ status: 'unpaid', rejection_reason: rejectReason, proof_id: null, updated_at: new Date().toISOString() })
      .eq('id', selectedSplit.id);
    if (!error) {
      if (selectedSplit.proof_id) {
        await supabase
          .from('payment_proofs')
          .update({ status: 'rejected', rejection_reason: rejectReason })
          .eq('id', selectedSplit.proof_id);
      }
      await recalculateExpenseStatus(selectedSplit.expense_id);
      showToast('Payment rejected.');
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedSplit(null);
      await handleHouseholdSelect(selectedHousehold, currentUser, profile);
    } else {
      showToast('Error rejecting payment', 'error');
    }
    setLoading(false);
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
      await submitFollowupProof({
        expense: followupFor.expense, split: followupFor.split, user: currentUser,
        userName: profile?.full_name || 'A member', adminId: selectedHousehold?.created_by,
        file, note, linkFor: flowLink,
      });
      showToast('Follow-up proof submitted! ⏳');
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
      showToast(approve ? 'Follow-up payment approved! ✅' : 'Follow-up payment rejected.');
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
      await sendRefund({ expense: refundFor.expense, split: refundFor.split, amount, file, note, actor: flowActor(), linkFor: flowLink });
      showToast('Refund sent and member notified! 💸');
      setRefundFor(null);
      await reloadAll();
    } catch (err) {
      showToast(err.message || 'Could not send refund', 'error');
    }
    setXmLoading(false);
  };

  const handleConfirmRefund = async (refund) => {
    setXmLoading(true);
    try {
      await confirmRefund({
        refund, expense: proofsFor?.expense, user: currentUser,
        userName: profile?.full_name || 'A member', adminId: selectedHousehold?.created_by, linkFor: flowLink,
      });
      showToast('Thanks — refund confirmed ✅');
      setProofsFor(null);
      await reloadAll();
    } catch (err) {
      showToast(err.message || 'Could not confirm refund', 'error');
    }
    setXmLoading(false);
  };

  // original proof for a member's split (for the history modal)
  const originalProofFor = (split) =>
    allProofs.find(p => p.id === split.proof_id)
    || [...allProofs].reverse().find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);

  const handleSubmitProof = async () => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot.', 'error'); return; }
    setLoading(true);
    const fileExt = proofForm.screenshot.name.split('.').pop();
    const fileName = `${currentUser.id}-${selectedExpense.id}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(fileName, proofForm.screenshot, { upsert: true });
    if (uploadError) { showToast('Failed to upload screenshot.', 'error'); setLoading(false); return; }
    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
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
        link_path: `/groups/${selectedHousehold.id}?type=household`,
        link_state: JSON.stringify({ type: 'household' }),
        link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}`,
      });
    }
    setShowPaymentProofModal(false);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
    setSelectedExpense(null);
    showToast('Payment proof submitted! ⏳');
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
    setLoading(true);
    const fileExt = proofForm.screenshot.name.split('.').pop();
    const fileName = `${currentUser.id}-${justAddedExpense.id}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(fileName, proofForm.screenshot, { upsert: true });
    if (uploadError) { showToast('Upload failed', 'error'); setLoading(false); return; }
    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);
    const { error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: justAddedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note || '',
      status: 'pending_verification',
    });
    if (proofError) { showToast('Failed to save proof', 'error'); setLoading(false); return; }
    closeUploadAfterAdd();
    showToast('Expense submitted with proof! ⏳');
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  const handleSkipProofAfterAdd = async () => {
    closeUploadAfterAdd();
    showToast('Submitted for approval — upload your proof after the owner approves');
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
  };

  // Owner submits their own proof: verified immediately (the owner is the approver).
  const handleOwnerSubmitProof = async () => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot.', 'error'); return; }
    setLoading(true);
    const fileExt = proofForm.screenshot.name.split('.').pop();
    const fileName = `${currentUser.id}-${selectedExpense.id}-owner-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(fileName, proofForm.screenshot, { upsert: true });
    if (uploadError) { showToast('Upload failed', 'error'); setLoading(false); return; }
    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note,
      status: 'verified',
    }).select().single();
    if (proofError) { showToast('Failed to save proof', 'error'); setLoading(false); return; }

    await supabase
      .from('expense_splits')
      .update({ status: 'approved', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
      .eq('expense_id', selectedExpense.id)
      .eq('user_id', currentUser.id);

    await recalculateExpenseStatus(selectedExpense.id);

    const { data: allSplits } = await supabase.from('expense_splits').select('user_id').eq('expense_id', selectedExpense.id);
    const others = (allSplits || []).filter(sp => sp.user_id !== currentUser.id);
    if (others.length) {
      await supabase.from('notifications').insert(others.map(sp => ({
        user_id: sp.user_id,
        title: 'Payment Confirmed by Owner',
        message: `The owner has confirmed payment for "${selectedExpense.title}". Tap to view proof.`,
        type: 'payment_confirmed',
        link_path: `/groups/${selectedHousehold.id}?type=household`,
        link_state: JSON.stringify({ type: 'household' }),
        link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}`,
      })));
    }

    setShowOwnerProofModal(false);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
    setSelectedExpense(null);
    showToast('Payment confirmed and proof saved! ✅');
    setLoading(false);
    await handleHouseholdSelect(selectedHousehold, currentUser, profile);
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
    showToast('Payment confirmed! ✅');
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
      link_path: `/groups/${selectedHousehold.id}?type=household`,
      link_state: JSON.stringify({ type: 'household' }),
      link_query: `openProof=${selectedProof.expense_id}&proofId=${selectedProof.id}`,
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
      <div className="expenses-sticky-header">
        {households.length > 0 && (
          <>
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
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
                    onClick={() => setHouseholdSearch('')}
                  >
                    <X size={12} color="#9E8FCC" />
                  </button>
                )}
              </div>
            </div>
            <div className="hh-toggle-row">
              {households
                .filter(hh => householdSearch === '' || hh.name.toLowerCase().includes(householdSearch.toLowerCase()))
                .map(hh => (
                  <button
                    key={hh.id}
                    className={`hh-toggle-pill${selectedHousehold?.id === hh.id ? ' active' : ''}`}
                    onClick={() => handleHouseholdSelect(hh, currentUser, profile)}
                  >
                    🏠 {hh.name}
                    {selectedHousehold?.id === hh.id && <span className="hh-pill-dot" />}
                  </button>
                ))}
              {householdSearch !== '' &&
                households.filter(hh => hh.name.toLowerCase().includes(householdSearch.toLowerCase())).length === 0 && (
                  <p style={{ fontSize: 12, color: '#9E8FCC', padding: '8px 4px' }}>No household found</p>
                )}
            </div>
          </>
        )}

        <div className="stat-cards-row">
          <div className="stat-card stat-card--indigo">
            <div className="stat-card-top">
              <span className="stat-card-emoji">💸</span>
              <span className="stat-card-label">Total Shared</span>
            </div>
            <p className="stat-card-amount">₱{totalShared.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="stat-card-sub">this month · {selectedHousehold?.name || '—'}</p>
          </div>

          <div className="stat-card stat-card--amber">
            <div className="stat-card-top">
              <span className="stat-card-emoji">🔁</span>
              <span className="stat-card-label">To Reimburse</span>
            </div>
            <p className="stat-card-amount">₱{toReimburse.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="stat-card-sub">
              {reimburseDetails.length > 0
                ? reimburseDetails.map((r, i) => (
                  <span key={i} className="stat-reimburse-line">
                    Owe ₱{Number(r.amount).toFixed(2)}{r.payer?.full_name ? ` → ${r.payer.full_name}` : ' · unpaid'}
                  </span>
                ))
                : 'Nothing to pay 🎉'}
            </p>
          </div>

          <div className="stat-card stat-card--emerald">
            <div className="stat-card-top">
              <span className="stat-card-emoji">🏦</span>
              <span className="stat-card-label">Total Saved</span>
            </div>
            <p className="stat-card-amount">₱{totalSaved.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="stat-card-sub">vs paying alone</p>
          </div>
        </div>

        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon" />
            <input type="text" placeholder="Search expenses" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}><Filter size={14} /> Filter</button>
        </div>
      </div>

      {/* ── Scrollable expense list ── */}
      <div className="expenses-content">
        {isAdmin && pendingApprovals.length > 0 && (
          <div className="pending-section">
            <p className="pending-section-title">⏳ Pending Payment Approvals ({pendingApprovals.length})</p>
            {pendingApprovals.map(split => {
              const expense = expenses.find(e => e.id === split.expense_id);
              const proof = pendingPaymentProofs.find(p => p.id === split.proof_id);
              const pendingFollowup = (extras.followups[split.expense_id] || []).find(f => f.user_id === split.user_id && f.status === 'pending_verification');
              if (pendingFollowup) {
                return (
                  <div key={split.id} className="pending-item">
                    <div className="pending-info">
                      <p className="pending-name">{expense?.title} – {split.profiles?.full_name}</p>
                      <p className="pending-amount">Follow-up ₱{Number(pendingFollowup.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="pending-actions">
                      <button className="view-proof-btn" onClick={() => expense && setProofsFor({ expense, split })}>Review</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={split.id} className="pending-item">
                  <div className="pending-info">
                    <p className="pending-name">{expense?.title} – {split.profiles?.full_name}</p>
                    <p className="pending-amount">₱{Number(split.share_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="pending-actions">
                    <button className="approve-btn" onClick={() => handleApproveSplit(split)}><Check size={14} /> Approve</button>
                    <button className="reject-btn" onClick={() => { setSelectedSplit(split); setShowRejectModal(true); }}><X size={14} /> Reject</button>
                    {proof && <button className="view-proof-btn" onClick={() => { setSelectedProof(proof); setSelectedSplit(split); setShowViewProofModal(true); }}>View Proof</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredExpenses.length === 0 && (
          <div className="expenses-empty">
            <span className="expenses-empty-icon">🧾</span>
            <p className="expenses-empty-title">No expenses yet</p>
            <p className="expenses-empty-sub">Tap + to add your first expense for {selectedHousehold?.name || 'this household'}.</p>
          </div>
        )}

        {filteredExpenses.map(expense => {
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
          const isOwed = !isAdmin && isApprovedExpense && mySplit && mySplit.status === 'unpaid' && expense.status !== 'paid';
          // Owner can attach proof until their own split has a proof saved (same as GroupDetailScreen)
          const ownerCanSubmitProof = isAdmin && isApprovedExpense && mySplit && !(mySplit.status === 'approved' && mySplit.proof_id) && expense.status !== 'paid';
          return (
            <div key={expense.id} className={`expense-item ${expense.approval_status === 'pending_approval' ? 'needs-approval' : ''}`} style={{ borderLeftColor: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}>
              <div className="expense-icon-circle" style={{ background: `${CATEGORY_COLORS[expense.category]}22` || '#F0EDFF' }}>
                <span style={{ fontSize: 20 }}>{CATEGORY_ICONS[expense.category] || '📦'}</span>
              </div>
              <div className="expense-body">
                <div className="expense-title-row">
                  <p className="expense-name">{expense.title}</p>
                  <p className="expense-amount">₱{Number(expense.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <p className="expense-meta">{expense.expense_date} · {selectedHousehold?.name || expense.location || ''}{expense.due_date ? ` · Due ${fmtDate(expense.due_date)}` : ''}</p>
                <div className="expense-footer-row">
                  <div className="expense-members">
                    {expenseMembers.slice(0, 3).map((m, i) => (
                      <div key={i} className="member-avatar-wrap">{getMemberAvatar(m)}</div>
                    ))}
                    {expenseMembers.length > 3 && <div className="member-avatar-more">+{expenseMembers.length - 3}</div>}
                  </div>
                  <span className="status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                </div>
                {expense.approval_status === 'rejected' && <p className="rejection-reason">Reason: {expense.rejection_reason}</p>}
                {isOwed && (
                  <div className="reimburse-row">
                    <span className="owe-text">
                      {iAmPayer ? 'You paid this bill — upload your proof' : `You owe ₱${Number(mySplit.share_amount).toFixed(2)}`}
                    </span>
                    <button className="pay-btn" onClick={() => { setSelectedExpense(expense); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); setShowPaymentProofModal(true); }}>
                      {iAmPayer ? 'Submit Proof' : 'Pay'}
                    </button>
                  </div>
                )}
                {ownerCanSubmitProof && (
                  <div className="reimburse-row">
                    <button className="pay-btn" onClick={() => { setSelectedExpense(expense); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); setShowOwnerProofModal(true); }}>
                      Submit Payment Proof (as Owner)
                    </button>
                  </div>
                )}
                {mySplit?.status === 'pending_verification' && (
                  <div className="reimburse-row">
                    <span className="owe-text">⏳ Proof submitted, awaiting approval</span>
                  </div>
                )}
                {/* Follow-up / overpaid / history rows (admin sees every member, a member sees only themselves) */}
                {splits
                  .filter(sp => (isAdmin || sp.user_id === currentUser?.id) && sp.user_id !== expense.paid_by && (
                    sp.status === 'partly_paid' || overpaidOf(sp) > 0
                    || (extras.followups[expense.id] || []).some(f => f.user_id === sp.user_id)
                    || (extras.refunds[expense.id] || []).some(r => r.user_id === sp.user_id)))
                  .map(sp => {
                    const mine = sp.user_id === currentUser?.id;
                    const due = followupDueOf(sp);
                    const over = overpaidOf(sp);
                    const unconfirmed = (extras.refunds[expense.id] || []).some(r => r.user_id === sp.user_id && r.status === 'sent');
                    return (
                      <div key={sp.id} className="xm-pay-line">
                        <div className="xm-pay-line-top">
                          <p className="xm-pay-line-name">{mine ? 'You' : sp.profiles?.full_name}</p>
                          <span className="xm-pay-line-text">Paid ₱{toNum(sp.paid_amount).toFixed(2)} of ₱{toNum(sp.share_amount).toFixed(2)}</span>
                        </div>
                        {due > 0 && <p className="xm-pay-line-text" style={{ color: '#c05621', fontWeight: 600 }}>{mine ? `Follow-up payment due: ₱${due.toFixed(2)}` : `Needs to pay ₱${due.toFixed(2)} more`}</p>}
                        {over > 0 && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}>{mine ? `You overpaid ₱${over.toFixed(2)} — the admin will refund you` : `Overpaid ₱${over.toFixed(2)} — refund needed`}</p>}
                        {mine && unconfirmed && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}>💸 A refund was sent — please confirm once received</p>}
                        <div className="xm-pay-line-actions">
                          {mine && due > 0 && (
                            <button className="xm-btn-sm" onClick={() => setFollowupFor({ expense, split: sp })}>Follow-up Payment</button>
                          )}
                          {isAdmin && over > 0 && (
                            <button className="xm-btn-sm" onClick={() => setRefundFor({ expense, split: sp })}>Refund ₱{over.toFixed(2)}</button>
                          )}
                          <button className="xm-btn-sm xm-soft" onClick={() => setProofsFor({ expense, split: sp })}>
                            <Eye size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{unconfirmed && mine ? 'Confirm refund' : 'Proofs'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
              {isAdmin && (
                <div className="expense-admin-col">
                  <button className="icon-btn" onClick={() => setEditExpense(expense)} title="Edit expense" style={{ color: '#3B2AAB' }}><Pencil size={14} /></button>
                  <button className="icon-btn delete" onClick={() => { setSelectedExpense(expense); setShowDeleteModal(true); }}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button className="fab-btn" onClick={() => setShowAddExpense(true)}><Plus size={24} /></button>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="modal-overlay">
          <div className="add-expense-modal">
            <div className="modal-header">
              <h2>Add Expense · {selectedHousehold?.name}</h2>
              <button className="modal-close" onClick={() => { setShowAddExpense(false); setOtherType(''); setCategoryTouched(false); setCategoryAutoDetected(false); setExpenseForm({
                title: '',
                amount: '',
                category: 'Rent',
                expense_date: getTodayStr(),
    due_date: '',
                who_paid: isAdmin ? currentUser?.id : '',
                split_type: 'equal',
                selected_members: [],
                custom_splits: {},
              }); }}><X size={18} /></button>
            </div>
            <div className="modal-scroll">
              <div className="form-group">
                <label>Description *</label>
                <input type="text" placeholder="e.g. Electricity bill" value={expenseForm.title} onChange={e => handleTitleChange(e.target.value)} className={expenseErrors.title ? 'input-error' : ''} />
                {expenseErrors.title && <span className="form-error">{expenseErrors.title}</span>}
              </div>
              <div className="form-group">
                <label>Amount *</label>
                <div className="amount-input-wrap">
                  <span className="peso-sign">₱</span>
                  <input type="number" placeholder="0.00" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                </div>
                {expenseErrors.amount && <span className="form-error">{expenseErrors.amount}</span>}
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={getTodayStr()} readOnly disabled className="input-readonly" />
                <span className="form-hint">Set automatically to today</span>
              </div>
              <div className="form-group">
                <label>Due Date (optional)</label>
                <input type="date" value={expenseForm.due_date} min={getTodayStr()} onChange={e => setExpenseForm({ ...expenseForm, due_date: e.target.value })} className={expenseErrors.due_date ? 'input-error' : ''} />
                {expenseErrors.due_date && <span className="form-error">{expenseErrors.due_date}</span>}
                {expenseForm.due_date && (() => {
                  const preview = getReminderPreview(expenseForm.due_date, getMyReminderDays(profile));
                  return (
                    <span className="form-hint">
                      {preview.length
                        ? `🔔 You'll be reminded on ${preview.join(', ')} (from your Settings). Each member is reminded based on their own Settings.`
                        : '🔔 None of your reminder days fall before this due date. Other members are reminded based on their own Settings.'}
                    </span>
                  );
                })()}
              </div>
              <div className="form-group">
                <label>Category</label>
                <div className="select-wrap">
                  <select
                    value={expenseForm.category}
                    onChange={e => {
                      setExpenseForm({ ...expenseForm, category: e.target.value });
                      setCategoryTouched(true);
                      setCategoryAutoDetected(false);
                      if (e.target.value !== 'Other') setOtherType('');
                    }}
                  >
                    {ALL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} className="select-arrow" />
                </div>
                {categoryAutoDetected && !categoryTouched && (
                  <span className="form-hint">✨ Picked from your description — change it anytime.</span>
                )}
                {expenseForm.category === 'Other' && (
                  <input
                    type="text"
                    placeholder="Specify type (e.g. Pet supplies, Haircut)"
                    value={otherType}
                    onChange={e => { setOtherType(e.target.value); setCategoryTouched(true); setCategoryAutoDetected(false); }}
                    style={{ marginTop: 8 }}
                  />
                )}
              </div>

              {/* Subscription preset picker */}
              {expenseForm.category === 'Subscription' && (
                <div className="form-group">
                  <label>Quick Select</label>
                  <div className="subscription-presets-wrap">
                    {SUBSCRIPTION_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        type="button"
                        className={`subscription-preset-btn ${expenseForm.title === preset.name ? 'active' : ''}`}
                        onClick={() => setExpenseForm({
                          ...expenseForm,
                          title: preset.name,
                          amount: String(preset.suggestedAmount),
                        })}
                      >
                        <span className="preset-icon">{preset.icon}</span>
                        <span className="preset-name">{preset.name}</span>
                        <span className="preset-amount">₱{preset.suggestedAmount}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="form-group">
                <label>Who Paid *</label>
                <div className="select-wrap">
                  <select value={expenseForm.who_paid} onChange={e => setExpenseForm({ ...expenseForm, who_paid: e.target.value })} className={expenseErrors.who_paid ? 'input-error' : ''}>
                    <option value="">Select member</option>
                    {householdMembers.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
                    <option value="none">None — nobody has paid yet</option>
                  </select>
                  <ChevronDown size={14} className="select-arrow" />
                </div>
                {expenseErrors.who_paid && <span className="form-error">{expenseErrors.who_paid}</span>}
              </div>
              {!isSolo && (<>
              <div className="form-group">
                <label>Split With *</label>
                <div className="members-select">
                  {householdMembers.map(m => (
                    <label key={m.user_id} className="member-checkbox">
                      <input type="checkbox" checked={expenseForm.selected_members.includes(m.user_id)} onChange={e => {
                        if (e.target.checked) setExpenseForm({ ...expenseForm, selected_members: [...expenseForm.selected_members, m.user_id] });
                        else setExpenseForm({ ...expenseForm, selected_members: expenseForm.selected_members.filter(id => id !== m.user_id) });
                      }} /> {m.profiles?.full_name}
                    </label>
                  ))}
                </div>
                {expenseErrors.members && <span className="form-error">{expenseErrors.members}</span>}
              </div>
              <div className="form-group">
                <label>Split Method</label>
                <div className="split-toggle">
                  <button type="button" className={`split-btn ${expenseForm.split_type === 'equal' ? 'active' : ''}`} onClick={() => setExpenseForm({ ...expenseForm, split_type: 'equal' })}>Equal</button>
                  <button type="button" className={`split-btn ${expenseForm.split_type === 'custom' ? 'active' : ''}`} onClick={() => setExpenseForm({ ...expenseForm, split_type: 'custom' })}>Custom</button>
                </div>
              </div>
              </>)}
              {!isSolo && expenseForm.split_type === 'custom' && (
                <div className="form-group">
                  <label>Custom Amounts</label>
                  {(() => {
                    const totalAmt = Number(expenseForm.amount) || 0;
                    return expenseForm.selected_members.map((uid, i) => {
                      const member = householdMembers.find(m => m.user_id === uid);
                      const prevTotal = expenseForm.selected_members.slice(0, i).reduce((sum, pid) => sum + (Number(expenseForm.custom_splits[pid]) || 0), 0);
                      const thisRemaining = totalAmt - prevTotal;
                      const hasEntered = Number(expenseForm.custom_splits[uid]) > 0;
                      const afterThis = thisRemaining - (Number(expenseForm.custom_splits[uid]) || 0);
                      return (
                        <div key={uid} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#2D1A7A' }}>{member?.profiles?.full_name}</span>
                            {totalAmt > 0 && (
                              <span style={{ fontSize: 10, color: '#9E8FCC' }}>
                                {hasEntered
                                  ? `₱${afterThis.toFixed(2)} left after this`
                                  : `₱${thisRemaining.toFixed(2)} still needs to be split`}
                              </span>
                            )}
                          </div>
                          <div className="custom-split-row">
                            <div className="amount-input-wrap small">
                              <span className="peso-sign">₱</span>
                              <input type="number" placeholder="0.00" value={expenseForm.custom_splits[uid] || ''} onChange={e => setExpenseForm({ ...expenseForm, custom_splits: { ...expenseForm.custom_splits, [uid]: e.target.value } })} />
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  {(() => {
                    const totalAmt = Number(expenseForm.amount) || 0;
                    const customTotal = expenseForm.selected_members.reduce((sum, uid) => sum + (Number(expenseForm.custom_splits[uid]) || 0), 0);
                    const rem = totalAmt - customTotal;
                    if (totalAmt <= 0) return null;
                    return (
                      <div style={{
                        padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                        background: Math.abs(rem) < 0.01 ? '#D1FAE5' : '#FEE2E2',
                        color: Math.abs(rem) < 0.01 ? '#065F46' : '#e53e3e'
                      }}>
                        {Math.abs(rem) < 0.01 ? '✅ Split total matches!' : `₱${Math.abs(rem).toFixed(2)} ${rem > 0 ? 'still unassigned' : 'over budget'}`}
                      </div>
                    );
                  })()}
                </div>
              )}
              <button type="button" className="add-expense-btn" onClick={handleAddExpense} disabled={loading}>
                {loading ? 'Adding…' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilter && (
        <div className="modal-overlay">
          <div className="filter-modal">
            <div className="modal-header"><h2>Filter</h2><button className="modal-close" onClick={() => setShowFilter(false)}><X size={18} /></button></div>
            <div className="form-group"><label>Status</label><div className="checkbox-group">{['paid', 'pending', 'verifying'].map(s => (<label key={s} className="checkbox-label"><input type="checkbox" checked={filterStatus.includes(s)} onChange={e => { if (e.target.checked) setFilterStatus([...filterStatus, s]); else setFilterStatus(filterStatus.filter(x => x !== s)); }} />{s.charAt(0).toUpperCase() + s.slice(1)}</label>))}</div></div>
            <div className="form-group"><label>Category</label><div className="checkbox-group">{Object.keys(CATEGORY_ICONS).map(c => (<label key={c} className="checkbox-label"><input type="checkbox" checked={filterCategory.includes(c)} onChange={e => { if (e.target.checked) setFilterCategory([...filterCategory, c]); else setFilterCategory(filterCategory.filter(x => x !== c)); }} />{c}</label>))}</div></div>
            <div className="form-group"><label>Date Range</label><div className="date-range-row"><input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} /><span>to</span><input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} /></div></div>
            <div className="filter-actions"><button className="filter-reset-btn" onClick={() => { setFilterStatus([]); setFilterCategory([]); setFilterFrom(''); setFilterTo(''); setShowFilter(false); }}>Reset</button><button className="filter-apply-btn" onClick={() => setShowFilter(false)}>Apply</button></div>
          </div>
        </div>
      )}

      {/* Reject Split Modal */}
      {showRejectModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Reject Payment</h2>
            <textarea placeholder="Reason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="reject-textarea" />
            <button className="add-expense-btn" onClick={handleRejectSplit}>Confirm</button>
            <button className="edit-cancel-btn" onClick={() => { setShowRejectModal(false); setRejectReason(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Delete Expense Modal */}
      {/* Delete Expense (shows what is being deleted; blocked until paid members are refunded) */}
      {showDeleteModal && selectedExpense && (
        <DeleteExpenseModal
          expense={selectedExpense}
          splits={expenseSplits[selectedExpense.id] || []}
          icon={CATEGORY_ICONS[selectedExpense.category] || '📦'}
          color={CATEGORY_COLORS[selectedExpense.category] || '#3B2AAB'}
          loading={xmLoading}
          onConfirm={handleDeleteExpense}
          onClose={() => { setShowDeleteModal(false); setSelectedExpense(null); }}
          onRefund={(split) => { setShowDeleteModal(false); setRefundFor({ expense: selectedExpense, split }); }}
        />
      )}

      {/* Upload proof right after a member who paid upfront adds an expense */}
      {showUploadAfterAdd && justAddedExpense && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Upload Payment Proof</h2>
            <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
              You marked yourself as the payer for "<strong>{justAddedExpense.title}</strong>". Upload a screenshot of your payment now, or do it after the owner approves.
            </p>
            {proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />}
            <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}>
              <Camera size={16} /> {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
            </button>
            <button className="add-expense-btn" onClick={handleUploadProofAfterAdd} disabled={!proofForm.screenshot || loading}>
              {loading ? 'Submitting…' : 'Submit Expense + Proof'}
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
              <button className="pom-trigger-btn" onClick={() => { setShowPaymentProofModal(false); setShowPayOnlineModal(true); }}>💳 Pay Online</button>
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
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Payment Proof</h2>
            <img src={selectedProof.screenshot_url} className="proof-preview" alt="proof" />
            <p className="proof-note">{selectedProof.note}</p>
            <button className="add-expense-btn" onClick={() => handleConfirmPayment(selectedProof, selectedSplit)}>Confirm Payment</button>
            <button className="delete-confirm-btn" onClick={() => { setShowViewProofModal(false); setShowRejectProofModal(true); }}>Reject Proof</button>
            <button className="edit-cancel-btn" onClick={() => setShowViewProofModal(false)}>Cancel</button>
          </div>
        </div>
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

      {/* Duplicate Detection Modal */}
      {showDuplicateModal && duplicateItem && (
        <div className="modal-overlay">
          <div className="small-modal">
            <p style={{ fontSize: 32 }}>⚠️</p>
            <h2>Possible Duplicate!</h2>
            <p className="modal-subtitle">
              We found a similar entry:{'\n'}
              "{duplicateItem.title || duplicateItem.provider_name}: 
              ₱{Number(duplicateItem.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })} | 
              {duplicateItem.expense_date || duplicateItem.billing_date}"
            </p>
            <p className="modal-subtitle">
              Would you like to merge this with the existing entry?
            </p>
            <button
              className="add-expense-btn"
              onClick={async () => {
                if (duplicateItem.source === 'utilities') {
                  await mergeItems(duplicateItem.id, duplicateItem.id);
                }
                setShowDuplicateModal(false);
                showToast('Items merged! ✅');
                await handleHouseholdSelect(selectedHousehold, currentUser, profile);
              }}
            >
              Yes, Merge
            </button>
            <button
              className="edit-cancel-btn"
              onClick={async () => {
                setShowDuplicateModal(false);
                setLoading(true);
                await proceedAddExpense();
                setLoading(false);
              }}
            >
              No, Keep Separate
            </button>
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
          loading={xmLoading}
          onSubmit={handleSendRefund}
          onClose={() => setRefundFor(null)}
        />
      )}

      {/* Payment history: original proof, follow-ups, refunds */}
      {proofsFor && (
        <ExpenseProofsModal
          expense={proofsFor.expense}
          split={(expenseSplits[proofsFor.expense.id] || []).find(x => x.id === proofsFor.split.id) || proofsFor.split}
          originalProof={originalProofFor(proofsFor.split)}
          followups={(extras.followups[proofsFor.expense.id] || []).filter(f => f.user_id === proofsFor.split.user_id)}
          refunds={(extras.refunds[proofsFor.expense.id] || []).filter(r => r.user_id === proofsFor.split.user_id)}
          isAdmin={isAdmin}
          currentUserId={currentUser?.id}
          loading={xmLoading}
          onReviewFollowup={handleReviewFollowup}
          onConfirmRefund={handleConfirmRefund}
          onRefund={isAdmin && overpaidOf(proofsFor.split) > 0 ? () => { setRefundFor(proofsFor); setProofsFor(null); } : undefined}
          onClose={() => setProofsFor(null)}
        />
      )}

      <BottomNav active="expenses" pendingCount={isAdmin ? pendingApprovals.length : 0} />
    </div>
  );
}