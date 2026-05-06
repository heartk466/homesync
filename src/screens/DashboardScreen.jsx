import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, ResponsiveContainer,
} from 'recharts';
import {
  Home, FileText, Users, Zap, BarChart2, Settings,
  Copy, Share2, X, LogOut, Camera, Edit
} from 'lucide-react';
import './DashboardScreen.css';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import { fetchAllHouseholdExpenses, UTILITY_CATEGORIES } from '../utils/expenseUtils';

const COLORS = ['#3B2AAB', '#AE96FF', '#D4C5FF'];

export default function DashboardScreen() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [household, setHousehold] = useState(null);
  const [totalSpent, setTotalSpent] = useState(0);
  const [utilitiesTotal, setUtilitiesTotal] = useState(0);
  const [lastMonthSpent, setLastMonthSpent] = useState(0);
  const [monthlyData, setMonthlyData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [groupSpending, setGroupSpending] = useState([]);
  const [totalGroupPaid, setTotalGroupPaid] = useState(0);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showHouseholdCode, setShowHouseholdCode] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return '☀️ Good Morning';
    if (hour >= 12 && hour < 17) return '👋 Good Afternoon';
    return '🌙 Good Evening';
  };

  const getFirstName = () => {
    if (!profile?.full_name) return '';
    return profile.full_name.split(' ')[0];
  };

  const getPercentChange = () => {
    if (lastMonthSpent === 0) return null;
    const change = ((totalSpent - lastMonthSpent) / lastMonthSpent) * 100;
    return change.toFixed(1);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(household?.code || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Join my HomeSync Household!',
      text: `Join my household "${household?.name}" on HomeSync! Use code: ${household?.code}`,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { handleCopyCode(); }
    } else {
      handleCopyCode();
      alert('Code copied! Share it with your household members.');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const handlePhotoClick = () => fileInputRef.current.click();

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Please select a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB.');
      return;
    }
    setUploadingPhoto(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
      setAvatarUrl(publicUrl);
      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
    } catch (err) {
      alert('Failed to upload photo.');
    }
    setUploadingPhoto(false);
  };

  const handleEditProfile = () => {
    setEditForm({ full_name: profile?.full_name || '' });
    setEditSuccess(false);
    setShowProfile(false);
    setShowEditModal(true);
  };

  const handleSaveProfile = async () => {
    if (!editForm.full_name.trim()) {
      alert('Full name cannot be empty.');
      return;
    }
    setEditLoading(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: editForm.full_name.trim() })
      .eq('id', currentUser.id);
    if (error) {
      alert('Failed to update profile.');
    } else {
      setProfile(prev => ({ ...prev, full_name: editForm.full_name.trim() }));
      setEditSuccess(true);
      setTimeout(() => {
        setShowEditModal(false);
        setEditSuccess(false);
      }, 1500);
    }
    setEditLoading(false);
  };

  const fetchExpenseSplits = async (expenseIds) => {
    if (!expenseIds.length) return {};
    const { data, error } = await supabase
      .from('expense_splits')
      .select('expense_id, user_id, share_amount, status')
      .in('expense_id', expenseIds);
    if (error) return {};
    const grouped = {};
    data.forEach(split => {
      if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
      grouped[split.expense_id].push(split);
    });
    return grouped;
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
      if (profileData?.avatar_url) setAvatarUrl(profileData.avatar_url);

      if (profileData?.household_id) {
        const { data: householdData } = await supabase
          .from('households')
          .select('*')
          .eq('id', profileData.household_id)
          .single();
        setHousehold(householdData);
      }

      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

      const allExpenses = await fetchAllHouseholdExpenses(profileData?.household_id);
      const expenseIds = allExpenses.map(e => e.id);
      const splitsByExpense = await fetchExpenseSplits(expenseIds);

      let myApprovedTotal = 0;
      let myUtilitiesTotal = 0;
      let myPendingTotal = 0;
      let lastMonthTotal = 0;

      // Main sum: only count if expense.approval_status === 'approved' AND split.status === 'approved'
      for (const expense of allExpenses) {
        const splits = splitsByExpense[expense.id] || [];
        const mySplit = splits.find(s => s.user_id === user.id);
        if (mySplit) {
          const amount = Number(mySplit.share_amount);
          const expenseDate = expense.expense_date;
          if (mySplit.status === 'approved' && expense.approval_status === 'approved') {
            if (expenseDate >= firstDay && expenseDate <= lastDay) {
              myApprovedTotal += amount;
              if (UTILITY_CATEGORIES.includes(expense.category)) {
                myUtilitiesTotal += amount;
              }
            }
            if (expenseDate >= lastMonthStart && expenseDate <= lastMonthEnd) {
              lastMonthTotal += amount;
            }
          } else if (mySplit.status !== 'approved' && expenseDate >= firstDay && expenseDate <= lastDay) {
            myPendingTotal += amount;
          }
        }
      }

      setTotalSpent(myApprovedTotal);
      setUtilitiesTotal(myUtilitiesTotal);
      setPendingAmount(myPendingTotal);
      setLastMonthSpent(lastMonthTotal);

      // Category breakdown
      const categories = {};
      for (const expense of allExpenses) {
        if (!(expense.expense_date >= firstDay && expense.expense_date <= lastDay)) continue;
        const splits = splitsByExpense[expense.id] || [];
        const mySplit = splits.find(s => s.user_id === user.id);
        if (mySplit && mySplit.status === 'approved' && expense.approval_status === 'approved') {
          const cat = expense.category;
          categories[cat] = (categories[cat] || 0) + Number(mySplit.share_amount);
        }
      }
      setCategoryData(Object.entries(categories).map(([name, value]) => ({ name, value })));

      // Group spending
      const { data: memberGroups } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .eq('status', 'active');
      const groupIds = (memberGroups || []).map(mg => mg.group_id);
      let groupsList = [];
      if (groupIds.length) {
        const { data: groupsData } = await supabase.from('groups').select('*').in('id', groupIds);
        groupsList = groupsData || [];
      }

      const groupsWithPaidTotals = await Promise.all(
        groupsList.map(async (group) => {
          const { data: groupExpenses } = await supabase
            .from('expenses')
            .select('id, amount, category, approval_status')
            .eq('group_id', group.id)
            .eq('status', 'paid')
            .eq('approval_status', 'approved')
            .gte('expense_date', firstDay)
            .lte('expense_date', lastDay);
          const groupExpenseIds = groupExpenses.map(e => e.id);
          const groupSplitsMap = await fetchExpenseSplits(groupExpenseIds);
          let paidTotal = 0;
          for (const exp of groupExpenses) {
            const splits = groupSplitsMap[exp.id] || [];
            const mySplit = splits.find(s => s.user_id === user.id);
            if (mySplit && mySplit.status === 'approved') {
              paidTotal += Number(mySplit.share_amount);
            }
          }
          return { ...group, currentMonthPaid: paidTotal };
        })
      );
      setGroupSpending(groupsWithPaidTotals);
      setTotalGroupPaid(groupsWithPaidTotals.reduce((sum, g) => sum + g.currentMonthPaid, 0));

      // Monthly trend (last 6 months)
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const first = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
        let monthTotal = 0;
        for (const expense of allExpenses) {
          if (expense.expense_date >= first && expense.expense_date <= last && expense.approval_status === 'approved') {
            const splits = splitsByExpense[expense.id] || [];
            const mySplit = splits.find(s => s.user_id === user.id);
            if (mySplit && mySplit.status === 'approved') {
              monthTotal += Number(mySplit.share_amount);
            }
          }
        }
        months.push({ month: d.toLocaleString('default', { month: 'short' })[0], amount: monthTotal });
      }
      setMonthlyData(months);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => {
    if (!currentUser?.id || !household?.id) return;
    const channel = supabase
      .channel(`dashboard-realtime-${household.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `household_id=eq.${household.id}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => fetchData())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id, household?.id]);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/dashboard' },
    { id: 'expenses', label: 'Expenses', icon: FileText, path: '/expenses' },
    { id: 'groups', label: 'Groups', icon: Users, path: '/groups' },
    { id: 'utilities', label: 'Utilities', icon: Zap, path: '/utilities' },
    { id: 'reports', label: 'Reports', icon: BarChart2, path: '/reports' },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
  ];

  const percentChange = getPercentChange();

  return (
    <div className="dashboard">
      <TopBar profile={profile} setProfile={setProfile} household={household} currentUser={currentUser} notifications={[]} unreadCount={0} title="Dashboard" showBell={false} />
      <div className="dash-content">
        <div className="dash-card">
          <div className="card-left">
            <p className="card-greeting">{getGreeting()}, {getFirstName()}!</p>
            <p className="card-label">Your Total Spent</p>
            <p className="card-amount">₱ {totalSpent.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="card-sub">this month</p>
            {percentChange !== null && (
              <p className={`card-change ${Number(percentChange) > 0 ? 'up' : 'down'}`}>
                {Number(percentChange) > 0 ? '↑' : '↓'} {Math.abs(percentChange)}% vs last month
              </p>
            )}
            {pendingAmount > 0 && (
              <span className="pending-badge">Pending: ₱{pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
            )}
          </div>
          <div className="card-chart">
            <ResponsiveContainer width={120} height={80}>
              <BarChart data={monthlyData}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#3B2AAB' }} axisLine={false} tickLine={false} />
                <Bar dataKey="amount" fill="#3B2AAB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dash-card">
          <div className="card-left">
            <p className="card-label">Utilities Paid</p>
            <p className="card-amount">₱ {utilitiesTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="card-sub">your share of utilities this month</p>
          </div>
          <div className="card-chart"><Zap size={32} color="#3B2AAB" /></div>
        </div>

        <div className="dash-card group-spending-card" onClick={() => setShowGroupModal(true)}>
          <div className="card-left">
            <p className="card-label">Group Spending</p>
            <p className="card-amount">₱ {totalGroupPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="card-sub">your share across groups this month</p>
          </div>
          <div className="card-chart"><p className="group-card-action">View details</p></div>
        </div>

        <div className="dash-card quick-actions">
          <p className="quick-title">Quick Actions</p>
          <button className="quick-btn" onClick={() => navigate('/expenses')}>Add Expense</button>
          <button className="quick-btn" onClick={() => navigate('/groups')}>Create Group</button>
          <button className="quick-btn" onClick={() => navigate('/reports')}>View Reports</button>
        </div>
      </div>

      {showGroupModal && (
        <div className="group-modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="group-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Group Spending</h2><button className="modal-close" onClick={() => setShowGroupModal(false)}><X size={18} /></button></div>
            <div className="group-modal-body">
              <p className="modal-sub">Your share of paid group expenses this month.</p>
              <div className="group-summary-row"><span>Total your share across groups</span><strong>₱ {totalGroupPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
              <div className="group-list">
                {groupSpending.length === 0 ? <p className="no-data">No active groups with paid expenses yet.</p> : groupSpending.map(group => (
                  <div key={group.id} className="group-row"><div><p className="group-name">{group.name}</p><p className="group-role">{group.role || 'Member'}</p></div><span className="group-amount">₱ {group.currentMonthPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span></div>
                ))}
              </div>
              <button className="quick-btn" onClick={() => { setShowGroupModal(false); navigate('/groups'); }}>Open Groups</button>
            </div>
          </div>
        </div>
      )}

      <div className="floating-code-wrap">
        {showHouseholdCode && (
          <div className="household-code-card">
            <p className="code-household-name">{household?.name}</p>
            <p className="code-value">{household?.code}</p>
            <div className="code-actions">
              <button className="code-copy-btn" onClick={handleCopyCode}><Copy size={14}/> {copied ? 'Copied!' : 'Copy'}</button>
              <button className="code-share-btn" onClick={handleShare}><Share2 size={14}/> Share</button>
            </div>
          </div>
        )}
        <button className="floating-code-btn" onClick={() => setShowHouseholdCode(!showHouseholdCode)}>🏠 Your Code</button>
      </div>

      <div className="bottom-nav">
        {navItems.map(item => (
          <button key={item.id} className={`nav-item ${activeNav === item.id ? 'active' : ''}`} onClick={() => { setActiveNav(item.id); navigate(item.path); }}>
            <item.icon size={20}/><span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}