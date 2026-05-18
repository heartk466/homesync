import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  ArrowLeft, Users, Plus, Check, X, Camera,
  Copy, Share2, AlertCircle, Trash2, Eye, RefreshCw, Pencil, ChevronDown
} from 'lucide-react';
import './GroupDetailScreen.css';
import { SUBSCRIPTION_PRESETS } from '../utils/expenseUtils';

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

export default function GroupDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const contextType = location.state?.type || new URLSearchParams(location.search).get('type') || 'group';

  const searchParams = new URLSearchParams(location.search);
  const openProofExpenseId = searchParams.get('openProof');
  const openProofId = searchParams.get('proofId');

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
  const [showRejectModal, setShowRejectModal] = useState(false);
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
  const [pendingPaymentProofs, setPendingPaymentProofs] = useState([]);
  const [allPaymentProofs, setAllPaymentProofs] = useState([]);
  const [selectedProof, setSelectedProof] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [toast, setToast] = useState(null);
  const [pendingExpenseApprovals, setPendingExpenseApprovals] = useState([]);
  const [showRejectExpenseModal, setShowRejectExpenseModal] = useState(false);
  const [rejectExpenseReason, setRejectExpenseReason] = useState('');
  const [selectedPendingExpense, setSelectedPendingExpense] = useState(null);
  const [showUploadAfterAdd, setShowUploadAfterAdd] = useState(false);
  const [justAddedExpense, setJustAddedExpense] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [showPaymentCard, setShowPaymentCard] = useState(false);
  const [paymentCardMember, setPaymentCardMember] = useState(null);

  // Edit Amount state
  const [showEditAmountModal, setShowEditAmountModal] = useState(false);
  const [editAmountExpense, setEditAmountExpense] = useState(null);
  const [editAmountValue, setEditAmountValue] = useState('');
  const [editAmountLoading, setEditAmountLoading] = useState(false);
  const [editCustomSplits, setEditCustomSplits] = useState({});

  const [expenseForm, setExpenseForm] = useState({
    title: '', amount: '', category: 'Food',
    expense_date: new Date().toISOString().split('T')[0],
    location: '', who_paid: '', split_type: 'equal',
    selected_members: [], custom_splits: {}
  });
  const [expenseErrors, setExpenseErrors] = useState({});
  const [otherType, setOtherType] = useState('');

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
        .order('created_at', { ascending: false });
      if (expError) throw expError;
      const allExpenses = expensesData || [];
      setExpenses(allExpenses.filter(e => e.approval_status === 'approved'));

      if (adminStatus) {
        const { data: pendingExp, error: pendingErr } = await supabase
          .from('expenses')
          .select('*')
          .eq(contextType === 'household' ? 'household_id' : 'group_id', id)
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
      const [splitsMap, proofsResult] = await Promise.all([
        fetchExpenseSplits(expenseIds),
        supabase
          .from('payment_proofs')
          .select(`*, profiles:submitted_by (id, full_name, email, avatar_url)`)
          .in('expense_id', expenseIds)
      ]);

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

  useEffect(() => {
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
        event: '*', schema: 'public', table: 'expense_splits',
      }, () => {
        if (expenses.length) {
          fetchExpenseSplits(expenses.map(e => e.id)).then(setExpenseSplits);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, group, id, contextType, fetchGroupAndData, fetchExpenseSplits, expenses.length]);

  const resetExpenseForm = () => {
    setExpenseForm({
      title: '', amount: '', category: 'Food',
      expense_date: new Date().toISOString().split('T')[0],
      location: group?.name || '', who_paid: currentUser?.id || '',
      split_type: 'equal', selected_members: [], custom_splits: {}
    });
    setExpenseErrors({});
    setOtherType('');
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
    if (paidCount === total) return { label: 'Fully Paid', color: '#38a169', bg: '#f0fff4' };
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

  const handleAddExpense = async () => {
    const errors = {};
    if (!expenseForm.title.trim()) errors.title = 'Title required';
    if (!expenseForm.amount || isNaN(expenseForm.amount)) errors.amount = 'Valid amount required';
    if (!expenseForm.who_paid) errors.who_paid = 'Select who paid';
    if (expenseForm.selected_members.length === 0) errors.members = 'Select at least one member';

    if (Object.keys(errors).length > 0) {
      setExpenseErrors(errors);
      showToast(Object.values(errors)[0], 'error');
      return;
    }

    setLoadingAction(true);
    const splits = {};
    if (expenseForm.split_type === 'equal') {
      const share = Number(expenseForm.amount) / expenseForm.selected_members.length;
      expenseForm.selected_members.forEach(uid => { splits[uid] = share.toFixed(2); });
    } else {
      let total = 0;
      expenseForm.selected_members.forEach(uid => {
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
      expense_date: expenseForm.expense_date,
      location: expenseForm.location || group?.name,
      paid_by: expenseForm.who_paid,
      split_type: expenseForm.split_type,
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
      const splitRows = expenseForm.selected_members.map(uid => ({
        expense_id: insertedExpense.id,
        user_id: uid,
        share_amount: Number(splits[uid]),
        status: uid === expenseForm.who_paid ? 'approved' : 'unpaid',
        updated_at: new Date().toISOString(),
      }));
      await supabase.from('expense_splits').insert(splitRows);
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

    await supabase.from('expenses')
      .update({ approval_status: 'approved', status: 'pending' })
      .eq('id', expense.id);

    const splitRows = memberIds.map(uid => ({
      expense_id: expense.id,
      user_id: uid,
      share_amount: Number(splits[uid]),
      status: uid === expense.paid_by ? 'approved' : 'unpaid',
      updated_at: new Date().toISOString(),
    }));
    await supabase.from('expense_splits').insert(splitRows);

    await supabase.from('notifications').insert({
      user_id: expense.created_by,
      title: '✅ Expense Approved!',
      message: `Your expense "${expense.title}" for ₱${Number(expense.amount).toFixed(2)} was approved by the owner.`,
      type: 'expense_approved',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
    });

    showToast('Expense approved!');
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const handleRejectExpense = async () => {
    if (!rejectExpenseReason.trim()) {
      showToast('Please provide a rejection reason', 'error');
      return;
    }
    setLoadingAction(true);

    await supabase.from('notifications').insert({
      user_id: selectedPendingExpense.created_by,
      title: '❌ Expense Rejected',
      message: `Your expense "${selectedPendingExpense.title}" was rejected. Reason: ${rejectExpenseReason}`,
      type: 'expense_rejected',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
    });

    await supabase.from('expenses').delete().eq('id', selectedPendingExpense.id);

    showToast('Expense rejected and deleted');
    setShowRejectExpenseModal(false);
    setRejectExpenseReason('');
    setSelectedPendingExpense(null);
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const handleApproveSplit = async (split) => {
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

  const handleRejectSplit = async () => {
    if (!rejectReason.trim()) { showToast('Please provide a reason', 'error'); return; }
    setLoadingAction(true);
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
      showToast('Payment rejected');
      setShowRejectModal(false);
      setRejectReason('');
      const newSplitsMap = await fetchExpenseSplits(expenses.map(e => e.id));
      setExpenseSplits(newSplitsMap);
      fetchGroupAndData();
    } else {
      showToast('Error rejecting payment', 'error');
    }
    setLoadingAction(false);
  };

  const handleDeleteExpense = async () => {
    await supabase.from('expenses').delete().eq('id', selectedExpense.id);
    setShowDeleteModal(false);
    setSelectedExpense(null);
    showToast('Expense deleted');
    fetchGroupAndData();
  };

  const handleDeleteGroup = async () => {
    setLoadingAction(true);
    try {
      if (contextType === 'household') {
        await supabase.from('expenses').delete().eq('household_id', id);
        await supabase.from('household_members').delete().eq('household_id', id);
        await supabase.from('households').delete().eq('id', id);
      } else {
        await supabase.from('expenses').delete().eq('group_id', id);
        await supabase.from('group_members').delete().eq('group_id', id);
        await supabase.from('groups').delete().eq('id', id);
      }
      showToast(`${contextType === 'household' ? 'Household' : 'Group'} deleted`);
      setShowDeleteGroupModal(false);
      navigate('/groups');
    } catch (err) {
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
    } catch (err) {
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

    const { data: existingSplit, error: fetchError } = await supabase
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

  const handleRejectProof = async () => {
    if (!rejectProofReason.trim()) { showToast('Please provide a reason', 'error'); return; }
    setLoadingAction(true);
    await supabase.from('payment_proofs').update({
      status: 'rejected',
      rejection_reason: rejectProofReason
    }).eq('id', selectedProof.id);
    await supabase.from('expense_splits').update({
      status: 'unpaid',
      rejection_reason: rejectProofReason,
      proof_id: null,
      updated_at: new Date().toISOString()
    }).eq('id', selectedSplit.id);
    await supabase.from('expenses').update({ status: 'pending' }).eq('id', selectedProof.expense_id);
    await supabase.from('notifications').insert({
      user_id: selectedProof.submitted_by,
      title: '❌ Payment Proof Rejected',
      message: `Your payment proof was rejected. Reason: ${rejectProofReason}`,
      type: 'payment_rejected',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `openProof=${selectedProof.expense_id}&proofId=${selectedProof.id}`,
    });
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    setSelectedSplit(null);
    showToast('Payment proof rejected');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const openEditAmount = (expense) => {
    setEditAmountExpense(expense);
    setEditAmountValue(String(expense.amount));
    // Pre-fill custom splits from existing splits in DB
    const splits = expenseSplits[expense.id] || [];
    const prefilled = {};
    splits.forEach(s => { prefilled[s.user_id] = String(s.share_amount); });
    setEditCustomSplits(prefilled);
    setShowEditAmountModal(true);
  };

  const handleSaveEditAmount = async () => {
    const newAmount = Number(editAmountValue);
    if (!newAmount || isNaN(newAmount) || newAmount <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }
    const splits = expenseSplits[editAmountExpense.id] || [];
    const splitType = editAmountExpense.split_type;
    let newMembersSplit = {};

    if (splitType === 'equal') {
      const share = newAmount / splits.length;
      splits.forEach(s => { newMembersSplit[s.user_id] = share.toFixed(2); });
    } else {
      // custom — validate total
      let total = 0;
      splits.forEach(s => { total += Number(editCustomSplits[s.user_id]) || 0; });
      if (Math.abs(total - newAmount) > 0.01) {
        showToast(`Custom split total ₱${total.toFixed(2)} doesn't equal ₱${newAmount.toFixed(2)}`, 'error');
        return;
      }
      splits.forEach(s => { newMembersSplit[s.user_id] = (Number(editCustomSplits[s.user_id]) || 0).toFixed(2); });
    }

    setEditAmountLoading(true);
    // Update expense amount and members_split
    await supabase.from('expenses').update({ amount: newAmount, members_split: newMembersSplit }).eq('id', editAmountExpense.id);
    // Update each expense_split share_amount
    for (const split of splits) {
      await supabase.from('expense_splits').update({ share_amount: Number(newMembersSplit[split.user_id]) }).eq('id', split.id);
    }

    // Notify all members that the amount was changed
    const notifTargets = members.filter(m => m.user_id !== currentUser.id);
    for (const m of notifTargets) {
      await supabase.from('notifications').insert({
        user_id: m.user_id,
        title: '✏️ Expense Amount Updated',
        message: `The owner updated "${editAmountExpense.title}" from ₱${Number(editAmountExpense.amount).toFixed(2)} to ₱${newAmount.toFixed(2)}.`,
        type: 'expense_updated',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
      });
    }

    setShowEditAmountModal(false);
    setEditAmountExpense(null);
    setEditAmountLoading(false);
    showToast('Amount updated and members notified! ✅');
    fetchGroupAndData();
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
          <h1 className="detail-group-name">{group.name}</h1>
          <p className="detail-group-type">{contextType === 'household' ? '🏠 Household' : '✈️ Trip Group'}</p>
        </div>
        <div className="detail-code-actions">
          <button className="icon-btn-sm" onClick={handleCopyCode}><Copy size={16} /></button>
          <button className="icon-btn-sm" onClick={handleShare}><Share2 size={16} /></button>
          {isAdmin && (
            <button className="icon-btn-sm" onClick={() => setShowDeleteGroupModal(true)}><Trash2 size={16} /></button>
          )}
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

      {/* Pending Expense Approvals */}
      {isAdmin && pendingExpenseApprovals.length > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title">📋 Pending Expense Approvals ({pendingExpenseApprovals.length})</h3>
          {pendingExpenseApprovals.map(expense => (
            <div key={expense.id} className="pending-item">
              <div>
                <strong style={{ fontSize: 13, color: '#2D1A7A' }}>{expense.title}</strong>
                <div style={{ fontSize: 11, color: '#9E8FCC' }}>
                  by {expense.profiles?.full_name} · ₱{Number(expense.amount).toFixed(2)} · {expense.expense_date}
                </div>
              </div>
              <div className="pending-actions">
                <button className="approve-btn" onClick={() => handleApproveExpense(expense)}>
                  <Check size={14} /> Approve
                </button>
                <button className="reject-btn" onClick={() => {
                  setSelectedPendingExpense(expense);
                  setShowRejectExpenseModal(true);
                }}>
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Approvals (splits) */}
      {isAdmin && pendingApprovals.length > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title">⏳ Pending Payment Approvals ({pendingApprovals.length})</h3>
          {pendingApprovals.map(split => {
            const expense = expenses.find(e => e.id === split.expense_id);
            const proof = allPaymentProofs.find(p => p.id === split.proof_id) 
              || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id && p.status === 'pending_verification');
            return (
              <div key={split.id} className="pending-item">
                <div>
                  <strong>{expense?.title}</strong><br />
                  <span>{split.profiles?.full_name} – ₱{Number(split.share_amount).toFixed(2)}</span>
                </div>
                <div className="pending-actions">
                  <button className="approve-btn" onClick={() => handleApproveSplit(split)}><Check size={14} /> Approve</button>
                  <button className="reject-btn" onClick={() => { setSelectedSplit(split); setShowRejectModal(true); }}><X size={14} /> Reject</button>
                  {proof && <button className="view-proof-btn" onClick={() => openProofModal(proof, split)}><Eye size={14} /> View Proof</button>}
                </div>
              </div>
            );
          })}
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
              <div key={expense.id} className="expense-item-detail">
                <div className="expense-icon" style={{ background: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}>
                  <span>{CATEGORY_ICONS[expense.category] || '📦'}</span>
                </div>

                <div className="expense-info">
                  <div className="expense-title">{expense.title}</div>
                  <div className="expense-amount">₱{Number(expense.amount).toFixed(2)}</div>
                  <div className="expense-meta">
                    {expense.expense_date}{expense.location ? ` • ${expense.location}` : ''}
                  </div>

                  <div className="member-splits-list" style={{ marginTop: 8 }}>
                    {splits.map(split => {
                      const member = members.find(m => m.user_id === split.user_id);
                      const proof = allPaymentProofs.find(p => p.id === split.proof_id)
                        || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);
                      return (
                        <div key={split.id} style={{
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
                            background: split.status === 'approved' ? '#D1FAE5' : split.status === 'pending_verification' ? '#FFF3CD' : '#FEE2E2',
                            color: split.status === 'approved' ? '#065F46' : split.status === 'pending_verification' ? '#856404' : '#e53e3e'
                          }}>
                            {split.status === 'approved' ? 'Paid' : split.status === 'pending_verification' ? 'Pending' : 'Unpaid'}
                          </span>
                          <div style={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                            {proof && (
                              <button className="view-proof-btn" style={{ padding: '2px 6px' }} onClick={() => openProofModal(proof, split)}>
                                <Eye size={12} />
                              </button>
                            )}
                            {isOwner && split.status === 'pending_verification' && !proof && (
                              <button className="approve-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => handleApproveSplit(split)}>✓</button>
                            )}
                          </div>
                        </div>
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
                    <div className="owe-row" style={{ marginTop: 8 }}>
                      <span>You owe ₱{Number(mySplit.share_amount).toFixed(2)}</span>
                      <button className="pay-btn-small" onClick={() => { setSelectedExpense(expense); resetProofForm(); setShowPaymentProofModal(true); }}>
                        Pay
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
                      <button className="icon-btn" onClick={() => openEditAmount(expense)} title="Edit amount" style={{ color: '#3B2AAB' }}>
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
                  onChange={e => setExpenseForm({ ...expenseForm, title: e.target.value })}
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

              {/* Date */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Date</label>
                <input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} className="detail-input" />
              </div>

              {/* Category */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>Category</label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={expenseForm.category}
                    onChange={e => {
                      setExpenseForm({ ...expenseForm, category: e.target.value });
                      if (e.target.value !== 'Other') setOtherType('');
                    }}
                    className="detail-input"
                    style={{ appearance: 'none', paddingRight: 36 }}
                  >
                    {ALL_EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#9E8FCC', pointerEvents: 'none' }} />
                </div>
                {/* Other — custom type input */}
                {expenseForm.category === 'Other' && (
                  <input
                    type="text"
                    placeholder="Specify type (e.g. Pet supplies, Haircut)"
                    className="detail-input"
                    value={otherType}
                    onChange={e => setOtherType(e.target.value)}
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
                  </select>
                  <ChevronDown size={14} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#9E8FCC', pointerEvents: 'none' }} />
                </div>
              </div>

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

              {/* Custom splits */}
              {expenseForm.split_type === 'custom' && expenseForm.selected_members.map((uid, i) => {
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
              {expenseForm.split_type === 'custom' && (() => {
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
              <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <div style={{ background: '#F0EDFF', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#3B2AAB', textAlign: 'center' }}>📢 This will automatically mark the expense as paid for all members.</div>
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

      {/* Reject Split Modal */}
      {showRejectModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header"><h2>Reject Payment</h2><button className="modal-close" onClick={() => setShowRejectModal(false)}><X size={20} /></button></div>
            <div className="modal-body-scroll">
              <textarea placeholder="Reason *" value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="detail-textarea" />
              <button className="add-expense-btn" onClick={handleRejectSplit}>Confirm Reject</button>
              <button className="cancel-btn" onClick={() => setShowRejectModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Expense Modal */}
      {showDeleteModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={40} color="#e53e3e" /><h2>Delete Expense?</h2>
            </div>
            <div className="modal-body-scroll">
              <button className="delete-confirm-btn" onClick={handleDeleteExpense}>Yes, Delete</button>
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Proof Modal */}
      {showRejectProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header"><h2>Reject Payment Proof</h2><button className="modal-close" onClick={() => setShowRejectProofModal(false)}><X size={20} /></button></div>
            <div className="modal-body-scroll">
              <textarea placeholder="Reason *" value={rejectProofReason} onChange={e => setRejectProofReason(e.target.value)} className="detail-textarea" />
              <button className="add-expense-btn" onClick={handleRejectProof}>Confirm</button>
              <button className="cancel-btn" onClick={() => setShowRejectProofModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Modal */}
      {showDeleteGroupModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={40} color="#e53e3e" />
              <h2>Delete {contextType === 'household' ? 'Household' : 'Group'}?</h2>
            </div>
            <div className="modal-body-scroll">
              <p style={{ textAlign: 'center', color: '#9E8FCC', fontSize: 13 }}>This will permanently delete everything.</p>
              <button className="delete-confirm-btn" onClick={handleDeleteGroup} disabled={loadingAction}>{loadingAction ? 'Deleting...' : 'Yes, Delete'}</button>
              <button className="cancel-btn" onClick={() => setShowDeleteGroupModal(false)}>Cancel</button>
            </div>
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
                  const { data: insertedProof } = await supabase.from('payment_proofs').insert({
                    expense_id: justAddedExpense.id,
                    submitted_by: currentUser.id,
                    screenshot_url: urlData.publicUrl,
                    status: 'pending_verification',
                  }).select().single();
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
                showToast('Expense submitted for approval (no proof yet)');
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
      {/* Edit Amount Modal */}
      {showEditAmountModal && editAmountExpense && (() => {
        const splits = expenseSplits[editAmountExpense.id] || [];
        const newAmount = Number(editAmountValue) || 0;
        const isCustom = editAmountExpense.split_type === 'custom';
        const equalShare = splits.length > 0 ? (newAmount / splits.length) : 0;

        // Running total for custom split "remaining" logic
        let runningTotal = 0;
        const splitEntries = splits.map((s, i) => {
          const entered = Number(editCustomSplits[s.user_id]) || 0;
          const remaining = newAmount - runningTotal;
          const isLast = i === splits.length - 1;
          runningTotal += entered;
          return { s, entered, remaining, isLast };
        });
        const customTotal = splits.reduce((sum, s) => sum + (Number(editCustomSplits[s.user_id]) || 0), 0);
        const customRemaining = newAmount - customTotal;

        return (
          <div className="modal-overlay-detail">
            <div className="modal-detail-card">
              <div className="modal-header">
                <h2>Edit Expense Amount</h2>
                <button className="modal-close" onClick={() => setShowEditAmountModal(false)}><X size={20} /></button>
              </div>
              <div className="modal-body-scroll">
                <div style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#5A4AAA' }}>
                  <strong>{editAmountExpense.title}</strong> · Original: ₱{Number(editAmountExpense.amount).toFixed(2)}
                </div>

                <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>New Amount</label>
                <div className="amount-input-wrap" style={{ marginTop: 6, marginBottom: 12 }}>
                  <span className="peso-sign">₱</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={editAmountValue}
                    onChange={e => {
                      setEditAmountValue(e.target.value);
                      // Reset custom splits when amount changes
                      if (isCustom) setEditCustomSplits({});
                    }}
                  />
                </div>

                {/* Equal split preview */}
                {!isCustom && newAmount > 0 && splits.length > 0 && (
                  <div style={{ background: '#F0EDFF', borderRadius: 12, padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#3B2AAB' }}>Equal Split Preview</p>
                    {splits.map(s => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, color: '#2D1A7A' }}>
                        <span>{s.profiles?.full_name}</span>
                        <span style={{ fontWeight: 700 }}>₱{equalShare.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Custom split inputs with running remainder */}
                {isCustom && (
                  <>
                    <div style={{ background: '#FFF3CD', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#856404' }}>
                      ⚠️ This expense uses custom splits. Adjust each member's share below. Suggested equal share: ₱{equalShare.toFixed(2)} each.
                    </div>
                    {splitEntries.map(({ s, remaining }) => {
                      const prevTotal = splits.slice(0, splits.indexOf(s)).reduce((sum, ps) => sum + (Number(editCustomSplits[ps.user_id]) || 0), 0);
                      const thisRemaining = newAmount - prevTotal;
                      return (
                        <div key={s.id} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#2D1A7A' }}>{s.profiles?.full_name}</span>
                            {newAmount > 0 && (
                              <span style={{ fontSize: 10, color: '#9E8FCC' }}>
                                {Number(editCustomSplits[s.user_id]) > 0
                                  ? `₱${thisRemaining.toFixed(2)} left to assign`
                                  : `₱${thisRemaining.toFixed(2)} still needs to be split`}
                              </span>
                            )}
                          </div>
                          <div className="amount-input-wrap small">
                            <span className="peso-sign">₱</span>
                            <input
                              type="number"
                              placeholder="0.00"
                              value={editCustomSplits[s.user_id] || ''}
                              onChange={e => setEditCustomSplits(prev => ({ ...prev, [s.user_id]: e.target.value }))}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {newAmount > 0 && (
                      <div style={{
                        padding: '8px 12px', borderRadius: 10, marginBottom: 8, fontSize: 12, fontWeight: 700,
                        background: Math.abs(customRemaining) < 0.01 ? '#D1FAE5' : '#FEE2E2',
                        color: Math.abs(customRemaining) < 0.01 ? '#065F46' : '#e53e3e'
                      }}>
                        {Math.abs(customRemaining) < 0.01
                          ? '✅ Split total matches!'
                          : `₱${Math.abs(customRemaining).toFixed(2)} ${customRemaining > 0 ? 'still unassigned' : 'over budget'}`}
                      </div>
                    )}
                  </>
                )}

                <div style={{ background: '#FFF3CD', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#856404' }}>
                  📢 All household members will be notified of this change.
                </div>

                <button className="add-expense-btn" onClick={handleSaveEditAmount} disabled={editAmountLoading}>
                  {editAmountLoading ? 'Saving…' : 'Save Changes'}
                </button>
                <button className="cancel-btn" onClick={() => setShowEditAmountModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}