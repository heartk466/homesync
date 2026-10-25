import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  ArrowLeft, Users, Plus, Check, X, Camera,
  Copy, Share2, AlertCircle, Trash2, Eye, EyeOff, Lock, MoreVertical, RefreshCw, Pencil, ChevronDown
} from 'lucide-react';
import './GroupDetailScreen.css';
import { SUBSCRIPTION_PRESETS } from '../utils/expenseUtils';
import PayOnlineModal from '../components/PayOnlineModal';
import EditExpenseModal from '../components/EditExpenseModal';
import DeleteExpenseModal from '../components/DeleteExpenseModal';
import ReviewExpenseModal from '../components/ReviewExpenseModal';
import DatePickerField from '../components/DatePickerField';
import FollowupPaymentModal from '../components/FollowupPaymentModal';
import RefundModal from '../components/RefundModal';
import ExpenseProofsModal from '../components/ExpenseProofsModal';
import {
  fetchExpenseExtras, softDeleteExpense, submitFollowupProof, reviewFollowupProof,
  sendRefund, confirmRefund, followupDueOf, overpaidOf, splitStatusMeta,
  num as toNum,
} from '../utils/expenseEditUtils';
import { openPaymentApp } from '../utils/paymentUtils';
import { detectCategory } from '../utils/categoryDetection';

