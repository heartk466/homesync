import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Search, Filter, Plus, X, ChevronDown,
  Edit, Trash2, AlertCircle, Check
} from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import './UtilitiesScreen.css';
import {
  checkDuplicate,
  mergeItems,
  markItemAsPaid,
  UTILITY_CATEGORIES,
} from '../utils/expenseUtils';

const UTILITY_TYPES = ['Power', 'Water', 'Gas', 'Internet', 'Other'];

const UTILITY_CONFIG = {
  Power:    { icon: '⚡', color: '#ECC94B', bg: '#FFFFF0' },
  Water:    { icon: '💧', color: '#4299E1', bg: '#EBF8FF' },
  Gas:      { icon: '🔥', color: '#ED8936', bg: '#FFFAF0' },
  Internet: { icon: '📶', color: '#9F7AEA', bg: '#FAF5FF' },
  Other:    { icon: '🔌', color: '#718096', bg: '#F7FAFC' },
};

const SPLIT_METHODS = ['Equal Split', 'By Member', 'Usage Based'];
const REMINDER_OPTIONS = [3, 5, 7, 14];

export default function UtilitiesScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [activeHousehold, setActiveHousehold] = useState(null);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [utilities, setUtilities] = useState([]);
  const [filteredUtilities, setFilteredUtilities] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [confirmations, setConfirmations] = useState([]); // kept for compatibility

  // Summary
  const [providerCount, setProviderCount] = useState(0);
  const [activeSubscriptions, setActiveSubscriptions] = useState(0);
  const [pendingSplits, setPendingSplits] = useState(0);

  // UI State
  const [showHouseholdSwitcher, setShowHouseholdSwitcher] = useState(false);
  const [householdSearch, setHouseholdSearch] = useState('');
  const [showAddUtility, setShowAddUtility] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedUtility, setSelectedUtility] = useState(null);
  const [activeTab, setActiveTab] = useState('add');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  // Filter
  const [filterStatus, setFilterStatus] = useState([]);
  const [filterType, setFilterType] = useState([]);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Utility Form
  const [utilityForm, setUtilityForm] = useState({
    utility_type: 'Power',
    provider_name: '',
    amount: '',
    billing_date: '',
    reminder_days: 5,
    split_method: 'Equal Split',
    location: '',
    selected_members: [],
    custom_splits: {},
  });
  const [utilityErrors, setUtilityErrors] = useState({});

  // Dispute / Adjust
  const [disputeReason, setDisputeReason] = useState('');
  const [adjustedSplits, setAdjustedSplits] = useState({});

  // Duplicate & Payment Proof
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateItem, setDuplicateItem] = useState(null);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [selectedProof, setSelectedProof] = useState(null);
  const [proofForm, setProofForm] = useState({
    note: '',
    screenshot: null,
    screenshotPreview: null,
  });
  const proofInputRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      setProfile(profileData);

      const { data: memberData, error: memberError } = await supabase
        .from('household_members')
        .select('household_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (memberError) {
        showToast('Error loading household memberships.', 'error');
        return;
      }

      if (!memberData || memberData.length === 0) {
        showToast('You are not a member of any household. Please join or create one.', 'error');
        setAllHouseholds([]);
        setActiveHousehold(null);
        return;
      }

      const householdIds = memberData.map(m => m.household_id);
      const { data: householdsData, error: housesError } = await supabase
        .from('households')
        .select('*')
        .in('id', householdIds);

      if (housesError) {
        showToast('Error loading household details.', 'error');
        return;
      }

      const householdsWithRole = householdsData.map(h => ({
        ...h,
        role: memberData.find(m => m.household_id === h.id)?.role || 'member'
      }));

      setAllHouseholds(householdsWithRole);
      const primary = householdsWithRole[0];
      setActiveHousehold(primary);

      await fetchHouseholdData(primary, user);
      await fetchNotifications(user.id);
    } catch (err) {
      console.error(err);
      showToast('Failed to load data. Check your connection.', 'error');
    }
  };

  const fetchHouseholdData = async (household, user) => {
    if (!household) return;

    // Fetch members
    const { data: members, error: membersError } = await supabase
      .from('household_members')
      .select('user_id, role, status, profiles(id, full_name, email, avatar_url)')
      .eq('household_id', household.id)
      .eq('status', 'active');

    if (membersError) {
      console.error(membersError);
      return;
    }

    const membersList = (members || []).map(m => ({
      user_id: m.user_id,
      role: m.role,
      status: m.status,
      profiles: m.profiles || { full_name: 'Unknown', email: '' }
    }));
    setHouseholdMembers(membersList);

    const userMember = membersList.find(m => m.user_id === user.id);
    setIsAdmin(userMember?.role === 'owner');

    // Fetch all utility expenses (approved or pending)
    const { data: utilityExpenses, error: expError } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', household.id)
      .in('category', UTILITY_CATEGORIES)
      .order('expense_date', { ascending: false });

    if (expError) {
      showToast('Error loading utility expenses.', 'error');
      return;
    }

    if (!utilityExpenses || utilityExpenses.length === 0) {
      setUtilities([]);
      setFilteredUtilities([]);
      setProviderCount(0);
      setPendingSplits(0);
      setActiveSubscriptions(0);
      showToast(`No utility expenses found in "${household.name}". Add one via Expenses screen.`, 'info');
      return;
    }

    // Diagnostic: show what categories were found
    const categoriesFound = [...new Set(utilityExpenses.map(e => e.category))];
    showToast(`✅ Found ${utilityExpenses.length} utility expense(s) in "${household.name}". Categories: ${categoriesFound.join(', ')}`, 'info');

    // Fetch splits for these expenses
    const expenseIds = utilityExpenses.map(e => e.id);
    const { data: splitsData, error: splitsError } = await supabase
      .from('expense_splits')
      .select('*')
      .in('expense_id', expenseIds);

    if (splitsError) {
      console.error(splitsError);
    }

    const splitsByExpense = {};
    (splitsData || []).forEach(split => {
      if (!splitsByExpense[split.expense_id]) splitsByExpense[split.expense_id] = [];
      splitsByExpense[split.expense_id].push(split);
    });

    // Build utility items from expenses
    const utilityItems = utilityExpenses.map(exp => {
      const splits = splitsByExpense[exp.id] || [];
      const mySplit = splits.find(s => s.user_id === user.id);
      const myStatus = mySplit ? mySplit.status : 'unpaid';
      const myShareAmount = mySplit ? Number(mySplit.share_amount) : 0;

      return {
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
        location: exp.location || household.name,
        source: 'expenses',
        created_at: exp.created_at,
        splits: splits,
        mySplit: mySplit,
        myStatus: myStatus,
        myShareAmount: myShareAmount,
      };
    });

    setUtilities(utilityItems);
    setFilteredUtilities(utilityItems);

    // Summary counts
    const uniqueCategories = [...new Set(utilityItems.map(u => u.utility_type))];
    setProviderCount(uniqueCategories.length);
    const activeCount = utilityItems.filter(u => u.status !== 'paid').length;
    setActiveSubscriptions(activeCount);
    const pendingCount = utilityItems.filter(u => u.myStatus !== 'approved').length;
    setPendingSplits(pendingCount);

    setUtilityForm(prev => ({ ...prev, location: household.name }));
  };

  const fetchNotifications = async (userId) => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotifications(data || []);
    setUnreadCount((data || []).filter(n => !n.is_read).length);
  };

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!currentUser || !activeHousehold) return;
    const channel = supabase
      .channel('utilities-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `household_id=eq.${activeHousehold.id}` }, () => fetchHouseholdData(activeHousehold, currentUser))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => fetchHouseholdData(activeHousehold, currentUser))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, activeHousehold]);

  useEffect(() => {
    let result = [...utilities];
    if (searchQuery) {
      result = result.filter(u =>
        u.provider_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.utility_type?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (filterStatus.length > 0) result = result.filter(u => filterStatus.includes(u.status));
    if (filterType.length > 0) result = result.filter(u => filterType.includes(u.utility_type));
    if (filterFrom) result = result.filter(u => u.billing_date >= filterFrom);
    if (filterTo) result = result.filter(u => u.billing_date <= filterTo);
    setFilteredUtilities(result);
  }, [searchQuery, filterStatus, filterType, filterFrom, filterTo, utilities]);

  const handleSwitchHousehold = async (household) => {
    setActiveHousehold(household);
    setShowHouseholdSwitcher(false);
    setHouseholdSearch('');
    await fetchHouseholdData(household, currentUser);
    showToast(`Switched to ${household.name}`);
  };

  // ========== UTILITY SAVE HANDLER (minimal for compatibility) ==========
  const proceedWithUtilitySave = async () => {};
  const handleSaveUtility = async () => {
    showToast('Utility saving is disabled – use Expenses screen instead.', 'info');
  };
  const handleConfirmSplit = async (utility) => {
    // Placeholder – you can implement later
  };
  const handleDisputeSplit = async () => {};
  const handleAdjustSplit = async () => {};
  const handleDeleteUtility = async () => {
    if (!selectedUtility) return;
    await supabase.from('expenses').delete().eq('id', selectedUtility.id);
    setShowDeleteModal(false);
    setSelectedUtility(null);
    showToast('Utility deleted.');
    fetchHouseholdData(activeHousehold, currentUser);
  };
  const resetUtilityForm = () => {};

  const getUtilityConfig = (type) => UTILITY_CONFIG[type] || UTILITY_CONFIG.Other;
  const filteredHouseholds = allHouseholds.filter(h => h.name.toLowerCase().includes(householdSearch.toLowerCase()));

  return (
    <div className="utilities-screen">
      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
      <TopBar
        profile={profile}
        setProfile={setProfile}
        household={activeHousehold}
        currentUser={currentUser}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
        title="HomeSync"
        showBell={true}
      />
      <div className="utilities-title-section">
        <h2 className="utilities-title">Utilities Management</h2>
        <p className="utilities-subtitle">Configure and track your household Utility bill splitting and payments</p>
      </div>

      {allHouseholds.length > 1 && (
        <div className="household-switcher-wrap">
          <button className="household-switcher-pill" onClick={() => setShowHouseholdSwitcher(!showHouseholdSwitcher)}>
            🏠 {activeHousehold?.name} <ChevronDown size={14}/>
          </button>
          {showHouseholdSwitcher && (
            <div className="household-dropdown">
              <div className="household-search-wrap">
                <Search size={13} className="household-search-icon"/>
                <input type="text" placeholder="Search household..." value={householdSearch} onChange={e => setHouseholdSearch(e.target.value)} className="household-search-input" />
              </div>
              {filteredHouseholds.map(h => (
                <button key={h.id} className={`household-option ${activeHousehold?.id === h.id ? 'active' : ''}`} onClick={() => handleSwitchHousehold(h)}>
                  <span className="household-option-name">{h.name}</span>
                  <span className="household-option-role">{h.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="utilities-content">
        <div className="utility-summary-row">
          <div className="utility-summary-card">
            <p className="summary-card-label">Connected Utility Providers</p>
            <p className="summary-card-count">{providerCount} Providers</p>
            <div className="utility-type-icons">
              {UTILITY_TYPES.slice(0, 4).map(type => (
                <span key={type} className="utility-type-icon" style={{ background: getUtilityConfig(type).bg, color: getUtilityConfig(type).color }}>
                  {getUtilityConfig(type).icon}
                </span>
              ))}
            </div>
          </div>
          <div className="utility-summary-card">
            <p className="summary-card-label">Active Utility Subscription</p>
            <p className="summary-card-count">{activeSubscriptions} Accounts</p>
          </div>
        </div>
        <div className="utility-summary-card full-width">
          <p className="summary-card-label">Pending Split Approvals</p>
          <p className="summary-card-count">{pendingSplits} Pending Splits</p>
        </div>

        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon"/>
            <input type="text" placeholder="Search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}><Filter size={14}/> Filter</button>
        </div>

        {filteredUtilities.length === 0 ? (
          <div className="empty-state">
            <p>No utilities found.</p>
            <p>Add utility expenses from the Expenses screen!</p>
          </div>
        ) : (
          filteredUtilities.map(utility => {
            const config = getUtilityConfig(utility.utility_type);
            const myShare = utility.myShareAmount;
            const isPaid = utility.myStatus === 'approved';
            return (
              <div key={utility.id} className="utility-item">
                <div className="utility-icon-wrap" style={{ background: config.bg, color: config.color }}>{config.icon}</div>
                <div className="utility-details">
                  <p className="utility-name">{utility.utility_type} – {utility.provider_name}: ₱{Number(utility.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="utility-meta">{utility.split_method} | {utility.billing_date} | {utility.location}</p>
                  {myShare > 0 && <p className="utility-my-share">Your share: ₱{myShare.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>}
                  {!isAdmin && !isPaid && (
                    <div className="confirmation-row">
                      <button className="pay-btn" onClick={() => { setSelectedUtility(utility); setShowPaymentProofModal(true); }}>Pay</button>
                    </div>
                  )}
                </div>
                <div className="utility-right">
                  <span className="status-badge" style={{
                    background: isPaid ? '#D1FAE5' : '#FFF3CD',
                    color: isPaid ? '#065F46' : '#856404'
                  }}>
                    {isPaid ? '✓ Paid' : '⏳ Pending'}
                  </span>
                  {utility.source === 'expenses' && <span className="source-label">📋 From Expenses</span>}
                  {isAdmin && (
                    <div className="utility-admin-actions">
                      <button className="icon-btn delete" onClick={() => { setSelectedUtility(utility); setShowDeleteModal(true); }}><Trash2 size={14}/></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Utility Modal – minimal */}
      {showAddUtility && (
        <div className="modal-overlay">
          <div className="add-utility-modal">
            <div className="modal-header">
              <h2>Configure Utilities</h2>
              <button className="modal-close" onClick={() => setShowAddUtility(false)}><X size={18}/></button>
            </div>
            <div className="utility-tabs">
              <button className={`utility-tab ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>Add Utility Provider</button>
              <button className={`utility-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Track Utility History</button>
            </div>
            {activeTab === 'add' ? (
              <div className="modal-scroll">
                <p className="modal-subtitle">Use the Expenses screen to add utility bills. This section is for future enhancements.</p>
                <button className="save-config-btn" onClick={handleSaveUtility} disabled={loading}>Save Configuration</button>
              </div>
            ) : (
              <div className="modal-scroll">
                <p className="history-section-title">Past Utility Bills</p>
                {utilities.filter(u => u.status === 'paid').length === 0 ? (
                  <p className="no-history">No paid utility bills yet.</p>
                ) : (
                  utilities.filter(u => u.status === 'paid').map(u => (
                    <div key={u.id} className="history-item">
                      <div className="utility-icon-wrap small" style={{ background: getUtilityConfig(u.utility_type).bg, color: getUtilityConfig(u.utility_type).color }}>
                        {getUtilityConfig(u.utility_type).icon}
                      </div>
                      <div className="history-details">
                        <p className="history-name">{u.utility_type} – {u.provider_name}</p>
                        <p className="history-meta">{u.billing_date} | {u.split_method}</p>
                      </div>
                      <p className="history-amount">₱{Number(u.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>Delete Utility?</h2>
            <p className="modal-subtitle">This action cannot be undone.</p>
            <button className="delete-confirm-btn" onClick={handleDeleteUtility}>Yes, Delete</button>
            <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Payment Proof Modal */}
      {showPaymentProofModal && selectedUtility && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Submit Payment Proof</h2>
            <p className="modal-subtitle">Upload your GCash/bank screenshot</p>
            {proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} alt="proof" className="proof-preview"/>}
            <button className="save-config-btn" style={{ background: '#F0EDFF', color: '#3B2AAB', marginTop: 0 }} onClick={() => proofInputRef.current.click()}>
              📷 {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
            </button>
            <textarea className="reject-textarea" placeholder="Optional note (e.g. GCash ref# 12345)" value={proofForm.note} onChange={e => setProofForm(prev => ({ ...prev, note: e.target.value }))} />
            <button className="save-config-btn" onClick={async () => {
              if (!proofForm.screenshot) { showToast('Please upload a screenshot.', 'error'); return; }
              setLoading(true);
              const fileExt = proofForm.screenshot.name.split('.').pop();
              const fileName = `${currentUser.id}-${selectedUtility.id}.${fileExt}`;
              const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(fileName, proofForm.screenshot, { upsert: true });
              if (uploadError) { showToast('Upload failed.', 'error'); setLoading(false); return; }
              const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);
              await markItemAsPaid(selectedUtility, urlData.publicUrl, proofForm.note, currentUser.id);
              await supabase.from('notifications').insert({
                user_id: activeHousehold?.created_by,
                title: 'Payment Proof Submitted 📸',
                message: `${profile?.full_name} submitted payment proof for "${selectedUtility.provider_name}"`,
                type: 'payment_proof',
              });
              setShowPaymentProofModal(false);
              setProofForm({ note: '', screenshot: null, screenshotPreview: null });
              setSelectedUtility(null);
              showToast('Payment proof submitted! ⏳');
              setLoading(false);
              fetchHouseholdData(activeHousehold, currentUser);
            }} disabled={loading}>{loading ? 'Submitting...' : 'Submit for Verification'}</button>
            <button className="cancel-btn" onClick={() => { setShowPaymentProofModal(false); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); }}>Cancel</button>
          </div>
        </div>
      )}

      <input type="file" ref={proofInputRef} style={{ display: 'none' }} accept="image/*" onChange={e => { const file = e.target.files[0]; if (file) setProofForm(prev => ({ ...prev, screenshot: file, screenshotPreview: URL.createObjectURL(file) })); }} />

      <BottomNav active="utilities"/>
    </div>
  );
}