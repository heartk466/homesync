import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  ArrowLeft, Users, Plus, Check, X, Camera,
  Copy, Share2, DollarSign, AlertCircle, Trash2, Edit
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
  const { type: contextType = 'group' } = location.state || {};

  const proofInputRef = useRef(null);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [filteredExpenses, setFilteredExpenses] = useState([]);
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
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingPaymentProofs, setPendingPaymentProofs] = useState([]);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [toast, setToast] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const [expenseForm, setExpenseForm] = useState({
    title: '', amount: '', category: 'Food',
    expense_date: new Date().toISOString().split('T')[0],
    location: '', who_paid: '', split_type: 'equal',
    selected_members: [], custom_splits: {}
  });
  const [expenseErrors, setExpenseErrors] = useState({});

  const [proofForm, setProofForm] = useState({
    note: '', screenshot: null, screenshotPreview: null
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ========== FIXED fetch function ==========
  const fetchGroupAndData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      // Determine type and fetch entity
      let resolvedType = contextType;
      let groupData = null;

      if (contextType === 'household') {
        const { data } = await supabase.from('households').select('*').eq('id', id).maybeSingle();
        groupData = data;
        if (!groupData) resolvedType = 'group';
      } else {
        const { data } = await supabase.from('groups').select('*').eq('id', id).maybeSingle();
        if (data) {
          groupData = data;
          resolvedType = 'group';
        } else {
          const { data: hhData } = await supabase.from('households').select('*').eq('id', id).maybeSingle();
          if (hhData) {
            groupData = hhData;
            resolvedType = 'household';
          }
        }
      }

      if (!groupData) {
        setError('Group or household not found. It may have been deleted.');
        setLoading(false);
        return;
      }
      setGroup(groupData);

      // Fetch members
      let membersList = [];
      let adminStatus = false;

      if (resolvedType === 'household') {
        const { data: memberRows } = await supabase
          .from('household_members')
          .select('user_id, role, status')
          .eq('household_id', id)
          .eq('status', 'active');

        if (memberRows && memberRows.length) {
          const userIds = memberRows.map(m => m.user_id);
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', userIds);
          const profilesMap = Object.fromEntries((profilesData || []).map(p => [p.id, p]));
          membersList = memberRows.map(m => ({
            user_id: m.user_id,
            role: m.role,
            status: m.status,
            profiles: profilesMap[m.user_id] || { full_name: 'Unknown', email: '' }
          }));
        }
        const userMember = membersList.find(m => m.user_id === user.id);
        adminStatus = userMember?.role === 'owner' || groupData.created_by === user.id;
      } else {
        const { data: memberRows } = await supabase
          .from('group_members')
          .select('user_id, role, status')
          .eq('group_id', id)
          .eq('status', 'active');

        if (memberRows && memberRows.length) {
          const userIds = memberRows.map(m => m.user_id);
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', userIds);
          const profilesMap = Object.fromEntries((profilesData || []).map(p => [p.id, p]));
          membersList = memberRows.map(m => ({
            user_id: m.user_id,
            role: m.role,
            status: m.status,
            profiles: profilesMap[m.user_id] || { full_name: 'Unknown', email: '' }
          }));
        }
        const userMember = membersList.find(m => m.user_id === user.id);
        adminStatus = userMember?.role === 'owner' || groupData.created_by === user.id;

        if (!userMember && groupData.created_by === user.id) {
          membersList.unshift({
            user_id: user.id,
            role: 'owner',
            status: 'active',
            profiles: { id: user.id, full_name: profileData?.full_name || 'You', email: profileData?.email || '', avatar_url: profileData?.avatar_url || null }
          });
        }
      }

      setIsAdmin(adminStatus);
      setMembers(membersList);

      // Fetch expenses
      const expenseColumn = resolvedType === 'household' ? 'household_id' : 'group_id';
      const { data: expensesData } = await supabase
        .from('expenses')
        .select('*')
        .eq(expenseColumn, id)
        .order('created_at', { ascending: false });

      const allExpenses = expensesData || [];
      setExpenses(allExpenses);
      setFilteredExpenses(allExpenses);

      if (adminStatus) {
        const pending = allExpenses.filter(e => e.approval_status === 'pending_approval');
        setPendingApprovals(pending);
        if (allExpenses.length > 0) {
          const { data: proofs } = await supabase
            .from('payment_proofs')
            .select(`*, profiles:submitted_by ( id, full_name, email, avatar_url )`)
            .eq('status', 'pending_verification')
            .in('expense_id', allExpenses.map(e => e.id));
          setPendingPaymentProofs(proofs || []);
        } else {
          setPendingPaymentProofs([]);
        }
      } else {
        setPendingApprovals([]);
        setPendingPaymentProofs([]);
      }
    } catch (err) {
      console.error('fetchGroupAndData error:', err);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [id, contextType, navigate]);

  useEffect(() => {
    fetchGroupAndData();
  }, [fetchGroupAndData]);

  // Realtime subscription
  useEffect(() => {
    if (!currentUser || !group) return;
    const expenseColumn = contextType === 'household' ? 'household_id' : 'group_id';
    const channel = supabase
      .channel('group-detail-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `${expenseColumn}=eq.${id}`,
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'payment_proofs',
      }, () => fetchGroupAndData())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, group, id, contextType, fetchGroupAndData]);

  // ========== Handlers (original) ==========
  const handleAddExpense = async () => {
    const errors = {};
    if (!expenseForm.title.trim()) errors.title = 'Title required';
    if (!expenseForm.amount || isNaN(expenseForm.amount)) errors.amount = 'Valid amount required';
    if (!expenseForm.expense_date) errors.expense_date = 'Date required';
    if (!expenseForm.who_paid) errors.who_paid = 'Select who paid';
    if (expenseForm.selected_members.length === 0) errors.members = 'Select at least one member';

    if (Object.keys(errors).length > 0) {
      setExpenseErrors(errors);
      showToast('Please fill in all required fields', 'error');
      return;
    }

    setLoadingAction(true);
    const splits = {};
    if (expenseForm.split_type === 'equal') {
      const share = Number(expenseForm.amount) / expenseForm.selected_members.length;
      expenseForm.selected_members.forEach(uid => { splits[uid] = share.toFixed(2); });
    } else {
      expenseForm.selected_members.forEach(uid => {
        splits[uid] = expenseForm.custom_splits[uid] || 0;
      });
    }

    const resolvedType = contextType;
    const insertData = {
      title: expenseForm.title.trim(),
      amount: Number(expenseForm.amount),
      category: expenseForm.category,
      expense_type: expenseForm.category,
      expense_date: expenseForm.expense_date,
      location: expenseForm.location || group?.name,
      paid_by: expenseForm.who_paid,
      split_type: expenseForm.split_type,
      members_split: splits,
      status: 'pending',
      approval_status: isAdmin ? 'approved' : 'pending_approval',
      created_by: currentUser.id,
    };

    if (resolvedType === 'household') {
      insertData.household_id = id;
    } else {
      insertData.group_id = id;
    }

    const { error } = await supabase.from('expenses').insert(insertData);
    if (error) {
      showToast(`Failed to add expense: ${error.message}`, 'error');
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
        });
      }
    }
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const handleApprove = async (expense) => {
    await supabase.from('expenses').update({ approval_status: 'approved' }).eq('id', expense.id);
    await supabase.from('notifications').insert({
      user_id: expense.created_by,
      title: 'Expense Approved',
      message: `Your expense "${expense.title}" was approved.`,
      type: 'approval',
    });
    showToast('Expense approved');
    fetchGroupAndData();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      showToast('Please provide a reason', 'error');
      return;
    }
    await supabase.from('expenses').update({
      approval_status: 'rejected',
      rejection_reason: rejectReason
    }).eq('id', selectedExpense.id);
    await supabase.from('notifications').insert({
      user_id: selectedExpense.created_by,
      title: 'Expense Rejected',
      message: `Your expense "${selectedExpense.title}" was rejected. Reason: ${rejectReason}`,
      type: 'rejection',
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
      const resolvedType = contextType;
      if (resolvedType === 'household') {
        await supabase.from('expenses').delete().eq('household_id', id);
        await supabase.from('household_members').delete().eq('household_id', id);
        await supabase.from('households').delete().eq('id', id);
      } else {
        await supabase.from('expenses').delete().eq('group_id', id);
        await supabase.from('group_members').delete().eq('group_id', id);
        await supabase.from('groups').delete().eq('id', id);
      }
      showToast(resolvedType === 'household' ? 'Household deleted' : 'Group deleted');
      setShowDeleteGroupModal(false);
      navigate('/groups');
    } catch (err) {
      console.error('Error deleting group:', err);
      showToast('Failed to delete group', 'error');
    }
    setLoadingAction(false);
  };

  const handleKickMember = async () => {
    if (!selectedMember) return;
    setLoadingAction(true);
    try {
      const resolvedType = contextType;
      if (resolvedType === 'household') {
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
      console.error('Error kicking member:', err);
      showToast('Failed to remove member', 'error');
    }
    setLoadingAction(false);
  };

  const handleSubmitProof = async () => {
    if (!proofForm.screenshot) {
      showToast('Please upload a screenshot', 'error');
      return;
    }
    setLoadingAction(true);
    const fileExt = proofForm.screenshot.name.split('.').pop();
    const fileName = `${currentUser.id}-${selectedExpense.id}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(fileName, proofForm.screenshot, { upsert: true });
    if (uploadError) {
      showToast('Upload failed', 'error');
      setLoadingAction(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);
    await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note,
      status: 'pending_verification',
    });
    await supabase.from('expenses').update({ status: 'verifying' }).eq('id', selectedExpense.id);
    await supabase.from('notifications').insert({
      user_id: isAdmin ? (group?.created_by || selectedExpense.paid_by) : group?.created_by,
      title: 'Payment Proof Submitted',
      message: `${profile?.full_name} submitted proof for "${selectedExpense.title}"`,
      type: 'payment_proof',
    });
    setShowPaymentProofModal(false);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
    setSelectedExpense(null);
    showToast('Proof submitted for verification');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const handleConfirmPayment = async (proof) => {
    const expense = expenses.find(e => e.id === proof.expense_id);
    await supabase.from('payment_proofs').update({ status: 'verified' }).eq('id', proof.id);
    await supabase.from('expenses').update({ status: 'paid' }).eq('id', proof.expense_id);
    await supabase.from('notifications').insert({
      user_id: proof.submitted_by,
      title: '✅ Payment Verified!',
      message: `Your payment proof for "${expense?.title || 'expense'}" has been accepted. The expense is now marked as paid.`,
      type: 'payment_confirmed',
    });
    setShowViewProofModal(false);
    showToast('Payment confirmed and member notified');
    fetchGroupAndData();
  };

  const handleRejectProof = async () => {
    if (!rejectProofReason.trim()) {
      showToast('Please provide a reason', 'error');
      return;
    }
    const expense = expenses.find(e => e.id === selectedProof.expense_id);
    await supabase.from('payment_proofs').update({
      status: 'rejected',
      rejection_reason: rejectProofReason
    }).eq('id', selectedProof.id);
    await supabase.from('expenses').update({ status: 'pending' }).eq('id', selectedProof.expense_id);
    await supabase.from('notifications').insert({
      user_id: selectedProof.submitted_by,
      title: '❌ Payment Proof Rejected',
      message: `Your payment proof for "${expense?.title || 'expense'}" was rejected. Reason: ${rejectProofReason}. Please submit a new proof of payment.`,
      type: 'payment_rejected',
    });
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    showToast('Payment proof rejected - member notified');
    fetchGroupAndData();
  };

  const resetExpenseForm = () => {
    setExpenseForm({
      title: '', amount: '', category: 'Food',
      expense_date: new Date().toISOString().split('T')[0],
      location: group?.name || '', who_paid: currentUser?.id || '',
      split_type: 'equal', selected_members: [], custom_splits: {}
    });
    setExpenseErrors({});
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

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${group?.name}`, text: `Use code: ${group?.code}` });
      } catch { handleCopyCode(); }
    } else { handleCopyCode(); }
  };

  // ========== Render ==========
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
          <button className="add-expense-btn" style={{ marginTop: 16, width: 'auto', padding: '8px 20px' }} onClick={() => fetchGroupAndData()}>Retry</button>
          <button className="cancel-btn" style={{ marginTop: 8 }} onClick={() => navigate('/groups')}>Back to Groups</button>
        </div>
      </div>
    );
  }

  // ---------- Normal JSX (original) ----------
  return (
    <div className="group-detail-screen">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
        <div className="detail-header-info">
          <h1 className="detail-group-name">{group?.name}</h1>
          <p className="detail-group-type">{contextType === 'household' ? '🏠 Household' : '✈️ Trip Group'}</p>
        </div>
        <div className="detail-code-actions">
          <button className="icon-btn-sm" onClick={handleCopyCode}><Copy size={16} /></button>
          <button className="icon-btn-sm" onClick={handleShare}><Share2 size={16} /></button>
          {isAdmin && (
            <button className="icon-btn-sm" onClick={() => setShowDeleteGroupModal(true)} title="Delete Group">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="detail-members-section">
        <h3 className="section-title">👥 Members ({members.length})</h3>
        {members.length === 0 ? (
          <p style={{ fontSize: 12, color: '#9E8FCC', margin: 0 }}>No members found.</p>
        ) : (
          <div className="members-list">
            {members.map(member => (
              <div key={member.user_id} className="member-row">
                <div className="member-avatar-tooltip" title={member.profiles?.full_name}>
                  {getMemberAvatar(member)}
                </div>
                <div className="member-info">
                  <span className="member-name">{member.profiles?.full_name}</span>
                  <span className="member-role">{member.role === 'owner' ? 'Owner' : 'Member'}</span>
                </div>
                {isAdmin && member.user_id !== currentUser?.id && (
                  <button 
                    className="kick-btn" 
                    onClick={() => { setSelectedMember(member); setShowKickMemberModal(true); }}
                    title="Remove member"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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

      {isAdmin && pendingPaymentProofs.length > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title">📸 Proofs to Verify ({pendingPaymentProofs.length})</h3>
          {pendingPaymentProofs.map(proof => (
            <div key={proof.id} className="pending-item">
              <div>{proof.profiles?.full_name}<br />{proof.note || 'No note'}</div>
              <div className="pending-actions">
                <button className="view-proof-btn" onClick={() => { setSelectedProof(proof); setShowViewProofModal(true); }}>View</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="detail-expenses-section">
        <h3 className="section-title">📋 Expenses ({filteredExpenses.length})</h3>
        {filteredExpenses.length === 0 ? (
          <div className="empty-state">No expenses yet. Tap + to add one!</div>
        ) : (
          filteredExpenses.map(expense => {
            const badge = getStatusBadge(expense);
            const splits = expense.members_split || {};
            const myShare = splits[currentUser?.id];
            const isOwed = expense.paid_by !== currentUser?.id
              && expense.status !== 'paid'
              && expense.approval_status === 'approved'
              && myShare;
            const pendingProof = pendingPaymentProofs.find(p => p.expense_id === expense.id);
            return (
              <div key={expense.id} className="expense-item-detail">
                <div
                  className="expense-icon"
                  style={{ background: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}
                >
                  <span>{CATEGORY_ICONS[expense.category] || '📦'}</span>
                </div>
                <div className="expense-info">
                  <div className="expense-title">{expense.title}</div>
                  <div className="expense-amount">₱{Number(expense.amount).toFixed(2)}</div>
                  <div className="expense-meta">
                    {expense.expense_date}{expense.location ? ` • ${expense.location}` : ''}
                  </div>
                  {pendingProof && (
                    <div className="pending-proof-indicator">
                      📸 Proof pending verification
                    </div>
                  )}
                  {isOwed && (
                    <div className="owe-row">
                      <span>You owe ₱{Number(myShare).toFixed(2)}</span>
                      <button
                        className="pay-btn-small"
                        onClick={() => { setSelectedExpense(expense); setShowPaymentProofModal(true); }}
                      >
                        Pay
                      </button>
                    </div>
                  )}
                </div>
                <div
                  className="expense-badge"
                  style={{ background: badge.bg, color: badge.color }}
                >
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

      <button className="fab-detail" onClick={() => setShowAddExpense(true)}>
        <Plus size={24} />
      </button>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Add Expense</h2>
              <button className="modal-close" onClick={() => { setShowAddExpense(false); resetExpenseForm(); }}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body-scroll">
              <input
                type="text"
                placeholder="Description *"
                className={`detail-input ${expenseErrors.title ? 'input-error' : ''}`}
                value={expenseForm.title}
                onChange={e => setExpenseForm({ ...expenseForm, title: e.target.value })}
              />
              {expenseErrors.title && <span style={{ color: '#e53e3e', fontSize: 11 }}>{expenseErrors.title}</span>}

              <div className="amount-input-wrap">
                <span className="peso-sign">₱</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={expenseForm.amount}
                  onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                />
              </div>
              {expenseErrors.amount && <span style={{ color: '#e53e3e', fontSize: 11 }}>{expenseErrors.amount}</span>}

              <input
                type="date"
                value={expenseForm.expense_date}
                onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                className="detail-input"
              />

              <select
                value={expenseForm.category}
                onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}
                className="detail-input"
              >
                {Object.keys(CATEGORY_ICONS).map(c => <option key={c}>{c}</option>)}
              </select>

              <select
                value={expenseForm.who_paid}
                onChange={e => setExpenseForm({ ...expenseForm, who_paid: e.target.value })}
                className="detail-input"
              >
                <option value="">Who paid? *</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profiles?.full_name}
                  </option>
                ))}
              </select>
              {expenseErrors.who_paid && <span style={{ color: '#e53e3e', fontSize: 11 }}>{expenseErrors.who_paid}</span>}

              <div className="split-members">
                <label style={{ fontSize: 12, color: '#5A4AAA', fontWeight: 600 }}>Split with: *</label>
                {members.length === 0 && (
                  <p style={{ fontSize: 12, color: '#9E8FCC' }}>No members available.</p>
                )}
                {members.map(m => (
                  <label key={m.user_id} className="member-checkbox">
                    <input
                      type="checkbox"
                      checked={expenseForm.selected_members.includes(m.user_id)}
                      onChange={e => {
                        if (e.target.checked)
                          setExpenseForm({ ...expenseForm, selected_members: [...expenseForm.selected_members, m.user_id] });
                        else
                          setExpenseForm({ ...expenseForm, selected_members: expenseForm.selected_members.filter(uid => uid !== m.user_id) });
                      }}
                    />
                    {m.profiles?.full_name}
                  </label>
                ))}
              </div>
              {expenseErrors.members && <span style={{ color: '#e53e3e', fontSize: 11 }}>{expenseErrors.members}</span>}

              <div className="split-toggle">
                <button
                  className={`split-btn ${expenseForm.split_type === 'equal' ? 'active' : ''}`}
                  onClick={() => setExpenseForm({ ...expenseForm, split_type: 'equal' })}
                >
                  Equal
                </button>
                <button
                  className={`split-btn ${expenseForm.split_type === 'custom' ? 'active' : ''}`}
                  onClick={() => setExpenseForm({ ...expenseForm, split_type: 'custom' })}
                >
                  Custom
                </button>
              </div>

              {expenseForm.split_type === 'custom' && expenseForm.selected_members.map(uid => {
                const member = members.find(m => m.user_id === uid);
                return (
                  <div key={uid} className="custom-split-row">
                    <span>{member?.profiles?.full_name}</span>
                    <div className="amount-input-wrap small">
                      <span className="peso-sign">₱</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={expenseForm.custom_splits[uid] || ''}
                        onChange={e => setExpenseForm({
                          ...expenseForm,
                          custom_splits: { ...expenseForm.custom_splits, [uid]: e.target.value }
                        })}
                      />
                    </div>
                  </div>
                );
              })}

              <button
                className="add-expense-btn"
                onClick={handleAddExpense}
                disabled={loadingAction}
              >
                {loadingAction ? 'Adding...' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Proof Modal */}
      {showPaymentProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Submit Payment Proof</h2>
              <button className="modal-close" onClick={() => { setShowPaymentProofModal(false); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); }}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview && (
                <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" />
              )}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}>
                <Camera size={16} /> Upload Screenshot
              </button>
              <textarea
                placeholder="Optional note"
                value={proofForm.note}
                onChange={e => setProofForm({ ...proofForm, note: e.target.value })}
                className="detail-textarea"
              />
              <button className="add-expense-btn" onClick={handleSubmitProof} disabled={loadingAction}>
                {loadingAction ? 'Submitting...' : 'Submit'}
              </button>
              <button className="cancel-btn" onClick={() => { setShowPaymentProofModal(false); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); }}>
                Cancel
              </button>
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
              <img src={selectedProof.screenshot_url} className="proof-preview" alt="proof" />
              <p>{selectedProof.note}</p>
              <button className="add-expense-btn" onClick={() => handleConfirmPayment(selectedProof)}>Confirm Payment</button>
              <button className="delete-confirm-btn" onClick={() => { setShowViewProofModal(false); setShowRejectProofModal(true); }}>Reject Proof</button>
              <button className="cancel-btn" onClick={() => setShowViewProofModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Expense Modal */}
      {showRejectModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Reject Expense</h2>
              <button className="modal-close" onClick={() => { setShowRejectModal(false); setRejectReason(''); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <textarea
                placeholder="Reason for rejection *"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="detail-textarea"
              />
              <button className="add-expense-btn" onClick={handleReject}>Confirm Reject</button>
              <button className="cancel-btn" onClick={() => { setShowRejectModal(false); setRejectReason(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Expense Modal */}
      {showDeleteModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={40} color="#e53e3e" />
              <h2>Delete Expense?</h2>
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
            <div className="modal-header">
              <h2>Reject Payment Proof</h2>
              <button className="modal-close" onClick={() => setShowRejectProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <textarea
                placeholder="Reason *"
                value={rejectProofReason}
                onChange={e => setRejectProofReason(e.target.value)}
                className="detail-textarea"
              />
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
              <p style={{ textAlign: 'center', color: '#9E8FCC', fontSize: 13 }}>
                This will permanently delete this {contextType === 'household' ? 'household' : 'group'} and all expenses. This action cannot be undone.
              </p>
              <button className="delete-confirm-btn" onClick={handleDeleteGroup} disabled={loadingAction}>
                {loadingAction ? 'Deleting...' : 'Yes, Delete'}
              </button>
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
              <AlertCircle size={40} color="#e53e3e" />
              <h2>Remove Member?</h2>
            </div>
            <div className="modal-body-scroll">
              <p style={{ textAlign: 'center', color: '#9E8FCC', fontSize: 13 }}>
                Are you sure you want to remove <strong>{selectedMember.profiles?.full_name}</strong> from this {contextType === 'household' ? 'household' : 'group'}?
              </p>
              <button className="delete-confirm-btn" onClick={handleKickMember} disabled={loadingAction}>
                {loadingAction ? 'Removing...' : 'Yes, Remove'}
              </button>
              <button className="cancel-btn" onClick={() => { setShowKickMemberModal(false); setSelectedMember(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for payment proof */}
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