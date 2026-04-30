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
  adminConfirmPayment,
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
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedUtility, setSelectedUtility] = useState(null);
  const [selectedConfirmation, setSelectedConfirmation] = useState(null);
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

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      // Fetch ALL households user belongs to
      const { data: memberData } = await supabase
        .from('household_members')
        .select('*, households(*)')
        .eq('user_id', user.id);

      const households = memberData?.map(m => ({
        ...m.households,
        role: m.role,
      })) || [];
      setAllHouseholds(households);

      // Set active household to primary
      const primary = households.find(h => h.id === profileData.household_id)
        || households[0];
      setActiveHousehold(primary);

      await fetchHouseholdData(primary, user);
      await fetchNotifications(user.id);

    } catch (err) {
      console.error(err);
    }
  };

  const fetchHouseholdData = async (household, user) => {
    if (!household) return;

    const { data: members } = await supabase
      .from('household_members')
      .select('*, profiles(*)')
      .eq('household_id', household.id);
    setHouseholdMembers(members || []);

    const userMember = members?.find(m => m.user_id === user.id);
    setIsAdmin(userMember?.role === 'owner');

    const { utilities: utilitiesData, fromExpenses } = await fetchAllUtilityItems(household.id);
    const allUtilityItems = [...utilitiesData, ...fromExpenses];
    setUtilities(allUtilityItems);
    setFilteredUtilities(allUtilityItems);

    // Summary
    const uniqueProviders = new Set(utilitiesData?.map(u => u.provider_name) || []);
    setProviderCount(uniqueProviders.size);

    const active = utilitiesData?.filter(u => u.status !== 'paid').length || 0;
    setActiveSubscriptions(active);

    // Fetch confirmations
    const { data: confirmData } = await supabase
      .from('utility_confirmations')
      .select('*, profiles(*)')
      .in('utility_id', utilitiesData?.map(u => u.id) || []);
    setConfirmations(confirmData || []);

    const pending = confirmData?.filter(c => c.status === 'pending' || c.status === 'disputed').length || 0;
    setPendingSplits(pending);

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime
  useEffect(() => {
    if (!currentUser || !activeHousehold) return;
    const channel = supabase
      .channel('utilities-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'utilities',
      }, () => fetchHouseholdData(activeHousehold, currentUser))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'utility_confirmations',
      }, () => fetchHouseholdData(activeHousehold, currentUser))
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, activeHousehold]);

  // Search & Filter
  useEffect(() => {
    let result = [...utilities];
    if (searchQuery) {
      result = result.filter(u =>
        u.provider_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.utility_type.toLowerCase().includes(searchQuery.toLowerCase())
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

  const proceedWithUtilitySave = async () => {
    const splits = {};
    if (utilityForm.split_method === 'Equal Split') {
      const share = Number(utilityForm.amount) / utilityForm.selected_members.length;
      utilityForm.selected_members.forEach(id => { splits[id] = share.toFixed(2); });
    } else {
      utilityForm.selected_members.forEach(id => {
        splits[id] = utilityForm.custom_splits[id] || 0;
      });
    }

    const { data: newUtility, error } = await supabase
      .from('utilities')
      .insert({
        household_id: activeHousehold.id,
        created_by: currentUser.id,
        utility_type: utilityForm.utility_type,
        provider_name: utilityForm.provider_name,
        amount: Number(utilityForm.amount),
        billing_date: utilityForm.billing_date,
        reminder_days: utilityForm.reminder_days,
        split_method: utilityForm.split_method,
        members_split: splits,
        status: 'pending',
        location: utilityForm.location,
      })
      .select()
      .single();

    if (error) {
      showToast('Failed to save utility. Try again.', 'error');
      setLoading(false);
      return;
    }

    // Create confirmations for each member
    const confirmInserts = utilityForm.selected_members.map(uid => ({
      utility_id: newUtility.id,
      user_id: uid,
      status: uid === currentUser.id ? 'confirmed' : 'pending',
    }));

    await supabase.from('utility_confirmations').insert(confirmInserts);

    // Notify members
    const notifInserts = utilityForm.selected_members
      .filter(uid => uid !== currentUser.id)
      .map(uid => ({
        user_id: uid,
        title: 'New Utility Bill Split 💡',
        message: `${profile?.full_name} added ${utilityForm.utility_type} bill of ₱${utilityForm.amount}. Please confirm your share.`,
        type: 'utility_confirmation',
      }));

    if (notifInserts.length > 0) {
      await supabase.from('notifications').insert(notifInserts);
    }

    showToast('Utility saved! Members notified. ✅');
    setShowAddUtility(false);
    resetUtilityForm();
    setLoading(false);
  };

  const handleSaveUtility = async () => {
    const errors = {};
    if (!utilityForm.provider_name.trim()) errors.provider_name = 'Provider name is required';
    if (!utilityForm.amount || isNaN(utilityForm.amount)) errors.amount = 'Valid amount is required';
    if (!utilityForm.billing_date) errors.billing_date = 'Billing date is required';
    if (utilityForm.selected_members.length === 0) errors.members = 'Select at least one member';

    if (Object.keys(errors).length > 0) {
      setUtilityErrors(errors);
      return;
    }

    setLoading(true);

    // Check for duplicates
    const dupes = await checkDuplicate(
      activeHousehold.id,
      utilityForm.utility_type,
      Number(utilityForm.amount),
      utilityForm.billing_date
    );

    if (dupes.length > 0) {
      setDuplicateItem(dupes[0]);
      setShowDuplicateModal(true);
      setLoading(false);
      return;
    }

    await proceedWithUtilitySave();
  };

  const handleConfirmSplit = async (utility) => {
    const existing = confirmations.find(
      c => c.utility_id === utility.id && c.user_id === currentUser.id
    );

    if (existing) {
      await supabase
        .from('utility_confirmations')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('utility_confirmations').insert({
        utility_id: utility.id,
        user_id: currentUser.id,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      });
    }

    await supabase.from('notifications').insert({
      user_id: utility.created_by,
      title: 'Split Confirmed ✅',
      message: `${profile?.full_name} confirmed their share for ${utility.utility_type} bill.`,
      type: 'split_confirmed',
    });

    showToast('Split confirmed! ✅');
  };

  const handleDisputeSplit = async () => {
    if (!disputeReason.trim()) {
      showToast('Please provide a dispute reason.', 'error');
      return;
    }

    const existing = confirmations.find(
      c => c.utility_id === selectedUtility.id && c.user_id === currentUser.id
    );

    if (existing) {
      await supabase
        .from('utility_confirmations')
        .update({ status: 'disputed', dispute_reason: disputeReason })
        .eq('id', existing.id);
    } else {
      await supabase.from('utility_confirmations').insert({
        utility_id: selectedUtility.id,
        user_id: currentUser.id,
        status: 'disputed',
        dispute_reason: disputeReason,
      });
    }

    await supabase.from('notifications').insert({
      user_id: selectedUtility.created_by,
      title: 'Split Disputed ⚠️',
      message: `${profile?.full_name} disputed their share. Reason: ${disputeReason}`,
      type: 'split_disputed',
    });

    setShowDisputeModal(false);
    setDisputeReason('');
    setSelectedUtility(null);
    showToast('Dispute submitted. Admin will review.');
  };

  const handleAdjustSplit = async () => {
    const newSplits = { ...selectedUtility.members_split, ...adjustedSplits };

    await supabase
      .from('utilities')
      .update({ members_split: newSplits })
      .eq('id', selectedUtility.id);

    // Reset disputed confirmations to pending
    const disputedConfs = confirmations.filter(
      c => c.utility_id === selectedUtility.id && c.status === 'disputed'
    );

    for (const conf of disputedConfs) {
      await supabase
        .from('utility_confirmations')
        .update({ status: 'pending', dispute_reason: null })
        .eq('id', conf.id);

      await supabase.from('notifications').insert({
        user_id: conf.user_id,
        title: 'Split Adjusted 🔄',
        message: `Admin adjusted your share for ${selectedUtility.utility_type} bill. Please re-confirm.`,
        type: 'split_adjusted',
      });
    }

    setShowAdjustModal(false);
    setAdjustedSplits({});
    setSelectedUtility(null);
    showToast('Split adjusted! Members notified to re-confirm.');
  };

  const handleDeleteUtility = async () => {
    await supabase.from('utility_confirmations').delete().eq('utility_id', selectedUtility.id);
    await supabase.from('utilities').delete().eq('id', selectedUtility.id);
    setShowDeleteModal(false);
    setSelectedUtility(null);
    showToast('Utility deleted.');
  };

  const resetUtilityForm = () => {
    setUtilityForm({
      utility_type: 'Power',
      provider_name: '',
      amount: '',
      billing_date: '',
      reminder_days: 5,
      split_method: 'Equal Split',
      location: activeHousehold?.name || '',
      selected_members: [],
      custom_splits: {},
    });
    setUtilityErrors({});
  };

  const getStatusBadge = (utility) => {
    if (utility.status === 'paid') return { label: 'Paid', color: '#38a169', bg: '#f0fff4' };
    if (utility.status === 'pending') return { label: 'Pending', color: '#856404', bg: '#fff3cd' };
    return { label: 'Unpaid', color: '#e53e3e', bg: '#ffe5e5' };
  };

  const getMyConfirmation = (utility) => {
    return confirmations.find(c => c.utility_id === utility.id && c.user_id === currentUser?.id);
  };

  const getDisputedConfirmations = (utility) => {
    return confirmations.filter(c => c.utility_id === utility.id && c.status === 'disputed');
  };

  const filteredHouseholds = allHouseholds.filter(h =>
    h.name.toLowerCase().includes(householdSearch.toLowerCase())
  );

  const getUtilityConfig = (type) => UTILITY_CONFIG[type] || UTILITY_CONFIG.Other;

  return (
    <div className="utilities-screen">

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}

      {/* TopBar */}
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

      {/* Screen Title */}
      <div className="utilities-title-section">
        <h2 className="utilities-title">Utilities Management</h2>
        <p className="utilities-subtitle">
          Configure and track your household Utility bill splitting and payments
        </p>
      </div>

      {/* Household Switcher */}
      {allHouseholds.length > 1 && (
        <div className="household-switcher-wrap">
          <button
            className="household-switcher-pill"
            onClick={() => setShowHouseholdSwitcher(!showHouseholdSwitcher)}
          >
            🏠 {activeHousehold?.name}
            <ChevronDown size={14}/>
          </button>

          {showHouseholdSwitcher && (
            <div className="household-dropdown">
              <div className="household-search-wrap">
                <Search size={13} className="household-search-icon"/>
                <input
                  type="text"
                  placeholder="Search household..."
                  value={householdSearch}
                  onChange={e => setHouseholdSearch(e.target.value)}
                  className="household-search-input"
                />
              </div>
              {filteredHouseholds.map(h => (
                <button
                  key={h.id}
                  className={`household-option ${activeHousehold?.id === h.id ? 'active' : ''}`}
                  onClick={() => handleSwitchHousehold(h)}
                >
                  <span className="household-option-name">{h.name}</span>
                  <span className="household-option-role">{h.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scrollable Content */}
      <div className="utilities-content">

        {/* Summary Cards */}
        <div className="utility-summary-row">
          <div className="utility-summary-card">
            <p className="summary-card-label">Connected Utility Providers</p>
            <p className="summary-card-count">{providerCount} Providers</p>
            <div className="utility-type-icons">
              {UTILITY_TYPES.slice(0, 4).map(type => (
                <span
                  key={type}
                  className="utility-type-icon"
                  style={{ background: getUtilityConfig(type).bg, color: getUtilityConfig(type).color }}
                >
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
            {confirmations
              .filter(c => c.status === 'pending' || c.status === 'disputed')
              .slice(0, 4)
              .map((c, i) => (
                <div key={i} className="pending-avatar">
                  {c.profiles?.avatar_url
                    ? <img src={c.profiles.avatar_url} alt="" className="pending-avatar-img"/>
                    : <span>{c.profiles?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
                  }
                </div>
              ))
            }
          </div>
        </div>

        {/* Search & Filter */}
        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon"/>
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}>
            <Filter size={14}/> Filter
          </button>
        </div>

        {/* Utilities List */}
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
                <div
                  className="utility-icon-wrap"
                  style={{ background: config.bg, color: config.color }}
                >
                  {config.icon}
                </div>

                <div className="utility-details">
                  <p className="utility-name">
                    {utility.utility_type}({utility.provider_name}): ₱{Number(utility.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="utility-meta">
                    {utility.split_method} | {utility.billing_date} | {utility.location}
                  </p>

                  {myShare && (
                    <p className="utility-my-share">
                      Your share: ₱{Number(myShare).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </p>
                  )}

                  {/* Member confirmation actions */}
                  {!isAdmin && utility.status !== 'paid' && (
                    <div className="confirmation-row">
                      {!myConfirmation || myConfirmation.status === 'pending' ? (
                        <>
                          <button
                            className="confirm-btn"
                            onClick={() => handleConfirmSplit(utility)}
                          >
                            <Check size={12}/> Confirm
                          </button>
                          <button
                            className="dispute-btn"
                            onClick={() => { setSelectedUtility(utility); setShowDisputeModal(true); }}
                          >
                            <X size={12}/> Dispute
                          </button>
                        </>
                      ) : myConfirmation.status === 'confirmed' ? (
                        <span className="confirmed-tag">✅ Confirmed</span>
                      ) : myConfirmation.status === 'disputed' ? (
                        <span className="disputed-tag">⚠️ Disputed — waiting for admin</span>
                      ) : null}
                    </div>
                  )}

                  {/* Admin — disputed confirmations */}
                  {isAdmin && disputedConfs.length > 0 && (
                    <div className="disputed-section">
                      {disputedConfs.map(conf => (
                        <div key={conf.id} className="disputed-item">
                          <span className="disputed-name">
                            ⚠️ {conf.profiles?.full_name} disputed: "{conf.dispute_reason}"
                          </span>
                          <button
                            className="adjust-btn"
                            onClick={() => {
                              setSelectedUtility(utility);
                              setAdjustedSplits({ ...utility.members_split });
                              setShowAdjustModal(true);
                            }}
                          >
                            Adjust Split
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pay button for read-only items from expenses */}
                {utility.source === 'expenses' && utility.status !== 'paid' && (
                  <div className="reimburse-row">
                    <button
                      className="pay-btn"
                      onClick={() => {
                        setSelectedUtility(utility);
                        setShowPaymentProofModal(true);
                      }}
                    >
                      Pay
                    </button>
                  </div>
                )}

                <div className="utility-right">
                  <span
                    className="status-badge"
                    style={{ color: badge.color, background: badge.bg }}
                  >
                    {badge.label}
                  </span>
                  {utility.source === 'expenses' && (
                    <span className="source-label">📋 From Expenses</span>
                  )}
                  {utility.source === 'utilities' && utility.is_merged && (
                    <span className="source-label">🔗 Merged</span>
                  )}
                  {isAdmin && (
                    <div className="utility-admin-actions">
                      <button
                        className="icon-btn"
                        onClick={() => { setSelectedUtility(utility); setShowAddUtility(true); }}
                      >
                        <Edit size={14}/>
                      </button>
                      <button
                        className="icon-btn delete"
                        onClick={() => { setSelectedUtility(utility); setShowDeleteModal(true); }}
                      >
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FAB */}
      {isAdmin && (
        <button className="fab-btn" onClick={() => { setShowAddUtility(true); setActiveTab('add'); }}>
          <Plus size={24}/>
        </button>
      )}

      {/* Add Utility Modal */}
      {showAddUtility && (
        <div className="modal-overlay">
          <div className="add-utility-modal">
            <div className="modal-header">
              <h2>Configure Utilities</h2>
              <button className="modal-close" onClick={() => { setShowAddUtility(false); resetUtilityForm(); setSelectedUtility(null); }}>
                <X size={18}/>
              </button>
            </div>

            {/* Tabs */}
            <div className="utility-tabs">
              <button
                className={`utility-tab ${activeTab === 'add' ? 'active' : ''}`}
                onClick={() => setActiveTab('add')}
              >
                Add Utility Provider
              </button>
              <button
                className={`utility-tab ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                Track Utility History
              </button>
            </div>

            {activeTab === 'add' ? (
              <div className="modal-scroll">

                <div className="form-group">
                  <label>Select Utility Type</label>
                  <div className="select-wrap">
                    <select
                      value={utilityForm.utility_type}
                      onChange={e => setUtilityForm(prev => ({ ...prev, utility_type: e.target.value }))}
                    >
                      {UTILITY_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="select-arrow"/>
                  </div>
                </div>

                <div className="form-group">
                  <label>Utility Provider</label>
                  <input
                    type="text"
                    placeholder="Utility Provider"
                    value={utilityForm.provider_name}
                    onChange={e => setUtilityForm(prev => ({ ...prev, provider_name: e.target.value }))}
                    className={utilityErrors.provider_name ? 'input-error' : ''}
                  />
                  {utilityErrors.provider_name && <span className="form-error">{utilityErrors.provider_name}</span>}
                </div>

                <div className="form-group">
                  <label>Amount</label>
                  <div className="amount-input-wrap">
                    <span className="peso-sign">₱</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={utilityForm.amount}
                      onChange={e => setUtilityForm(prev => ({ ...prev, amount: e.target.value }))}
                      className={utilityErrors.amount ? 'input-error' : ''}
                    />
                  </div>
                  {utilityErrors.amount && <span className="form-error">{utilityErrors.amount}</span>}
                </div>

                <div className="form-group">
                  <label>Billing Date (Due Date)</label>
                  <input
                    type="date"
                    value={utilityForm.billing_date}
                    onChange={e => setUtilityForm(prev => ({ ...prev, billing_date: e.target.value }))}
                    className={utilityErrors.billing_date ? 'input-error' : ''}
                  />
                  {utilityErrors.billing_date && <span className="form-error">{utilityErrors.billing_date}</span>}
                </div>

                <div className="form-group">
                  <label>Reminder (days before due date)</label>
                  <div className="reminder-options">
                    {REMINDER_OPTIONS.map(days => (
                      <button
                        key={days}
                        className={`reminder-btn ${utilityForm.reminder_days === days ? 'active' : ''}`}
                        onClick={() => setUtilityForm(prev => ({ ...prev, reminder_days: days }))}
                      >
                        {days} days
                      </button>
                    ))}
                    <input
                      type="number"
                      placeholder="Custom"
                      className="reminder-custom"
                      value={![3, 5, 7, 14].includes(utilityForm.reminder_days) ? utilityForm.reminder_days : ''}
                      onChange={e => setUtilityForm(prev => ({ ...prev, reminder_days: Number(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Split Method</label>
                  <div className="select-wrap">
                    <select
                      value={utilityForm.split_method}
                      onChange={e => setUtilityForm(prev => ({ ...prev, split_method: e.target.value }))}
                    >
                      {SPLIT_METHODS.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="select-arrow"/>
                  </div>
                </div>

                <div className="form-group">
                  <label>Split Group</label>
                  <div className="select-wrap">
                    <select value={utilityForm.location}
                      onChange={e => setUtilityForm(prev => ({ ...prev, location: e.target.value }))}>
                      {allHouseholds.map(h => (
                        <option key={h.id} value={h.name}>{h.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="select-arrow"/>
                  </div>
                </div>

                <div className="form-group">
                  <label>Add Members to Split</label>
                  {utilityErrors.members && <span className="form-error">{utilityErrors.members}</span>}
                  <div className="members-select">
                    {householdMembers.map(m => (
                      <label key={m.user_id} className="member-checkbox">
                        <input
                          type="checkbox"
                          checked={utilityForm.selected_members.includes(m.user_id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setUtilityForm(prev => ({
                                ...prev,
                                selected_members: [...prev.selected_members, m.user_id]
                              }));
                            } else {
                              setUtilityForm(prev => ({
                                ...prev,
                                selected_members: prev.selected_members.filter(id => id !== m.user_id)
                              }));
                            }
                          }}
                        />
                        {m.profiles?.full_name}
                      </label>
                    ))}
                  </div>
                </div>

                {(utilityForm.split_method === 'By Member' || utilityForm.split_method === 'Usage Based') && (
                  <div className="form-group">
                    <label>
                      {utilityForm.split_method === 'Usage Based' ? 'Usage Amount per Member' : 'Custom Amount per Member'}
                    </label>
                    {utilityForm.selected_members.map(uid => {
                      const member = householdMembers.find(m => m.user_id === uid);
                      return (
                        <div key={uid} className="custom-split-row">
                          <span>{member?.profiles?.full_name}</span>
                          <div className="amount-input-wrap small">
                            <span className="peso-sign">₱</span>
                            <input
                              type="number"
                              placeholder="0.00"
                              value={utilityForm.custom_splits[uid] || ''}
                              onChange={e => setUtilityForm(prev => ({
                                ...prev,
                                custom_splits: { ...prev.custom_splits, [uid]: e.target.value }
                              }))}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  className="save-config-btn"
                  onClick={handleSaveUtility}
                  disabled={loading}
                >
                  {loading ? 'Saving...' : 'Save Configuration'}
                </button>

              </div>
            ) : (
              /* Track Utility History Tab */
              <div className="modal-scroll">
                <p className="history-section-title">Past Utility Bills</p>
                {utilities.filter(u => u.status === 'paid').length === 0 ? (
                  <p className="no-history">No paid utility bills yet.</p>
                ) : (
                  utilities
                    .filter(u => u.status === 'paid')
                    .map(u => {
                      const config = getUtilityConfig(u.utility_type);
                      return (
                        <div key={u.id} className="history-item">
                          <div
                            className="utility-icon-wrap small"
                            style={{ background: config.bg, color: config.color }}
                          >
                            {config.icon}
                          </div>
                          <div className="history-details">
                            <p className="history-name">
                              {u.utility_type}({u.provider_name})
                            </p>
                            <p className="history-meta">
                              {u.billing_date} | {u.split_method}
                            </p>
                          </div>
                          <p className="history-amount">
                            ₱{Number(u.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      );
                    })
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
            <button className="delete-confirm-btn" onClick={handleDeleteUtility}>
              Yes, Delete
            </button>
            <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Dispute Split</h2>
            <p className="modal-subtitle">Tell admin why you disagree with this split</p>
            <textarea
              className="reject-textarea"
              placeholder="Enter your reason..."
              value={disputeReason}
              onChange={e => setDisputeReason(e.target.value)}
            />
            <button className="save-config-btn" onClick={handleDisputeSplit}>
              Submit Dispute
            </button>
            <button className="cancel-btn" onClick={() => { setShowDisputeModal(false); setDisputeReason(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Adjust Split Modal */}
      {showAdjustModal && selectedUtility && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Adjust Split</h2>
            <p className="modal-subtitle">Update the split amounts for members</p>
            {Object.entries(adjustedSplits).map(([uid, amount]) => {
              const member = householdMembers.find(m => m.user_id === uid);
              return (
                <div key={uid} className="custom-split-row">
                  <span>{member?.profiles?.full_name}</span>
                  <div className="amount-input-wrap small">
                    <span className="peso-sign">₱</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAdjustedSplits(prev => ({ ...prev, [uid]: e.target.value }))}
                    />
                  </div>
                </div>
              );
            })}
            <button className="save-config-btn" onClick={handleAdjustSplit}>
              Save Adjusted Split
            </button>
            <button className="cancel-btn" onClick={() => setShowAdjustModal(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hidden proof input */}
      <input
        type="file"
        ref={proofInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        onChange={e => {
          const file = e.target.files[0];
          if (file) {
            setProofForm(prev => ({
              ...prev,
              screenshot: file,
              screenshotPreview: URL.createObjectURL(file),
            }));
          }
        }}
      />

      {/* Payment Proof Modal */}
      {showPaymentProofModal && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Submit Payment Proof</h2>
            <p className="modal-subtitle">Upload your GCash/bank screenshot</p>
            {proofForm.screenshotPreview && (
              <img src={proofForm.screenshotPreview} alt="proof" className="proof-preview"/>
            )}
            <button
              className="save-config-btn"
              style={{ background: '#F0EDFF', color: '#3B2AAB', marginTop: 0 }}
              onClick={() => proofInputRef.current.click()}
            >
              📷 {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
            </button>
            <textarea
              className="reject-textarea"
              placeholder="Optional note (e.g. GCash ref# 12345)"
              value={proofForm.note}
              onChange={e => setProofForm(prev => ({ ...prev, note: e.target.value }))}
            />
            <button
              className="save-config-btn"
              onClick={async () => {
                if (!proofForm.screenshot) {
                  showToast('Please upload a screenshot.', 'error');
                  return;
                }
                setLoading(true);
                const fileExt = proofForm.screenshot.name.split('.').pop();
                const fileName = `${currentUser.id}-${selectedUtility.id}.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                  .from('payment-proofs')
                  .upload(fileName, proofForm.screenshot, { upsert: true });
                if (uploadError) {
                  showToast('Upload failed.', 'error');
                  setLoading(false);
                  return;
                }
                const { data: urlData } = supabase.storage
                  .from('payment-proofs')
                  .getPublicUrl(fileName);
                await markItemAsPaid(
                  selectedUtility,
                  urlData.publicUrl,
                  proofForm.note,
                  currentUser.id
                );
                await supabase.from('notifications').insert({
                  user_id: activeHousehold?.created_by,
                  title: 'Payment Proof Submitted 📸',
                  message: `${profile?.full_name} submitted payment proof for "${selectedUtility.title || selectedUtility.utility_type}"`,
                  type: 'payment_proof',
                });
                setShowPaymentProofModal(false);
                setProofForm({ note: '', screenshot: null, screenshotPreview: null });
                setSelectedUtility(null);
                showToast('Payment proof submitted! ⏳');
                setLoading(false);
              }}
              disabled={loading}
            >
              {loading ? 'Submitting...' : 'Submit for Verification'}
            </button>
            <button className="cancel-btn" onClick={() => {
              setShowPaymentProofModal(false);
              setProofForm({ note: '', screenshot: null, screenshotPreview: null });
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Modal */}
      {showDuplicateModal && duplicateItem && (
        <div className="modal-overlay">
          <div className="small-modal">
            <p style={{ fontSize: 32 }}>⚠️</p>
            <h2>Possible Duplicate!</h2>
            <p className="modal-subtitle">
              We found a similar entry: "{duplicateItem.title || duplicateItem.provider_name}: 
              ₱{Number(duplicateItem.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}"
            </p>
            <p className="modal-subtitle">Would you like to merge this with the existing entry?</p>
            <button
              className="save-config-btn"
              onClick={async () => {
                if (duplicateItem.source === 'expenses') {
                  await mergeItems(duplicateItem.id, null);
                }
                setShowDuplicateModal(false);
                showToast('Items merged! ✅');
              }}
            >
              Yes, Merge
            </button>
            <button
              className="cancel-btn"
              onClick={async () => {
                setShowDuplicateModal(false);
                setLoading(true);
                await proceedWithUtilitySave();
              }}
            >
              No, Keep Separate
            </button>
          </div>
        </div>
      )}

      <BottomNav active="utilities"/>
    </div>
  );
}