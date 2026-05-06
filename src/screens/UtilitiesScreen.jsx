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
  fetchAllUtilityItems,
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
  const [confirmations, setConfirmations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [providerCount, setProviderCount] = useState(0);
  const [activeSubscriptions, setActiveSubscriptions] = useState(0);
  const [pendingSplits, setPendingSplits] = useState(0);

  const [showHouseholdSwitcher, setShowHouseholdSwitcher] = useState(false);
  const [householdSearch, setHouseholdSearch] = useState('');
  const [showAddUtility, setShowAddUtility] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedUtility, setSelectedUtility] = useState(null);
  const [selectedConfirmation, setSelectedConfirmation] = useState(null);
  const [activeTab, setActiveTab] = useState('add');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const [filterStatus, setFilterStatus] = useState([]);
  const [filterType, setFilterType] = useState([]);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

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

  const [disputeReason, setDisputeReason] = useState('');
  const [adjustedSplits, setAdjustedSplits] = useState({});

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

      // Fetch active household memberships
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

      // Get household details
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

      // Show debug info
      showToast(`Active household: ${primary.name} (${primary.id})`, 'info');

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

    // Fetch utility items (merge from utilities table and expenses)
    const { utilities: utilitiesData, fromExpenses } = await fetchAllUtilityItems(household.id);
    const allUtilityItems = [...utilitiesData, ...fromExpenses];
    setUtilities(allUtilityItems);
    setFilteredUtilities(allUtilityItems);

    setProviderCount(allUtilityItems.length);
    const active = allUtilityItems.filter(u => u.status !== 'paid').length || 0;
    setActiveSubscriptions(active);

    const pending = allUtilityItems.filter(item => {
      if (item.source === 'expenses') {
        return item.approval_status !== 'approved';
      } else {
        return item.status !== 'paid';
      }
    }).length;
    setPendingSplits(pending);

    // Also fetch confirmations for utilities table items
    const { data: confirmData } = await supabase
      .from('utility_confirmations')
      .select('*, profiles(*)')
      .in('utility_id', utilitiesData?.map(u => u.id) || []);
    setConfirmations(confirmData || []);

    setUtilityForm(prev => ({ ...prev, location: household.name }));

    // DEBUG: show how many utility expenses were found
    if (fromExpenses.length === 0) {
      showToast(`No utility expenses found for ${household.name}. Check category spelling (case-sensitive).`, 'error');
    } else {
      showToast(`Found ${fromExpenses.length} utility expenses in ${household.name}`, 'success');
    }
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'utilities' }, () => fetchHouseholdData(activeHousehold, currentUser))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'utility_confirmations' }, () => fetchHouseholdData(activeHousehold, currentUser))
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

  // Rest of handlers (proceedWithUtilitySave, handleSaveUtility, etc.) remain exactly as in your original file.
  // For brevity, I'm skipping them here – they are unchanged.
  // Please keep your existing handler functions (they are correct).

  // ------------------------------------------------------------
  // THE REMAINING CODE (HANDLERS, MODALS) IS UNCHANGED.
  // YOU MUST PASTE THEM FROM YOUR CURRENT WORKING FILE.
  // BELOW IS A PLACEHOLDER – REPLACE WITH YOUR ACTUAL HANDLERS.
  // ------------------------------------------------------------

  // Placeholders – you must replace these with your full original code.
  const proceedWithUtilitySave = async () => {};
  const handleSaveUtility = async () => {};
  const handleConfirmSplit = async () => {};
  const handleDisputeSplit = async () => {};
  const handleAdjustSplit = async () => {};
  const handleDeleteUtility = async () => {};
  const resetUtilityForm = () => {};
  const getStatusBadge = () => {};
  const getMyConfirmation = () => {};
  const getDisputedConfirmations = () => {};
  const getUtilityConfig = (type) => UTILITY_CONFIG[type] || UTILITY_CONFIG.Other;
  const filteredHouseholds = allHouseholds.filter(h => h.name.toLowerCase().includes(householdSearch.toLowerCase()));

  // JSX – unchanged from working version (but keep modals)
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
          <div className="pending-avatars">
            {confirmations.filter(c => c.status === 'pending' || c.status === 'disputed').slice(0, 4).map((c, i) => (
              <div key={i} className="pending-avatar">
                {c.profiles?.avatar_url ? <img src={c.profiles.avatar_url} alt="" className="pending-avatar-img"/> : <span>{c.profiles?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>}
              </div>
            ))}
          </div>
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
            <p>Tap + to add your first utility bill!</p>
          </div>
        ) : (
          filteredUtilities.map(utility => {
            const config = getUtilityConfig(utility.utility_type);
            const badge = getStatusBadge(utility);
            const myConfirmation = getMyConfirmation(utility);
            const disputedConfs = getDisputedConfirmations(utility);
            const myShare = utility.members_split?.[currentUser?.id];
            return (
              <div key={utility.id} className="utility-item">
                <div className="utility-icon-wrap" style={{ background: config.bg, color: config.color }}>{config.icon}</div>
                <div className="utility-details">
                  <p className="utility-name">{utility.utility_type}({utility.provider_name}): ₱{Number(utility.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="utility-meta">{utility.split_method} | {utility.billing_date} | {utility.location}</p>
                  {myShare && <p className="utility-my-share">Your share: ₱{Number(myShare).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>}
                  {!isAdmin && utility.status !== 'paid' && (
                    <div className="confirmation-row">
                      {!myConfirmation || myConfirmation.status === 'pending' ? (
                        <>
                          <button className="confirm-btn" onClick={() => handleConfirmSplit(utility)}><Check size={12}/> Confirm</button>
                          <button className="dispute-btn" onClick={() => { setSelectedUtility(utility); setShowDisputeModal(true); }}><X size={12}/> Dispute</button>
                        </>
                      ) : myConfirmation.status === 'confirmed' ? (<span className="confirmed-tag">✅ Confirmed</span>) : myConfirmation.status === 'disputed' ? (<span className="disputed-tag">⚠️ Disputed — waiting for admin</span>) : null}
                    </div>
                  )}
                  {isAdmin && disputedConfs.length > 0 && (
                    <div className="disputed-section">
                      {disputedConfs.map(conf => (
                        <div key={conf.id} className="disputed-item">
                          <span className="disputed-name">⚠️ {conf.profiles?.full_name} disputed: "{conf.dispute_reason}"</span>
                          <button className="adjust-btn" onClick={() => { setSelectedUtility(utility); setAdjustedSplits({ ...utility.members_split }); setShowAdjustModal(true); }}>Adjust Split</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {utility.source === 'expenses' && utility.status !== 'paid' && (
                  <div className="reimburse-row"><button className="pay-btn" onClick={() => { setSelectedUtility(utility); setShowPaymentProofModal(true); }}>Pay</button></div>
                )}
                <div className="utility-right">
                  <span className="status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                  {utility.source === 'expenses' && <span className="source-label">📋 From Expenses</span>}
                  {utility.source === 'utilities' && utility.is_merged && <span className="source-label">🔗 Merged</span>}
                  {isAdmin && (
                    <div className="utility-admin-actions">
                      <button className="icon-btn" onClick={() => { setSelectedUtility(utility); setShowAddUtility(true); }}><Edit size={14}/></button>
                      <button className="icon-btn delete" onClick={() => { setSelectedUtility(utility); setShowDeleteModal(true); }}><Trash2 size={14}/></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {isAdmin && (
        <button className="fab-btn" onClick={() => { setShowAddUtility(true); setActiveTab('add'); }}>
          <Plus size={24}/>
        </button>
      )}

      {/* --- MODALS (keep exactly as in your file) --- */}
      {/* ... paste your add utility modal, delete, dispute, adjust, payment proof, duplicate modals here ... */}

      <BottomNav active="utilities"/>
    </div>
  );
}