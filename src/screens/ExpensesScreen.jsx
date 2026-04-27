import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Search, Filter, X, Check, Plus,
  Trash2, AlertCircle
} from 'lucide-react';
import './ExpensesScreen.css';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';

const CATEGORY_ICONS = {
  Rent: '🏠', Electricity: '⚡', Water: '💧', Internet: '📶',
  Food: '🍽️', Grocery: '🛒', Other: '📦', Transport: '🚗', Entertainment: '🎬'
};

const CATEGORY_COLORS = {
  Rent: '#3B2AAB', Electricity: '#2B6CB0', Water: '#2C7A7B',
  Internet: '#6B46C1', Food: '#C05621', Grocery: '#276749',
  Other: '#718096', Transport: '#DD6B20', Entertainment: '#D53F8C'
};

export default function ExpensesScreen() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const proofInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [selectedHousehold, setSelectedHousehold] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expenses, setExpenses] = useState([]);
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
  const [showHouseholdSelector, setShowHouseholdSelector] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectProofModal, setShowRejectProofModal] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
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
    expense_type: 'Rent',
    expense_date: new Date().toISOString().split('T')[0],
    location: '',
    who_paid: '',
    split_type: 'equal',
    selected_members: [],
    custom_splits: {},
  });
  const [expenseErrors, setExpenseErrors] = useState({});

  // Payment proof form
  const [proofForm, setProofForm] = useState({ note: '', screenshot: null, screenshotPreview: null });
  const [rejectReason, setRejectReason] = useState('');
  const [rejectProofReason, setRejectProofReason] = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ==================== DATA FETCHING (FIXED) ====================
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

      // Fetch all households user is a member of
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
      
      // Set first household as selected by default
      if (householdsData && householdsData.length > 0) {
        setSelectedHousehold(householdsData[0]);
      }

      await fetchNotifications(user.id);

    } catch (err) {
      console.error(err);
    }
  }, [navigate]);

  const fetchExpenses = async (profileData, user, adminStatus, memberData, householdId) => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const { data: expensesData } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', householdId || profileData.household_id)
      .order('created_at', { ascending: false });

    if (!expensesData) return;

    setExpenses(expensesData);
    setFilteredExpenses(expensesData);

    if (adminStatus) {
      const pending = expensesData.filter(e => e.approval_status === 'pending_approval');
      setPendingApprovals(pending);

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
    }

    const monthExpenses = expensesData.filter(e =>
      e.expense_date >= firstDay && e.expense_date <= lastDay &&
      e.approval_status === 'approved'
    );

    const total = monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    setTotalShared(total);

    let reimburseTotal = 0;
    const reimburseList = [];
    let savedTotal = 0;

    monthExpenses.forEach(e => {
      if (e.members_split) {
        const splits = e.members_split;
        const myShare = splits[user.id];
        if (myShare && e.paid_by !== user.id && e.status !== 'paid') {
          reimburseTotal += Number(myShare);
          const payer = memberData?.find(m => m.user_id === e.paid_by);
          reimburseList.push({
            expense: e,
            amount: myShare,
            payer: payer?.profiles,
          });
        }
        if (myShare) {
          savedTotal += Number(e.amount) - Number(myShare);
        }
      }
    });

    setToReimburse(reimburseTotal);
    setReimburseDetails(reimburseList);
    setTotalSaved(savedTotal);
  };

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

  // Handle household selection
  const handleHouseholdSelect = useCallback(async (household) => {
    setSelectedHousehold(household);
    setShowHouseholdSelector(false);
    setExpenseForm(prev => ({ ...prev, location: household?.name || '' }));

    // Fetch members for this household
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

    const userMember = membersList.find(m => m.user_id === currentUser.id);
    const adminStatus = userMember?.role === 'owner';
    setIsAdmin(adminStatus);
    if (adminStatus) setExpenseForm(prev => ({ ...prev, who_paid: currentUser.id }));

    await fetchExpenses(profile, currentUser, adminStatus, membersList, household.id);
  }, [currentUser, profile]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // When household is selected, fetch its data
  useEffect(() => {
    if (selectedHousehold && currentUser && profile) {
      handleHouseholdSelect(selectedHousehold);
    }
  }, [selectedHousehold]);

  // Realtime subscriptions
  useEffect(() => {
    if (!currentUser || !selectedHousehold) return;

    const channel = supabase
      .channel('expenses-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `household_id=eq.${selectedHousehold?.id}`,
      }, () => {
        if (profile && currentUser) {
          handleHouseholdSelect(selectedHousehold);
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev]);
        setUnreadCount(prev => prev + 1);
        showToast(payload.new.message, 'info');
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [currentUser, selectedHousehold?.id, profile]);

  // Search & Filter
  useEffect(() => {
    let result = [...expenses];
    if (searchQuery) result = result.filter(e => e.title.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterStatus.length > 0) result = result.filter(e => filterStatus.includes(e.status));
    if (filterCategory.length > 0) result = result.filter(e => filterCategory.includes(e.category));
    if (filterFrom) result = result.filter(e => e.expense_date >= filterFrom);
    if (filterTo) result = result.filter(e => e.expense_date <= filterTo);
    setFilteredExpenses(result);
  }, [searchQuery, filterStatus, filterCategory, filterFrom, filterTo, expenses]);

  // ==================== EXPENSE ACTIONS ====================
  const handleAddExpense = async () => {
    const errors = {};
    if (!expenseForm.title.trim()) errors.title = 'Title is required';
    if (!expenseForm.amount || isNaN(expenseForm.amount)) errors.amount = 'Valid amount is required';
    if (!expenseForm.expense_date) errors.expense_date = 'Date is required';
    if (!expenseForm.who_paid) errors.who_paid = 'Please select who paid';
    if (expenseForm.selected_members.length === 0) errors.members = 'Select at least one member to split with';

    if (Object.keys(errors).length > 0) {
      setExpenseErrors(errors);
      showToast(Object.values(errors)[0], 'error');
      return;
    }

    setLoading(true);

    const splits = {};
    const totalAmount = Number(expenseForm.amount);
    if (expenseForm.split_type === 'equal') {
      const share = totalAmount / expenseForm.selected_members.length;
      expenseForm.selected_members.forEach(id => { splits[id] = share.toFixed(2); });
    } else {
      let customTotal = 0;
      expenseForm.selected_members.forEach(id => {
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

    const insertData = {
      household_id: profile.household_id,
      created_by: currentUser.id,
      title: expenseForm.title.trim(),
      amount: totalAmount,
      category: expenseForm.category,
      expense_type: expenseForm.category,   // FIXED
      expense_date: expenseForm.expense_date,
      location: expenseForm.location,
      paid_by: expenseForm.who_paid,
      split_type: expenseForm.split_type,
      members_split: splits,
      status: 'pending',
      approval_status: isAdmin ? 'approved' : 'pending_approval',
    };

    const { error } = await supabase.from('expenses').insert(insertData);
    if (error) {
      showToast('Failed to add expense: ' + error.message, 'error');
    } else {
      showToast(isAdmin ? 'Expense added! ✅' : 'Expense submitted for approval! ⏳');
      setShowAddExpense(false);
      resetExpenseForm();
      if (!isAdmin && household?.created_by) {
        await supabase.from('notifications').insert({
          user_id: household.created_by,
          title: 'New Expense Pending Approval',
          message: `${profile?.full_name} submitted "${expenseForm.title}" for ₱${expenseForm.amount}`,
          type: 'approval_request',
        });
      }
      fetchData();
    }
    setLoading(false);
  };

  const resetExpenseForm = () => {
    setExpenseForm({
      title: '',
      amount: '',
      category: 'Rent',
      expense_type: 'Rent',
      expense_date: new Date().toISOString().split('T')[0],
      location: household?.name || '',
      who_paid: isAdmin ? currentUser?.id : '',
      split_type: 'equal',
      selected_members: [],
      custom_splits: {},
    });
    setExpenseErrors({});
  };

  const handleApprove = async (expense) => {
    await supabase.from('expenses').update({ approval_status: 'approved' }).eq('id', expense.id);
    await supabase.from('notifications').insert({
      user_id: expense.created_by,
      title: 'Expense Approved! ✅',
      message: `Your expense "${expense.title}" for ₱${expense.amount} has been approved!`,
      type: 'approval',
    });
    showToast('Expense approved! ✅');
    fetchData();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { showToast('Please provide a rejection reason.', 'error'); return; }
    await supabase.from('expenses').update({
      approval_status: 'rejected',
      rejection_reason: rejectReason,
    }).eq('id', selectedExpense.id);
    await supabase.from('notifications').insert({
      user_id: selectedExpense.created_by,
      title: 'Expense Rejected ❌',
      message: `Your expense "${selectedExpense.title}" was rejected. Reason: ${rejectReason}`,
      type: 'rejection',
    });
    setShowRejectModal(false);
    setRejectReason('');
    setSelectedExpense(null);
    showToast('Expense rejected.');
    fetchData();
  };

  const handleDelete = async () => {
    await supabase.from('expenses').delete().eq('id', selectedExpense.id);
    setShowDeleteModal(false);
    setSelectedExpense(null);
    showToast('Expense deleted.');
    fetchData();
  };

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
    await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: urlData.publicUrl,
      note: proofForm.note,
      status: 'pending_verification',
    });
    await supabase.from('expenses').update({ status: 'verifying' }).eq('id', selectedExpense.id);
    await supabase.from('notifications').insert({
      user_id: household?.created_by,
      title: 'Payment Proof Submitted 📸',
      message: `${profile?.full_name} submitted payment proof for "${selectedExpense.title}"`,
      type: 'payment_proof',
    });
    setShowPaymentProofModal(false);
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
    setSelectedExpense(null);
    showToast('Payment proof submitted! ⏳');
    setLoading(false);
    fetchData();
  };

  const handleConfirmPayment = async (proof) => {
    await supabase.from('payment_proofs').update({ status: 'verified' }).eq('id', proof.id);
    await supabase.from('expenses').update({ status: 'paid' }).eq('id', proof.expense_id);
    await supabase.from('notifications').insert({
      user_id: proof.submitted_by,
      title: 'Payment Confirmed! ✅',
      message: `Your payment has been verified!`,
      type: 'payment_confirmed',
    });
    setShowViewProofModal(false);
    showToast('Payment confirmed! ✅');
    fetchData();
  };

  const handleRejectProof = async () => {
    if (!rejectProofReason.trim()) { showToast('Please provide a rejection reason.', 'error'); return; }
    await supabase.from('payment_proofs').update({ status: 'rejected', rejection_reason: rejectProofReason }).eq('id', selectedProof.id);
    await supabase.from('expenses').update({ status: 'pending' }).eq('id', selectedProof.expense_id);
    await supabase.from('notifications').insert({
      user_id: selectedProof.submitted_by,
      title: 'Payment Proof Rejected ❌',
      message: `Your payment proof was rejected. Reason: ${rejectProofReason}`,
      type: 'payment_rejected',
    });
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    showToast('Payment proof rejected.');
    fetchData();
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

  const getStatusBadge = (expense) => {
    if (expense.approval_status === 'pending_approval') return { label: 'Waiting Approval', color: '#3B2AAB', bg: '#F0EDFF' };
    if (expense.approval_status === 'rejected') return { label: 'Rejected', color: '#e53e3e', bg: '#ffe5e5' };
    if (expense.status === 'paid') return { label: 'Paid', color: '#38a169', bg: '#f0fff4' };
    if (expense.status === 'verifying') return { label: 'Verifying', color: '#c05621', bg: '#fffaf0' };
    return { label: 'Pending', color: '#856404', bg: '#fff3cd' };
  };

  const getMemberAvatar = (member) => {
    const p = member?.profiles;
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="member-avatar-img" />;
    const initials = p?.full_name?.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase() || '?';
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

      <div className="expenses-content">
        {/* Household Pill Toggle — always visible */}
        {households.length > 0 && (
          <div className="hh-toggle-row">
            {households.map(hh => (
              <button
                key={hh.id}
                className={`hh-toggle-pill${selectedHousehold?.id === hh.id ? ' active' : ''}`}
                onClick={() => handleHouseholdSelect(hh)}
              >
                🏠 {hh.name}
                {selectedHousehold?.id === hh.id && <span className="hh-pill-dot" />}
              </button>
            ))}
          </div>
        )}

        {/* Premium Stat Cards */}
        <div className="stat-cards-row">
          {/* Total Shared */}
          <div className="stat-card stat-card--indigo">
            <div className="stat-card-top">
              <span className="stat-card-emoji">💸</span>
              <span className="stat-card-label">Total Shared</span>
            </div>
            <p className="stat-card-amount">₱{totalShared.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="stat-card-sub">this month · {selectedHousehold?.name || '—'}</p>
          </div>

          {/* To Reimburse */}
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
                      Owe ₱{Number(r.amount).toFixed(2)} → {r.payer?.full_name}
                    </span>
                  ))
                : 'Nothing to pay 🎉'}
            </p>
          </div>

          {/* Total Saved */}
          <div className="stat-card stat-card--emerald">
            <div className="stat-card-top">
              <span className="stat-card-emoji">🏦</span>
              <span className="stat-card-label">Total Saved</span>
            </div>
            <p className="stat-card-amount">₱{totalSaved.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="stat-card-sub">vs paying alone</p>
          </div>
        </div>

        {/* Admin Pending Approvals */}
        {isAdmin && pendingApprovals.length > 0 && (
          <div className="pending-section">
            <p className="pending-section-title">⏳ Pending Approvals ({pendingApprovals.length})</p>
            {pendingApprovals.map(expense => (
              <div key={expense.id} className="pending-item">
                <div className="pending-info">
                  <p className="pending-name">{expense.title}</p>
                  <p className="pending-amount">₱{Number(expense.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="pending-date">{expense.expense_date}</p>
                </div>
                <div className="pending-actions">
                  <button className="approve-btn" onClick={() => handleApprove(expense)}><Check size={14}/> Approve</button>
                  <button className="reject-btn" onClick={() => { setSelectedExpense(expense); setShowRejectModal(true); }}><X size={14}/> Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Admin Payment Proofs */}
        {isAdmin && pendingPaymentProofs.length > 0 && (
          <div className="pending-section">
            <p className="pending-section-title">📸 Payment Proofs to Verify ({pendingPaymentProofs.length})</p>
            {pendingPaymentProofs.map(proof => (
              <div key={proof.id} className="pending-item">
                <div className="pending-info">
                  <p className="pending-name">{proof.profiles?.full_name}</p>
                  <p className="pending-date">{proof.note || 'No note'}</p>
                </div>
                <button className="view-proof-btn" onClick={() => { setSelectedProof(proof); setShowViewProofModal(true); }}>View Proof</button>
              </div>
            ))}
          </div>
        )}

        {/* Search & Filter */}
        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon"/>
            <input type="text" placeholder="Search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}><Filter size={14}/> Filter</button>
        </div>

        {/* Expense List */}
        {filteredExpenses.length === 0 && (
          <div className="expenses-empty">
            <span className="expenses-empty-icon">🧾</span>
            <p className="expenses-empty-title">No expenses yet</p>
            <p className="expenses-empty-sub">Tap + to add your first expense for {selectedHousehold?.name || 'this household'}.</p>
          </div>
        )}
        {filteredExpenses.map(expense => {
          const badge = getStatusBadge(expense);
          const myReimburse = reimburseDetails.find(r => r.expense.id === expense.id);
          const expenseMembers = expense.members_split
            ? Object.keys(expense.members_split).map(uid => householdMembers.find(m => m.user_id === uid)).filter(Boolean)
            : [];
          return (
            <div key={expense.id} className="expense-item" style={{ borderLeftColor: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}>
              <div className="expense-icon-circle" style={{ background: `${CATEGORY_COLORS[expense.category]}22` || '#F0EDFF' }}>
                <span style={{ fontSize: 20 }}>{CATEGORY_ICONS[expense.category] || '📦'}</span>
              </div>
              <div className="expense-body">
                <div className="expense-title-row">
                  <p className="expense-name">{expense.title}</p>
                  <p className="expense-amount">₱{Number(expense.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <p className="expense-meta">{expense.expense_date}{expense.location ? ` · ${expense.location}` : ''}</p>
                <div className="expense-footer-row">
                  <div className="expense-members">
                    {expenseMembers.slice(0,3).map((m,i) => (
                      <div key={i} className="member-avatar-wrap">{getMemberAvatar(m)}</div>
                    ))}
                    {expenseMembers.length > 3 && <div className="member-avatar-more">+{expenseMembers.length-3}</div>}
                  </div>
                  <span className="status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                </div>
                {expense.approval_status === 'rejected' && <p className="rejection-reason">Reason: {expense.rejection_reason}</p>}
                {myReimburse && expense.status !== 'paid' && expense.status !== 'verifying' && (
                  <div className="reimburse-row">
                    <span className="owe-text">You owe ₱{Number(myReimburse.amount).toFixed(2)} to {myReimburse.payer?.full_name}</span>
                    <button className="pay-btn" onClick={() => { setSelectedExpense(expense); setShowPaymentProofModal(true); }}>Pay</button>
                  </div>
                )}
              </div>
              {isAdmin && (
                <div className="expense-admin-col">
                  <button className="icon-btn delete" onClick={() => { setSelectedExpense(expense); setShowDeleteModal(true); }}><Trash2 size={14}/></button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* FAB */}
      <button className="fab-btn" onClick={() => setShowAddExpense(true)}><Plus size={24}/></button>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="modal-overlay">
          <div className="add-expense-modal">
            <div className="modal-header">
              <h2>Create New Expense</h2>
              <button className="modal-close" onClick={() => { setShowAddExpense(false); resetExpenseForm(); }}><X size={18}/></button>
            </div>
            <div className="modal-scroll">
              <div className="form-group">
                <label>Amount</label>
                <div className="amount-input-wrap"><span className="peso-sign">₱</span><input type="number" placeholder="0.00" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} /></div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" placeholder="Description" value={expenseForm.title} onChange={e => setExpenseForm({...expenseForm, title: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({...expenseForm, expense_date: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Category</label>
                <div className="select-wrap"><select value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})}>{Object.keys(CATEGORY_ICONS).map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14} className="select-arrow"/></div>
              </div>
              <div className="form-group">
                <label>Location</label>
                <input type="text" placeholder="Location" value={expenseForm.location} onChange={e => setExpenseForm({...expenseForm, location: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Who Paid</label>
                <div className="select-wrap">
                  <select value={expenseForm.who_paid} onChange={e => setExpenseForm({...expenseForm, who_paid: e.target.value})}>
                    <option value="">Select</option>
                    {householdMembers.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
                  </select><ChevronDown size={14} className="select-arrow"/>
                </div>
              </div>
              <div className="form-group">
                <label>Split With</label>
                <div className="members-select">
                  {householdMembers.map(m => (
                    <label key={m.user_id} className="member-checkbox">
                      <input type="checkbox" checked={expenseForm.selected_members.includes(m.user_id)} onChange={e => {
                        if (e.target.checked) setExpenseForm({...expenseForm, selected_members: [...expenseForm.selected_members, m.user_id]});
                        else setExpenseForm({...expenseForm, selected_members: expenseForm.selected_members.filter(id => id !== m.user_id)});
                      }} /> {m.profiles?.full_name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Splitting Method</label>
                <div className="split-toggle">
                  <button className={`split-btn ${expenseForm.split_type === 'equal' ? 'active' : ''}`} onClick={() => setExpenseForm({...expenseForm, split_type: 'equal'})}>Equal Split</button>
                  <button className={`split-btn ${expenseForm.split_type === 'custom' ? 'active' : ''}`} onClick={() => setExpenseForm({...expenseForm, split_type: 'custom'})}>Custom Split</button>
                </div>
              </div>
              {expenseForm.split_type === 'custom' && (
                <div className="form-group">
                  <label>Custom Amounts</label>
                  {expenseForm.selected_members.map(uid => {
                    const member = householdMembers.find(m => m.user_id === uid);
                    return (
                      <div key={uid} className="custom-split-row">
                        <span>{member?.profiles?.full_name}</span>
                        <div className="amount-input-wrap small">
                          <span className="peso-sign">₱</span>
                          <input type="number" placeholder="0.00" value={expenseForm.custom_splits[uid] || ''} onChange={e => setExpenseForm({...expenseForm, custom_splits: {...expenseForm.custom_splits, [uid]: e.target.value}})} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button className="add-expense-btn" onClick={handleAddExpense} disabled={loading}>{loading ? 'Adding...' : 'Add Expense'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilter && (
        <div className="modal-overlay">
          <div className="filter-modal">
            <div className="modal-header"><h2>Filter</h2><button className="modal-close" onClick={() => setShowFilter(false)}><X size={18}/></button></div>
            <div className="form-group"><label>Status</label><div className="checkbox-group">{['paid','pending','unpaid','verifying'].map(s => (<label key={s} className="checkbox-label"><input type="checkbox" checked={filterStatus.includes(s)} onChange={e => {if(e.target.checked) setFilterStatus([...filterStatus,s]); else setFilterStatus(filterStatus.filter(x=>x!==s));}} />{s.charAt(0).toUpperCase()+s.slice(1)}</label>))}</div></div>
            <div className="form-group"><label>Category</label><div className="checkbox-group">{Object.keys(CATEGORY_ICONS).map(c => (<label key={c} className="checkbox-label"><input type="checkbox" checked={filterCategory.includes(c)} onChange={e => {if(e.target.checked) setFilterCategory([...filterCategory,c]); else setFilterCategory(filterCategory.filter(x=>x!==c));}} />{c}</label>))}</div></div>
            <div className="form-group"><label>Date Range</label><div className="date-range-row"><input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}/><span>to</span><input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)}/></div></div>
            <div className="filter-actions"><button className="filter-reset-btn" onClick={()=>{setFilterStatus([]); setFilterCategory([]); setFilterFrom(''); setFilterTo(''); setShowFilter(false);}}>Reset</button><button className="filter-apply-btn" onClick={()=>setShowFilter(false)}>Apply</button></div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="modal-overlay">
          <div className="small-modal"><h2>Reject Expense</h2><textarea placeholder="Reason" value={rejectReason} onChange={e=>setRejectReason(e.target.value)} className="reject-textarea"/><button className="add-expense-btn" onClick={handleReject}>Confirm</button><button className="edit-cancel-btn" onClick={()=>{setShowRejectModal(false); setRejectReason('');}}>Cancel</button></div>
        </div>
      )}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="small-modal"><AlertCircle size={40} color="#e53e3e"/><h2>Delete Expense?</h2><button className="delete-confirm-btn" onClick={handleDelete}>Yes, Delete</button><button className="edit-cancel-btn" onClick={()=>setShowDeleteModal(false)}>Cancel</button></div>
        </div>
      )}
      {showPaymentProofModal && (
        <div className="modal-overlay">
          <div className="small-modal"><h2>Submit Payment Proof</h2>{proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} className="proof-preview"/>}<button className="upload-proof-btn" onClick={()=>proofInputRef.current.click()}><Camera size={16}/> Upload Screenshot</button><textarea placeholder="Optional note" value={proofForm.note} onChange={e=>setProofForm({...proofForm, note:e.target.value})} className="reject-textarea"/><button className="add-expense-btn" onClick={handleSubmitProof} disabled={loading}>{loading?'Submitting...':'Submit'}</button><button className="edit-cancel-btn" onClick={()=>{setShowPaymentProofModal(false); setProofForm({note:'', screenshot:null, screenshotPreview:null});}}>Cancel</button></div>
        </div>
      )}
      {showViewProofModal && selectedProof && (
        <div className="modal-overlay">
          <div className="small-modal"><h2>Payment Proof</h2><img src={selectedProof.screenshot_url} className="proof-preview"/><p>{selectedProof.note}</p><button className="add-expense-btn" onClick={()=>handleConfirmPayment(selectedProof)}>Confirm Payment</button><button className="delete-confirm-btn" onClick={()=>{setShowViewProofModal(false); setShowRejectProofModal(true);}}>Reject Proof</button><button className="edit-cancel-btn" onClick={()=>setShowViewProofModal(false)}>Cancel</button></div>
        </div>
      )}
      {showRejectProofModal && (
        <div className="modal-overlay">
          <div className="small-modal"><h2>Reject Payment Proof</h2><textarea placeholder="Reason" value={rejectProofReason} onChange={e=>setRejectProofReason(e.target.value)} className="reject-textarea"/><button className="add-expense-btn" onClick={handleRejectProof}>Confirm</button><button className="edit-cancel-btn" onClick={()=>setShowRejectProofModal(false)}>Cancel</button></div>
        </div>
      )}

      <BottomNav active="expenses" pendingCount={isAdmin ? pendingApprovals.length : 0} />
    </div>
  );
}