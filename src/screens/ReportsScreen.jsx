import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Tooltip
} from 'recharts';
import { Search, Filter, X, ChevronDown, FileText, Eye, Download, Users } from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import { fetchAllHouseholdExpenses } from '../utils/expenseUtils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './ReportsScreen.css';

const COLORS = ['#3B2AAB', '#2D1A7A', '#D4C5FF', '#AE96FF', '#6B46C1', '#9F7AEA', '#7C3AED', '#C4B5FD'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ReportsScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [selectedHousehold, setSelectedHousehold] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState(null); // for member filter (admin only)
  const [isAdmin, setIsAdmin] = useState(false);

  // Data
  const [yearlyTotal, setYearlyTotal] = useState(0);
  const [lastYearTotal, setLastYearTotal] = useState(0);
  const [monthlyData, setMonthlyData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [pendingBalances, setPendingBalances] = useState(0);
  const [lastYearPending, setLastYearPending] = useState(0);
  const [pendingByCategory, setPendingByCategory] = useState([]);
  const [statementHistory, setStatementHistory] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [reportSchedule, setReportSchedule] = useState(null);

  // UI State
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showStatementDetail, setShowStatementDetail] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState(null);
  const [showHouseholdDropdown, setShowHouseholdDropdown] = useState(false);
  const [householdSearch, setHouseholdSearch] = useState('');
  const [activeTab, setActiveTab] = useState('generate');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);

  // Generate Report Form
  const [reportForm, setReportForm] = useState({
    expense_range: new Date().toISOString().split('T')[0],
    category_filter: [],
    member_filter: '', // 'all' or specific user_id
    include_split_details: true,
  });

  // Schedule Form
  const [scheduleForm, setScheduleForm] = useState({
    frequency: 'monthly',
    day_of_month: 1,
    custom_interval_days: 30,
    category_filter: [],
  });

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Helper to fetch expense splits - no foreign key join to avoid 400 errors
  const fetchExpenseSplits = async (expenseIds) => {
    if (!expenseIds || !expenseIds.length) return {};
    // Chunk into 500 to stay under Supabase .in() limits
    const chunks = [];
    for (let i = 0; i < expenseIds.length; i += 500) {
      chunks.push(expenseIds.slice(i, i + 500));
    }
    const results = await Promise.all(
      chunks.map(chunk =>
        supabase
          .from('expense_splits')
          .select('id, expense_id, user_id, share_amount, status, profiles:user_id(id, full_name)')
          .in('expense_id', chunk)
      )
    );
    const grouped = {};
    results.forEach(({ data, error }) => {
      if (error) { console.error('fetchExpenseSplits error:', error); return; }
      (data || []).forEach(split => {
        if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
        grouped[split.expense_id].push(split);
      });
    });
    return grouped;
  };

  // Aggregate report data across ALL households the user belongs to
  const fetchReportData = async (houseData, memberId = null, resolvedUserId = null) => {
    if (!houseData) return;

    // Use the directly passed userId (avoids stale state issue)
    const targetUserId = resolvedUserId || memberId || currentUser?.id;
    if (!targetUserId) return;

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    const yearEnd   = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0];
    const lastYearEnd   = new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0];

    // ── Step 1: Get ALL household IDs this user belongs to ──
    const { data: memberRows } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', targetUserId);

    const householdIds = (memberRows?.map(r => r.household_id) || [houseData.id]).filter(Boolean);

    // ── Step 2: Fetch ALL expenses — no filter, we sort in JS ──
    const expenseResults = await Promise.all(
      householdIds.map(async (hid) => {
        const { data } = await supabase
          .from('expenses')
          .select('*')
          .eq('household_id', hid)
          .order('expense_date', { ascending: false });
        return data || [];
      })
    );
    const allExpenses = expenseResults.flat();

    // ── Step 3: Fetch expense_splits for enrichment (best-effort) ──
    const allExpenseIds = allExpenses.map(e => e.id);
    const splitsMap = allExpenseIds.length > 0 ? await fetchExpenseSplits(allExpenseIds) : {};

    // ── Helpers ──────────────────────────────────────────────────────────────
    // members_split JSONB shape: { "userId": "3500.00", ... }
    // This is always populated when expense is created — primary source of truth.
    const getUserShareAmount = (expense) => {
      // 1. Try members_split JSONB object keyed by userId
      if (expense.members_split) {
        const val = expense.members_split[targetUserId];
        if (val !== undefined && val !== null) return Number(val) || 0;
        // Also try if members_split is an array of objects
        if (Array.isArray(expense.members_split)) {
          const row = expense.members_split.find(s => s.user_id === targetUserId);
          if (row) return Number(row.share_amount || row.amount) || 0;
        }
      }
      // 2. Try expense_splits table row
      const tableRow = (splitsMap[expense.id] || []).find(s => s.user_id === targetUserId);
      if (tableRow) return Number(tableRow.share_amount) || 0;
      // 3. paid_by = this user and no split defined → full amount
      if (expense.paid_by === targetUserId) return Number(expense.amount) || 0;
      // 4. Equal split fallback — if user is in same household, divide equally
      if (expense.split_type === 'equal') {
        const splitCount = Object.keys(expense.members_split || {}).length;
        if (splitCount > 0) return Number(expense.amount) / splitCount;
      }
      return 0;
    };

    // Paid = expense.status === 'paid'  (ExpensesScreen sets this when all splits approved)
    const getPaidAmountForUser = (expense) => {
      if (expense.status !== 'paid') return 0;
      return getUserShareAmount(expense);
    };

    // Pending = approved but not yet paid, and user has a share
    const getPendingAmountForUser = (expense) => {
      if (expense.status === 'paid') return 0;
      if (expense.approval_status === 'rejected') return 0;
      return getUserShareAmount(expense);
    };

    // ── Step 4: Filter by year ──
    const thisYearExpenses = allExpenses.filter(
      e => e.expense_date >= yearStart && e.expense_date <= yearEnd
    );
    const lastYearExpenses = allExpenses.filter(
      e => e.expense_date >= lastYearStart && e.expense_date <= lastYearEnd
    );

    // ── Card 1: Total Household Spent = sum of user's paid (approved) splits this year ──
    const total = thisYearExpenses.reduce((sum, e) => sum + getPaidAmountForUser(e), 0);
    setYearlyTotal(total);

    const lastTotal = lastYearExpenses.reduce((sum, e) => sum + getPaidAmountForUser(e), 0);
    setLastYearTotal(lastTotal);

    // Monthly bar chart (paid splits per month)
    const monthly = MONTHS.map((month, i) => {
      const monthExpenses = thisYearExpenses.filter(
        e => new Date(e.expense_date).getMonth() === i
      );
      return { month, amount: monthExpenses.reduce((sum, e) => sum + getPaidAmountForUser(e), 0) };
    });
    setMonthlyData(monthly);

    // ── Card 2: Category breakdown (paid splits, all households) ──
    const categories = {};
    thisYearExpenses.forEach(e => {
      const paid = getPaidAmountForUser(e);
      if (paid > 0 && e.category) {
        categories[e.category] = (categories[e.category] || 0) + paid;
      }
    });
    setCategoryData(
      Object.entries(categories)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
    );

    // ── Card 3: Pending balances (user's unpaid splits, all households) ──
    const pending = thisYearExpenses.reduce((sum, e) => sum + getPendingAmountForUser(e), 0);
    setPendingBalances(pending);

    const lastPending = lastYearExpenses.reduce((sum, e) => sum + getPendingAmountForUser(e), 0);
    setLastYearPending(lastPending);

    // Pending by category (for grouped bar chart)
    const pendingCats = {};
    thisYearExpenses.forEach(e => {
      const amt = getPendingAmountForUser(e);
      if (amt > 0 && e.category) {
        pendingCats[e.category] = (pendingCats[e.category] || 0) + amt;
      }
    });
    setPendingByCategory(Object.entries(pendingCats).map(([name, value]) => ({ name, value })));

    // ── Statement history: group by month (primary household only) ──
    const primaryExpenses = thisYearExpenses.filter(e => e.household_id === houseData.id);
    const monthlyStatements = {};
    primaryExpenses.forEach(e => {
      const userAmount = getPaidAmountForUser(e);
      const d = new Date(e.expense_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyStatements[key]) {
        monthlyStatements[key] = {
          id: key,
          period: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
          expenses: [],
          total: 0,
          createdDate: e.created_at,
        };
      }
      if (userAmount > 0) {
        monthlyStatements[key].expenses.push({ ...e, user_share: userAmount });
        monthlyStatements[key].total += userAmount;
      }
    });
    const statements = Object.values(monthlyStatements).sort((a, b) => b.id.localeCompare(a.id));
    setStatementHistory(statements);

    // Recent activity (primary household)
    const { data: activity } = await supabase
      .from('report_activity')
      .select('*')
      .eq('household_id', houseData.id)
      .order('created_at', { ascending: false })
      .limit(10);
    setRecentActivity(activity || []);
  };

  const fetchHouseholdMembers = async (householdId, resolvedUserId = null) => {
    if (!householdId) return;
    const uid = resolvedUserId || currentUser?.id;
    const { data: memberRows } = await supabase
      .from('household_members')
      .select('user_id, role, status')
      .eq('household_id', householdId);
    if (memberRows && memberRows.length) {
      const userIds = memberRows.map(m => m.user_id);
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      const membersWithProfiles = memberRows.map(m => ({
        ...m,
        profiles: profilesData?.find(p => p.id === m.user_id) || { full_name: 'Unknown' }
      }));
      setHouseholdMembers(membersWithProfiles);
      // Check if current user is owner
      const userMember = membersWithProfiles.find(m => m.user_id === uid);
      setIsAdmin(userMember?.role === 'owner');
      // If admin and no member selected, default to current user
      // Don't auto-set selectedMemberId here — fetchData passes userId directly
    } else {
      setHouseholdMembers([]);
      setIsAdmin(false);
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

      // Step 1: get household IDs the user belongs to
      const { data: memberData } = await supabase
        .from('household_members')
        .select('household_id, role')
        .eq('user_id', user.id);

      // Step 2: fetch household details separately (no FK join needed)
      const householdIds = (memberData || []).map(m => m.household_id).filter(Boolean);
      const { data: householdsData } = householdIds.length > 0
        ? await supabase.from('households').select('*').in('id', householdIds)
        : { data: [] };

      const households = (householdsData || []).map(h => ({
        ...h,
        role: memberData?.find(m => m.household_id === h.id)?.role || 'member',
      }));
      setAllHouseholds(households);

      const primary = households.find(h => h.id === profileData.household_id) || households[0];
      setHousehold(primary);
      setSelectedHousehold(primary);
      setReportForm(prev => ({ ...prev, group_filter: primary?.name || '' }));

      if (primary) {
        await fetchHouseholdMembers(primary.id, user.id);
        await fetchReportData(primary, user.id, user.id);
      }
      await fetchNotifications(user.id);

      // report_schedules may not exist — wrap to prevent crash
      try {
        const { data: schedule } = await supabase
          .from('report_schedules')
          .select('*')
          .eq('user_id', user.id)
          .eq('household_id', primary?.id)
          .maybeSingle();
        if (schedule) {
          setReportSchedule(schedule);
          setScheduleForm({
            frequency: schedule.frequency,
            day_of_month: schedule.day_of_month,
            custom_interval_days: schedule.custom_interval_days || 30,
            category_filter: schedule.category_filter || [],
          });
        }
      } catch (_) { /* table may not exist yet */ }
    } catch (err) {
      console.error(err);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!currentUser?.id || !selectedHousehold?.id) return;
    const channel = supabase
      .channel(`reports-realtime-${selectedHousehold.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `household_id=eq.${selectedHousehold.id}`,
      }, () => fetchReportData(selectedHousehold, selectedMemberId, currentUser?.id))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expense_splits',
      }, () => fetchReportData(selectedHousehold, selectedMemberId, currentUser?.id))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'utilities',
        filter: `household_id=eq.${selectedHousehold.id}`,
      }, () => fetchReportData(selectedHousehold, selectedMemberId, currentUser?.id))
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [currentUser?.id, selectedHousehold?.id, selectedMemberId]);

  // selectedMemberId changes are handled directly in handleMemberChange()
  // No useEffect here — avoids stale currentUser causing 0 values on initial load

  const getYoYChange = (current, last) => {
    if (last === 0) return null;
    return (((current - last) / last) * 100).toFixed(1);
  };

  const handleSwitchHousehold = async (h) => {
    setSelectedHousehold(h);
    setShowHouseholdDropdown(false);
    setHouseholdSearch('');
    await fetchHouseholdMembers(h.id, currentUser?.id);
    await fetchReportData(h, currentUser?.id, currentUser?.id);
    showToast(`Switched to ${h.name}`);
  };

  const handleMemberChange = (memberId) => {
    setSelectedMemberId(memberId);
    setShowMemberDropdown(false);
    fetchReportData(selectedHousehold, memberId, currentUser?.id);
    showToast(`Viewing report for ${householdMembers.find(m => m.user_id === memberId)?.profiles?.full_name}`);
  };

  const handleGenerateReport = async () => {
    setLoading(true);
    try {
      await supabase.from('report_activity').insert({
        user_id: currentUser.id,
        household_id: selectedHousehold?.id,
        action: 'generated',
        description: `${profile?.full_name} generated a report for ${selectedHousehold?.name}`,
      });
      showToast('Report generated! ✅');
      setShowGenerateModal(false);
      await fetchReportData(selectedHousehold, selectedMemberId || currentUser?.id, currentUser?.id);
    } catch {
      showToast('Failed to generate report.', 'error');
    }
    setLoading(false);
  };

  const handleExportPDF = async (statement) => {
    try {
      const doc = new jsPDF();
      const targetMember = householdMembers.find(m => m.user_id === selectedMemberId);
      const memberName = targetMember?.profiles?.full_name || 'All Members';

      doc.setFontSize(20);
      doc.setTextColor(59, 42, 171);
      doc.text('HomeSync Report', 14, 20);
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(`Household: ${selectedHousehold?.name || ''}`, 14, 30);
      doc.text(`Member: ${memberName}`, 14, 38);
      doc.text(`Period: ${statement?.period || 'Full Year'}`, 14, 46);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 54);

      doc.setFontSize(14);
      doc.setTextColor(59, 42, 171);
      doc.text('Summary', 14, 66);

      const expenses = statement?.expenses || [];
      const total = expenses.reduce((sum, e) => sum + Number(e.user_share || e.amount), 0);
      const paid = expenses.filter(e => e.status === 'paid').reduce((sum, e) => sum + Number(e.user_share || e.amount), 0);
      const pending = total - paid;

      autoTable(doc, {
        startY: 70,
        head: [['Total Expenses (Your Share)', 'Paid', 'Pending']],
        body: [[
          `₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          `₱${paid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          `₱${pending.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        ]],
        styles: { font: 'helvetica', fontSize: 10 },
        headStyles: { fillColor: [59, 42, 171] },
      });

      doc.setFontSize(14);
      doc.setTextColor(59, 42, 171);
      doc.text('Expense Details', 14, doc.lastAutoTable.finalY + 14);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 18,
        head: [['Title', 'Category', 'Your Share', 'Date', 'Status']],
        body: expenses.map(e => [
          e.title,
          e.category,
          `₱${Number(e.user_share || e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          e.expense_date,
          e.status,
        ]),
        styles: { font: 'helvetica', fontSize: 9 },
        headStyles: { fillColor: [59, 42, 171] },
      });

      doc.save(`HomeSync-Report-${statement?.period || 'Full-Year'}.pdf`);

      await supabase.from('report_activity').insert({
        user_id: currentUser.id,
        household_id: selectedHousehold?.id,
        action: 'exported',
        description: `${profile?.full_name} exported "${selectedHousehold?.name}" Statement for ${memberName}`,
      });

      showToast('PDF exported! ✅');
    } catch (err) {
      console.error(err);
      showToast('Failed to export PDF.', 'error');
    }
  };

  const handleSaveSchedule = async () => {
    setLoading(true);
    try {
      const nextDate = new Date();
      if (scheduleForm.frequency === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1);
        nextDate.setDate(scheduleForm.day_of_month);
      } else {
        nextDate.setDate(nextDate.getDate() + scheduleForm.custom_interval_days);
      }

      if (reportSchedule) {
        await supabase
          .from('report_schedules')
          .update({
            frequency: scheduleForm.frequency,
            day_of_month: scheduleForm.day_of_month,
            custom_interval_days: scheduleForm.custom_interval_days,
            category_filter: scheduleForm.category_filter,
            next_scheduled_at: nextDate.toISOString(),
            is_active: true,
          })
          .eq('id', reportSchedule.id);
      } else {
        await supabase.from('report_schedules').insert({
          user_id: currentUser.id,
          household_id: selectedHousehold?.id,
          frequency: scheduleForm.frequency,
          day_of_month: scheduleForm.day_of_month,
          custom_interval_days: scheduleForm.custom_interval_days,
          category_filter: scheduleForm.category_filter,
          next_scheduled_at: nextDate.toISOString(),
          is_active: true,
        });
      }
      showToast('Schedule saved! ✅');
      setShowGenerateModal(false);
    } catch {
      showToast('Failed to save schedule.', 'error');
    }
    setLoading(false);
  };

  const getTimeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${mins}m ago`;
  };

  const yoyTotal = getYoYChange(yearlyTotal, lastYearTotal);
  const yoyPending = getYoYChange(pendingBalances, lastYearPending);

  const filteredStatements = statementHistory.filter(s => {
    if (searchQuery && !s.period.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterFrom && s.id < filterFrom.substring(0, 7)) return false;
    if (filterTo && s.id > filterTo.substring(0, 7)) return false;
    return true;
  });

  const filteredActivity = recentActivity.filter(a => {
    if (searchQuery && !a.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const CATEGORIES = ['Rent', 'Water', 'Food', 'Internet', 'Electricity', 'Gas', 'Grocery'];

  return (
    <div className="reports-screen">

      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}

      <TopBar
        profile={profile}
        setProfile={setProfile}
        household={household}
        currentUser={currentUser}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={() => {}}
        title="HomeSync"
        showBell={true}
      />

      <div className="reports-title-section">
        <div className="reports-title-row">
          <div>
            <h2 className="reports-title">Reports & Analytics</h2>
            <p className="reports-subtitle">Top Spending & Balances</p>
          </div>
          <button className="export-icon-btn" onClick={() => setShowGenerateModal(true)}>
            <FileText size={20}/>
          </button>
        </div>

        {/* Household Switcher */}
        {allHouseholds.length > 1 && (
          <div className="household-switcher-wrap">
            <button className="household-switcher-pill" onClick={() => setShowHouseholdDropdown(!showHouseholdDropdown)}>
              🏠 {selectedHousehold?.name}
              <ChevronDown size={14}/>
            </button>
            {showHouseholdDropdown && (
              <div className="household-dropdown">
                <div className="household-search-wrap">
                  <Search size={13} className="household-search-icon"/>
                  <input type="text" placeholder="Search household..." value={householdSearch} onChange={e => setHouseholdSearch(e.target.value)} className="household-search-input" />
                </div>
                {allHouseholds.filter(h => h.name.toLowerCase().includes(householdSearch.toLowerCase())).map(h => (
                  <button key={h.id} className={`household-option ${selectedHousehold?.id === h.id ? 'active' : ''}`} onClick={() => handleSwitchHousehold(h)}>
                    <span className="household-option-name">{h.name}</span>
                    <span className="household-option-role">{h.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Member Selector (only for admin) */}
        {isAdmin && householdMembers.length > 1 && (
          <div className="household-switcher-wrap" style={{ marginTop: 8 }}>
            <button className="household-switcher-pill" style={{ background: '#5A4AAA' }} onClick={() => setShowMemberDropdown(!showMemberDropdown)}>
              <Users size={14}/> {householdMembers.find(m => m.user_id === selectedMemberId)?.profiles?.full_name || 'Select Member'}
              <ChevronDown size={14}/>
            </button>
            {showMemberDropdown && (
              <div className="household-dropdown">
                {householdMembers.map(m => (
                  <button key={m.user_id} className={`household-option ${selectedMemberId === m.user_id ? 'active' : ''}`} onClick={() => handleMemberChange(m.user_id)}>
                    <span className="household-option-name">{m.profiles?.full_name}</span>
                    <span className="household-option-role">{m.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="reports-content">

        {/* Card 1 — Total Household Spent (paid splits across ALL households) */}
        <div className="report-card">
          <p className="report-card-label">Total Household Spent (This Year)</p>
          <div className="report-card-row">
            <div>
              <p className="report-card-amount">
                ₱ {yearlyTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
              {yoyTotal !== null ? (
                <p className={`yoy-change ${Number(yoyTotal) > 0 ? 'up' : 'down'}`}>
                  {Number(yoyTotal) > 0 ? '↑' : '↓'} {Math.abs(yoyTotal)}% Year-over-year
                </p>
              ) : (
                <p className="yoy-change" style={{ color: '#9E8FCC' }}>+ Year-over-year</p>
              )}
            </div>
          </div>
          {monthlyData.some(m => m.amount > 0) ? (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={monthlyData} barCategoryGap="20%">
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#3B2AAB' }} axisLine={false} tickLine={false} />
                <Bar dataKey="amount" fill="#3B2AAB" radius={[4, 4, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p className="no-data" style={{ margin: 0 }}>No paid expenses yet this year</p>
            </div>
          )}
        </div>

        {/* Card 2 — Largest Expense Category (pie chart + legend, all households) */}
        <div className="report-card">
          <p className="report-card-label">Largest Expense Category</p>
          {categoryData.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              {/* Donut chart on the left */}
              <div style={{ flexShrink: 0, width: 120, height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={32}
                      outerRadius={52}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {categoryData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Legend on the right */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {categoryData.map((entry, i) => (
                  <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: COLORS[i % COLORS.length],
                      flexShrink: 0, display: 'inline-block'
                    }}/>
                    <span style={{ fontSize: 11, color: '#3B2AAB', fontWeight: 500 }}>{entry.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="no-data">No expense data yet</p>
          )}
        </div>

        {/* Card 3 — Pending Member Balances (unpaid splits across ALL households) */}
        <div className="report-card">
          <p className="report-card-label">Pending Member Balances</p>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p className="report-card-amount">
                ₱ {pendingBalances.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
              {yoyPending !== null ? (
                <p className={`yoy-change ${Number(yoyPending) > 0 ? 'up' : 'down'}`}>
                  {Number(yoyPending) > 0 ? '↑' : '↓'} {Math.abs(yoyPending)}% Year-over-year
                </p>
              ) : (
                <p className="yoy-change" style={{ color: '#9E8FCC' }}>+ Year-over-year</p>
              )}
            </div>
            {/* Mini legend top-right */}
            {pendingByCategory.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B2AAB', display: 'inline-block' }}/>
                  <span style={{ fontSize: 9, color: '#3B2AAB' }}>Total</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#AE96FF', display: 'inline-block' }}/>
                  <span style={{ fontSize: 9, color: '#3B2AAB' }}>Pending</span>
                </div>
              </div>
            )}
          </div>
          {pendingByCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={110}>
              <BarChart
                data={pendingByCategory}
                barCategoryGap="25%"
                barGap={2}
              >
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: '#3B2AAB' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) =>
                    `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                  }
                />
                {/* "Total" bar (paid + pending for that category) */}
                <Bar
                  dataKey="value"
                  name="Total"
                  radius={[4, 4, 0, 0]}
                  fill="#3B2AAB"
                />
                {/* "Pending" bar rendered as a lighter overlay — same data but lighter color */}
                <Bar
                  dataKey="value"
                  name="Pending"
                  radius={[4, 4, 0, 0]}
                  fill="#AE96FF"
                  fillOpacity={0.55}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p className="no-data" style={{ margin: 0 }}>No pending balances</p>
            </div>
          )}
        </div>

        {/* Search & Filter */}
        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon"/>
            <input type="text" placeholder="Search reports..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}><Filter size={14}/> Filter</button>
        </div>

        {/* Statement History */}
        <div className="report-section">
          <p className="report-section-title">Statement History</p>
          <div className="statement-table">
            <div className="statement-header-row">
              <span>ID</span>
              <span>Period</span>
              <span>Total</span>
              <span>Date</span>
              <span>Status</span>
              <span></span>
            </div>
            {filteredStatements.length === 0 ? (
              <p className="no-data">No statements yet</p>
            ) : (
              filteredStatements.map((s, i) => (
                <div key={s.id} className="statement-row">
                  <span className="statement-id">ID {i + 501}</span>
                  <span className="statement-period">{s.period}</span>
                  <span className="statement-total">₱{s.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                  <span className="statement-date">{new Date(s.createdDate).toLocaleDateString()}</span>
                  <span className="statement-status finalized">Finalized</span>
                  <div className="statement-actions">
                    <button className="icon-btn-report" onClick={() => { setSelectedStatement(s); setShowStatementDetail(true); }}><Eye size={14}/></button>
                    <button className="icon-btn-report" onClick={() => handleExportPDF(s)}><Download size={14}/></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="report-section">
          <p className="report-section-title">Recent Report Activity</p>
          {filteredActivity.length === 0 ? (
            <p className="no-data">No recent activity</p>
          ) : (
            filteredActivity.map(a => (
              <div key={a.id} className="activity-item">
                <div className="activity-avatar">
                  {a.profiles?.avatar_url ? <img src={a.profiles.avatar_url} alt="" className="activity-avatar-img"/> : a.profiles?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="activity-info">
                  <p className="activity-desc">{a.description}</p>
                  <p className="activity-time">{getTimeAgo(a.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Generate & Export Modal */}
      {showGenerateModal && (
        <div className="modal-overlay-reports">
          <div className="generate-modal">
            <div className="modal-header">
              <h2>Generate & Export Report</h2>
              <button className="modal-close" onClick={() => setShowGenerateModal(false)}><X size={18}/></button>
            </div>

            <div className="modal-tabs">
              <button className={`modal-tab ${activeTab === 'generate' ? 'active' : ''}`} onClick={() => setActiveTab('generate')}>Generate New Report</button>
              <button className={`modal-tab ${activeTab === 'schedule' ? 'active' : ''}`} onClick={() => setActiveTab('schedule')}>Schedule Automated Reports</button>
            </div>

            <div className="modal-scroll">
              {activeTab === 'generate' ? (
                <>
                  <div className="form-group">
                    <label>Expense Range</label>
                    <input type="date" value={reportForm.expense_range} onChange={e => setReportForm(prev => ({ ...prev, expense_range: e.target.value }))} />
                  </div>

                  <div className="form-group">
                    <label>Category Filter</label>
                    <div className="select-wrap">
                      <select value={reportForm.category_filter} onChange={e => setReportForm(prev => ({ ...prev, category_filter: Array.from(e.target.selectedOptions, o => o.value) }))} multiple style={{ borderRadius: 16, height: 100 }}>
                        {CATEGORIES.map(c => (<option key={c} value={c}>{c}</option>))}
                      </select>
                    </div>
                    <span style={{ fontSize: 10, color: '#9E8FCC', paddingLeft: 8 }}>Hold Ctrl/Cmd to select multiple</span>
                  </div>

                  <div className="form-group">
                    <label>Member (for detailed splits)</label>
                    <div className="select-wrap">
                      <select value={reportForm.member_filter} onChange={e => setReportForm(prev => ({ ...prev, member_filter: e.target.value }))}>
                        <option value="all">All Members (Household Total)</option>
                        {householdMembers.map(m => (<option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>))}
                      </select>
                      <ChevronDown size={14} className="select-arrow"/>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>
                      <input type="checkbox" checked={reportForm.include_split_details} onChange={e => setReportForm(prev => ({ ...prev, include_split_details: e.target.checked }))} />
                      {' '}Include per‑member split details
                    </label>
                  </div>

                  <button className="generate-btn" onClick={handleGenerateReport} disabled={loading}>{loading ? 'Generating...' : 'Generate Report'}</button>
                  <button className="export-pdf-btn" onClick={() => handleExportPDF(null)} disabled={loading}><Download size={16}/> Export to PDF (Current View)</button>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Frequency</label>
                    <div className="split-toggle">
                      {['monthly', 'weekly', 'custom'].map(f => (
                        <button key={f} className={`split-btn ${scheduleForm.frequency === f ? 'active' : ''}`} onClick={() => setScheduleForm(prev => ({ ...prev, frequency: f }))}>
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {scheduleForm.frequency === 'monthly' && (
                    <div className="form-group">
                      <label>Day of Month</label>
                      <input type="number" min="1" max="28" value={scheduleForm.day_of_month} onChange={e => setScheduleForm(prev => ({ ...prev, day_of_month: Number(e.target.value) }))} />
                    </div>
                  )}

                  {scheduleForm.frequency === 'custom' && (
                    <div className="form-group">
                      <label>Every X Days</label>
                      <input type="number" min="1" value={scheduleForm.custom_interval_days} onChange={e => setScheduleForm(prev => ({ ...prev, custom_interval_days: Number(e.target.value) }))} />
                    </div>
                  )}

                  {reportSchedule && (
                    <div className="schedule-info">
                      <p>✅ Schedule active</p>
                      <p>Next report: {new Date(reportSchedule.next_scheduled_at).toLocaleDateString()}</p>
                    </div>
                  )}

                  <button className="generate-btn" onClick={handleSaveSchedule} disabled={loading}>{loading ? 'Saving...' : 'Save Schedule'}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Statement Detail Modal */}
      {showStatementDetail && selectedStatement && (
        <div className="modal-overlay-reports">
          <div className="generate-modal">
            <div className="modal-header">
              <h2>{selectedStatement.period} Statement</h2>
              <button className="modal-close" onClick={() => setShowStatementDetail(false)}><X size={18}/></button>
            </div>
            <div className="modal-scroll">
              <div className="statement-detail-summary">
                <div className="stat-detail-item">
                  <span className="stat-detail-label">Total (Your Share)</span>
                  <span className="stat-detail-value">₱{selectedStatement.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="stat-detail-item">
                  <span className="stat-detail-label">Expenses</span>
                  <span className="stat-detail-value">{selectedStatement.expenses.length}</span>
                </div>
              </div>

              {selectedStatement.expenses.map(e => (
                <div key={e.id} className="detail-expense-row">
                  <div className="detail-expense-info">
                    <p className="detail-expense-title">{e.title}</p>
                    <p className="detail-expense-meta">{e.category} | {e.expense_date}</p>
                  </div>
                  <div className="detail-expense-right">
                    <p className="detail-expense-amount">₱{Number(e.user_share || e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    <span className="detail-expense-status" style={{ color: e.status === 'paid' ? '#38a169' : '#856404', background: e.status === 'paid' ? '#f0fff4' : '#fff3cd' }}>{e.status}</span>
                  </div>
                </div>
              ))}

              <button className="export-pdf-btn" onClick={() => handleExportPDF(selectedStatement)}><Download size={16}/> Export to PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilter && (
        <div className="modal-overlay-reports">
          <div className="filter-modal-reports">
            <div className="modal-header">
              <h2>Filter</h2>
              <button className="modal-close" onClick={() => setShowFilter(false)}><X size={18}/></button>
            </div>
            <div className="form-group">
              <label>Date From</label>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date To</label>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
            </div>
            <div className="filter-actions">
              <button className="filter-reset-btn" onClick={() => { setFilterFrom(''); setFilterTo(''); setShowFilter(false); }}>Reset</button>
              <button className="filter-apply-btn" onClick={() => setShowFilter(false)}>Apply</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="reports"/>
    </div>
  );
}