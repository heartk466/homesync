import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Home, Users, Plus, Copy, Share2, X,
  DollarSign
} from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import './GroupsScreen.css';
import { UTILITY_CATEGORIES } from '../utils/expenseUtils';

export default function GroupsScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinType, setJoinType] = useState('group');
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

  // Helper to fetch expense splits
  const fetchExpenseSplits = async (expenseIds) => {
    if (!expenseIds.length) return {};
    const { data, error } = await supabase
      .from('expense_splits')
      .select('expense_id, user_id, share_amount, status')
      .in('expense_id', expenseIds);
    if (error) {
      console.error('Error fetching splits:', error);
      return {};
    }
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

    // Fetch only approved expenses within the month
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, amount, paid_by, status, approval_status, category')
      .eq('household_id', householdData.id)
      .eq('approval_status', 'approved')
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay);

    if (!expenses || expenses.length === 0) {
      const { count: memberCount } = await supabase
        .from('household_members')
        .select('*', { count: 'exact', head: true })
        .eq('household_id', householdData.id)
        .eq('status', 'active');
      return {
        id: householdData.id,
        name: householdData.name,
        code: householdData.code,
        type: 'household',
        memberCount: memberCount || 1,
        totalExpenses: 0,
        yourShare: 0,
        pendingOwed: 0,
        yourBalance: 0,
        utilitiesTotal: 0,
        role: householdData.created_by === profileData.id ? 'owner' : 'member',
      };
    }

    const expenseIds = expenses.map(e => e.id);
    const splitsMap = await fetchExpenseSplits(expenseIds);

    let totalExpenses = 0;
    let yourShare = 0;
    let pendingOwed = 0;
    let utilitiesTotal = 0;

    for (const expense of expenses) {
      const splits = splitsMap[expense.id] || [];
      const mySplit = splits.find(s => s.user_id === user.id);

      // Count full expense amount
      totalExpenses += Number(expense.amount);

      if (mySplit) {
        // yourShare = total of your splits (paid + unpaid)
        yourShare += Number(mySplit.share_amount);

        if (mySplit.status !== 'approved') {
          // Still unpaid = you owe this
          pendingOwed += Number(mySplit.share_amount);
        } else {
          // Paid — count utilities
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

    return {
      id: householdData.id,
      name: householdData.name,
      code: householdData.code,
      type: 'household',
      memberCount: memberCount || 1,
      totalExpenses,
      yourShare,
      pendingOwed,
      yourBalance: pendingOwed, // balance = what you still owe
      utilitiesTotal,
      role: householdData.created_by === profileData.id ? 'owner' : 'member',
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
      .eq('approval_status', 'approved')
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay);

    if (!expenses || expenses.length === 0) {
      return {
        ...group,
        totalExpenses: 0,
        yourShare: 0,
        pendingOwed: 0,
        yourBalance: 0,
        utilitiesTotal: 0,
      };
    }

    const expenseIds = expenses.map(e => e.id);
    const splitsMap = await fetchExpenseSplits(expenseIds);

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
        if (mySplit.status !== 'approved') {
          pendingOwed += Number(mySplit.share_amount);
        } else {
          if (UTILITY_CATEGORIES.includes(expense.category)) {
            utilitiesTotal += Number(mySplit.share_amount);
          }
        }
      }
    }

    return {
      ...group,
      totalExpenses,
      yourShare,
      pendingOwed,
      yourBalance: pendingOwed, // balance = what you still owe
      utilitiesTotal,
    };
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

      // Households
      const householdsList = await fetchAllHouseholds(user, profileData);
      setHouseholds(householdsList);

      // Groups
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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [navigate, fetchAllHouseholds, fetchGroupSpending]);

  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Realtime: notifications
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('groups-notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev]);
        setUnreadCount(prev => prev + 1);
        showToast(payload.new.message, 'info');
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id]);

  // Realtime: expense changes + split changes → refresh stats
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('groups-expenses-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
        fetchDataRef.current?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => {
        fetchDataRef.current?.();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id]);

  // ---------- Handlers ----------
  const handleCreateGroup = async () => {
    if (!createForm.name.trim()) {
      showToast('Group name is required', 'error');
      return;
    }
    setCreateLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({ name: createForm.name.trim(), description: createForm.description.trim() || null, code, created_by: user.id })
        .select()
        .single();
      if (groupError) throw groupError;
      const { error: memberError } = await supabase.from('group_members').insert({ group_id: group.id, user_id: user.id, role: 'owner', status: 'active' });
      if (memberError) {
        await supabase.from('groups').delete().eq('id', group.id);
        throw new Error('Failed to add you as member');
      }
      showToast(`Group "${group.name}" created! Code: ${code}`);
      setShowCreateModal(false);
      setCreateForm({ name: '', description: '' });
      fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setCreateLoading(false);
  };

  const handleJoinGroup = async () => {
    if (!joinCode.trim()) {
      showToast('Enter a code', 'error');
      return;
    }
    if (joinType === 'household') {
      handleJoinHousehold();
      return;
    }
    setJoinLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: group, error: findError } = await supabase
        .from('groups')
        .select('id, name')
        .eq('code', joinCode.trim().toUpperCase())
        .single();
      if (findError || !group) { showToast('Invalid group code', 'error'); return; }
      const { data: existing } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', user.id);
      if (existing && existing.length > 0) { showToast('You are already a member of this group', 'error'); return; }
      const { error: insertError } = await supabase.from('group_members').insert({ group_id: group.id, user_id: user.id, role: 'member', status: 'active' });
      if (insertError) { showToast(`Failed to join: ${insertError.message}`, 'error'); return; }
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
    if (!joinCode.trim()) {
      showToast('Enter a household code', 'error');
      return;
    }
    setJoinLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: householdData, error: findError } = await supabase
        .from('households')
        .select('id, name')
        .eq('code', joinCode.trim().toUpperCase())
        .single();
      if (findError || !householdData) { showToast('Invalid household code', 'error'); return; }
      const { data: existing } = await supabase
        .from('household_members')
        .select('id')
        .eq('household_id', householdData.id)
        .eq('user_id', user.id);
      if (existing && existing.length > 0) { showToast('You are already a member of this household', 'error'); return; }
      const { error: insertError } = await supabase.from('household_members').insert({ household_id: householdData.id, user_id: user.id, role: 'member', status: 'active' });
      if (insertError) { showToast(`Failed to join: ${insertError.message}`, 'error'); return; }
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

  // Fixed balance display — balance is now simply pendingOwed (always >= 0)
  const getBalanceDisplay = (balance) => {
    if (balance > 0) return { text: `You owe ₱${balance.toFixed(2)}`, color: '#e53e3e', arrow: '↓' };
    return { text: 'All settled', color: '#38a169', arrow: '✓' };
  };

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
            <button onClick={(e) => { e.stopPropagation(); handleCopyCode(item.code); }} className="icon-btn-sm"><Copy size={14} /></button>
            <button onClick={(e) => { e.stopPropagation(); handleShareCode(item.code, item.name); }} className="icon-btn-sm"><Share2 size={14} /></button>
          </div>
        </div>
        <div className="group-stats">
          <div className="stat"><span className="stat-label">Total spent (this month)</span><span className="stat-value">₱{(item.totalExpenses || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span></div>
          <div className="stat"><span className="stat-label">Your share</span><span className="stat-value">₱{(item.yourShare || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span></div>
          <div className="stat"><span className="stat-label">Utilities</span><span className="stat-value">₱{(item.utilitiesTotal || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span></div>
          <div className="stat balance"><span className="stat-label">Balance</span><span className="stat-value" style={{ color: balanceInfo.color }}>{balanceInfo.arrow} {balanceInfo.text}</span></div>
        </div>
        {(item.pendingOwed || 0) > 0 && (
          <div className="pending-badge-group">
            <DollarSign size={12} /> ₱{item.pendingOwed.toFixed(2)} pending from you
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="groups-screen">
        <TopBar profile={profile} setProfile={setProfile} title="Groups" showBell notifications={notifications} unreadCount={unreadCount} onMarkAllRead={markNotificationsRead} />
        <div className="loading-spinner">Loading groups…</div>
        <BottomNav active="groups" />
      </div>
    );
  }

  return (
    <div className="groups-screen">
      <TopBar profile={profile} setProfile={setProfile} title="Groups" showBell notifications={notifications} unreadCount={unreadCount} onMarkAllRead={markNotificationsRead} />
      <div className="groups-content">
        {households.length > 0 && (
          <div className="household-section">
            <h4 className="section-title">🏠 Households</h4>
            {households.map(household => renderGroupCard(household, true))}
          </div>
        )}
        <div className="groups-section">
          <h4 className="section-title">👥 Trip Groups</h4>
          {groups.length === 0 ? (
            <div className="empty-state"><p>No groups yet. Create or join one!</p></div>
          ) : (
            groups.map(group => renderGroupCard(group, false))
          )}
        </div>
      </div>
      <div className="fab-group">
        <button className="fab-btn-group" onClick={() => setShowCreateModal(true)}><Plus size={24} /></button>
        <button className="fab-btn-join" onClick={() => setShowJoinModal(true)}><Users size={20} /></button>
      </div>

      {showCreateModal && (
        <div className="modal-overlay-group">
          <div className="modal-group-card">
            <div className="modal-header"><h2>Create New Group</h2><button className="modal-close" onClick={() => setShowCreateModal(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <input type="text" placeholder="Group name *" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} className="group-input" />
              <textarea placeholder="Description (optional)" value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} className="group-textarea" rows={3} />
              <button className="create-group-btn" onClick={handleCreateGroup} disabled={createLoading}>{createLoading ? 'Creating…' : 'Create Group'}</button>
            </div>
          </div>
        </div>
      )}

      {showJoinModal && (
        <div className="modal-overlay-group">
          <div className="modal-group-card">
            <div className="modal-header"><h2>Join {joinType === 'household' ? 'Household' : 'Group'}</h2><button className="modal-close" onClick={() => { setShowJoinModal(false); setJoinType('group'); setJoinCode(''); }}><X size={20} /></button></div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button onClick={() => setJoinType('group')} style={{ flex: 1, padding: '10px', borderRadius: '50px', border: joinType === 'group' ? '2px solid #3B2AAB' : '1.5px solid #E0D9FF', background: joinType === 'group' ? '#F0EDFF' : 'white', color: joinType === 'group' ? '#3B2AAB' : '#9E8FCC', fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>👥 Group</button>
                <button onClick={() => setJoinType('household')} style={{ flex: 1, padding: '10px', borderRadius: '50px', border: joinType === 'household' ? '2px solid #3B2AAB' : '1.5px solid #E0D9FF', background: joinType === 'household' ? '#F0EDFF' : 'white', color: joinType === 'household' ? '#3B2AAB' : '#9E8FCC', fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>🏠 Household</button>
              </div>
              <input type="text" placeholder={joinType === 'household' ? 'Enter household code (e.g. A1B2C3)' : 'Enter group code (e.g. A1B2C3)'} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} className="group-input" />
              <button className="join-group-btn" onClick={handleJoinGroup} disabled={joinLoading} style={{ background: joinType === 'household' ? '#2C7A7B' : '#3B2AAB' }}>{joinLoading ? 'Joining…' : `Join ${joinType === 'household' ? 'Household' : 'Group'}`}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast-group toast-${toast.type}`}>{toast.msg}</div>}
      <BottomNav active="groups" />
    </div>
  );
}