import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  ArrowLeft, Users, Plus, Check, X, Camera,
  Copy, Share2, AlertCircle, Trash2, Eye
} from 'lucide-react';
import './GroupDetailScreen.css';

const CATEGORY_ICONS = {
  Rent: '🏠', Electricity: '⚡', Water: '💧', Internet: '📶',
  Food: '🍽️', Grocery: '🛒', Other: '📦', Transport: '🚗', Entertainment: '🎬'
};

const CATEGORY_COLORS = {
  Rent: '#3B2AAB', Electricity: '#2B6CB0', Water: '#2C7A7B',
  Internet: '#6B46C1', Food: '#C05621', Grocery: '#276749',
  Other: '#718096', Transport: '#DD6B20', Entertainment: '#D53F8C'
};

export default function GroupDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const contextType = location.state?.type || 'group';

  // Deep-link from notification: ?openProof=<expense_id>&proofId=<proof_id>
  const searchParams = new URLSearchParams(location.search);
  const openProofExpenseId = searchParams.get('openProof');
  const openProofId = searchParams.get('proofId');

  const proofInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI states for modals
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectProofModal, setShowRejectProofModal] = useState(false);
  const [showDeleteGroupModal, setShowDeleteGroupModal] = useState(false);
  const [showKickMemberModal, setShowKickMemberModal] = useState(false);
  const [showOwnerProofModal, setShowOwnerProofModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingPaymentProofs, setPendingPaymentProofs] = useState([]);
  const [allPaymentProofs, setAllPaymentProofs] = useState([]);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [toast, setToast] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);

  // Add expense form
  const [expenseForm, setExpenseForm] = useState({
    title: '', amount: '', category: 'Food',
    expense_date: new Date().toISOString().split('T')[0],
    location: '', who_paid: '', split_type: 'equal',
    selected_members: [], custom_splits: {}
  });
  const [expenseErrors, setExpenseErrors] = useState({});

  // Payment proof form
  const [proofForm, setProofForm] = useState({
    note: '', screenshot: null, screenshotPreview: null, submittedBy: 'member'
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ---------- Data fetching ----------
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

      // Fetch members
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
          .select('id, full_name, email, avatar_url')
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
      setExpenses(allExpenses);

      let proofsData = [];
      if (allExpenses.length > 0) {
        const { data: proofs } = await supabase
          .from('payment_proofs')
          .select(`*, profiles:submitted_by ( id, full_name, email, avatar_url )`)
          .in('expense_id', allExpenses.map(e => e.id));
        proofsData = proofs || [];
        setAllPaymentProofs(proofsData);
      } else {
        setAllPaymentProofs([]);
      }

      if (adminStatus) {
        setPendingApprovals(allExpenses.filter(e => e.approval_status === 'pending_approval'));
        const pendingProofs = proofsData.filter(p => p.status === 'pending_verification');
        setPendingPaymentProofs(pendingProofs);
      } else {
        setPendingApprovals([]);
        setPendingPaymentProofs([]);
      }

    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, contextType, navigate]);

  useEffect(() => {
    fetchGroupAndData();
  }, [fetchGroupAndData]);

  // Deep-link: auto-open proof modal when navigated from a notification
  useEffect(() => {
    if (!openProofExpenseId || allPaymentProofs.length === 0 || expenses.length === 0) return;

    // Try to find by specific proof ID first, then by expense ID
    let proofToOpen = null;
    if (openProofId) {
      proofToOpen = allPaymentProofs.find(p => p.id === openProofId);
    }
    if (!proofToOpen) {
      proofToOpen = allPaymentProofs.find(p => p.expense_id === openProofExpenseId);
    }

    if (proofToOpen) {
      setSelectedProof(proofToOpen);
      setShowViewProofModal(true);
      // Clean the URL so refreshing doesn't re-open it
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [openProofExpenseId, openProofId, allPaymentProofs, expenses]);

  // Realtime subscriptions
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
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, group, id, contextType, fetchGroupAndData]);

  // ---------- Helpers ----------
  const resetExpenseForm = () => {
    setExpenseForm({
      title: '', amount: '', category: 'Food',
      expense_date: new Date().toISOString().split('T')[0],
      location: group?.name || '', who_paid: currentUser?.id || '',
      split_type: 'equal', selected_members: [], custom_splits: {}
    });
    setExpenseErrors({});
    setProofForm({ note: '', screenshot: null, screenshotPreview: null, submittedBy: 'member' });
  };

  const getStatusBadge = (expense) => {
    if (expense.approval_status === 'pending_approval') return { label: 'Waiting Approval', color: '#3B2AAB', bg: '#F0EDFF' };
    if (expense.approval_status === 'rejected') return { label: 'Rejected', color: '#e53e3e', bg: '#ffe5e5' };
    if (expense.status === 'paid') return { label: 'Paid', color: '#38a169', bg: '#f0fff4' };
    if (expense.status === 'verifying') return { label: 'Verifying', color: '#c05621', bg: '#fffaf0' };
    return { label: 'Pending', color: '#856404', bg: '#fff3cd' };
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

  // Helper: open proof modal for a specific proof
  const openProofModal = (proof) => {
    setSelectedProof(proof);
    setShowViewProofModal(true);
  };

  // ---------- Expense actions ----------
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

    const insertData = {
      title: expenseForm.title.trim(),
      amount: Number(expenseForm.amount),
      category: expenseForm.category,
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

    const { error } = await supabase.from('expenses').insert(insertData);
    if (error) {
      showToast(`Failed: ${error.message}`, 'error');
    } else {
      showToast(isAdmin ? 'Expense added!' : 'Submitted for approval');
      setShowAddExpense(false);
      resetExpenseForm();
      if (!isAdmin && group?.created_by) {
        await supabase.from('notifications').insert({
          user_id: group.created_by,
          title: 'New Expense Pending',
          message: `${profile?.full_name} added "${expenseForm.title}" for ₱${expenseForm.amount}`,
          type: 'approval_request',
          link_path: `/groups/${id}`,
          link_state: JSON.stringify({ type: contextType }),
          link_query: `openExpense=${expenseForm.id}`,
        });
      }
      fetchGroupAndData();
    }
    setLoadingAction(false);
  };

  const handleApprove = async (expense) => {
    await supabase.from('expenses').update({ approval_status: 'approved' }).eq('id', expense.id);
    await supabase.from('notifications').insert({
      user_id: expense.created_by,
      title: 'Expense Approved',
      message: `Your expense "${expense.title}" was approved.`,
      type: 'approval',
      link_path: `/groups/${id}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `openExpense=${expense.id}`,
    });
    showToast('Expense approved');
    fetchGroupAndData();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { showToast('Please provide a reason', 'error'); return; }
    await supabase.from('expenses').update({
      approval_status: 'rejected',
      rejection_reason: rejectReason
    }).eq('id', selectedExpense.id);
    await supabase.from('notifications').insert({
      user_id: selectedExpense.created_by,
      title: 'Expense Rejected',
      message: `Your expense "${selectedExpense.title}" was rejected. Reason: ${rejectReason}`,
      type: 'rejection',
      link_path: `/groups/${id}`,
      link_state: JSON.stringify({ type: contextType }),
    });
    setShowRejectModal(false);
    setRejectReason('');
    setSelectedExpense(null);
    showToast('Expense rejected');
    fetchGroupAndData();
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

  const handleSubmitProof = async () => {
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

    const isOwnerSubmitting = proofForm.submittedBy === 'owner' && isAdmin;

    const { data: insertedProof } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note,
      status: isOwnerSubmitting ? 'verified' : 'pending_verification',
    }).select().single();

    if (isOwnerSubmitting) {
      // Auto-mark paid, no member approval needed
      await supabase.from('expenses').update({ status: 'paid' }).eq('id', selectedExpense.id);

      const splits = selectedExpense.members_split || {};
      const memberIds = Object.keys(splits).filter(uid => uid !== currentUser.id);
      for (const memberId of memberIds) {
        await supabase.from('notifications').insert({
          user_id: memberId,
          title: '✅ Payment Confirmed by Owner',
          message: `${profile?.full_name} confirmed payment for "${selectedExpense.title}". Tap to view proof.`,
          type: 'payment_confirmed',
          link_path: `/groups/${id}`,
          link_state: JSON.stringify({ type: contextType }),
          link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}`,
        });
      }
    } else {
      // Member submitted — needs owner verification
      await supabase.from('expenses').update({ status: 'verifying' }).eq('id', selectedExpense.id);

      await supabase.from('notifications').insert({
        user_id: group?.created_by,
        title: '📸 Payment Proof Submitted',
        message: `${profile?.full_name} submitted proof for "${selectedExpense.title}". Tap to review.`,
        type: 'payment_proof',
        link_path: `/groups/${id}`,
        link_state: JSON.stringify({ type: contextType }),
        link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}`,
      });
    }

    setShowPaymentProofModal(false);
    setShowOwnerProofModal(false);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null, submittedBy: 'member' });
    setSelectedExpense(null);
    showToast(isOwnerSubmitting ? 'Payment confirmed!' : 'Proof submitted for verification');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const handleConfirmPayment = async (proof) => {
    await supabase.from('payment_proofs').update({ status: 'verified' }).eq('id', proof.id);
    await supabase.from('expenses').update({ status: 'paid' }).eq('id', proof.expense_id);
    await supabase.from('notifications').insert({
      user_id: proof.submitted_by,
      title: '✅ Payment Verified!',
      message: `Your payment has been verified by the owner.`,
      type: 'payment_confirmed',
      link_path: `/groups/${id}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `openProof=${proof.expense_id}&proofId=${proof.id}`,
    });
    setShowViewProofModal(false);
    showToast('Payment confirmed');
    fetchGroupAndData();
  };

  const handleRejectProof = async () => {
    if (!rejectProofReason.trim()) { showToast('Please provide a reason', 'error'); return; }
    await supabase.from('payment_proofs').update({
      status: 'rejected',
      rejection_reason: rejectProofReason
    }).eq('id', selectedProof.id);
    await supabase.from('expenses').update({ status: 'pending' }).eq('id', selectedProof.expense_id);
    await supabase.from('notifications').insert({
      user_id: selectedProof.submitted_by,
      title: '❌ Payment Proof Rejected',
      message: `Your payment proof was rejected. Reason: ${rejectProofReason}`,
      type: 'payment_rejected',
      link_path: `/groups/${id}`,
      link_state: JSON.stringify({ type: contextType }),
    });
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    showToast('Payment proof rejected');
    fetchGroupAndData();
  };

  // ---------- Render ----------
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
                <div className="member-avatar-tooltip">{getMemberAvatar(member)}</div>
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

      {/* Pending approvals (admin only) */}
      {isAdmin && pendingApprovals.length > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title">⏳ Approvals Needed ({pendingApprovals.length})</h3>
          {pendingApprovals.map(exp => (
            <div key={exp.id} className="pending-item">
              <div><strong>{exp.title}</strong><br />₱{Number(exp.amount).toFixed(2)}</div>
              <div className="pending-actions">
                <button className="approve-btn" onClick={() => handleApprove(exp)}><Check size={14} /> Approve</button>
                <button className="reject-btn" onClick={() => { setSelectedExpense(exp); setShowRejectModal(true); }}><X size={14} /> Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expenses list */}
      <div className="detail-expenses-section">
        <h3 className="section-title">📋 Expenses ({expenses.length})</h3>
        {expenses.length === 0 ? (
          <div className="empty-state">No expenses yet. Tap + to add one!</div>
        ) : (
          expenses.map(expense => {
            const badge = getStatusBadge(expense);
            const splits = expense.members_split || {};
            const myShare = splits[currentUser?.id];

            // Is this member (not owner) owed money?
            const isOwed = expense.paid_by !== currentUser?.id
              && expense.status !== 'paid'
              && expense.approval_status === 'approved'
              && myShare;

            // Find all proofs for this expense
            const proofsForExpense = allPaymentProofs.filter(p => p.expense_id === expense.id);
            
            // Member pending proof (submitted by member, waiting for owner)
            const memberPendingProof = proofsForExpense.find(
              p => p.status === 'pending_verification' && p.submitted_by !== group?.created_by
            );
            
            // Owner submitted proof (verified)
            const ownerVerifiedProof = proofsForExpense.find(
              p => p.status === 'verified' && p.submitted_by === group?.created_by
            );
            
            // Member's own submitted proof
            const mySubmittedProof = proofsForExpense.find(
              p => p.submitted_by === currentUser?.id && p.status === 'pending_verification'
            );
            
            // Any verified proof that members can view
            const anyVerifiedProof = proofsForExpense.find(p => p.status === 'verified');

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

                  {/* OWNER: Member pending proof - CLICKABLE EYE ICON */}
                  {isAdmin && memberPendingProof && (
                    <div className="owe-row" style={{ marginTop: 6 }}>
                      <button
                        className="view-proof-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => openProofModal(memberPendingProof)}
                      >
                        <Eye size={14} /> View Member's Proof
                      </button>
                    </div>
                  )}

                  {/* OWNER: Owner's own verified proof */}
                  {isAdmin && ownerVerifiedProof && (
                    <div className="owe-row" style={{ marginTop: 6 }}>
                      <button
                        className="view-proof-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#D1FAE5', color: '#065F46' }}
                        onClick={() => openProofModal(ownerVerifiedProof)}
                      >
                        <Eye size={14} /> View Your Payment Proof
                      </button>
                    </div>
                  )}

                  {/* MEMBER: Owner verified proof - clickable to view */}
                  {!isAdmin && anyVerifiedProof && (
                    <div className="owe-row" style={{ marginTop: 6 }}>
                      <button
                        className="view-proof-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#D1FAE5', color: '#065F46' }}
                        onClick={() => openProofModal(anyVerifiedProof)}
                      >
                        <Eye size={14} /> View Owner's Payment Proof
                      </button>
                    </div>
                  )}

                  {/* MEMBER: Own pending proof */}
                  {!isAdmin && mySubmittedProof && (
                    <div className="owe-row" style={{ marginTop: 6 }}>
                      <button
                        className="view-proof-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => openProofModal(mySubmittedProof)}
                      >
                        <Eye size={14} /> View Your Proof (Pending)
                      </button>
                    </div>
                  )}

                  {/* Member: owe row with Pay button */}
                  {isOwed && !memberPendingProof && !mySubmittedProof && !anyVerifiedProof && (
                    <div className="owe-row">
                      <span>You owe ₱{Number(myShare).toFixed(2)}</span>
                      <button
                        className="pay-btn-small"
                        onClick={() => {
                          setSelectedExpense(expense);
                          setProofForm({ ...proofForm, submittedBy: 'member' });
                          setShowPaymentProofModal(true);
                        }}
                      >
                        Pay
                      </button>
                    </div>
                  )}

                  {/* Owner: submit proof that they paid (for expenses they paid) */}
                  {isAdmin && expense.paid_by === currentUser?.id && expense.status !== 'paid' && !ownerVerifiedProof && (
                    <div className="owe-row">
                      <button
                        className="pay-btn-small"
                        onClick={() => {
                          setSelectedExpense(expense);
                          setProofForm({ ...proofForm, submittedBy: 'owner' });
                          setShowOwnerProofModal(true);
                        }}
                      >
                        Submit Payment Proof
                      </button>
                    </div>
                  )}
                </div>

                <div className="expense-badge" style={{ background: badge.bg, color: badge.color }}>
                  {badge.label}
                </div>

                {isAdmin && (
                  <div className="expense-admin-icons">
                    <button
                      className="icon-btn delete"
                      onClick={() => { setSelectedExpense(expense); setShowDeleteModal(true); }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* FAB */}
      <button className="fab-detail" onClick={() => setShowAddExpense(true)}><Plus size={24} /></button>

      {/* ── MODALS ── */}

      {/* Add Expense */}
      {showAddExpense && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Add Expense</h2>
              <button className="modal-close" onClick={() => { setShowAddExpense(false); resetExpenseForm(); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <input type="text" placeholder="Description *" className="detail-input" value={expenseForm.title} onChange={e => setExpenseForm({ ...expenseForm, title: e.target.value })} />
              <div className="amount-input-wrap"><span className="peso-sign">₱</span><input type="number" placeholder="0.00" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></div>
              <input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} className="detail-input" />
              <select value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })} className="detail-input">
                {Object.keys(CATEGORY_ICONS).map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={expenseForm.who_paid} onChange={e => setExpenseForm({ ...expenseForm, who_paid: e.target.value })} className="detail-input">
                <option value="">Who paid? *</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
              </select>
              <div className="split-members">
                <label style={{ fontSize: 12, fontWeight: 600 }}>Split with: *</label>
                {members.map(m => (
                  <label key={m.user_id} className="member-checkbox">
                    <input type="checkbox" checked={expenseForm.selected_members.includes(m.user_id)} onChange={e => {
                      if (e.target.checked) setExpenseForm({ ...expenseForm, selected_members: [...expenseForm.selected_members, m.user_id] });
                      else setExpenseForm({ ...expenseForm, selected_members: expenseForm.selected_members.filter(uid => uid !== m.user_id) });
                    }} /> {m.profiles?.full_name}
                  </label>
                ))}
              </div>
              <div className="split-toggle">
                <button className={`split-btn ${expenseForm.split_type === 'equal' ? 'active' : ''}`} onClick={() => setExpenseForm({ ...expenseForm, split_type: 'equal' })}>Equal</button>
                <button className={`split-btn ${expenseForm.split_type === 'custom' ? 'active' : ''}`} onClick={() => setExpenseForm({ ...expenseForm, split_type: 'custom' })}>Custom</button>
              </div>
              {expenseForm.split_type === 'custom' && expenseForm.selected_members.map(uid => {
                const member = members.find(m => m.user_id === uid);
                return (
                  <div key={uid} className="custom-split-row">
                    <span>{member?.profiles?.full_name}</span>
                    <div className="amount-input-wrap small"><span className="peso-sign">₱</span><input type="number" placeholder="0.00" value={expenseForm.custom_splits[uid] || ''} onChange={e => setExpenseForm({ ...expenseForm, custom_splits: { ...expenseForm.custom_splits, [uid]: e.target.value } })} /></div>
                  </div>
                );
              })}
              <button className="add-expense-btn" onClick={handleAddExpense} disabled={loadingAction}>{loadingAction ? 'Adding...' : 'Add Expense'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Member submits payment proof */}
      {showPaymentProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Submit Payment Proof</h2>
              <button className="modal-close" onClick={() => setShowPaymentProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview
                ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />
                : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>No screenshot selected yet</div>
              }
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}>
                <Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}
              </button>
              <textarea placeholder="Optional note (e.g. GCash ref #)" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <p style={{ fontSize: 11, color: '#9E8FCC', textAlign: 'center', margin: '0 0 4px' }}>
                The owner will review your proof before marking it as paid.
              </p>
              <button className="add-expense-btn" onClick={handleSubmitProof} disabled={loadingAction}>{loadingAction ? 'Submitting...' : 'Submit Proof'}</button>
              <button className="cancel-btn" onClick={() => setShowPaymentProofModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Owner submits proof they paid → auto-confirms for all members */}
      {showOwnerProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Confirm Payment</h2>
              <button className="modal-close" onClick={() => setShowOwnerProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview
                ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />
                : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>No screenshot selected yet</div>
              }
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}>
                <Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}
              </button>
              <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <div style={{ background: '#F0EDFF', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#3B2AAB', textAlign: 'center' }}>
                📢 This will <strong>automatically mark the expense as paid</strong> for all members. Members will be notified and can view your screenshot.
              </div>
              <button className="add-expense-btn" onClick={handleSubmitProof} disabled={loadingAction}>{loadingAction ? 'Confirming...' : 'Confirm Payment'}</button>
              <button className="cancel-btn" onClick={() => setShowOwnerProofModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* View proof modal - WORKS FOR BOTH OWNER AND MEMBERS */}
      {showViewProofModal && selectedProof && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>
                {selectedProof.submitted_by === group?.created_by
                  ? '✅ Owner Payment Proof'
                  : '📸 Member Payment Proof'}
              </h2>
              <button className="modal-close" onClick={() => setShowViewProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {/* Submitter info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8F6FF', borderRadius: 12, padding: '10px 14px', marginBottom: 4 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#3B2AAB', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {selectedProof.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#2D1A7A' }}>
                    {selectedProof.profiles?.full_name || 'Unknown'}
                    {selectedProof.submitted_by === group?.created_by ? ' (Owner)' : ''}
                  </div>
                  <div style={{ fontSize: 10, color: '#9E8FCC' }}>
                    {new Date(selectedProof.created_at).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Screenshot - CLICKABLE TO OPEN FULL SIZE */}
              <img
                src={selectedProof.screenshot_url}
                className="proof-preview"
                alt="payment proof"
                style={{ cursor: 'pointer' }}
                onClick={() => window.open(selectedProof.screenshot_url, '_blank')}
              />
              <p style={{ fontSize: 11, color: '#9E8FCC', textAlign: 'center', margin: '-4px 0 4px' }}>Tap image to open full size</p>

              {/* Note */}
              {selectedProof.note && (
                <div style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#2D1A7A' }}>
                  💬 {selectedProof.note}
                </div>
              )}

              {/* Status */}
              <div style={{
                textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '8px',
                borderRadius: 8,
                background: selectedProof.status === 'verified' ? '#D1FAE5' : selectedProof.status === 'rejected' ? '#ffe5e5' : '#fff3cd',
                color: selectedProof.status === 'verified' ? '#065F46' : selectedProof.status === 'rejected' ? '#e53e3e' : '#856404',
              }}>
                {selectedProof.status === 'verified' ? '✅ Payment Verified' : selectedProof.status === 'rejected' ? '❌ Proof Rejected' : '⏳ Pending Verification'}
              </div>

              {/* Owner action buttons — only if proof is from a member and still pending */}
              {isAdmin && selectedProof.status === 'pending_verification' && selectedProof.submitted_by !== currentUser?.id && (
                <>
                  <button className="add-expense-btn" onClick={() => handleConfirmPayment(selectedProof)}>
                    ✅ Confirm Payment
                  </button>
                  <button className="delete-confirm-btn" onClick={() => { setShowViewProofModal(false); setShowRejectProofModal(true); }}>
                    ❌ Reject Proof
                  </button>
                </>
              )}

              <button className="cancel-btn" onClick={() => setShowViewProofModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject expense */}
      {showRejectModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header"><h2>Reject Expense</h2><button className="modal-close" onClick={() => setShowRejectModal(false)}><X size={20} /></button></div>
            <div className="modal-body-scroll">
              <textarea placeholder="Reason *" value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="detail-textarea" />
              <button className="add-expense-btn" onClick={handleReject}>Confirm Reject</button>
              <button className="cancel-btn" onClick={() => setShowRejectModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete expense */}
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

      {/* Reject proof */}
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

      {/* Delete group */}
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

      {/* Kick member */}
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

      {/* Hidden file input for proof uploads */}
      <input
        type="file"
        ref={proofInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        onChange={e => {
          const file = e.target.files[0];
          if (file) setProofForm({ ...proofForm, screenshot: file, screenshotPreview: URL.createObjectURL(file) });
        }}
      />

      {toast && <div className={`toast-detail toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}