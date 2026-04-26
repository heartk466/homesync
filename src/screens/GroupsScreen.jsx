import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { 
  Home, Users, Plus, Copy, Share2, X, 
  DollarSign 
} from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import './GroupsScreen.css';

export default function GroupsScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [household, setHousehold] = useState(null);
  const [householdSummary, setHouseholdSummary] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinType, setJoinType] = useState('group'); // 'group' or 'household'
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [toast, setToast] = useState(null);
  
  // Notification state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch notifications
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

  // Mark all as read
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

  // Realtime notification subscription
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

  // Fetch household summary
  const fetchHouseholdSummary = useCallback(async (householdData, profileData) => {
    if (!householdData || !profileData) return null;
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, paid_by, status, members_split')
      .eq('household_id', householdData.id)
      .eq('approval_status', 'approved')
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay);

    const total = (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);
    let yourShare = 0, pendingOwed = 0;
    expenses?.forEach(exp => {
      const splits = exp.members_split || {};
      const mySplit = splits[profileData.id];
      if (mySplit) {
        if (exp.paid_by !== profileData.id && exp.status !== 'paid') yourShare += Number(mySplit);
        if (exp.paid_by === profileData.id && exp.status !== 'paid') pendingOwed += Number(mySplit);
      }
    });
    const balance = pendingOwed - yourShare;

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
      totalExpenses: total,
      yourShare: yourShare,
      pendingOwed: pendingOwed,
      yourBalance: balance,
      role: householdData.created_by === profileData.id ? 'owner' : 'member',
    };
  }, []);

  // Main data fetch
  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }

      // Profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);
      
      // Fetch notifications for this user
      await fetchNotifications(user.id);

      // Household
      let householdData = null;
      if (profileData?.household_id) {
        const { data: hh } = await supabase
          .from('households')
          .select('*')
          .eq('id', profileData.household_id)
          .single();
        householdData = hh;
        setHousehold(householdData);
        
        const summary = await fetchHouseholdSummary(householdData, profileData);
        setHouseholdSummary(summary);
      }

      // Groups where user is a member
      const { data: memberGroups, error: memberGroupsError } = await supabase
        .from('group_members')
        .select('group_id, role')
        .eq('user_id', user.id)
        .eq('status', 'active');

      console.log('Member groups:', memberGroups, memberGroupsError);

      if (memberGroupsError) {
        console.error('Error fetching member groups:', memberGroupsError);
      }

      // Fetch group details separately
      const groupIds = (memberGroups || []).map(mg => mg.group_id);
      let groupsData = [];
      if (groupIds.length > 0) {
        const { data } = await supabase
          .from('groups')
          .select('*')
          .in('id', groupIds);
        groupsData = data || [];
      }

      console.log('Groups data:', groupsData);

      const groupsList = (memberGroups || []).map(mg => {
        const group = groupsData?.find(g => g.id === mg.group_id);
        return {
          ...group,
          role: mg.role,
          memberCount: 0,
          totalExpenses: 0,
          yourShare: 0,
          yourBalance: 0,
          pendingOwed: 0,
        };
      }).filter(g => g.id); // Filter out any null groups

      // Fallback: Also fetch groups where user is the creator (in case group_members insert failed)
      const { data: createdGroups } = await supabase
        .from('groups')
        .select('*')
        .eq('created_by', user.id);

      console.log('Created groups:', createdGroups);

      // Merge created groups that aren't already in the list
      if (createdGroups) {
        createdGroups.forEach(cg => {
          if (!groupsList.find(g => g.id === cg.id)) {
            groupsList.push({
              ...cg,
              role: 'owner',
              memberCount: 0,
              totalExpenses: 0,
              yourShare: 0,
              yourBalance: 0,
              pendingOwed: 0,
            });
          }
        });
      }

      console.log('Final groups list:', groupsList);

      // Enrich each group with stats
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      for (let group of groupsList) {
        // Member count
        const { count: memberCount } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('status', 'active');
        group.memberCount = memberCount;

        // Expenses this month
        const { data: groupExpenses } = await supabase
          .from('expenses')
          .select('amount, paid_by, status, members_split')
          .eq('group_id', group.id)
          .eq('approval_status', 'approved')
          .gte('expense_date', firstDay)
          .lte('expense_date', lastDay);

        const total = (groupExpenses || []).reduce((sum, e) => sum + Number(e.amount), 0);
        group.totalExpenses = total;

        let yourShareTotal = 0;
        let pendingOwedTotal = 0;
        groupExpenses?.forEach(exp => {
          const splits = exp.members_split || {};
          const mySplit = splits[user.id];
          if (mySplit) {
            if (exp.paid_by !== user.id && exp.status !== 'paid') yourShareTotal += Number(mySplit);
            if (exp.paid_by === user.id && exp.status !== 'paid') pendingOwedTotal += Number(mySplit);
          }
        });
        group.yourShare = yourShareTotal;
        group.pendingOwed = pendingOwedTotal;
        group.yourBalance = pendingOwedTotal - yourShareTotal;
      }

      setGroups(groupsList);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [navigate, fetchHouseholdSummary]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        .insert({
          name: createForm.name.trim(),
          description: createForm.description.trim() || null,
          code,
          created_by: user.id,
        })
        .select()
        .single();

      if (groupError) {
        console.error('Create group error:', groupError);
        throw groupError;
      }

      const { error: memberError } = await supabase.from('group_members').insert({
        group_id: group.id,
        user_id: user.id,
        role: 'owner',
        status: 'active',
      });

      if (memberError) {
        console.error('Add member error:', memberError);
        // Group was created but member insert failed - try to delete the group
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

      if (findError || !group) {
        showToast('Invalid group code', 'error');
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', user.id);

      console.log('Existing check:', existing, existingError);

      if (existing && existing.length > 0) {
        showToast('You are already a member of this group', 'error');
        return;
      }

      const { error: insertError } = await supabase.from('group_members').insert({
        group_id: group.id,
        user_id: user.id,
        role: 'member',
        status: 'active',
      });

      if (insertError) {
        console.error('Insert error:', insertError);
        showToast(`Failed to join: ${insertError.message}`, 'error');
        return;
      }

      showToast(`Joined "${group.name}" successfully!`);
      setShowJoinModal(false);
      setJoinCode('');
      setJoinType('group');
      fetchData();
    } catch (err) {
      console.error('Join error:', err);
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

      if (findError || !householdData) {
        showToast('Invalid household code', 'error');
        return;
      }

      const { data: userProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_id', user.id)
        .single();

      if (!userProfile) {
        showToast('Profile not found', 'error');
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from('household_members')
        .select('id')
        .eq('household_id', householdData.id)
        .eq('profile_id', userProfile.id);

      if (existing && existing.length > 0) {
        showToast('You are already a member of this household', 'error');
        return;
      }

      const { error: insertError } = await supabase.from('household_members').insert({
        household_id: householdData.id,
        profile_id: userProfile.id,
        role: 'member',
        status: 'active',
      });

      if (insertError) {
        console.error('Insert error:', insertError);
        showToast(`Failed to join: ${insertError.message}`, 'error');
        return;
      }

      // Update user's household_id in profiles
      await supabase
        .from('profiles')
        .update({ household_id: householdData.id })
        .eq('id', userProfile.id);

      showToast(`Joined "${householdData.name}" successfully!`);
      setShowJoinModal(false);
      setJoinCode('');
      setJoinType('group');
      fetchData();
    } catch (err) {
      console.error('Join household error:', err);
      showToast(err.message, 'error');
    }
    setJoinLoading(false);
  };

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    showToast('Code copied!');
  };

  const handleShareCode = async (code, name) => {
    const shareData = {
      title: `Join ${name} on HomeSync`,
      text: `Join my group "${name}" on HomeSync! Use code: ${code}`,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { handleCopyCode(code); }
    } else {
      handleCopyCode(code);
    }
  };

  const getBalanceDisplay = (balance) => {
    if (balance > 0) return { text: `Others owe you ₱${balance.toFixed(2)}`, color: '#38a169', arrow: '↑' };
    if (balance < 0) return { text: `You owe ₱${Math.abs(balance).toFixed(2)}`, color: '#e53e3e', arrow: '↓' };
    return { text: 'All settled', color: '#5A4AAA', arrow: '✓' };
  };

  const renderGroupCard = (item, isHousehold = false) => {
    const balanceInfo = getBalanceDisplay(item.yourBalance);
    return (
      <div 
        key={item.id} 
        className="group-card" 
        onClick={() => navigate(`/group/${item.id}`, { state: { type: isHousehold ? 'household' : 'group' } })}
      >
        <div className="group-card-header">
          <div className="group-icon">
            {isHousehold ? <Home size={22} /> : <Users size={22} />}
          </div>
          <div className="group-info">
            <h3 className="group-name">{item.name}</h3>
            <p className="group-meta">{item.memberCount} member{item.memberCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="group-code-actions">
            <button onClick={(e) => { e.stopPropagation(); handleCopyCode(item.code); }} className="icon-btn-sm">
              <Copy size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleShareCode(item.code, item.name); }} className="icon-btn-sm">
              <Share2 size={14} />
            </button>
          </div>
        </div>
        <div className="group-stats">
          <div className="stat">
            <span className="stat-label">Total spent (this month)</span>
            <span className="stat-value">₱{item.totalExpenses.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Your share</span>
            <span className="stat-value">₱{item.yourShare.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="stat balance">
            <span className="stat-label">Balance</span>
            <span className="stat-value" style={{ color: balanceInfo.color }}>
              {balanceInfo.arrow} {balanceInfo.text}
            </span>
          </div>
        </div>
        {item.pendingOwed > 0 && (
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
        <TopBar 
          profile={profile} 
          setProfile={setProfile} 
          title="Groups" 
          showBell 
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAllRead={markNotificationsRead}
        />
        <div className="loading-spinner">Loading groups...</div>
        <BottomNav active="groups" />
      </div>
    );
  }

  return (
    <div className="groups-screen">
      <TopBar 
        profile={profile} 
        setProfile={setProfile} 
        title="Groups" 
        showBell 
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markNotificationsRead}
      />

      <div className="groups-content">
        {/* Household Card */}
        {household && householdSummary && (
          <div className="household-section">
            <h4 className="section-title">🏠 Your Household</h4>
            {renderGroupCard(householdSummary, true)}
          </div>
        )}

        {/* Trip Groups */}
        <div className="groups-section">
          <h4 className="section-title">👥 Trip Groups</h4>
          {groups.length === 0 ? (
            <div className="empty-state">
              <p>No groups yet. Create or join one!</p>
            </div>
          ) : (
            groups.map(group => renderGroupCard(group, false))
          )}
        </div>
      </div>

      {/* FAB Buttons */}
      <div className="fab-group">
        <button className="fab-btn-group" onClick={() => setShowCreateModal(true)}>
          <Plus size={24} />
        </button>
        <button className="fab-btn-join" onClick={() => setShowJoinModal(true)}>
          <Users size={20} />
        </button>
      </div>

      {/* Create Group Modal */}
      {showCreateModal && (
        <div className="modal-overlay-group">
          <div className="modal-group-card">
            <div className="modal-header">
              <h2>Create New Group</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                placeholder="Group name *"
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
                {createLoading ? 'Creating...' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Group or Household Modal */}
      {showJoinModal && (
        <div className="modal-overlay-group">
          <div className="modal-group-card">
            <div className="modal-header">
              <h2>Join {joinType === 'household' ? 'Household' : 'Group'}</h2>
              <button className="modal-close" onClick={() => {
                setShowJoinModal(false);
                setJoinType('group');
                setJoinCode('');
              }}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {/* Join Type Toggle */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button
                  onClick={() => setJoinType('group')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '50px',
                    border: joinType === 'group' ? '2px solid #3B2AAB' : '1.5px solid #E0D9FF',
                    background: joinType === 'group' ? '#F0EDFF' : 'white',
                    color: joinType === 'group' ? '#3B2AAB' : '#9E8FCC',
                    fontFamily: "'Poppins', sans-serif",
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  👥 Group
                </button>
                <button
                  onClick={() => setJoinType('household')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '50px',
                    border: joinType === 'household' ? '2px solid #3B2AAB' : '1.5px solid #E0D9FF',
                    background: joinType === 'household' ? '#F0EDFF' : 'white',
                    color: joinType === 'household' ? '#3B2AAB' : '#9E8FCC',
                    fontFamily: "'Poppins', sans-serif",
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  🏠 Household
                </button>
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
                style={{
                  background: joinType === 'household' ? '#2C7A7B' : '#3B2AAB',
                }}
              >
                {joinLoading ? 'Joining...' : `Join ${joinType === 'household' ? 'Household' : 'Group'}`}
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