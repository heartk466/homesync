import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, ResponsiveContainer,
} from 'recharts';
import {
  Copy, Share2, X, Zap,
} from 'lucide-react';
import './DashboardScreen.css';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import ChatDrawer from '../components/ChatDrawer';       
import { fetchAllHouseholdExpenses, UTILITY_CATEGORIES } from '../utils/expenseUtils';
import { useAppContext } from '../AppContext';

export default function DashboardScreen() {
  const navigate = useNavigate();
  const { currencySymbol } = useAppContext();

  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  // ── Multi-household state ──────────────────────────────────────────────────
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [household, setHousehold] = useState(null);
  // ──────────────────────────────────────────────────────────────────────────

  const [totalSpent, setTotalSpent] = useState(0);
  const [utilitiesTotal, setUtilitiesTotal] = useState(0);
  const [lastMonthSpent, setLastMonthSpent] = useState(0);
  const [monthlyData, setMonthlyData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [groupSpending, setGroupSpending] = useState([]);
  const [totalGroupPaid, setTotalGroupPaid] = useState(0);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showHouseholdCode, setShowHouseholdCode] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  // ──────────────────────────────────────────────────────────────────────────

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

  // ── Fetch expense splits helper ────────────────────────────────────────────
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

  // ── Initial load: profile + all households ────────────────────────────────
  const fetchProfile = async () => {
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

      const { data: memberRows } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (!memberRows || memberRows.length === 0) return;

      const hhIds = memberRows.map(r => r.household_id);
      const { data: hhData } = await supabase
        .from('households')
        .select('*')
        .in('id', hhIds);

      const households = hhData || [];
      setAllHouseholds(households);

      if (households.length > 0) {
        setHousehold(prev => {
          if (prev && households.find(h => h.id === prev.id)) return prev;
          return households[0];
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ── Fetch data scoped to the selected household ───────────────────────────
  const fetchHouseholdData = async (selectedHousehold, user) => {
    if (!selectedHousehold || !user) return;

    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

      const allExpenses = await fetchAllHouseholdExpenses(selectedHousehold.id);
      const expenseIds = allExpenses.map(e => e.id);
      const splitsByExpense = await fetchExpenseSplits(expenseIds);

      let myApprovedTotal = 0;
      let myUtilitiesTotal = 0;
      let myPendingTotal = 0;
      let lastMonthTotal = 0;

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
        const splits = splitsByExpense[expense.id] || [];
        const mySplit = splits.find(s => s.user_id === user.id);
        if (mySplit && mySplit.status === 'approved' && expense.approval_status === 'approved') {
          const expenseDate = expense.expense_date;
          if (expenseDate >= firstDay && expenseDate <= lastDay) {
            const cat = expense.category || 'Other';
            categories[cat] = (categories[cat] || 0) + Number(mySplit.share_amount);
          }
        }
      }
      setCategoryData(Object.entries(categories).map(([name, value]) => ({ name, value })));

      // Monthly chart
      const monthlyMap = {};
      for (const expense of allExpenses) {
        const splits = splitsByExpense[expense.id] || [];
        const mySplit = splits.find(s => s.user_id === user.id);
        if (mySplit && mySplit.status === 'approved' && expense.approval_status === 'approved') {
          const d = new Date(expense.expense_date);
          const key = d.toLocaleDateString('en-US', { month: 'short' });
          monthlyMap[key] = (monthlyMap[key] || 0) + Number(mySplit.share_amount);
        }
      }
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      setMonthlyData(months.map(m => ({ month: m, amount: monthlyMap[m] || 0 })).filter(m => m.amount > 0).slice(-6));

      // Group spending
      const { data: memberGroupRows } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);
      let groupsList = [];
      if (memberGroupRows && memberGroupRows.length > 0) {
        const groupIds = memberGroupRows.map(r => r.group_id);
        const { data: groupsData } = await supabase
          .from('groups')
          .select('*')
          .in('id', groupIds);
        groupsList = groupsData || [];
      }
      const groupsWithPaidTotals = await Promise.all(
        groupsList.map(async (group) => {
          const { data: groupExpenses } = await supabase
            .from('expenses')
            .select('id, amount, category, approval_status')
            .eq('group_id', group.id)
            .eq('approval_status', 'approved')
            .gte('expense_date', firstDay)
            .lte('expense_date', lastDay);
          const groupExpenseIds = (groupExpenses || []).map(e => e.id);
          const groupSplitsMap = await fetchExpenseSplits(groupExpenseIds);
          let paidTotal = 0;
          for (const exp of (groupExpenses || [])) {
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
    } catch (err) {
      console.error(err);
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => { fetchProfile(); }, []);

  useEffect(() => {
    if (currentUser && household) {
      fetchHouseholdData(household, currentUser);
    }
  }, [household?.id, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || !household?.id) return;
    const channel = supabase
      .channel(`dashboard-realtime-${household.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `household_id=eq.${household.id}` }, () => fetchHouseholdData(household, currentUser))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => fetchHouseholdData(household, currentUser))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id, household?.id]);

  const percentChange = getPercentChange();

  return (
    <div className="dashboard">
      
      <TopBar
  profile={profile}
  setProfile={setProfile}
  household={household}
  currentUser={currentUser}
  notifications={[]}
  unreadCount={0}
  title="Dashboard"
  showBell={false}
  onChatOpen={() => setShowChat(true)}
  chatUnreadCount={chatUnread}
/>

      
      <ChatDrawer
  profile={profile}
  currentUser={currentUser}
  household={household}
  allHouseholds={allHouseholds}
  isOpen={showChat}
  onClose={() => setShowChat(false)}
/>

      {/* ── Household Pill Switcher ── */}
      {allHouseholds.length >= 2 && (
        <div className="household-pill-row">
          {allHouseholds.map(hh => (
            <button
              key={hh.id}
              className={`household-pill ${household?.id === hh.id ? 'active' : ''}`}
              onClick={() => setHousehold(hh)}
            >
              🏠 {hh.name}
            </button>
          ))}
        </div>
      )}

      <div className="dash-content">
        <div className="dash-card">
          <div className="card-left">
            <p className="card-greeting">{getGreeting()}, {getFirstName()}!</p>
            <p className="card-label">Your Total Spent</p>
            <p className="card-amount">{currencySymbol} {totalSpent.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="card-sub">this month{allHouseholds.length >= 2 ? ` · ${household?.name}` : ''}</p>
            {percentChange !== null && (
              <p className={`card-change ${Number(percentChange) > 0 ? 'up' : 'down'}`}>
                {Number(percentChange) > 0 ? '↑' : '↓'} {Math.abs(percentChange)}% vs last month
              </p>
            )}
            {pendingAmount > 0 && (
              <span className="pending-badge">Pending: {currencySymbol}{pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
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
            <p className="card-amount">{currencySymbol} {utilitiesTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            <p className="card-sub">your share of utilities this month</p>
          </div>
          <div className="card-chart"><Zap size={32} color="#3B2AAB" /></div>
        </div>

        <div className="dash-card group-spending-card" onClick={() => setShowGroupModal(true)}>
          <div className="card-left">
            <p className="card-label">Group Spending</p>
            <p className="card-amount">{currencySymbol} {totalGroupPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
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

      {/* Group Spending Modal */}
      {showGroupModal && (
        <div className="group-modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="group-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Group Spending</h2>
              <button className="modal-close" onClick={() => setShowGroupModal(false)}><X size={18} /></button>
            </div>
            <div className="group-modal-body">
              <p className="modal-sub">Your share of paid group expenses this month.</p>
              <div className="group-summary-row">
                <span>Total your share across groups</span>
                <strong>{currencySymbol} {totalGroupPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div className="group-list">
                {groupSpending.length === 0
                  ? <p className="no-data">No active groups with paid expenses yet.</p>
                  : groupSpending.map(group => (
                    <div key={group.id} className="group-row">
                      <div>
                        <p className="group-name">{group.name}</p>
                        <p className="group-role">{group.role || 'Member'}</p>
                      </div>
                      <span className="group-amount">{currencySymbol} {group.currentMonthPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))
                }
              </div>
              <button className="quick-btn" onClick={() => { setShowGroupModal(false); navigate('/groups'); }}>Open Groups</button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Household Code */}
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

      <BottomNav active="dashboard" />
    </div>
  );
}