const ALL_EXPENSE_CATEGORIES = [
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

export default function GroupDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const contextType = location.state?.type || new URLSearchParams(location.search).get('type') || 'group';

  const searchParams = new URLSearchParams(location.search);
  const openProofId = searchParams.get('proofId');
  const highlightExpenseId = searchParams.get('expenseId');

  const proofInputRef = useRef(null);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [expenseSplits, setExpenseSplits] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectProofModal, setShowRejectProofModal] = useState(false);
  const [showDeleteGroupModal, setShowDeleteGroupModal] = useState(false);
  const [showKickMemberModal, setShowKickMemberModal] = useState(false);
  const [showOwnerProofModal, setShowOwnerProofModal] = useState(false);
  const [showResubmitModal, setShowResubmitModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedSplit, setSelectedSplit] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [allPaymentProofs, setAllPaymentProofs] = useState([]);
  const [selectedProof, setSelectedProof] = useState(null);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState(null);
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [toast, setToast] = useState(null);
  const [pendingExpenseApprovals, setPendingExpenseApprovals] = useState([]);
  const [showRejectExpenseModal, setShowRejectExpenseModal] = useState(false);
  const [rejectExpenseReason, setRejectExpenseReason] = useState('');
  const [selectedPendingExpense, setSelectedPendingExpense] = useState(null);
  const [reviewExpense, setReviewExpense] = useState(null); // pending expense being reviewed by the admin
  const [showUploadAfterAdd, setShowUploadAfterAdd] = useState(false);
  const [justAddedExpense, setJustAddedExpense] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [showPaymentCard, setShowPaymentCard] = useState(false);
  const [paymentCardMember, setPaymentCardMember] = useState(null);
  const [showPayOnlineModal, setShowPayOnlineModal] = useState(false);
  const [payOnlineOrigin, setPayOnlineOrigin] = useState(null); // 'proof' | 'resubmit'

  const openPayOnline = (origin) => {
    setPayOnlineOrigin(origin);
    if (origin === 'proof') setShowPaymentProofModal(false);
    if (origin === 'resubmit') setShowResubmitModal(false);
    setShowPayOnlineModal(true);
  };

  const handlePayOnlineProceed = () => {
    setShowPayOnlineModal(false);
    if (payOnlineOrigin === 'proof') setShowPaymentProofModal(true);
    if (payOnlineOrigin === 'resubmit') setShowResubmitModal(true);
  };

  // Edit / follow-up / refund / proofs (shared modals)
  const [editExpense, setEditExpense] = useState(null);
  const [extras, setExtras] = useState({ followups: {}, refunds: {} });
  const [followupFor, setFollowupFor] = useState(null);   // { expense, split }
  const [showFollowupPayOnline, setShowFollowupPayOnline] = useState(false);
  const [refundFor, setRefundFor] = useState(null);       // { expense, split }
  const [proofsFor, setProofsFor] = useState(null);       // { expense, split }
  const [xmLoading, setXmLoading] = useState(false);

  const [expenseForm, setExpenseForm] = useState({
    title: '', amount: '', category: 'Food',
    expense_date: getTodayStr(),
    due_date: '',
    location: '', who_paid: '', split_type: 'equal',
    selected_members: [], custom_splits: {}
  });
  const [expenseErrors, setExpenseErrors] = useState({});
  const [otherType, setOtherType] = useState('');
  // Category auto-detect: stops overriding once the user picks a category themselves
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [categoryAutoDetected, setCategoryAutoDetected] = useState(false);

  // Rename household / group
  const [renameStep, setRenameStep] = useState(null); // null | 'edit' | 'confirm'
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [nameRequests, setNameRequests] = useState([]);

  // Nobody to split with when the household/group has a single member
  const isSolo = members.length <= 1;
  const contextLabel = contextType === 'household' ? 'household' : 'group';
  const myPendingNameRequest = !isAdmin
    ? nameRequests.find(r => r.requested_by === currentUser?.id)
    : null;

  // Header actions dropdown (copy / share / delete)
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Delete confirmation: password for email accounts, typing the name for
  // accounts that sign in with Google etc. (they have no password to check)
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteTypedName, setDeleteTypedName] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const authProviders = currentUser?.app_metadata?.providers
    || (currentUser?.app_metadata?.provider ? [currentUser.app_metadata.provider] : []);
  const canUsePassword = authProviders.includes('email') && !!currentUser?.email;

  const [proofForm, setProofForm] = useState({
    note: '', screenshot: null, screenshotPreview: null
  });

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
    if (error) {
      console.error(error);
      return {};
    }
    const grouped = {};
    data.forEach(split => {
      if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
      grouped[split.expense_id].push(split);
    });
    return grouped;
  }, []);

  const fetchGroupAndData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      let groupData;
      if (contextType === 'household') {
        const { data, error } = await supabase
          .from('households')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        groupData = data;
      } else {
        const { data, error } = await supabase
          .from('groups')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        groupData = data;
      }
      setGroup(groupData);

      let membersData = [];
      if (contextType === 'household') {
        const { data, error } = await supabase
          .from('household_members')
          .select('user_id, role, status')
          .eq('household_id', id)
          .eq('status', 'active');
        if (error) throw error;
        membersData = data || [];
      } else {
        const { data, error } = await supabase
          .from('group_members')
          .select('user_id, role, status')
          .eq('group_id', id)
          .eq('status', 'active');
        if (error) throw error;
        membersData = data || [];
      }

      const userIds = membersData.map(m => m.user_id);
      let profilesMap = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, gcash_number, bank_name, bank_account_number, bank_account_name')
          .in('id', userIds);
        profilesMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
      }

      const membersList = membersData.map(m => ({
        user_id: m.user_id,
        role: m.role,
        profiles: profilesMap[m.user_id] || { full_name: 'Unknown', email: '' }
      }));
      setMembers(membersList);

      const userMember = membersList.find(m => m.user_id === user.id);
      const adminStatus = userMember?.role === 'owner' || groupData.created_by === user.id;
      setIsAdmin(adminStatus);

      const expenseColumn = contextType === 'household' ? 'household_id' : 'group_id';
      const { data: expensesData, error: expError } = await supabase
        .from('expenses')
        .select('*')
        .eq(expenseColumn, id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (expError) throw expError;
      const allExpenses = expensesData || [];
      setExpenses(allExpenses.filter(e => e.approval_status === 'approved'));

      if (adminStatus) {
        const { data: pendingExp } = await supabase
          .from('expenses')
          .select('*')
          .eq(contextType === 'household' ? 'household_id' : 'group_id', id)
          .is('deleted_at', null)
          .eq('approval_status', 'pending_approval');

        if (pendingExp && pendingExp.length > 0) {
          const enriched = pendingExp.map(exp => ({
            ...exp,
            profiles: profilesMap[exp.created_by] || { full_name: 'Unknown', avatar_url: null }
          }));
          setPendingExpenseApprovals(enriched);
        } else {
          setPendingExpenseApprovals([]);
        }
      } else {
        setPendingExpenseApprovals([]);
      }

      // Pending rename requests (owner sees all, a member sees only their own).
      // If the table doesn't exist yet this just returns an error and we show none.
      const { data: nameReqData } = await supabase
        .from('name_change_requests')
        .select('*')
        .eq(contextType === 'household' ? 'household_id' : 'group_id', id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      setNameRequests((nameReqData || []).map(r => ({
        ...r,
        profiles: profilesMap[r.requested_by] || { full_name: 'A member' },
      })));
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, contextType, navigate]);

  useEffect(() => {
    const loadSplitsAndProofs = async () => {
      if (expenses.length === 0) {
        setExpenseSplits({});
        setPendingApprovals([]);
        setAllPaymentProofs([]);
        return;
      }

      const expenseIds = expenses.map(e => e.id);
      const [splitsMap, proofsResult, extrasResult] = await Promise.all([
        fetchExpenseSplits(expenseIds),
        supabase
          .from('payment_proofs')
          .select(`*, profiles:submitted_by (id, full_name, email, avatar_url)`)
          .in('expense_id', expenseIds),
        fetchExpenseExtras(expenseIds),
      ]);

      setExtras(extrasResult);
      setExpenseSplits(splitsMap);
      const proofsData = proofsResult.data || [];
      setAllPaymentProofs(proofsData);

      const pending = [];
      for (const exp of expenses) {
        const splits = splitsMap[exp.id] || [];
        const pendingSplits = splits.filter(s => s.status === 'pending_verification');
        pending.push(...pendingSplits);
      }
      setPendingApprovals(pending);
    };

    loadSplitsAndProofs();
  }, [expenses, fetchExpenseSplits]);

  // ── Scroll to + briefly highlight the specific expense when arriving from
  // a "New Expense Pending Approval" / "Expense Approved" / "Expense Amount
  // Updated" notification. Retries as pendingExpenseApprovals/expenses load.
  useEffect(() => {
    if (!highlightExpenseId || loading) return;
    const el = document.getElementById(`expense-${highlightExpenseId}`);
    if (!el) return;

    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedExpenseId(highlightExpenseId);
      navigate(`${location.pathname}?type=${contextType}`, { replace: true, state: location.state });
    }, 0);
    return () => clearTimeout(timer);
  }, [highlightExpenseId, loading, contextType, location, navigate]);

  // Clears the highlight a few seconds after it's set. Kept as its own effect
  // (depending only on highlightedExpenseId, not the URL) so the query-string
  // cleanup above doesn't cancel this timer before it fires.
  useEffect(() => {
    if (!highlightedExpenseId) return;
    const t = setTimeout(() => setHighlightedExpenseId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightedExpenseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGroupAndData();
  }, [fetchGroupAndData]);

  useEffect(() => {
    if (!currentUser || !group) return;
    const expenseColumn = contextType === 'household' ? 'household_id' : 'group_id';
    const channel = supabase
      .channel('group-detail')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `${expenseColumn}=eq.${id}`,
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_proofs',
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: contextType === 'household' ? 'households' : 'groups',
        filter: `id=eq.${id}`,
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expense_splits',
      }, () => {
        if (expenses.length) {
          fetchExpenseSplits(expenses.map(e => e.id)).then(setExpenseSplits);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, group, id, contextType, fetchGroupAndData, fetchExpenseSplits, expenses]);

  // Separate channel so a missing table can never break the expense updates above
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel(`name-requests-${id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'name_change_requests',
        filter: `${contextType === 'household' ? 'household_id' : 'group_id'}=eq.${id}`,
      }, () => fetchGroupAndData())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, id, contextType, fetchGroupAndData]);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [menuOpen]);

  const resetExpenseForm = () => {
    setExpenseForm({
      title: '', amount: '', category: 'Food',
      expense_date: getTodayStr(),
    due_date: '',
      location: group?.name || '', who_paid: currentUser?.id || '',
      split_type: 'equal', selected_members: [], custom_splits: {}
    });
    setExpenseErrors({});
    setOtherType('');
    setCategoryTouched(false);
    setCategoryAutoDetected(false);
  };

  const resetProofForm = () => {
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
  };

  const getStatusBadge = (expense, splits) => {
    if (expense.approval_status === 'pending_approval') return { label: 'Waiting Approval', color: '#3B2AAB', bg: '#F0EDFF' };
    if (expense.approval_status === 'rejected') return { label: 'Rejected', color: '#e53e3e', bg: '#ffe5e5' };
    const paidCount = splits.filter(s => s.status === 'approved').length;
    const total = splits.length;
    if (total === 0) return { label: 'No splits', color: '#856404', bg: '#fff3cd' };
    // "Who Paid: None" and nothing paid or awaiting review yet
    if (!expense.paid_by && paidCount === 0 && !splits.some(s => s.status === 'pending_verification')) {
      return { label: 'Unpaid', color: '#e53e3e', bg: '#FEE2E2' };
    }
    if (paidCount === total) return { label: 'Fully Paid', color: '#38a169', bg: '#f0fff4' };
    if (splits.some(s => s.status === 'partly_paid')) return { label: 'Partly Paid', color: '#c05621', bg: '#FEEBC8' };
    return { label: `${paidCount}/${total} Paid`, color: '#856404', bg: '#fff3cd' };
  };

  const getMemberAvatar = (member) => {
    const p = member.profiles;
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="detail-avatar-img" />;
    const initials = p?.full_name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
    return <div className="detail-avatar-initials">{initials}</div>;
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(group?.code || '');
    showToast('Code copied!');
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: `Join ${group?.name}`, text: `Use code: ${group?.code}` }).catch(() => handleCopyCode());
    } else {
      handleCopyCode();
    }
  };

  const openProofModal = (proof, split) => {
    setSelectedProof(proof);
    setSelectedSplit(split);
    setShowViewProofModal(true);
  };

  useEffect(() => {
    if (!openProofId || loading) return;
    const proof = allPaymentProofs.find(p => p.id === openProofId);
    if (!proof) return;

    const splits = expenseSplits[proof.expense_id] || [];
    const split = splits.find(s => s.proof_id === proof.id)
      || splits.find(s => s.user_id === proof.submitted_by);

    const timer = setTimeout(() => {
      openProofModal(proof, split);
      navigate(`${location.pathname}?type=${contextType}`, { replace: true, state: location.state });
    }, 0);
    return () => clearTimeout(timer);
  }, [openProofId, loading, allPaymentProofs, expenseSplits, contextType, location, navigate]);

  // Typing in Description picks a matching category — until the user chooses one by hand
  const handleTitleChange = (value) => {
    const hit = categoryTouched ? null : detectCategory(value);
    setExpenseForm(prev => ({ ...prev, title: value, ...(hit ? { category: hit.category } : {}) }));
    if (hit) {
      setCategoryAutoDetected(true);
      setOtherType(hit.category === 'Other' ? (hit.otherType || '') : '');
    }
  };

  const handleAddExpense = async () => {
    const errors = {};
    if (!expenseForm.title.trim()) errors.title = 'Title required';
    if (expenseForm.due_date && expenseForm.due_date < getTodayStr()) errors.due_date = 'Due date cannot be in the past';
    if (!expenseForm.amount || isNaN(expenseForm.amount)) errors.amount = 'Valid amount required';
    if (!expenseForm.who_paid) errors.who_paid = 'Select who paid';
    if (!isSolo && expenseForm.selected_members.length === 0) errors.members = 'Select at least one member';

    if (Object.keys(errors).length > 0) {
      setExpenseErrors(errors);
      showToast(Object.values(errors)[0], 'error');
      return;
    }

    setLoadingAction(true);
    // Single-member household/group: that member is the only participant
    const participants = isSolo ? members.map(m => m.user_id) : expenseForm.selected_members;
    const splitType = isSolo ? 'equal' : expenseForm.split_type;
    // "None" = nobody has paid yet
    const payerId = expenseForm.who_paid === 'none' ? null : expenseForm.who_paid;
    const splits = {};
    if (splitType === 'equal') {
      const share = Number(expenseForm.amount) / participants.length;
      participants.forEach(uid => { splits[uid] = share.toFixed(2); });
    } else {
      let total = 0;
      participants.forEach(uid => {
        const val = Number(expenseForm.custom_splits[uid]) || 0;
        splits[uid] = val.toFixed(2);
        total += val;
      });
      if (Math.abs(total - Number(expenseForm.amount)) > 0.01) {
        showToast('Custom split total does not match amount', 'error');
        setLoadingAction(false);
        return;
      }
    }

    const finalCategory = expenseForm.category === 'Other' && otherType.trim()
      ? otherType.trim()
      : expenseForm.category;

    const insertData = {
      title: expenseForm.title.trim(),
      amount: Number(expenseForm.amount),
      category: finalCategory,
      expense_type: contextType === 'household' ? 'household' : 'group',
      expense_date: getTodayStr(),             // auto: the day it was created
      due_date: expenseForm.due_date || null,  // optional
      location: expenseForm.location || group?.name,
      paid_by: payerId,
      split_type: splitType,
      members_split: splits,
      status: 'pending',
      approval_status: isAdmin ? 'approved' : 'pending_approval',
      created_by: currentUser.id,
    };
    if (contextType === 'household') insertData.household_id = id;
    else insertData.group_id = id;

    const { data: insertedExpense, error } = await supabase
      .from('expenses')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      showToast(`Failed: ${error.message}`, 'error');
      setLoadingAction(false);
      return;
    }

    if (isAdmin) {
      const splitRows = participants.map(uid => ({
        expense_id: insertedExpense.id,
        user_id: uid,
        share_amount: Number(splits[uid]),
        // Owner as payer = automatically paid. A member payer starts Unpaid and
        // must submit proof (which the owner then approves/rejects).
        status: (uid === expenseForm.who_paid && uid === group?.created_by) ? 'approved' : 'unpaid',
        updated_at: new Date().toISOString(),
      }));
      // upsert (not insert): a DB trigger may already have created the rows
      await supabase.from('expense_splits').upsert(splitRows, { onConflict: 'expense_id,user_id' });

      // Owner-created expenses skip approval, so tell every member who owes a share.
      const dueText = expenseForm.due_date ? ` Due ${fmtDate(expenseForm.due_date)}.` : '';
      const notifRows = participants
        .filter(uid => uid !== currentUser.id)
        .map(uid => ({
          user_id: uid,
          title: 'New Expense Added',
          message: `${profile?.full_name} added "${insertedExpense.title}" for ₱${Number(expenseForm.amount).toFixed(2)}. Your share: ₱${Number(splits[uid]).toFixed(2)}.${dueText}${!payerId ? ' It is marked unpaid — please upload your proof of payment once you pay your share.' : ''}${uid === expenseForm.who_paid && uid !== group?.created_by ? ' You are marked as the payer — please upload your proof of payment.' : ''}`,
          type: 'expense_added',
          link_path: `/groups/${id}?type=${contextType}`,
          link_state: JSON.stringify({ type: contextType }),
          link_query: `expenseId=${insertedExpense.id}`,
        }));
      if (notifRows.length) {
        const { error: notifError } = await supabase.from('notifications').insert(notifRows);
        if (notifError) console.error('Failed to notify members:', notifError);
      }

      showToast('Expense added!');
      setShowAddExpense(false);
      resetExpenseForm();
      fetchGroupAndData();
    } else {
      await supabase.from('notifications').insert({
        user_id: group.created_by,
        title: '📋 New Expense Pending Approval',
        message: `${profile?.full_name} added "${expenseForm.title}" for ₱${Number(expenseForm.amount).toFixed(2)}. Please review.`,
        type: 'approval_request',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
        link_query: `expenseId=${insertedExpense.id}`,
      });

      setShowAddExpense(false);

      if (expenseForm.who_paid === currentUser.id) {
        setJustAddedExpense(insertedExpense);
        resetProofForm();
        setShowUploadAfterAdd(true);
      } else {
        showToast('Expense submitted for approval!');
        resetExpenseForm();
        fetchGroupAndData();
      }
    }
    setLoadingAction(false);
  };

  const handleApproveExpense = async (expense) => {
    setLoadingAction(true);
    const splits = expense.members_split || {};
    const memberIds = Object.keys(splits);
    const ownerId = group?.created_by;
    const payerIsOwner = expense.paid_by === ownerId;

    await supabase.from('expenses')
      .update({ approval_status: 'approved', status: 'pending' })
      .eq('id', expense.id);

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

    // Payer rules:
    //  • owner is the payer            → automatically Paid
    //  • member is the payer + proof   → Pending (owner reviews the proof)
    //  • member is the payer, no proof → Unpaid (member must submit proof; NOT auto-paid)
    const splitRows = memberIds.map(uid => {
      let status = 'unpaid';
      let proof_id = null;
      if (uid === expense.paid_by) {
        if (payerIsOwner) status = 'approved';
        else if (upfrontProof) { status = 'pending_verification'; proof_id = upfrontProof.id; }
      }
      return {
        expense_id: expense.id,
        user_id: uid,
        share_amount: Number(splits[uid]),
        status,
        proof_id,
        updated_at: new Date().toISOString(),
      };
    });
    // upsert (not insert): a DB trigger may already have created the rows
    await supabase.from('expense_splits').upsert(splitRows, { onConflict: 'expense_id,user_id' });

    const needsProof = !payerIsOwner && !upfrontProof;
    const creatorIsPayer = expense.created_by === expense.paid_by;
    await supabase.from('notifications').insert({
      user_id: expense.created_by,
      title: '✅ Expense Approved!',
      message: !expense.paid_by
        ? `Your expense "${expense.title}" for ₱${Number(expense.amount).toFixed(2)} was approved and is marked Unpaid. Upload your proof of payment for your share — it is marked paid once the owner approves it.`
        : needsProof && creatorIsPayer
        ? `Your expense "${expense.title}" for ₱${Number(expense.amount).toFixed(2)} was approved. Please upload your proof of payment — it is marked paid once the owner approves it.`
        : `Your expense "${expense.title}" for ₱${Number(expense.amount).toFixed(2)} was approved by the owner.${upfrontProof && creatorIsPayer ? ' Your proof is now waiting for the owner\'s review.' : ''}`,
      type: 'expense_approved',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `expenseId=${expense.id}`,
    });

    // Someone else was named as the payer → tell them to upload their proof
    if (needsProof && !creatorIsPayer && expense.paid_by) {
      await supabase.from('notifications').insert({
        user_id: expense.paid_by,
        title: '📸 Upload your proof of payment',
        message: `"${expense.title}" (₱${Number(expense.amount).toFixed(2)}) was approved and you are the payer. Please upload your proof of payment.`,
        type: 'expense_approved',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
        link_query: `expenseId=${expense.id}`,
      });
    }

    // No payer: every member submits proof for their own share, so let them know
    if (!expense.paid_by) {
      const others = memberIds.filter(uid => uid !== expense.created_by && uid !== currentUser?.id);
      if (others.length) {
        await supabase.from('notifications').insert(others.map(uid => ({
          user_id: uid,
          title: 'New Expense Added',
          message: `"${expense.title}" for ₱${Number(expense.amount).toFixed(2)} was added and is marked Unpaid. Your share: ₱${Number(splits[uid]).toFixed(2)}. Upload your proof of payment once you pay.`,
          type: 'expense_added',
          link_path: `/groups/${id}?type=${contextType}`,
          link_state: JSON.stringify({ type: contextType }),
          link_query: `expenseId=${expense.id}`,
        })));
      }
    }

    showToast('Expense approved!');
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const handleRejectExpense = async () => {
    const reason = rejectExpenseReason.trim();
    if (!reason) {
      showToast('Please provide a rejection reason', 'error');
      return;
    }
    if (!selectedPendingExpense) return;

    setLoadingAction(true);
    const expense = selectedPendingExpense;
    const ownerName = profile?.full_name || 'The owner';

    // 1) Remove the proposed expense first — if this fails we stop, so the member
    //    is never told "rejected" about an expense that still exists.
    const { error: deleteError } = await supabase
      .from('expenses')
      .update({
        approval_status: 'rejected',
        rejection_reason: reason,
        deleted_at: new Date().toISOString(),
        deleted_by: profile?.id,
      })
      .eq('id', expense.id);

    if (deleteError) {
      showToast('Could not reject the expense. Please try again.', 'error');
      setLoadingAction(false);
      return;
    }

    // 2) Tell the member who proposed it (skip if the owner proposed it themselves)
    if (expense.created_by && expense.created_by !== profile?.id) {
      const { error: notifError } = await supabase.from('notifications').insert({
        user_id: expense.created_by,
        title: '❌ Expense Rejected',
        message: `${ownerName} (owner) rejected your proposed expense "${expense.title}" for ₱${Number(expense.amount).toFixed(2)}. Reason: ${reason}`,
        type: 'expense_rejected',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
      });
      if (notifError) console.error('Failed to notify member of rejected expense:', notifError);
    }

    showToast('Expense rejected — member notified');
    setShowRejectExpenseModal(false);
    setRejectExpenseReason('');
    setSelectedPendingExpense(null);
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const handleApproveSplit = async (split) => {
    // If the member submitted a payment proof, approving MUST go through the exact
    // same flow as the "Confirm Payment" button in the proof modal. Before, this
    // function only flipped the split to 'approved' and left the proof stuck on
    // 'pending_verification' (and never notified the member), so the proof modal
    // still showed "Pending Verification" + Confirm/Reject buttons.
    const proof = allPaymentProofs.find(p => p.id === split.proof_id)
      || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id && p.status === 'pending_verification');
    if (proof) {
      await handleConfirmPayment(proof, split);
      return;
    }

    // No proof attached (manual "✓" mark-as-paid) — keep the original behavior.
    setLoadingAction(true);
    const { error } = await supabase
      .from('expense_splits')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', split.id);
    if (!error) {
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
      const { data: allSplits } = await supabase
        .from('expense_splits')
        .select('status')
        .eq('expense_id', split.expense_id);
      const allApproved = allSplits.every(s => s.status === 'approved');
      if (allApproved) {
        await supabase.from('expenses').update({ status: 'paid' }).eq('id', split.expense_id);
      }
      showToast('Payment approved!');
      const newSplitsMap = await fetchExpenseSplits(expenses.map(e => e.id));
      setExpenseSplits(newSplitsMap);
      fetchGroupAndData();
    } else {
      showToast('Error approving payment', 'error');
    }
    setLoadingAction(false);
  };

  // ── shared helpers for the edit / follow-up / refund / delete flows ──
  const flowLink = (expenseId) => ({
    link_path: `/groups/${id}?type=${contextType}`,
    link_state: JSON.stringify({ type: contextType }),
    link_query: `expenseId=${expenseId}`,
  });
  const flowActor = () => ({ id: currentUser.id, name: profile?.full_name || 'The admin' });

  const handleDeleteExpense = async () => {
    if (!selectedExpense) return;
    setXmLoading(true);
    try {
      const res = await softDeleteExpense({ expense: selectedExpense, actor: flowActor(), linkFor: flowLink });
      if (res.blocked) {
        showToast('Refund the members who paid first', 'error');
      } else {
        setShowDeleteModal(false);
        setSelectedExpense(null);
        showToast('Expense deleted');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not delete expense', 'error');
    }
    setXmLoading(false);
    fetchGroupAndData();
  };

  const handleSubmitFollowup = async ({ file, note }) => {
    setXmLoading(true);
    try {
      await submitFollowupProof({
        expense: followupFor.expense, split: followupFor.split, user: currentUser,
        userName: profile?.full_name || 'A member', adminId: group?.created_by,
        file, note, linkFor: flowLink,
      });
      showToast('Follow-up proof submitted! ⏳');
      setFollowupFor(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Could not submit follow-up', 'error');
    }
    setXmLoading(false);
  };

  const handleReviewFollowup = async (proof, approve, reason) => {
    setXmLoading(true);
    try {
      await reviewFollowupProof({ proof, approve, reason, expense: proofsFor?.expense, actor: flowActor(), linkFor: flowLink });
      showToast(approve ? 'Follow-up payment approved! ✅' : 'Follow-up payment rejected');
      setProofsFor(null);
      fetchGroupAndData();
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
      fetchGroupAndData();
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
        userName: profile?.full_name || 'A member', adminId: group?.created_by, linkFor: flowLink,
      });
      showToast('Thanks — refund confirmed ✅');
      setProofsFor(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Could not confirm refund', 'error');
    }
    setXmLoading(false);
  };

  const originalProofFor = (split) =>
    allPaymentProofs.find(p => p.id === split.proof_id)
    || [...allPaymentProofs].reverse().find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);

  const closeDeleteGroupModal = () => {
    if (loadingAction) return;
    setShowDeleteGroupModal(false);
    setDeletePassword('');
    setDeleteTypedName('');
    setDeleteError('');
    setShowDeletePassword(false);
  };

  const deleteConfirmReady = canUsePassword
    ? deletePassword.length > 0
    : deleteTypedName.trim() === (group?.name || '');

  const handleDeleteGroup = async () => {
    if (!isAdmin || !deleteConfirmReady) return;
    setDeleteError('');
    setLoadingAction(true);

    // Nothing is deleted until the owner proves it is them
    if (canUsePassword) {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: deletePassword,
      });
      if (authError) {
        setDeleteError('Incorrect password. Please try again.');
        setLoadingAction(false);
        return;
      }
    }

    try {
      const steps = contextType === 'household'
        ? [['expenses', 'household_id'], ['household_members', 'household_id'], ['households', 'id']]
        : [['expenses', 'group_id'], ['group_members', 'group_id'], ['groups', 'id']];
      for (const [table, column] of steps) {
        const { error: deleteErr } = await supabase.from(table).delete().eq(column, id);
        if (deleteErr) throw deleteErr;
      }
      showToast(`${contextType === 'household' ? 'Household' : 'Group'} deleted`);
      setShowDeleteGroupModal(false);
      navigate('/groups');
    } catch (err) {
      console.error(err);
      showToast('Failed to delete', 'error');
    }
    setLoadingAction(false);
  };

  const handleKickMember = async () => {
    if (!selectedMember) return;
    setLoadingAction(true);
    try {
      if (contextType === 'household') {
        await supabase.from('household_members')
          .update({ status: 'kicked' })
          .eq('household_id', id)
          .eq('user_id', selectedMember.user_id);
      } else {
        await supabase.from('group_members')
          .update({ status: 'kicked' })
          .eq('group_id', id)
          .eq('user_id', selectedMember.user_id);
      }
      await supabase.from('notifications').insert({
        user_id: selectedMember.user_id,
        title: 'Removed from Group',
        message: `You have been removed from "${group?.name}"`,
        type: 'kicked',
      });
      showToast('Member removed');
      setShowKickMemberModal(false);
      setSelectedMember(null);
      fetchGroupAndData();
    } catch {
      showToast('Failed to remove member', 'error');
    }
    setLoadingAction(false);
  };

  const handleSubmitProof = async (isResubmit = false) => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot', 'error'); return; }
    setLoadingAction(true);
    
    const fileExt = proofForm.screenshot.name.split('.').pop();
    const fileName = `${currentUser.id}-${selectedExpense.id}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(fileName, proofForm.screenshot, { upsert: true });
    if (uploadError) {
      showToast('Upload failed', 'error');
      setLoadingAction(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);

    if (isResubmit) {
      await supabase
        .from('payment_proofs')
        .delete()
        .eq('expense_id', selectedExpense.id)
        .eq('submitted_by', currentUser.id)
        .eq('status', 'rejected');
    }

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note,
      status: 'pending_verification',
    }).select().single();

    if (proofError) {
      showToast('Failed to save proof', 'error');
      setLoadingAction(false);
      return;
    }

    const { data: existingSplit } = await supabase
      .from('expense_splits')
      .select('id')
      .eq('expense_id', selectedExpense.id)
      .eq('user_id', currentUser.id)
      .maybeSingle();

    let splitUpdateError = null;
    if (!existingSplit) {
      const myShare = selectedExpense.members_split?.[currentUser.id];
      if (!myShare) {
        showToast('Error: Your share not found in expense.', 'error');
        setLoadingAction(false);
        return;
      }
      const { error: insertError } = await supabase
        .from('expense_splits')
        .insert({
          expense_id: selectedExpense.id,
          user_id: currentUser.id,
          share_amount: Number(myShare),
          status: 'pending_verification',
          proof_id: insertedProof.id,
          updated_at: new Date().toISOString(),
        });
      splitUpdateError = insertError;
    } else {
      const { error: updateError } = await supabase
        .from('expense_splits')
        .update({ status: 'pending_verification', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
        .eq('id', existingSplit.id);
      splitUpdateError = updateError;
    }

    if (splitUpdateError) {
      showToast('Failed to update payment status', 'error');
      setLoadingAction(false);
      return;
    }

    await supabase.from('expenses').update({ status: 'verifying' }).eq('id', selectedExpense.id);

    await supabase.from('notifications').insert({
      user_id: group?.created_by,
      title: isResubmit ? '📸 Payment Proof Resubmitted' : '📸 Payment Proof Submitted',
      message: `${profile?.full_name} ${isResubmit ? 'resubmitted' : 'submitted'} proof for "${selectedExpense.title}". Tap to review.`,
      type: 'payment_proof',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}`,
    });

    setShowPaymentProofModal(false);
    setShowResubmitModal(false);
    resetProofForm();
    setSelectedExpense(null);
    showToast('Proof submitted for verification');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const handleConfirmPayment = async (proof, split) => {
    setLoadingAction(true);
    
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
    
    const { data: allSplits } = await supabase
      .from('expense_splits')
      .select('status')
      .eq('expense_id', split.expense_id);
    const allApproved = allSplits.every(s => s.status === 'approved');
    if (allApproved) {
      await supabase.from('expenses').update({ status: 'paid' }).eq('id', split.expense_id);
    }
    
    await supabase.from('notifications').insert({
      user_id: proof.submitted_by,
      title: '✅ Owner approved your proof!',
      message: `The owner has approved your payment proof for "${expenses.find(e => e.id === split.expense_id)?.title}". Your payment is now marked as paid.`,
      type: 'payment_confirmed',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `openProof=${split.expense_id}&proofId=${proof.id}`,
    });
    
    setShowViewProofModal(false);
    showToast('Payment confirmed');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const handleOwnerSubmitProof = async () => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot', 'error'); return; }
    setLoadingAction(true);

    const fileExt = proofForm.screenshot.name.split('.').pop();
    const fileName = `${currentUser.id}-${selectedExpense.id}-owner-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(fileName, proofForm.screenshot, { upsert: true });
    if (uploadError) {
      showToast('Upload failed', 'error');
      setLoadingAction(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);

    const { data: insertedProof } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note,
      status: 'verified',
    }).select().single();

    await supabase
      .from('expense_splits')
      .update({ status: 'approved', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
      .eq('expense_id', selectedExpense.id)
      .eq('user_id', currentUser.id);

    const { data: splits } = await supabase.from('expense_splits').select('status').eq('expense_id', selectedExpense.id);
    const allApproved = splits.every(s => s.status === 'approved');
    if (allApproved) {
      await supabase.from('expenses').update({ status: 'paid' }).eq('id', selectedExpense.id);
    }

    const otherSplits = splits.filter(s => s.user_id !== currentUser.id);
    for (const split of otherSplits) {
      await supabase.from('notifications').insert({
        user_id: split.user_id,
        title: '✅ Payment Confirmed by Owner',
        message: `The owner has confirmed payment for "${selectedExpense.title}". Tap to view proof.`,
        type: 'payment_confirmed',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
        link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}`,
      });
    }

    setShowOwnerProofModal(false);
    resetProofForm();
    setSelectedExpense(null);
    showToast('Payment confirmed and proof saved!');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  // Single handler for rejecting a payment — used by BOTH the "Reject" button on the
  // Pending Approvals card and the "Reject Proof" button inside the proof modal.
  const handleRejectProof = async () => {
    const reason = rejectProofReason.trim();
    if (!reason) { showToast('Please provide a reason', 'error'); return; }

    const proof = selectedProof || null;
    // The split can be missing when the modal was opened from a notification — look it up.
    const split = selectedSplit
      || (proof ? (expenseSplits[proof.expense_id] || []).find(sp => sp.proof_id === proof.id || sp.user_id === proof.submitted_by) : null);
    if (!split) { showToast('Could not find this payment. Please refresh.', 'error'); return; }

    setLoadingAction(true);
    const expenseId = proof?.expense_id || split.expense_id;
    const expense = expenses.find(e => e.id === expenseId);
    const memberId = proof?.submitted_by || split.user_id;
    const ownerName = profile?.full_name || 'The owner';

    // 1) Send the member's share back to "unpaid" with the reason
    const { error: splitError } = await supabase.from('expense_splits').update({
      status: 'unpaid',
      rejection_reason: reason,
      proof_id: null,
      updated_at: new Date().toISOString(),
    }).eq('id', split.id);

    if (splitError) {
      showToast('Error rejecting payment', 'error');
      setLoadingAction(false);
      return;
    }

    // 2) Mark the proof itself as rejected (if the member attached one)
    const proofId = proof?.id || split.proof_id;
    if (proofId) {
      await supabase.from('payment_proofs').update({
        status: 'rejected',
        rejection_reason: reason,
      }).eq('id', proofId);
    }

    // 3) Expense goes back to pending since a share is unpaid again
    await supabase.from('expenses').update({ status: 'pending' }).eq('id', expenseId);

    // 4) Notify the member: tap → opens their rejected proof so they can resubmit
    const { error: notifError } = await supabase.from('notifications').insert({
      user_id: memberId,
      title: '❌ Payment Proof Rejected',
      message: `${ownerName} (owner) rejected your payment proof for "${expense?.title || 'an expense'}" (₱${Number(split.share_amount).toFixed(2)}). Reason: ${reason}. Please submit a new proof.`,
      type: 'payment_rejected',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: proofId ? `openProof=${expenseId}&proofId=${proofId}` : `expenseId=${expenseId}`,
    });
    if (notifError) console.error('Failed to notify member of rejected proof:', notifError);

    closeRejectProofModal();
    showToast('Payment rejected — member notified');
    setLoadingAction(false);
    const newSplitsMap = await fetchExpenseSplits(expenses.map(e => e.id));
    setExpenseSplits(newSplitsMap);
    fetchGroupAndData();
  };

  const closeRejectProofModal = () => {
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    setSelectedSplit(null);
  };

  // ── Rename household / group ─────────────────────────────────────────────
  const nameTable = contextType === 'household' ? 'households' : 'groups';
  const nameColumn = contextType === 'household' ? 'household_id' : 'group_id';
  const trimmedRename = renameValue.trim();
  const renameInvalid =
    trimmedRename.length < 2 ? 'Name must be at least 2 characters'
    : trimmedRename === group?.name ? 'Enter a different name'
    : '';

  const openRename = () => {
    if (myPendingNameRequest) {
      showToast('Your rename request is still waiting for the owner', 'error');
      return;
    }
    setRenameValue(group?.name || '');
    setRenameStep('edit');
  };

  const closeRename = () => {
    if (renameLoading) return;
    setRenameStep(null);
    setRenameValue('');
  };

  const handleConfirmRename = async () => {
    if (renameInvalid) return;
    const newName = trimmedRename;
    const oldName = group.name;
    setRenameLoading(true);

    if (isAdmin) {
      const { error: updateError } = await supabase.from(nameTable).update({ name: newName }).eq('id', id);
      if (updateError) {
        showToast('Could not change the name. Please try again.', 'error');
        setRenameLoading(false);
        return;
      }
      // Keep the name shown on older expenses in sync (best effort)
      await supabase.from('expenses').update({ location: newName }).eq(nameColumn, id).eq('location', oldName);

      const rows = members
        .filter(m => m.user_id !== currentUser.id)
        .map(m => ({
          user_id: m.user_id,
          title: `${contextLabel === 'household' ? 'Household' : 'Group'} renamed`,
          message: `${profile?.full_name} renamed "${oldName}" to "${newName}".`,
          type: 'name_changed',
          link_path: `/groups/${id}?type=${contextType}`,
          link_state: JSON.stringify({ type: contextType }),
        }));
      if (rows.length) await supabase.from('notifications').insert(rows);

      setGroup(g => ({ ...g, name: newName }));
      showToast(`${contextLabel === 'household' ? 'Household' : 'Group'} name changed`);
    } else {
      const { error: requestError } = await supabase.from('name_change_requests').insert({
        [nameColumn]: id,
        requested_by: currentUser.id,
        old_name: oldName,
        new_name: newName,
        status: 'pending',
      });
      if (requestError) {
        showToast('Could not send your request. Please try again.', 'error');
        setRenameLoading(false);
        return;
      }
      await supabase.from('notifications').insert({
        user_id: group.created_by,
        title: '✏️ Name change request',
        message: `${profile?.full_name} wants to rename "${oldName}" to "${newName}". Tap to review.`,
        type: 'approval_request',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
      });
      showToast('Request sent to the owner');
    }

    setRenameLoading(false);
    setRenameStep(null);
    setRenameValue('');
    fetchGroupAndData();
  };

  const handleApproveNameRequest = async (req) => {
    setLoadingAction(true);
    const { error: updateError } = await supabase.from(nameTable).update({ name: req.new_name }).eq('id', id);
    if (updateError) {
      showToast('Could not change the name. Please try again.', 'error');
      setLoadingAction(false);
      return;
    }
    await supabase.from('name_change_requests').update({ status: 'approved' }).eq('id', req.id);
    await supabase.from('expenses').update({ location: req.new_name }).eq(nameColumn, id).eq('location', group.name);

    const rows = members
      .filter(m => m.user_id !== currentUser.id)
      .map(m => m.user_id === req.requested_by
        ? {
            user_id: m.user_id,
            title: '✅ Name change approved',
            message: `The owner approved renaming "${req.old_name}" to "${req.new_name}".`,
            type: 'name_change_approved',
            link_path: `/groups/${id}?type=${contextType}`,
            link_state: JSON.stringify({ type: contextType }),
          }
        : {
            user_id: m.user_id,
            title: `${contextLabel === 'household' ? 'Household' : 'Group'} renamed`,
            message: `"${req.old_name}" is now called "${req.new_name}".`,
            type: 'name_changed',
            link_path: `/groups/${id}?type=${contextType}`,
            link_state: JSON.stringify({ type: contextType }),
          });
    if (rows.length) await supabase.from('notifications').insert(rows);

    setGroup(g => ({ ...g, name: req.new_name }));
    showToast('Name change approved');
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const handleRejectNameRequest = async (req) => {
    setLoadingAction(true);
    const { error: updateError } = await supabase.from('name_change_requests').update({ status: 'rejected' }).eq('id', req.id);
    if (updateError) {
      showToast('Could not reject the request. Please try again.', 'error');
      setLoadingAction(false);
      return;
    }
    await supabase.from('notifications').insert({
      user_id: req.requested_by,
      title: '❌ Name change declined',
      message: `The owner declined renaming "${req.old_name}" to "${req.new_name}".`,
      type: 'name_change_rejected',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
    });
    showToast('Request declined');
    fetchGroupAndData();
    setLoadingAction(false);
  };

  if (loading) {
    return (
      <div className="group-detail-screen">
        <div className="detail-header">
          <button className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
          <div className="detail-header-info"><span className="detail-group-name">Loading...</span></div>
        </div>
        <div className="loading-spinner">Loading group…</div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="group-detail-screen">
        <div className="detail-header">
          <button className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
          <div className="detail-header-info"><span className="detail-group-name">Error</span></div>
        </div>
        <div className="empty-state" style={{ padding: 40, textAlign: 'center' }}>
          <p>{error || 'Group not found'}</p>
          <button className="add-expense-btn" style={{ marginTop: 16, width: 'auto', padding: '8px 20px' }} onClick={fetchGroupAndData}>Retry</button>
          <button className="cancel-btn" style={{ marginTop: 8 }} onClick={() => navigate('/groups')}>Back to Groups</button>
        </div>
      </div>
    );
  }

  return (
    <div className="group-detail-screen">
      {/* Header */}
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
        <div className="detail-header-info">
          <div className="detail-name-row">
            <span className="detail-name-spacer" aria-hidden="true" />
            <h1 className="detail-group-name">{group.name}</h1>
            <button
              className="detail-rename-btn"
              onClick={openRename}
              title={isAdmin ? `Rename ${contextLabel}` : `Request a new ${contextLabel} name`}
              aria-label={`Rename ${contextLabel}`}
            >
              <Pencil size={12} />
            </button>
          </div>
          <p className="detail-group-type">{contextType === 'household' ? '🏠 Household' : '✈️ Trip Group'}</p>
          {myPendingNameRequest && (
            <span className="detail-rename-pending">⏳ Rename to “{myPendingNameRequest.new_name}” awaiting approval</span>
          )}
        </div>
        <div className={`detail-menu${menuOpen ? ' open' : ''}`} ref={menuRef}>
          <button
            className="icon-btn-sm detail-menu-trigger"
            onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label="Group actions"
          >
            <MoreVertical size={18} />
          </button>
          <div className="detail-menu-list">
            <button className="icon-btn-sm detail-menu-item" style={{ '--i': 0 }} title="Copy invite code" aria-label="Copy invite code"
              onClick={() => { handleCopyCode(); setMenuOpen(false); }}>
              <Copy size={16} />
            </button>
            <button className="icon-btn-sm detail-menu-item" style={{ '--i': 1 }} title="Share invite code" aria-label="Share invite code"
              onClick={() => { handleShare(); setMenuOpen(false); }}>
              <Share2 size={16} />
            </button>
            {isAdmin && (
              <button className="icon-btn-sm detail-menu-item detail-menu-delete" style={{ '--i': 2 }} title={`Delete ${contextLabel}`} aria-label={`Delete ${contextLabel}`}
                onClick={() => { setMenuOpen(false); setShowDeleteGroupModal(true); }}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="detail-members-section">
        <h3 className="section-title">👥 Members ({members.length})</h3>
        {members.length === 0 ? (
          <p style={{ fontSize: 12, color: '#9E8FCC', margin: 0 }}>No members found.</p>
        ) : (
          <div className="members-list">
            {members.map(member => (
              <div key={member.user_id} className="member-row">
                <button
                  className="member-avatar-tooltip member-avatar-clickable"
                  onClick={() => { setPaymentCardMember(member); setShowPaymentCard(true); }}
                  title="View payment details"
                >
                  {getMemberAvatar(member)}
                </button>
                <div className="member-info">
                  <span className="member-name">{member.profiles?.full_name}</span>
                  <span className="member-role">{member.role === 'owner' ? 'Owner' : 'Member'}</span>
                </div>
                {isAdmin && member.user_id !== currentUser?.id && (
                  <button className="kick-btn" onClick={() => { setSelectedMember(member); setShowKickMemberModal(true); }}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Approvals — ONE section for both kinds of admin approvals:
          1) a member's newly created expense  (Approve / Reject)
          2) a member's payment proof          (Approve / Reject / View Proof) */}
      {isAdmin && (pendingExpenseApprovals.length + pendingApprovals.length + nameRequests.length) > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title">
            ⏳ Pending Approvals ({pendingExpenseApprovals.length + pendingApprovals.length + nameRequests.length})
          </h3>

          <div className="pa-list">
            {/* Rename requests from members */}
            {nameRequests.map(req => (
              <div key={`name-${req.id}`} className="pa-card">
                <div className="pa-top">
                  <div className="pa-icon pa-icon-name">✏️</div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">Rename {contextLabel}</span>
                    </div>
                    <div className="pa-meta">{req.profiles?.full_name} wants to change “{req.old_name}” to “{req.new_name}”</div>
                    <span className="pa-tag pa-tag-name">Name change</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-approve" disabled={loadingAction} onClick={() => handleApproveNameRequest(req)}>
                    <Check size={14} /> Approve
                  </button>
                  <button className="pa-btn pa-btn-reject" disabled={loadingAction} onClick={() => handleRejectNameRequest(req)}>
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            ))}

            {/* New expenses waiting for approval */}
            {pendingExpenseApprovals.map(expense => (
              <div
                key={`exp-${expense.id}`}
                id={`expense-${expense.id}`}
                className={`pa-card ${highlightedExpenseId === expense.id ? 'notif-highlight' : ''}`}
              >
                <div
                  className="pa-top pa-top-tap"
                  role="button"
                  tabIndex={0}
                  onClick={() => setReviewExpense(expense)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setReviewExpense(expense); }}
                >
                  <div className="pa-icon pa-icon-expense">{CATEGORY_ICONS[expense.category] || '🧾'}</div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">{expense.title}</span>
                      <span className="pa-amount">₱{Number(expense.amount).toFixed(2)}</span>
                    </div>
                    <div className="pa-meta">by {expense.profiles?.full_name} · {expense.expense_date}{expense.due_date ? ` · Due ${fmtDate(expense.due_date)}` : ''}</div>
                    <span className="pa-tag pa-tag-expense">New expense</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-proof" onClick={() => setReviewExpense(expense)}>
                    <Eye size={14} /> Review details
                  </button>
                </div>
              </div>
            ))}

            {/* Payment proofs waiting for approval */}
            {pendingApprovals.map(split => {
              const expense = expenses.find(e => e.id === split.expense_id);
              const proof = allPaymentProofs.find(p => p.id === split.proof_id)
                || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id && p.status === 'pending_verification');
              const pendingFollowup = (extras.followups[split.expense_id] || []).find(f => f.user_id === split.user_id && f.status === 'pending_verification');
              if (pendingFollowup) {
                return (
                  <div key={`pay-${split.id}`} className="pa-card">
                    <div className="pa-top">
                      <div className="pa-icon pa-icon-payment">📸</div>
                      <div className="pa-info">
                        <div className="pa-title-row">
                          <span className="pa-title">{expense?.title}</span>
                          <span className="pa-amount">₱{Number(pendingFollowup.amount).toFixed(2)}</span>
                        </div>
                        <div className="pa-meta">{split.profiles?.full_name}'s follow-up payment</div>
                        <span className="pa-tag pa-tag-payment">Follow-up proof</span>
                      </div>
                    </div>
                    <div className="pa-actions">
                      <button className="pa-btn pa-btn-proof" onClick={() => expense && setProofsFor({ expense, split })}>
                        <Eye size={14} /> Review
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={`pay-${split.id}`} className="pa-card">
                  <div className="pa-top">
                    <div className="pa-icon pa-icon-payment">📸</div>
                    <div className="pa-info">
                      <div className="pa-title-row">
                        <span className="pa-title">{expense?.title}</span>
                        <span className="pa-amount">₱{Number(split.share_amount).toFixed(2)}</span>
                      </div>
                      <div className="pa-meta">{split.profiles?.full_name}'s share</div>
                      <span className="pa-tag pa-tag-payment">Payment proof</span>
                    </div>
                  </div>
                  <div className="pa-actions">
                    {proof && (
                      <button className="pa-btn pa-btn-proof" onClick={() => openProofModal(proof, split)}>
                        <Eye size={14} /> View Proof
                      </button>
                    )}
                    <button className="pa-btn pa-btn-approve" disabled={loadingAction} onClick={() => handleApproveSplit(split)}>
                      <Check size={14} /> Approve
                    </button>
                    <button
                      className="pa-btn pa-btn-reject"
                      disabled={loadingAction}
                      onClick={() => { setSelectedProof(proof || null); setSelectedSplit(split); setRejectProofReason(''); setShowRejectProofModal(true); }}
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expenses List */}
      <div className="detail-expenses-section">
        <h3 className="section-title">📋 Expenses ({expenses.length})</h3>
        {expenses.length === 0 ? (
          <div className="empty-state">No expenses yet. Tap + to add one!</div>
        ) : (
          expenses.map(expense => {
            const splits = expenseSplits[expense.id] || [];
            const badge = getStatusBadge(expense, splits);
            const mySplit = splits.find(s => s.user_id === currentUser?.id);
            const isOwner = isAdmin;
            const ownerVerifiedProof = allPaymentProofs.find(p => p.expense_id === expense.id && p.submitted_by === group?.created_by && p.status === 'verified');
            const myRejectedProof = allPaymentProofs.find(p => p.expense_id === expense.id && p.submitted_by === currentUser?.id && p.status === 'rejected');

            return (
              <div
                key={expense.id}
                id={`expense-${expense.id}`}
                className={`expense-item-detail ${highlightedExpenseId === expense.id ? 'notif-highlight' : ''}`}
              >
                <div className="expense-icon" style={{ background: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}>
                  <span>{CATEGORY_ICONS[expense.category] || '📦'}</span>
                </div>

                <div className="expense-info">
                  <div className="expense-title">{expense.title}</div>
                  <div className="expense-amount">₱{Number(expense.amount).toFixed(2)}</div>
                  <div className="expense-meta">
                    {expense.expense_date}{expense.location ? ` • ${expense.location}` : ''}{expense.due_date ? ` • Due ${fmtDate(expense.due_date)}` : ''}
                  </div>

                  <div className="member-splits-list" style={{ marginTop: 8 }}>
                    {splits.map(split => {
                      const member = members.find(m => m.user_id === split.user_id);
                      const proof = allPaymentProofs.find(p => p.id === split.proof_id)
                        || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);
                      const statusMeta = splitStatusMeta(split);
                      const hasPendingFollowup = (extras.followups[expense.id] || []).some(f => f.user_id === split.user_id && f.status === 'pending_verification');
                      const mine = split.user_id === currentUser?.id;
                      const due = followupDueOf(split);
                      const over = overpaidOf(split);
                      const myUnconfirmed = mine && (extras.refunds[expense.id] || []).some(r => r.user_id === split.user_id && r.status === 'sent');
                      const showPayLine = (isOwner || mine) && split.user_id !== expense.paid_by && (
                        split.status === 'partly_paid' || over > 0
                        || (extras.followups[expense.id] || []).some(f => f.user_id === split.user_id)
                        || (extras.refunds[expense.id] || []).some(r => r.user_id === split.user_id));
                      return (
                        <React.Fragment key={split.id}>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr auto auto auto',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 0',
                          borderTop: '1px solid #F0EDFF'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div className="member-avatar-tooltip" style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}>
                              {getMemberAvatar(member || { profiles: split.profiles })}
                            </div>
                            <span style={{ fontSize: 11, color: '#2D1A7A', fontWeight: 500 }}>
                              {split.profiles?.full_name}
                            </span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#3B2AAB' }}>
                            ₱{Number(split.share_amount).toFixed(2)}
                          </span>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 50,
                            whiteSpace: 'nowrap',
                            background: statusMeta.bg,
                            color: statusMeta.color
                          }}>
                            {statusMeta.label}
                          </span>
                          <div style={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                            {proof && (
                              <button className="view-proof-btn" style={{ padding: '2px 6px' }} onClick={() => (hasPendingFollowup ? setProofsFor({ expense, split }) : openProofModal(proof, split))}>
                                <Eye size={12} />
                              </button>
                            )}
                            {isOwner && split.status === 'pending_verification' && !proof && (
                              <button className="approve-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => handleApproveSplit(split)}>✓</button>
                            )}
                          </div>
                        </div>
                        {showPayLine && (
                          <div className="xm-pay-line" style={{ marginBottom: 6 }}>
                            <div className="xm-pay-line-top">
                              <p className="xm-pay-line-name">{mine ? 'You' : split.profiles?.full_name}</p>
                              <span className="xm-pay-line-text">Paid ₱{toNum(split.paid_amount).toFixed(2)} of ₱{toNum(split.share_amount).toFixed(2)}</span>
                            </div>
                            {due > 0 && <p className="xm-pay-line-text" style={{ color: '#c05621', fontWeight: 600 }}>{mine ? `Follow-up payment due: ₱${due.toFixed(2)}` : `Needs to pay ₱${due.toFixed(2)} more`}</p>}
                            {over > 0 && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}>{mine ? `You overpaid ₱${over.toFixed(2)} — the admin will refund you` : `Overpaid ₱${over.toFixed(2)} — refund needed`}</p>}
                            {myUnconfirmed && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}>💸 A refund was sent — please confirm once received</p>}
                            <div className="xm-pay-line-actions">
                              {mine && due > 0 && (
                                <button className="xm-btn-sm" onClick={() => setFollowupFor({ expense, split })}>Follow-up Payment</button>
                              )}
                              {isOwner && over > 0 && (
                                <button className="xm-btn-sm" onClick={() => setRefundFor({ expense, split })}>Refund ₱{over.toFixed(2)}</button>
                              )}
                              <button className="xm-btn-sm xm-soft" onClick={() => setProofsFor({ expense, split })}>
                                <Eye size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{myUnconfirmed ? 'Confirm refund' : 'Proofs'}
                              </button>
                            </div>
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {isOwner && !ownerVerifiedProof && (
                    <div className="owe-row" style={{ marginTop: 8 }}>
                      <button className="pay-btn-small" onClick={() => { setSelectedExpense(expense); resetProofForm(); setShowOwnerProofModal(true); }}>
                        Submit Payment Proof (as Owner)
                      </button>
                    </div>
                  )}

                  {!isOwner && mySplit && mySplit.status === 'unpaid' && expense.status !== 'paid' && (
                    <div className="owe-row pay-prompt" style={{ marginTop: 8 }}>
                      <div className="pay-prompt-text">
                        {expense.paid_by === currentUser?.id ? (
                          <>
                            <strong>You paid this bill</strong>
                            <span>Upload your proof of payment</span>
                          </>
                        ) : (
                          <strong>You owe ₱{Number(mySplit.share_amount).toFixed(2)}</strong>
                        )}
                      </div>
                      <button className="pay-btn-small" onClick={() => { setSelectedExpense(expense); resetProofForm(); setShowPaymentProofModal(true); }}>
                        {expense.paid_by === currentUser?.id ? 'Submit Proof' : 'Pay'}
                      </button>
                    </div>
                  )}

                  {!isOwner && myRejectedProof && (
                    <div style={{ marginTop: 8, background: '#ffe5e5', borderRadius: 10, padding: '8px 12px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e53e3e' }}>❌ Your proof was rejected</div>
                      <div style={{ fontSize: 11, color: '#c53030' }}>Reason: {myRejectedProof.rejection_reason}</div>
                      <button className="pay-btn-small" style={{ marginTop: 4, background: '#e53e3e' }} onClick={() => { setSelectedExpense(expense); resetProofForm(); setShowResubmitModal(true); }}>Resubmit New Proof</button>
                    </div>
                  )}
                </div>

                <div className="expense-right-col">
                  <div className="expense-badge" style={{ background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </div>
                  {isAdmin && (
                    <>
                      <button className="icon-btn" onClick={() => setEditExpense(expense)} title="Edit expense" style={{ color: '#3B2AAB' }}>
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn delete" onClick={() => { setSelectedExpense(expense); setShowDeleteModal(true); }}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FAB */}
      <button className="fab-detail" onClick={() => { resetExpenseForm(); setShowAddExpense(true); }}><Plus size={24} /></button>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Add Expense</h2>
              <button className="modal-close" onClick={() => { setShowAddExpense(false); resetExpenseForm(); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">

              {/* Description */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Description *</label>
                <input
                  type="text"
                  placeholder="e.g. Electricity bill"
                  className={`detail-input${expenseErrors.title ? ' input-error' : ''}`}
                  value={expenseForm.title}
                  onChange={e => handleTitleChange(e.target.value)}
                />
              </div>

              {/* Amount */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Amount *</label>
                <div className="amount-input-wrap">
                  <span className="peso-sign">₱</span>
                  <input type="number" placeholder="0.00" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                </div>
              </div>

              {/* Date — set automatically, not editable */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Date</label>
                <DatePickerField value={getTodayStr()} onChange={() => {}} disabled />
                <span className="detail-hint">Set automatically to today</span>
              </div>

              {/* Due date — optional, no past dates */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Due Date (optional)</label>
                <DatePickerField
                  value={expenseForm.due_date}
                  min={getTodayStr()}
                  placeholder="Select due date"
                  hasError={!!expenseErrors.due_date}
                  onChange={v => setExpenseForm({ ...expenseForm, due_date: v && v < getTodayStr() ? '' : v })}
                />
                {expenseErrors.due_date && <span className="detail-hint" style={{ color: '#e53e3e' }}>{expenseErrors.due_date}</span>}
                {expenseForm.due_date && (() => {
                  const preview = getReminderPreview(expenseForm.due_date, getMyReminderDays(profile));
                  return (
                    <span className="detail-hint">
                      {preview.length
                        ? `🔔 You'll be reminded on ${preview.join(', ')} (from your Settings). Each member is reminded based on their own Settings.`
                        : '🔔 None of your reminder days fall before this due date. Other members are reminded based on their own Settings.'}
                    </span>
                  );
                })()}
              </div>

              {/* Category */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Category</label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={expenseForm.category}
                    onChange={e => {
                      setExpenseForm({ ...expenseForm, category: e.target.value });
                      setCategoryTouched(true);
                      setCategoryAutoDetected(false);
                      if (e.target.value !== 'Other') setOtherType('');
                    }}
                    className="detail-input"
                    style={{ appearance: 'none', paddingRight: 36 }}
                  >
                    {ALL_EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#9E8FCC', pointerEvents: 'none' }} />
                </div>
                {categoryAutoDetected && !categoryTouched && (
                  <span className="detail-hint">✨ Picked from your description — change it anytime.</span>
                )}
                {/* Other — custom type input */}
                {expenseForm.category === 'Other' && (
                  <input
                    type="text"
                    placeholder="Specify type (e.g. Pet supplies, Haircut)"
                    className="detail-input"
                    value={otherType}
                    onChange={e => { setOtherType(e.target.value); setCategoryTouched(true); setCategoryAutoDetected(false); }}
                    style={{ marginTop: 6 }}
                  />
                )}
              </div>

              {/* Subscription preset picker */}
              {expenseForm.category === 'Subscription' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Quick Select</label>
                  <div className="detail-subscription-presets">
                    {SUBSCRIPTION_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        type="button"
                        className={`detail-preset-btn${expenseForm.title === preset.name ? ' active' : ''}`}
                        onClick={() => setExpenseForm({
                          ...expenseForm,
                          title: preset.name,
                          amount: String(preset.suggestedAmount),
                        })}
                      >
                        <span>{preset.icon}</span>
                        <span style={{ flex: 1, textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#2D1A7A' }}>{preset.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#9B2C87' }}>₱{preset.suggestedAmount}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Who paid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Who Paid *</label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={expenseForm.who_paid}
                    onChange={e => setExpenseForm({ ...expenseForm, who_paid: e.target.value })}
                    className={`detail-input${expenseErrors.who_paid ? ' input-error' : ''}`}
                    style={{ appearance: 'none', paddingRight: 36 }}
                  >
                    <option value="">Select member</option>
                    {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
                    <option value="none">None — nobody has paid yet</option>
                  </select>
                  <ChevronDown size={14} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#9E8FCC', pointerEvents: 'none' }} />
                </div>
              </div>

              {!isSolo && (<>
              {/* Split with */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Split With *</label>
                <div className="split-members">
                  {members.map(m => (
                    <label key={m.user_id} className="member-checkbox">
                      <input type="checkbox" checked={expenseForm.selected_members.includes(m.user_id)} onChange={e => {
                        if (e.target.checked) setExpenseForm({ ...expenseForm, selected_members: [...expenseForm.selected_members, m.user_id] });
                        else setExpenseForm({ ...expenseForm, selected_members: expenseForm.selected_members.filter(uid => uid !== m.user_id) });
                      }} /> {m.profiles?.full_name}
                    </label>
                  ))}
                </div>
              </div>

              {/* Split method */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Split Method</label>
                <div className="split-toggle">
                  <button className={`split-btn ${expenseForm.split_type === 'equal' ? 'active' : ''}`} onClick={() => setExpenseForm({ ...expenseForm, split_type: 'equal' })}>Equal</button>
                  <button className={`split-btn ${expenseForm.split_type === 'custom' ? 'active' : ''}`} onClick={() => setExpenseForm({ ...expenseForm, split_type: 'custom' })}>Custom</button>
                </div>
              </div>

              </>)}

              {/* Custom splits */}
              {!isSolo && expenseForm.split_type === 'custom' && expenseForm.selected_members.map((uid, i) => {
                const member = members.find(m => m.user_id === uid);
                const totalAmt = Number(expenseForm.amount) || 0;
                const prevTotal = expenseForm.selected_members.slice(0, i).reduce((sum, pid) => sum + (Number(expenseForm.custom_splits[pid]) || 0), 0);
                const thisRemaining = totalAmt - prevTotal;
                const hasEntered = Number(expenseForm.custom_splits[uid]) > 0;
                const afterThis = thisRemaining - (Number(expenseForm.custom_splits[uid]) || 0);
                return (
                  <div key={uid} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#2D1A7A' }}>{member?.profiles?.full_name}</span>
                      {totalAmt > 0 && (
                        <span style={{ fontSize: 10, color: '#9E8FCC' }}>
                          {hasEntered ? `₱${afterThis.toFixed(2)} left` : `₱${thisRemaining.toFixed(2)} to split`}
                        </span>
                      )}
                    </div>
                    <div className="amount-input-wrap small">
                      <span className="peso-sign">₱</span>
                      <input type="number" placeholder="0.00" value={expenseForm.custom_splits[uid] || ''} onChange={e => setExpenseForm({ ...expenseForm, custom_splits: { ...expenseForm.custom_splits, [uid]: e.target.value } })} />
                    </div>
                  </div>
                );
              })}
              {!isSolo && expenseForm.split_type === 'custom' && (() => {
                const totalAmt = Number(expenseForm.amount) || 0;
                const customTotal = expenseForm.selected_members.reduce((sum, uid) => sum + (Number(expenseForm.custom_splits[uid]) || 0), 0);
                const rem = totalAmt - customTotal;
                if (totalAmt <= 0) return null;
                return (
                  <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: Math.abs(rem) < 0.01 ? '#D1FAE5' : '#FEE2E2', color: Math.abs(rem) < 0.01 ? '#065F46' : '#e53e3e' }}>
                    {Math.abs(rem) < 0.01 ? '✅ Split total matches!' : `₱${Math.abs(rem).toFixed(2)} ${rem > 0 ? 'still unassigned' : 'over budget'}`}
                  </div>
                );
              })()}

              <button className="add-expense-btn" onClick={handleAddExpense} disabled={loadingAction}>{loadingAction ? 'Adding...' : 'Add Expense'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Member Payment Proof Modal */}
      {showPaymentProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Submit Payment Proof</h2>
              <button className="modal-close" onClick={() => { setShowPaymentProofModal(false); resetProofForm(); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" /> : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>No screenshot selected yet</div>}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}</button>
              {selectedExpense?.paid_by !== currentUser?.id && <button className="pom-trigger-btn" onClick={() => openPayOnline('proof')}>💳 Pay Online</button>}
              <textarea placeholder="Optional note (e.g. GCash ref #)" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <button className="add-expense-btn" onClick={() => handleSubmitProof(false)} disabled={loadingAction}>{loadingAction ? 'Submitting...' : 'Submit Proof'}</button>
              <button className="cancel-btn" onClick={() => { setShowPaymentProofModal(false); resetProofForm(); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Resubmit Modal */}
      {showResubmitModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Resubmit Payment Proof</h2>
              <button className="modal-close" onClick={() => { setShowResubmitModal(false); resetProofForm(); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <div style={{ background: '#FFF3CD', borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontSize: 12, color: '#856404', textAlign: 'center' }}>⚠️ Your previous proof was rejected. Please upload a new, clear screenshot.</div>
              {proofForm.screenshotPreview ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" /> : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>Upload a new screenshot</div>}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload New Screenshot'}</button>
              {selectedExpense?.paid_by !== currentUser?.id && <button className="pom-trigger-btn" onClick={() => openPayOnline('resubmit')}>💳 Pay Online</button>}
              <textarea placeholder="Optional note (e.g. GCash ref #)" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <button className="add-expense-btn" onClick={() => handleSubmitProof(true)} disabled={loadingAction}>{loadingAction ? 'Submitting...' : 'Resubmit Proof'}</button>
              <button className="cancel-btn" onClick={() => { setShowResubmitModal(false); resetProofForm(); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Owner Proof Modal */}
      {showOwnerProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Confirm Payment</h2>
              <button className="modal-close" onClick={() => setShowOwnerProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" /> : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>No screenshot selected yet</div>}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}</button>
              <div className="pom-quick-pay-row">
                <button className="pom-trigger-btn" style={{ flex: 1, margin: 0 }} onClick={() => openPaymentApp('gcash')}>💙 GCash</button>
                <button className="pom-trigger-btn" style={{ flex: 1, margin: 0 }} onClick={() => openPaymentApp('paymaya')}>💚 PayMaya</button>
              </div>
              <p className="pom-owner-hint">Pay your biller directly, then upload the screenshot above.</p>
              <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <div style={{ background: '#F0EDFF', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#3B2AAB', textAlign: 'center' }}>{isSolo ? '📢 This will mark the expense as paid.' : '📢 This marks your share as paid. The expense is fully paid once every member’s share is approved.'}</div>
              <button className="add-expense-btn" onClick={handleOwnerSubmitProof} disabled={loadingAction}>{loadingAction ? 'Confirming...' : 'Confirm Payment'}</button>
              <button className="cancel-btn" onClick={() => setShowOwnerProofModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* View Proof Modal */}
      {showViewProofModal && selectedProof && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Payment Proof</h2>
              <button className="modal-close" onClick={() => setShowViewProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8F6FF', borderRadius: 12, padding: '10px 14px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#3B2AAB', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{selectedProof.profiles?.full_name?.[0]?.toUpperCase()}</div>
                <div><div style={{ fontWeight: 600, fontSize: 13 }}>{selectedProof.profiles?.full_name}</div><div style={{ fontSize: 10, color: '#9E8FCC' }}>{new Date(selectedProof.created_at).toLocaleString()}</div></div>
              </div>
              <img src={selectedProof.screenshot_url} className="proof-preview" alt="payment proof" style={{ cursor: 'pointer' }} onClick={() => window.open(selectedProof.screenshot_url, '_blank')} />
              {selectedProof.note && <div style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>💬 {selectedProof.note}</div>}
              {selectedProof.rejection_reason && <div style={{ background: '#ffe5e5', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#e53e3e' }}>❌ Rejection reason: {selectedProof.rejection_reason}</div>}
              <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, padding: 8, borderRadius: 8, background: selectedProof.status === 'verified' ? '#D1FAE5' : selectedProof.status === 'rejected' ? '#ffe5e5' : '#fff3cd', color: selectedProof.status === 'verified' ? '#065F46' : selectedProof.status === 'rejected' ? '#e53e3e' : '#856404' }}>
                {selectedProof.status === 'verified' ? '✅ Payment Verified' : selectedProof.status === 'rejected' ? '❌ Proof Rejected' : '⏳ Pending Verification'}
              </div>
              {isAdmin && selectedProof.status === 'pending_verification' && selectedProof.submitted_by !== currentUser?.id && (
                <>
                  <button className="add-expense-btn" onClick={() => handleConfirmPayment(selectedProof, selectedSplit)}>✅ Confirm Payment</button>
                  <button className="delete-confirm-btn" onClick={() => { setShowViewProofModal(false); setShowRejectProofModal(true); }}>❌ Reject Proof</button>
                </>
              )}
              {!isAdmin && selectedProof.status === 'rejected' && selectedProof.submitted_by === currentUser?.id && (
                <button className="pay-btn-small" style={{ width: '100%', marginTop: 8, background: '#e53e3e' }} onClick={() => { setShowViewProofModal(false); const expense = expenses.find(e => e.id === selectedProof.expense_id); if (expense) { setSelectedExpense(expense); resetProofForm(); setShowResubmitModal(true); } }}>Resubmit New Proof</button>
              )}
              <button className="cancel-btn" onClick={() => setShowViewProofModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Review a member's new expense before approving / rejecting it */}
      {reviewExpense && isAdmin && (
        <ReviewExpenseModal
          expense={reviewExpense}
          members={members}
          icon={CATEGORY_ICONS[reviewExpense.category] || '📦'}
          color={CATEGORY_COLORS[reviewExpense.category] || '#3B2AAB'}
          loading={loadingAction}
          onApprove={async (exp) => { await handleApproveExpense(exp); setReviewExpense(null); }}
          onReject={(exp) => {
            setReviewExpense(null);
            setSelectedPendingExpense(exp);
            setShowRejectExpenseModal(true);
          }}
          onClose={() => setReviewExpense(null)}
        />
      )}

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

      {/* Reject Payment Modal (shared by the approvals card and the proof modal) */}
      {showRejectProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Reject Payment</h2>
              <button className="modal-close" onClick={closeRejectProofModal}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
                Rejecting <strong>{(selectedSplit?.profiles?.full_name) || 'this member'}</strong>'s payment for
                {' '}"<strong>{expenses.find(e => e.id === (selectedProof?.expense_id || selectedSplit?.expense_id))?.title || 'this expense'}</strong>"
                {' '}will notify them with your reason so they can submit a new proof.
              </p>
              <textarea
                placeholder="Reason for rejection *"
                value={rejectProofReason}
                onChange={e => setRejectProofReason(e.target.value)}
                className="detail-textarea"
                rows={3}
              />
              <button className="delete-confirm-btn" onClick={handleRejectProof} disabled={loadingAction}>
                {loadingAction ? 'Rejecting...' : 'Reject & Notify Member'}
              </button>
              <button className="cancel-btn" onClick={closeRejectProofModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Modal — needs the owner's password first */}
      {showDeleteGroupModal && (
        <div className="modal-overlay-detail" onClick={closeDeleteGroupModal}>
          <div className="rn-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="rn-icon"><Lock size={22} /></div>
            <h2 className="rn-title">Delete {contextLabel}?</h2>
            <p className="rn-sub">
              You’re about to delete <strong>{group.name}</strong>. This can’t be undone.
            </p>
            <div className="rn-note rn-note-danger">
              All expenses and members in this {contextLabel} will be removed for everyone.
            </div>
            <label className="rn-label" htmlFor="dg-input">
              {canUsePassword ? 'Enter your password to confirm' : `Type “${group.name}” to confirm`}
            </label>
            <div className="rn-input-wrap">
              <input
                id="dg-input"
                className="rn-input"
                type={canUsePassword && !showDeletePassword ? 'password' : 'text'}
                autoFocus
                autoComplete={canUsePassword ? 'current-password' : 'off'}
                placeholder={canUsePassword ? 'Your password' : group.name}
                value={canUsePassword ? deletePassword : deleteTypedName}
                onChange={e => {
                  setDeleteError('');
                  if (canUsePassword) setDeletePassword(e.target.value);
                  else setDeleteTypedName(e.target.value);
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleDeleteGroup(); }}
              />
              {canUsePassword && (
                <button
                  type="button"
                  className="rn-eye"
                  onClick={() => setShowDeletePassword(v => !v)}
                  aria-label={showDeletePassword ? 'Hide password' : 'Show password'}
                >
                  {showDeletePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
            <div className="rn-meta">
              <span className="rn-error">{deleteError}</span>
            </div>
            <button className="rn-btn-primary rn-btn-danger" disabled={!deleteConfirmReady || loadingAction} onClick={handleDeleteGroup}>
              {loadingAction ? 'Verifying…' : `Delete ${contextLabel}`}
            </button>
            <button className="rn-btn-ghost" disabled={loadingAction} onClick={closeDeleteGroupModal}>Cancel</button>
          </div>
        </div>
      )}

      {/* Kick Member Modal */}
      {showKickMemberModal && selectedMember && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={40} color="#e53e3e" /><h2>Remove Member?</h2>
            </div>
            <div className="modal-body-scroll">
              <p style={{ textAlign: 'center' }}>Remove <strong>{selectedMember.profiles?.full_name}</strong>?</p>
              <button className="delete-confirm-btn" onClick={handleKickMember} disabled={loadingAction}>{loadingAction ? 'Removing...' : 'Yes, Remove'}</button>
              <button className="cancel-btn" onClick={() => { setShowKickMemberModal(false); setSelectedMember(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Expense Modal */}
      {showRejectExpenseModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Reject Expense</h2>
              <button className="modal-close" onClick={() => { setShowRejectExpenseModal(false); setRejectExpenseReason(''); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
                Rejecting "<strong>{selectedPendingExpense?.title}</strong>" will delete it and notify the member.
              </p>
              <textarea
                className="detail-textarea"
                placeholder="Reason for rejection *"
                value={rejectExpenseReason}
                onChange={e => setRejectExpenseReason(e.target.value)}
                rows={3}
              />
              <button className="delete-confirm-btn" onClick={handleRejectExpense} disabled={loadingAction}>
                {loadingAction ? 'Rejecting...' : 'Reject & Delete Expense'}
              </button>
              <button className="cancel-btn" onClick={() => { setShowRejectExpenseModal(false); setRejectExpenseReason(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Proof After Adding Expense (member paid upfront) */}
      {showUploadAfterAdd && justAddedExpense && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Upload Payment Proof</h2>
            </div>
            <div className="modal-body-scroll">
              <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
                You marked yourself as the payer for "<strong>{justAddedExpense.title}</strong>". 
                Please upload a screenshot proof of payment.
              </p>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={el => el && (el.id = 'afterAddProofInput')}
                onChange={e => {
                  const file = e.target.files[0];
                  if (file) setProofForm({ ...proofForm, screenshot: file, screenshotPreview: URL.createObjectURL(file) });
                }}
              />
              {proofForm.screenshotPreview && (
                <img src={proofForm.screenshotPreview} alt="Preview" className="proof-preview" />
              )}
              <button className="upload-proof-btn" onClick={() => document.getElementById('afterAddProofInput').click()}>
                📷 {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
              </button>
              <button className="add-expense-btn" disabled={!proofForm.screenshot || loadingAction}
                onClick={async () => {
                  setLoadingAction(true);
                  const fileExt = proofForm.screenshot.name.split('.').pop();
                  const fileName = `${currentUser.id}-${justAddedExpense.id}-${Date.now()}.${fileExt}`;
                  const { error: uploadError } = await supabase.storage
                    .from('payment-proofs')
                    .upload(fileName, proofForm.screenshot, { upsert: true });
                  if (uploadError) { showToast('Upload failed', 'error'); setLoadingAction(false); return; }
                  const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);
                  await supabase.from('payment_proofs').insert({
                    expense_id: justAddedExpense.id,
                    submitted_by: currentUser.id,
                    screenshot_url: urlData.publicUrl,
                    status: 'pending_verification',
                  });
                  showToast('Expense submitted with proof!');
                  setShowUploadAfterAdd(false);
                  setJustAddedExpense(null);
                  resetProofForm();
                  resetExpenseForm();
                  fetchGroupAndData();
                  setLoadingAction(false);
                }}>
                {loadingAction ? 'Submitting...' : 'Submit Expense + Proof'}
              </button>
              <button className="cancel-btn" onClick={() => {
                showToast('Submitted for approval — upload your proof after the owner approves');
                setShowUploadAfterAdd(false);
                setJustAddedExpense(null);
                resetProofForm();
                resetExpenseForm();
                fetchGroupAndData();
              }}>Skip for now</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input type="file" ref={proofInputRef} style={{ display: 'none' }} accept="image/*" onChange={e => { const file = e.target.files[0]; if (file) setProofForm({ ...proofForm, screenshot: file, screenshotPreview: URL.createObjectURL(file) }); }} />

      <PayOnlineModal
        show={showPayOnlineModal}
        onClose={() => {
          setShowPayOnlineModal(false);
          if (payOnlineOrigin === 'proof') setShowPaymentProofModal(true);
          if (payOnlineOrigin === 'resubmit') setShowResubmitModal(true);
        }}
        receiverId={group?.created_by}
        itemTitle={selectedExpense?.title}
        amount={selectedExpense?.members_split?.[currentUser?.id]}
        onProceed={handlePayOnlineProceed}
      />

      {/* Rename household / group — step 1: edit, step 2: confirm */}
      {renameStep && (
        <div className="modal-overlay-detail" onClick={closeRename}>
          <div className="rn-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            {renameStep === 'edit' ? (
              <>
                <div className="rn-icon"><Pencil size={22} /></div>
                <h2 className="rn-title">Rename {contextLabel}</h2>
                <p className="rn-sub">
                  {isAdmin
                    ? `Fix a typo or pick a new name. Everyone in the ${contextLabel} will see it.`
                    : `Suggest a new name. The owner needs to approve it before it changes.`}
                </p>
                <label className="rn-label" htmlFor="rn-input">New name</label>
                <input
                  id="rn-input"
                  className="rn-input"
                  type="text"
                  autoFocus
                  maxLength={40}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !renameInvalid) setRenameStep('confirm'); }}
                  placeholder={`e.g. ${contextType === 'household' ? 'Win and K House' : 'Cebu Trip 2026'}`}
                />
                <div className="rn-meta">
                  <span className={renameValue && renameInvalid ? 'rn-error' : ''}>{renameValue ? renameInvalid : ''}</span>
                  <span>{renameValue.length}/40</span>
                </div>
                <button className="rn-btn-primary" disabled={!!renameInvalid} onClick={() => setRenameStep('confirm')}>
                  Continue
                </button>
                <button className="rn-btn-ghost" onClick={closeRename}>Cancel</button>
              </>
            ) : (
              <>
                <div className="rn-icon rn-icon-confirm"><AlertCircle size={24} /></div>
                <h2 className="rn-title">
                  {isAdmin ? `Change the ${contextLabel} name?` : 'Send name change request?'}
                </h2>
                <div className="rn-diff">
                  <div className="rn-diff-row">
                    <span className="rn-diff-label">Current</span>
                    <span className="rn-old">{group.name}</span>
                  </div>
                  <div className="rn-diff-row">
                    <span className="rn-diff-label">New</span>
                    <span className="rn-new">{trimmedRename}</span>
                  </div>
                </div>
                <div className={`rn-note ${isAdmin ? '' : 'rn-note-warn'}`}>
                  {isAdmin
                    ? `Are you sure? All members will be notified of the new ${contextLabel} name.`
                    : 'Are you sure? Your request goes to the owner, and the name only changes once they approve it.'}
                </div>
                <button className="rn-btn-primary" disabled={renameLoading} onClick={handleConfirmRename}>
                  {renameLoading ? 'Saving…' : isAdmin ? 'Yes, change name' : 'Yes, send request'}
                </button>
                <button className="rn-btn-ghost" disabled={renameLoading} onClick={() => setRenameStep('edit')}>
                  Go back
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className={`toast-detail toast-${toast.type}`}>{toast.msg}</div>}

      {/* Payment Details Card */}
      {showPaymentCard && paymentCardMember && (
        <div className="modal-overlay-detail" onClick={() => setShowPaymentCard(false)}>
          <div className="modal-detail-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
            <div className="modal-header" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="member-avatar-tooltip" style={{ width: 44, height: 44, minWidth: 44, minHeight: 44 }}>
                  {getMemberAvatar(paymentCardMember)}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, color: '#2D1A7A', fontWeight: 700 }}>{paymentCardMember.profiles?.full_name}</h2>
                  <span style={{ fontSize: 11, color: '#9E8FCC' }}>{paymentCardMember.role === 'owner' ? '👑 Owner' : '👤 Member'}</span>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowPaymentCard(false)}><X size={20} /></button>
            </div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#5A4AAA', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>💳 Payment Details</p>
            {[
              { label: 'GCash', value: paymentCardMember.profiles?.gcash_number },
              { label: 'Bank', value: paymentCardMember.profiles?.bank_name },
              { label: 'Account #', value: paymentCardMember.profiles?.bank_account_number },
              { label: 'Account Name', value: paymentCardMember.profiles?.bank_account_name },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0EDFF' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: value ? 700 : 400, color: value ? '#2D1A7A' : '#C4B5FD' }}>{value || 'Not set'}</span>
                  {value && (
                    <button onClick={() => { navigator.clipboard?.writeText(value); showToast(`${label} copied!`); }}
                      style={{ background: '#F0EDFF', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: '#3B2AAB', fontSize: 10, fontWeight: 700, fontFamily: 'Poppins' }}>
                      Copy
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!paymentCardMember.profiles?.gcash_number && !paymentCardMember.profiles?.bank_name && !paymentCardMember.profiles?.bank_account_number && (
              <p style={{ fontSize: 12, color: '#9E8FCC', textAlign: 'center', padding: '16px 0 4px', margin: 0 }}>No payment details set yet</p>
            )}
            <button onClick={() => setShowPaymentCard(false)}
              style={{ width: '100%', marginTop: 16, background: '#3B2AAB', color: 'white', border: 'none', borderRadius: 50, padding: '12px 0', fontFamily: 'Poppins', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
      {/* Edit Expense (admin only) */}
      {editExpense && isAdmin && (
        <EditExpenseModal
          expense={editExpense}
          splits={expenseSplits[editExpense.id] || []}
          members={members}
          actor={flowActor()}
          linkFor={flowLink}
          categories={ALL_EXPENSE_CATEGORIES}
          showToast={showToast}
          onClose={() => setEditExpense(null)}
          onSaved={() => { setEditExpense(null); fetchGroupAndData(); }}
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
        receiverId={group?.created_by}
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

    </div>
  );
}