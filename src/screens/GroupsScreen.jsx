import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Home, Users, Plus, Copy, Share2, X,
  Search
} from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import './GroupsScreen.css';
import { UTILITY_CATEGORIES } from '../utils/expenseUtils';
import { generateInviteCode } from '../utils/generateInviteCode';
import { fetchOwedRefunds, fetchDeletionRefundsMap, deletionStateOf } from '../utils/refundsOwed';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';
import { useCachedState, useScreenLoad } from '../utils/screenCache';
import { LoadGate, GroupsSkeleton } from '../components/Skeleton';

const TYPE_LABELS = { household: <><InlineIcon as={ICONS.household} /> Household</>, group: <><InlineIcon as={ICONS.group} /> Group</> };

export default function GroupsScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useCachedState('groups', 'profile', null);
  const [households, setHouseholds] = useCachedState('groups', 'households', []);
  const [groups, setGroups] = useCachedState('groups', 'groups', []);
  const load = useScreenLoad('groups');
  const { done: loadDone, fail: loadFail } = load;

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [createType, setCreateType] = useState('group'); // 'group' | 'household'

  // Join / Create form state
  const [joinCode, setJoinCode] = useState('');
  const [joinType, setJoinType] = useState('group');
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTab, setSearchTab] = useState('households'); // 'households' | 'groups'
  // Create / Join: the tab you're on comes first and is pre-selected
  const tabType = searchTab === 'groups' ? 'group' : 'household';
  const typeOrder = tabType === 'household' ? ['household', 'group'] : ['group', 'household'];

  const [toast, setToast] = useState(null);
  const [notifications, setNotifications] = useCachedState('groups', 'notifications', []);
  const [unreadCount, setUnreadCount] = useCachedState('groups', 'unreadCount', 0);

  const fetchDataRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
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

  const markNotificationsRead = async () => {
    if (!profile?.id) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', profile.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const fetchExpenseSplits = async (expenseIds) => {
    if (!expenseIds.length) return {};
    const { data, error } = await supabase
      .from('expense_splits')
      .select('expense_id, user_id, share_amount, paid_amount, status')
      .in('expense_id', expenseIds);
    if (error) { console.error('Error fetching splits:', error); return {}; }
    const grouped = {};
    data.forEach(split => {
      if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
      grouped[split.expense_id].push(split);
    });
    return grouped;
  };

  const fetchHouseholdSummary = useCallback(async (householdData, profileData, user) => {
    if (!householdData || !profileData) return null;

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, amount, paid_by, status, approval_status, category')
      .eq('household_id', householdData.id)
      .is('deleted_at', null)
      .eq('approval_status', 'approved')
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay);

    if (!expenses || expenses.length === 0) {
      const { count: memberCount } = await supabase
        .from('household_members')
        .select('*', { count: 'exact', head: true })
        .eq('household_id', householdData.id)
        .eq('status', 'active');
      // refunds from earlier months are still owed
      const refundsOwed = householdData.created_by === profileData.id
        ? (await fetchOwedRefunds(householdData.id, profileData.id)).reduce((sum, r) => sum + r.amount, 0)
        : 0;
      return {
        id: householdData.id,
        name: householdData.name,
        code: householdData.code,
        type: 'household',
        memberCount: memberCount || 1,
        totalExpenses: 0,
        yourShare: 0,
        pendingOwed: 0,
        yourBalance: refundsOwed,
        utilitiesTotal: 0,
        role: householdData.created_by === profileData.id ? 'owner' : 'member',
      };
    }

    const expenseIds = expenses.map(e => e.id);
    const splitsMap = await fetchExpenseSplits(expenseIds);
    // a deletion refund sent / confirmed for my share means I owe nothing on it
    const deletionMap = await fetchDeletionRefundsMap(expenseIds);

    let totalExpenses = 0;
    let yourShare = 0;
    let pendingOwed = 0;
    let utilitiesTotal = 0;

    for (const expense of expenses) {
      const splits = splitsMap[expense.id] || [];
      const mySplit = splits.find(s => s.user_id === user.id);
      totalExpenses += Number(expense.amount);
      if (mySplit) {
        yourShare += Number(mySplit.share_amount);
        if (deletionStateOf(mySplit, deletionMap[expense.id])) {
          // being deleted: nothing owed
        } else if (mySplit.status !== 'approved') {
          // only what is still owed (share minus what the admin approved)
          pendingOwed += Math.max(Number(mySplit.share_amount) - (Number(mySplit.paid_amount) || 0), 0);
        } else {
          if (UTILITY_CATEGORIES.includes(expense.category)) {
            utilitiesTotal += Number(mySplit.share_amount);
          }
        }
      }
    }

    const { count: memberCount } = await supabase
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', householdData.id)
      .eq('status', 'active');

    // The owner also owes members refunds for overpaid shares (same as the Expenses "You Owe" card).
    const isOwner = householdData.created_by === profileData.id;
    const refundsOwed = isOwner
      ? (await fetchOwedRefunds(householdData.id, profileData.id)).reduce((sum, r) => sum + r.amount, 0)
      : 0;

    return {
      id: householdData.id,
      name: householdData.name,
      code: householdData.code,
      type: 'household',
      memberCount: memberCount || 1,
      totalExpenses,
      yourShare,
      pendingOwed,
      yourBalance: pendingOwed + refundsOwed,
      utilitiesTotal,
      role: isOwner ? 'owner' : 'member',
    };
  }, []);

  const fetchAllHouseholds = useCallback(async (user, profileData) => {
    const { data: memberHouseholds } = await supabase
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (!memberHouseholds || memberHouseholds.length === 0) return [];

    const householdIds = memberHouseholds.map(mh => mh.household_id);
    const { data: householdsData } = await supabase
      .from('households')
      .select('*')
      .in('id', householdIds);

    const householdsList = [];
    for (const hh of householdsData || []) {
      const summary = await fetchHouseholdSummary(hh, profileData, user);
      if (summary) householdsList.push(summary);
    }
    return householdsList;
  }, [fetchHouseholdSummary]);

  const fetchGroupSpending = useCallback(async (group, user, firstDay, lastDay) => {
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, amount, category, approval_status')
      .eq('group_id', group.id)
      .is('deleted_at', null)
      .eq('approval_status', 'approved')
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay);

    if (!expenses || expenses.length === 0) {
      return { ...group, totalExpenses: 0, yourShare: 0, pendingOwed: 0, yourBalance: 0, utilitiesTotal: 0 };
    }

    const expenseIds = expenses.map(e => e.id);
    const splitsMap = await fetchExpenseSplits(expenseIds);
    // a deletion refund sent / confirmed for my share means I owe nothing on it
    const deletionMap = await fetchDeletionRefundsMap(expenseIds);

    let totalExpenses = 0;
    let yourShare = 0;
    let pendingOwed = 0;
    let utilitiesTotal = 0;

    for (const expense of expenses) {
      const splits = splitsMap[expense.id] || [];
      const mySplit = splits.find(s => s.user_id === user.id);
      totalExpenses += Number(expense.amount);
      if (mySplit) {
        if (mySplit.status === 'approved') {
          yourShare += Number(mySplit.share_amount);
        } else {
          // partly paid: count what is approved as paid, the rest as owed
          yourShare += Math.min(Number(mySplit.paid_amount) || 0, Number(mySplit.share_amount) || 0);
          if (!deletionStateOf(mySplit, deletionMap[expense.id])) {
            pendingOwed += Math.max(Number(mySplit.share_amount) - (Number(mySplit.paid_amount) || 0), 0);
          }
        }
      }
    }

    return { ...group, totalExpenses, yourShare, pendingOwed, yourBalance: pendingOwed, utilitiesTotal };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      await fetchNotifications(user.id);

      const householdsList = await fetchAllHouseholds(user, profileData);
      setHouseholds(householdsList);

      const { data: memberGroups } = await supabase
        .from('group_members')
        .select('group_id, role')
        .eq('user_id', user.id)
        .eq('status', 'active');
      const groupIds = (memberGroups || []).map(mg => mg.group_id);
      let groupsList = [];
      if (groupIds.length) {
        const { data: groupsData } = await supabase
          .from('groups')
          .select('*')
          .in('id', groupIds);
        groupsList = groupsData || [];
      }

      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const enrichedGroups = await Promise.all(
        groupsList.map(async (group) => {
          const { count: memberCount } = await supabase
            .from('group_members')
            .select('*', { count: 'exact', head: true })
            .eq('group_id', group.id)
            .eq('status', 'active');
          const withStats = await fetchGroupSpending(group, user, firstDay, lastDay);
          return { ...withStats, memberCount: memberCount || 0, role: 'member' };
        })
      );

      setGroups(enrichedGroups);
      loadDone();
    } catch (err) {
      loadFail(err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable cache setters / plain helper (adding it would refetch every render)
  }, [navigate, fetchAllHouseholds, fetchGroupSpending, loadDone, loadFail]);

  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('groups-notifications')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev]);
        setUnreadCount(prev => prev + 1);
        showToast(payload.new.message, 'info');
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, setNotifications, setUnreadCount]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('groups-expenses-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => { fetchDataRef.current?.(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => { fetchDataRef.current?.(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_refunds' }, () => { fetchDataRef.current?.(); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id]);

  // ---------- Handlers ----------

  const handleCreateGroup = async () => {
    if (!createForm.name.trim()) { showToast('Name is required', 'error'); return; }
    setCreateLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const code = generateInviteCode();

      if (createType === 'household') {
        const { data: household, error: hhError } = await supabase
          .from('households')
          .insert({ name: createForm.name.trim(), description: createForm.description.trim() || null, code, created_by: user.id })
          .select()
          .single();
        if (hhError) throw hhError;
        const { error: memberError } = await supabase
          .from('household_members')
          .insert({ household_id: household.id, user_id: user.id, role: 'owner', status: 'active' });
        if (memberError) {
          await supabase.from('households').delete().eq('id', household.id);
          throw new Error('Failed to add you as member');
        }
        showToast(`Household "${household.name}" created! Code: ${code}`);
      } else {
        const { data: group, error: groupError } = await supabase
          .from('groups')
          .insert({ name: createForm.name.trim(), description: createForm.description.trim() || null, code, created_by: user.id })
          .select()
          .single();
        if (groupError) throw groupError;
        const { error: memberError } = await supabase
          .from('group_members')
          .insert({ group_id: group.id, user_id: user.id, role: 'owner', status: 'active' });
        if (memberError) {
          await supabase.from('groups').delete().eq('id', group.id);
          throw new Error('Failed to add you as member');
        }
        showToast(`Group "${group.name}" created! Code: ${code}`);
      }

      setShowCreateModal(false);
      setCreateForm({ name: '', description: '' });
      fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setCreateLoading(false);
  };

  const handleJoinGroup = async () => {
    if (!joinCode.trim()) { showToast('Enter a code', 'error'); return; }
    if (joinType === 'household') { handleJoinHousehold(); return; }
    setJoinLoading(true);
    try {
      const { data: group, error: joinError } = await supabase.rpc('join_group_by_code', {
        p_code: joinCode.trim().toUpperCase(),
      });
      if (joinError) throw joinError;
      showToast(`Joined "${group.name}" successfully!`);
      setShowJoinModal(false);
      setJoinCode('');
      setJoinType('group');
      fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setJoinLoading(false);
  };

  const handleJoinHousehold = async () => {
    if (!joinCode.trim()) { showToast('Enter a household code', 'error'); return; }
    setJoinLoading(true);
    try {
      const { data: householdData, error: joinError } = await supabase.rpc('join_household_by_code', {
        p_code: joinCode.trim().toUpperCase(),
      });
      if (joinError) throw joinError;
      showToast(`Joined "${householdData.name}" successfully!`);
      setShowJoinModal(false);
      setJoinCode('');
      setJoinType('group');
      fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setJoinLoading(false);
  };

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    showToast('Code copied!');
  };

  const handleShareCode = async (code, name) => {
    const shareData = { title: `Join ${name} on HomeSync`, text: `Join my group "${name}" on HomeSync! Use code: ${code}` };
    if (navigator.share) { try { await navigator.share(shareData); } catch { handleCopyCode(code); } }
    else { handleCopyCode(code); }
  };

  const peso = (v) => `₱${(Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const getBalanceDisplay = (balance) => {
    if (balance > 0) return { text: `You owe ${peso(balance)}`, color: '#e53e3e', arrow: '↓', owe: true };
    return { text: 'All settled', color: '#38a169', arrow: '✓', owe: false };
  };

  // Filtered lists based on search
  const filteredHouseholds = households.filter(h =>
    h.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderGroupCard = (item, isHousehold = false) => {
    const balanceInfo = getBalanceDisplay(item.yourBalance || 0);
    return (
      <div
        key={item.id}
        className="group-card"
        onClick={() => navigate(`/group-detail/${item.id}`, { state: { type: isHousehold ? 'household' : 'group' } })}
      >
        <div className="group-card-header">
          <div className="group-icon">{isHousehold ? <Home size={22} /> : <Users size={22} />}</div>
          <div className="group-info">
            <h3 className="group-name">{item.name}</h3>
            <p className="group-meta">{item.memberCount} member{item.memberCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="group-code-actions">
            <button aria-label="Copy code" onClick={(e) => { e.stopPropagation(); handleCopyCode(item.code); }} className="icon-btn-sm"><Copy size={14} /></button>
            <button aria-label="Share" onClick={(e) => { e.stopPropagation(); handleShareCode(item.code, item.name); }} className="icon-btn-sm"><Share2 size={14} /></button>
          </div>
        </div>
        <div className="group-stats">
          <div className={`group-stat-grid ${isHousehold ? 'cols-3' : 'cols-2'}`}>
            <div className="stat">
              <span className="stat-label">Total spent</span>
              <span className="stat-value">{peso(item.totalExpenses)}</span>
              <span className="stat-sub">this month</span>
            </div>
            <div className="stat">
              <span className="stat-label">Your share</span>
              <span className="stat-value">{peso(item.yourShare)}</span>
            </div>
            {isHousehold && (
              <div className="stat">
                <span className="stat-label">Utilities</span>
                <span className="stat-value">{peso(item.utilitiesTotal)}</span>
              </div>
            )}
          </div>
          <div className={`group-balance ${balanceInfo.owe ? 'owe' : 'settled'}`}>
            <span className="group-balance-label">Balance</span>
            <span className="group-balance-value">{balanceInfo.arrow} {balanceInfo.text}</span>
          </div>
        </div>
        {(item.pendingOwed || 0) > 0 && null}
      </div>
    );
  };

  return (
    <div className="groups-screen">
      <TopBar profile={profile} setProfile={setProfile} title="Groups" showBell notifications={notifications} unreadCount={unreadCount} onMarkAllRead={markNotificationsRead} />

      {/* Search Bar */}
      <div className="search-bar-wrap">
        <div className="search-toggle">
          <button
            className={`search-toggle-btn ${searchTab === 'households' ? 'active' : ''}`}
            onClick={() => { setSearchTab('households'); setSearchQuery(''); }}
          ><InlineIcon as={ICONS.household} /> Households</button>
          <button
            className={`search-toggle-btn ${searchTab === 'groups' ? 'active' : ''}`}
            onClick={() => { setSearchTab('groups'); setSearchQuery(''); }}
          ><InlineIcon as={ICONS.group} /> Groups</button>
        </div>
        <div className="search-input-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder={`Search ${searchTab}…`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button aria-label="Clear search" className="search-clear" onClick={() => setSearchQuery('')}><X size={14} /></button>
          )}
        </div>
      </div>

      <div className="groups-content">
        <LoadGate load={load} skeleton={<GroupsSkeleton />} onRetry={fetchData}>
        {searchTab === 'households' && (
          <div className="household-section">
            <h4 className="section-title"><InlineIcon as={ICONS.household} /> Households</h4>
            {filteredHouseholds.length === 0 ? (
              <div className="empty-state">
                <p>{searchQuery ? 'No households match your search.' : 'No households yet. Create or join one!'}</p>
              </div>
            ) : (
              filteredHouseholds.map(h => renderGroupCard(h, true))
            )}
          </div>
        )}

        {searchTab === 'groups' && (
          <div className="groups-section">
            <h4 className="section-title"><InlineIcon as={ICONS.group} /> Trip Groups</h4>
            {filteredGroups.length === 0 ? (
              <div className="empty-state">
                <p>{searchQuery ? 'No groups match your search.' : 'No groups yet. Create or join one!'}</p>
              </div>
            ) : (
              filteredGroups.map(g => renderGroupCard(g, false))
            )}
          </div>
        )}
        </LoadGate>
      </div>

      {/* FABs */}
      <div className="fab-group">
        <button aria-label="Create" className="fab-btn-group" onClick={() => { setCreateType(tabType); setShowCreateModal(true); }} title="Create">
          <Plus size={24} />
        </button>
        <button aria-label="Join" className="fab-btn-join" onClick={() => { setJoinType(tabType); setShowJoinModal(true); }} title="Join">
          <Users size={20} />
        </button>
      </div>

      {/* Create Modal (Group or Household) */}
      {showCreateModal && (
        <div className="modal-overlay-group">
          <div className="modal-group-card">
            <div className="modal-header">
              <h2>Create New {createType === 'household' ? 'Household' : 'Group'}</h2>
              <button aria-label="Close" className="modal-close" onClick={() => { setShowCreateModal(false); setCreateForm({ name: '', description: '' }); }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {/* Type toggle inside modal */}
              <div className="modal-type-toggle">
                {typeOrder.map(t => (
                  <button
                    key={t}
                    className={`split-btn ${createType === t ? 'active' : ''}`}
                    onClick={() => setCreateType(t)}
                  >{TYPE_LABELS[t]}</button>
                ))}
              </div>
              <input
                type="text"
                placeholder={`${createType === 'household' ? 'Household' : 'Group'} name *`}
                value={createForm.name}
                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                className="group-input"
              />
              <textarea
                placeholder="Description (optional)"
                value={createForm.description}
                onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                className="group-textarea"
                rows={3}
              />
              <button className="create-group-btn" onClick={handleCreateGroup} disabled={createLoading}>
                {createLoading ? 'Creating…' : `Create ${createType === 'household' ? 'Household' : 'Group'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {showJoinModal && (
        <div className="modal-overlay-group">
          <div className="modal-group-card">
            <div className="modal-header">
              <h2>Join {joinType === 'household' ? 'Household' : 'Group'}</h2>
              <button aria-label="Close" className="modal-close" onClick={() => { setShowJoinModal(false); setJoinType('group'); setJoinCode(''); }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="modal-type-toggle">
                {typeOrder.map(t => (
                  <button
                    key={t}
                    onClick={() => setJoinType(t)}
                    className={`split-btn ${joinType === t ? 'active' : ''}`}
                  >{TYPE_LABELS[t]}</button>
                ))}
              </div>
              <input
                type="text"
                placeholder={joinType === 'household' ? 'Enter household code (e.g. A1B2C3)' : 'Enter group code (e.g. A1B2C3)'}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                className="group-input"
              />
              <button
                className="join-group-btn"
                onClick={handleJoinGroup}
                disabled={joinLoading}
                style={{ background: '#3B2AAB' }}
              >
                {joinLoading ? 'Joining…' : `Join ${joinType === 'household' ? 'Household' : 'Group'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast-group toast-${toast.type}`}>{toast.msg}</div>}
      <BottomNav active="groups" />
    </div>
  );
}