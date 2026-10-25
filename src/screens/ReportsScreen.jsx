import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Tooltip
} from 'recharts';
import { Search, Filter, X, ChevronDown, FileText, Eye, Download, Users, Check } from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import {
  computeReport, periodLabel, statementFromReport, statementFromMonthly,
  exportReportPdf, datePresets, REPORT_CATEGORIES, peso,
} from '../utils/reportUtils';
import './ReportsScreen.css';

const COLORS = ['#3B2AAB', '#2D1A7A', '#D4C5FF', '#AE96FF', '#6B46C1', '#9F7AEA', '#7C3AED', '#C4B5FD'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tap-friendly category chips with a one-click "Select all".
// value === null means "all categories".
function CategoryPicker({ options, value, onChange }) {
  const isOn = (c) => value === null || value.includes(c);
  const allOn = value === null || value.length === options.length;
  const count = value === null ? options.length : value.length;
  const toggle = (c) => {
    const base = value === null ? options : value;
    const next = base.includes(c) ? base.filter((x) => x !== c) : [...base, c];
    onChange(next.length === options.length ? null : next);
  };
  return (
    <div className="cat-picker">
      <div className="cat-picker-head">
        <span className="cat-count">{allOn ? 'All categories' : `${count} of ${options.length} selected`}</span>
        <div className="cat-head-actions">
          <button type="button" className={`cat-all-btn ${allOn ? 'active' : ''}`} onClick={() => onChange(null)}>
            <Check size={12} /> Select all
          </button>
          <button type="button" className="cat-clear-btn" disabled={value !== null && value.length === 0} onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      </div>
      <div className="cat-chip-grid">
        {options.map((c) => (
          <button type="button" key={c} className={`cat-chip ${isOn(c) ? 'active' : ''}`} onClick={() => toggle(c)}>
            {isOn(c) && <Check size={11} />}
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

// A clean on/off switch (replaces the browser checkbox)
function SwitchRow({ checked, onChange, title, hint }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch-row ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-text">
        <span className="switch-title">{title}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <span className="switch-track"><span className="switch-thumb" /></span>
    </button>
  );
}

export default function ReportsScreen() {
  const navigate = useNavigate();
  const location = useLocation();

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
  const [savedReports, setSavedReports] = useState([]);     // reports saved in Statement History
  const [highlightId, setHighlightId] = useState(null);
  const statementRef = useRef(null);
  const openedFromLink = useRef(false);

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

  // Generate Report Form  (category_filter: null = all categories)
  const presets = datePresets();
  const [reportForm, setReportForm] = useState({
    from: presets.thisMonth.from,
    to: presets.thisMonth.to,
    category_filter: null,
    member_filter: 'all',          // admin only: 'all' or a user id
    include_split_details: false,
  });

  // Schedule Form  (category_filter: null = all categories)
  const [scheduleForm, setScheduleForm] = useState({
    frequency: 'monthly',
    day_of_month: 1,
    custom_interval_days: 30,
    category_filter: null,
  });

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Helper to fetch expense splits — plain select, no FK join to avoid 400 errors
  const fetchExpenseSplits = async (expenseIds) => {
    if (!expenseIds || !expenseIds.length) return {};
    const chunks = [];
    for (let i = 0; i < expenseIds.length; i += 500) {
      chunks.push(expenseIds.slice(i, i + 500));
    }
    const results = await Promise.all(
      chunks.map(chunk =>
        supabase
          .from('expense_splits')
          .select('id, expense_id, user_id, share_amount, paid_amount, status')
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

  // Reports this user generated (manual + scheduled) for the household
  const loadSavedReports = async (houseId, userId) => {
    if (!houseId || !userId) return;
    const { data, error } = await supabase
      .from('generated_reports')
      .select('*')
      .eq('household_id', houseId)
      .eq('generated_by', userId)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) { console.error('Load reports failed:', error); return; }
    setSavedReports(data || []);
  };

  // Report data is always scoped to ONE household — the one selected in the
  // household switcher (houseData.id). We never pull in expenses from other
  // households the target member happens to belong to, and Groups (a separate
  // feature from Households) are never mixed into this screen.
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

    // ── Step 1: Fetch expenses for THIS household only ──
    // (Regardless of how many other households targetUserId belongs to.)
    const { data: householdExpenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', houseData.id)
      .is('deleted_at', null)
      .order('expense_date', { ascending: false });
    const allExpenses = householdExpenses || [];

    // ── Step 2: Fetch expense_splits for enrichment (best-effort) ──
    const allExpenseIds = allExpenses.map(e => e.id);
    const splitsMap = allExpenseIds.length > 0 ? await fetchExpenseSplits(allExpenseIds) : {};

    // ── Helpers ──────────────────────────────────────────────────────────────
    // Priority: expense_splits table row (most authoritative) → members_split JSONB → 0
    // We deliberately do NOT fall back to full expense.amount when paid_by matches,
    // because Sasha paying the bill doesn't mean she owes the full amount — her share is in the split.
    const getUserShareAmount = (expense) => {
      // 1. expense_splits table row — authoritative, written when expense is approved
      const tableRow = (splitsMap[expense.id] || []).find(s => s.user_id === targetUserId);
      if (tableRow) return Number(tableRow.share_amount) || 0;

      // 2. members_split JSONB object keyed by userId — written at creation time
      if (expense.members_split && !Array.isArray(expense.members_split)) {
        const val = expense.members_split[targetUserId];
        if (val !== undefined && val !== null) return Number(val) || 0;
        // User is not in this expense's split — they owe nothing
        if (Object.keys(expense.members_split).length > 0) return 0;
      }
      // members_split as array of objects (legacy shape)
      if (Array.isArray(expense.members_split)) {
        const row = expense.members_split.find(s => s.user_id === targetUserId);
        if (row) return Number(row.share_amount || row.amount) || 0;
        if (expense.members_split.length > 0) return 0;
      }

      // 3. No split data at all — only count if user created/paid the expense alone
      if (expense.paid_by === targetUserId && expense.split_type === 'none') {
        return Number(expense.amount) || 0;
      }
      return 0;
    };

    // Paid = THIS user's own expense_splits row is 'approved' — not whether the
    // whole expense is fully settled by every member. The owner's own share is
    // auto-approved the moment they submit proof (no one needs to confirm it),
    // and a regular member's share is approved once the owner confirms their
    // proof — either way, "paid" here is per-person, matching Reports being an
    // individual view.
    const getPaidAmountForUser = (expense) => {
      const userSplit = (splitsMap[expense.id] || []).find(s => s.user_id === targetUserId);
      if (userSplit) {
        // Paid only counts once the admin has APPROVED a proof. An overpaid
        // member only counts their real share; a partly paid member counts
        // what has been approved so far.
        const share = Number(userSplit.share_amount) || 0;
        if (userSplit.status === 'approved') return share;
        return Math.min(Number(userSplit.paid_amount) || 0, share);
      }
      // No split row exists yet (e.g. no split_details were ever created for this
      // expense) — fall back to the old whole-expense signal, since there's no
      // per-user status to check.
      if (expense.status === 'paid') return getUserShareAmount(expense);
      return 0;
    };

    // Pending = expense is approved, this user has an unpaid split
    // Split statuses: 'unpaid' → member submits proof → 'pending_verification' → owner approves → 'approved'
    const getPendingAmountForUser = (expense) => {
      // Expense must be fully approved first
      if (expense.approval_status === 'rejected') return 0;
      if (expense.approval_status === 'pending_approval') return 0;

      // Check split-level status — this is the authoritative source
      const userSplit = (splitsMap[expense.id] || []).find(s => s.user_id === targetUserId);
      if (userSplit) {
        // 'approved' = owner confirmed payment — not pending
        // 'pending_verification' = member submitted proof, awaiting owner — already paid by member, not pending
        if (userSplit.status === 'approved' || userSplit.status === 'pending_verification') return 0;
        // 'unpaid' = still owes the whole share; 'partly_paid' = owes the rest
        return Math.max((Number(userSplit.share_amount) || 0) - (Number(userSplit.paid_amount) || 0), 0);
      }

      // No split row at all — if expense is fully paid, nothing pending
      if (expense.status === 'paid') return 0;
      // No split row and expense not paid — use members_split JSONB as fallback
      // but only if user is actually listed in the split
      if (expense.members_split && !Array.isArray(expense.members_split)) {
        const val = expense.members_split[targetUserId];
        if (val === undefined || val === null) return 0; // user not in this split
        return Number(val) || 0;
      }
      return 0;
    };

    // ── Step 3: Filter by year ──
    const thisYearExpenses = allExpenses.filter(
      e => e.expense_date >= yearStart && e.expense_date <= yearEnd
    );
    const lastYearExpenses = allExpenses.filter(
      e => e.expense_date >= lastYearStart && e.expense_date <= lastYearEnd
    );

    // ── Card 1: Total Household Spent = sum of the selected member's paid (approved)
    //    splits this year, WITHIN THIS HOUSEHOLD ONLY ──
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

    // ── Card 2: Category breakdown (paid splits, this household only) ──
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

    // ── Card 3: Pending balances (user's unpaid splits, this household only) ──
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

    // ── Statement history: group by month (already scoped to this household) ──
    const monthlyStatements = {};
    thisYearExpenses.forEach(e => {
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

    // Recent activity — table may not exist yet, safe fallback
    try {
      // try with the person's name + avatar; fall back to plain rows
      let { data: activity, error: actError } = await supabase
        .from('report_activity')
        .select('*, profiles:user_id (full_name, avatar_url)')
        .eq('household_id', houseData.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (actError) {
        ({ data: activity, error: actError } = await supabase
          .from('report_activity')
          .select('*')
          .eq('household_id', houseData.id)
          .order('created_at', { ascending: false })
          .limit(10));
      }
      if (!actError) setRecentActivity(activity || []);
      else setRecentActivity([]);
    } catch {
      setRecentActivity([]);
    }

    await loadSavedReports(houseData.id, resolvedUserId || currentUser?.id);
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
            category_filter: schedule.category_filter && schedule.category_filter.length ? schedule.category_filter : null,
          });
        }
      } catch { /* table may not exist yet */ }
    } catch (err) {
      console.error(err);
    }
  };

  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchData();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!currentUser?.id || !selectedHousehold?.id) return;
    const channelName = `reports-rt-${selectedHousehold.id}-${currentUser.id}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `household_id=eq.${selectedHousehold.id}`,
      }, () => {
        if (currentUser?.id && selectedHousehold?.id)
          fetchReportData(selectedHousehold, selectedMemberId || currentUser.id, currentUser.id);
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expense_splits',
      }, () => {
        if (currentUser?.id && selectedHousehold?.id)
          fetchReportData(selectedHousehold, selectedMemberId || currentUser.id, currentUser.id);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.id, selectedHousehold?.id, selectedMemberId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // selectedMemberId changes are handled directly in handleMemberChange()
  // No useEffect here — avoids stale currentUser causing 0 values on initial load

  const memberNameMap = () =>
    Object.fromEntries(householdMembers.map((m) => [m.user_id, m.profiles?.full_name || 'Member']));

  // Tapping the "report ready" notification lands here with ?report=<id>
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('report') || location.state?.report;
    if (!id || openedFromLink.current) return;
    const rep = savedReports.find((r) => r.id === id);
    if (rep) {
      openedFromLink.current = true;
      setSelectedStatement(statementFromReport(rep, memberNameMap()));
      setShowStatementDetail(true);
    }
  }, [savedReports, householdMembers, location.search]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  const getYoYChange = (current, last) => {
    if (last === 0) return null;
    return (((current - last) / last) * 100).toFixed(1);
  };

  // true on devices with a real mouse; touch devices fall back to tap-to-toggle
  const canHover = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

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
    // Pass memberId as resolvedUserId so fetchReportData uses it as targetUserId
    fetchReportData(selectedHousehold, memberId, memberId);
    showToast(`Viewing report for ${householdMembers.find(m => m.user_id === memberId)?.profiles?.full_name}`);
  };

  // Admins can pick a member (or the household total); everyone else gets their own report
  const effectiveMemberId = () => (isAdmin ? (reportForm.member_filter || 'all') : currentUser?.id);

  const reportFormProblem = () => {
    if (!reportForm.from || !reportForm.to) return 'Pick a start and end date.';
    if (reportForm.from > reportForm.to) return 'The start date must be before the end date.';
    if (reportForm.category_filter !== null && reportForm.category_filter.length === 0) return 'Pick at least one category.';
    return null;
  };

  // Builds the report described by the form (nothing is saved here)
  const buildReportFromForm = async () => {
    const memberId = effectiveMemberId();
    const { data: exps, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', selectedHousehold.id)
      .eq('approval_status', 'approved')
      .is('deleted_at', null)
      .gte('expense_date', reportForm.from)
      .lte('expense_date', reportForm.to);
    if (error) throw error;
    const list = exps || [];
    const splitsMap = list.length ? await fetchExpenseSplits(list.map((e) => e.id)) : {};
    const names = memberNameMap();
    const result = computeReport({
      expenses: list,
      splitsMap,
      memberId,
      categories: reportForm.category_filter,
      includeSplits: reportForm.include_split_details,
      memberNames: names,
    });
    return { memberId, names, ...result };
  };

  const memberLabelOf = (memberId, names) => (memberId === 'all' ? 'All Members' : (names[memberId] || 'Member'));

  const handleGenerateReport = async () => {
    const problem = reportFormProblem();
    if (problem) { showToast(problem, 'error'); return; }
    setLoading(true);
    try {
      const built = await buildReportFromForm();
      if (built.count === 0) {
        showToast('No expenses match these filters.', 'error');
        setLoading(false);
        return;
      }

      // 1. save the report so it appears in Statement History
      const { data: saved, error } = await supabase
        .from('generated_reports')
        .insert({
          household_id: selectedHousehold.id,
          generated_by: currentUser.id,
          member_id: built.memberId === 'all' ? null : built.memberId,
          kind: 'manual',
          period_from: reportForm.from,
          period_to: reportForm.to,
          categories: reportForm.category_filter === null ? [] : reportForm.category_filter,
          include_split_details: reportForm.include_split_details,
          total: built.total,
          paid: built.paid,
          pending: built.pending,
          expense_count: built.count,
          rows: built.rows,
        })
        .select()
        .single();
      if (error) throw error;

      const label = periodLabel(reportForm.from, reportForm.to);
      const who = memberLabelOf(built.memberId, built.names);

      // 2. recent activity line
      try {
        await supabase.from('report_activity').insert({
          user_id: currentUser.id,
          household_id: selectedHousehold.id,
          action: 'generated',
          description: `${profile?.full_name} generated a report for ${selectedHousehold.name} (${label})`,
        });
      } catch { /* table may not exist */ }

      // 3. bell notification for the person who generated it
      try {
        await supabase.from('notifications').insert({
          user_id: currentUser.id,
          title: '📄 Your report is ready',
          message: `${selectedHousehold.name} · ${label} · ${who}. Total ${peso(built.total)} (paid ${peso(built.paid)}, pending ${peso(built.pending)}) across ${built.count} expense${built.count === 1 ? '' : 's'}.`,
          type: 'report_generated',
          link_path: '/reports',
          link_query: `report=${saved.id}`,
        });
      } catch { /* ignore – the report itself is saved */ }
      await fetchNotifications(currentUser.id);

      // 4. refresh history and show the new report
      await fetchReportData(selectedHousehold, selectedMemberId || currentUser?.id, currentUser?.id);
      setShowGenerateModal(false);
      showToast('Report generated! It’s in Statement History ✅');
      setHighlightId(saved.id);
      setTimeout(() => statementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
      setTimeout(() => setHighlightId(null), 4500);
    } catch (err) {
      console.error('Generate report failed:', err);
      showToast('Failed to generate report.', 'error');
    }
    setLoading(false);
  };

  // statement = a saved / automatic statement, or null = "export what the form describes" (not saved)
  const handleExportPDF = async (statement) => {
    try {
      let st = statement;
      if (!st) {
        const problem = reportFormProblem();
        if (problem) { showToast(problem, 'error'); return; }
        setLoading(true);
        const built = await buildReportFromForm();
        setLoading(false);
        if (built.count === 0) { showToast('No expenses match these filters.', 'error'); return; }
        st = {
          period: periodLabel(reportForm.from, reportForm.to),
          memberLabel: memberLabelOf(built.memberId, built.names),
          categories: reportForm.category_filter || [],
          includeSplits: reportForm.include_split_details,
          total: built.total, paid: built.paid, pending: built.pending,
          rows: built.rows,
        };
      }
      exportReportPdf({ statement: st, householdName: selectedHousehold?.name, generatedBy: profile?.full_name });

      try {
        await supabase.from('report_activity').insert({
          user_id: currentUser.id,
          household_id: selectedHousehold?.id,
          action: 'exported',
          description: `${profile?.full_name} exported "${selectedHousehold?.name}" statement (${st.period}) for ${st.memberLabel}`,
        });
      } catch { /* table may not exist */ }

      showToast('PDF exported! ✅');
    } catch (err) {
      console.error(err);
      setLoading(false);
      showToast('Failed to export PDF.', 'error');
    }
  };

  // First report date for a schedule (the server job moves it forward after each report)
  const computeNextReportDate = () => {
    const now = new Date();
    if (scheduleForm.frequency === 'monthly') {
      const day = Math.min(Math.max(Number(scheduleForm.day_of_month) || 1, 1), 28);
      const next = new Date(now.getFullYear(), now.getMonth(), day);
      if (next <= now) next.setMonth(next.getMonth() + 1);   // that day already passed this month
      return next;
    }
    const days = scheduleForm.frequency === 'weekly'
      ? 7                                                       // weekly = every 7 days
      : Math.max(Number(scheduleForm.custom_interval_days) || 1, 1);
    const next = new Date(now);
    next.setDate(next.getDate() + days);
    return next;
  };

  const handleSaveSchedule = async () => {
    if (scheduleForm.category_filter !== null && scheduleForm.category_filter.length === 0) {
      showToast('Pick at least one category.', 'error');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        frequency: scheduleForm.frequency,
        day_of_month: scheduleForm.day_of_month,
        custom_interval_days: scheduleForm.custom_interval_days,
        category_filter: scheduleForm.category_filter || [],
        next_scheduled_at: computeNextReportDate().toISOString(),
        is_active: true,
      };

      const query = reportSchedule
        ? supabase.from('report_schedules').update(payload).eq('id', reportSchedule.id)
        : supabase.from('report_schedules').insert({
            ...payload,
            user_id: currentUser.id,
            household_id: selectedHousehold?.id,
          });
      const { data, error } = await query.select().single();
      if (error) throw error;

      setReportSchedule(data);   // so "Next report" shows the saved date right away
      showToast('Schedule saved! ✅');
      setShowGenerateModal(false);
    } catch (err) {
      console.error('Save schedule failed:', err);
      showToast('Failed to save schedule.', 'error');
    }
    setLoading(false);
  };

  const getTimeAgo = (dateStr) => {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const yoyTotal = getYoYChange(yearlyTotal, lastYearTotal);
  const yoyPending = getYoYChange(pendingBalances, lastYearPending);

  const names = memberNameMap();
  const viewedMemberLabel = names[selectedMemberId || currentUser?.id] || profile?.full_name || 'Me';
  const historyItems = [
    ...savedReports.map((rep) => ({
      key: rep.id,
      kind: rep.kind,
      statement: statementFromReport(rep, names),
      monthKey: String(rep.period_to).slice(0, 7),
      createdDate: rep.created_at,
    })),
    ...statementHistory.map((s) => ({
      key: `auto-${s.id}`,
      kind: 'auto',
      statement: statementFromMonthly(s, viewedMemberLabel),
      monthKey: s.id,
      createdDate: s.createdDate,
    })),
  ].filter((item) => {
    if (searchQuery && !item.statement.period.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterFrom && item.monthKey < filterFrom.substring(0, 7)) return false;
    if (filterTo && item.monthKey > filterTo.substring(0, 7)) return false;
    return true;
  });

  const filteredActivity = recentActivity.filter(a => {
    if (searchQuery && !a.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const categoryOptions = Array.from(new Set([...REPORT_CATEGORIES, ...categoryData.map((c) => c.name)]));

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

        {/* Household + Member switchers (side by side, open on hover) */}
        {(allHouseholds.length > 1 || (isAdmin && householdMembers.length > 1)) && (
          <div className="switcher-row">

            {allHouseholds.length > 1 && (
              <div
                className={`household-switcher-wrap ${showHouseholdDropdown ? 'is-open' : ''}`}
                onMouseEnter={() => { if (canHover()) { setShowMemberDropdown(false); setShowHouseholdDropdown(true); } }}
                onMouseLeave={() => { if (canHover()) setShowHouseholdDropdown(false); }}
              >
                <button
                  className="household-switcher-pill"
                  onClick={() => { if (!canHover()) { setShowMemberDropdown(false); setShowHouseholdDropdown(!showHouseholdDropdown); } }}
                >
                  <span className="pill-text">🏠 {selectedHousehold?.name}</span>
                  <ChevronDown size={14} className={`pill-chevron ${showHouseholdDropdown ? 'open' : ''}`}/>
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
              <div
                className={`household-switcher-wrap ${showMemberDropdown ? 'is-open' : ''}`}
                onMouseEnter={() => { if (canHover()) { setShowHouseholdDropdown(false); setShowMemberDropdown(true); } }}
                onMouseLeave={() => { if (canHover()) setShowMemberDropdown(false); }}
              >
                <button
                  className="household-switcher-pill member-pill"
                  onClick={() => { if (!canHover()) { setShowHouseholdDropdown(false); setShowMemberDropdown(!showMemberDropdown); } }}
                >
                  <Users size={14}/>
                  <span className="pill-text">{householdMembers.find(m => m.user_id === selectedMemberId)?.profiles?.full_name || 'Select Member'}</span>
                  <ChevronDown size={14} className={`pill-chevron ${showMemberDropdown ? 'open' : ''}`}/>
                </button>
                {showMemberDropdown && (
                  <div className="household-dropdown align-right">
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
            <div style={{ width: '100%', height: 80 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} barCategoryGap="20%">
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#3B2AAB' }} axisLine={false} tickLine={false} />
                  <Bar dataKey="amount" fill="#3B2AAB" radius={[4, 4, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
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
                  <Bar
                    dataKey="value"
                    name="Total"
                    radius={[4, 4, 0, 0]}
                    fill="#3B2AAB"
                  />
                  <Bar
                    dataKey="value"
                    name="Pending"
                    radius={[4, 4, 0, 0]}
                    fill="#AE96FF"
                    fillOpacity={0.55}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
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
        <div className="report-section" ref={statementRef}>
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
            {historyItems.length === 0 ? (
              <p className="no-data">No statements yet</p>
            ) : (
              historyItems.map((item) => {
                const st = item.statement;
                const statusClass = item.kind === 'scheduled' ? 'scheduled' : item.kind === 'auto' ? 'auto' : 'finalized';
                const statusText = item.kind === 'scheduled' ? 'Scheduled' : item.kind === 'auto' ? 'Auto' : 'Finalized';
                return (
                  <div key={item.key} className={`statement-row ${highlightId === item.key ? 'highlight' : ''}`}>
                    <span className="statement-id">{item.kind === 'auto' ? 'AUTO' : `RPT-${String(st.id).slice(0, 4).toUpperCase()}`}</span>
                    <span className="statement-period">{st.period}</span>
                    <span className="statement-total">{peso(st.total)}</span>
                    <span className="statement-date">{new Date(item.createdDate).toLocaleDateString()}</span>
                    <span className={`statement-status ${statusClass}`}>{statusText}</span>
                    <div className="statement-actions">
                      <button className="icon-btn-report" onClick={() => { setSelectedStatement(st); setShowStatementDetail(true); }}><Eye size={14}/></button>
                      <button className="icon-btn-report" onClick={() => handleExportPDF(st)}><Download size={14}/></button>
                    </div>
                  </div>
                );
              })
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
                    <label>Date range</label>
                    <div className="date-range-row">
                      <input type="date" value={reportForm.from} max={reportForm.to || undefined} onChange={e => setReportForm(prev => ({ ...prev, from: e.target.value }))} />
                      <span className="date-range-sep">to</span>
                      <input type="date" value={reportForm.to} min={reportForm.from || undefined} onChange={e => setReportForm(prev => ({ ...prev, to: e.target.value }))} />
                    </div>
                    <div className="preset-row">
                      <button type="button" className="preset-btn" onClick={() => setReportForm(prev => ({ ...prev, ...datePresets().thisMonth }))}>This month</button>
                      <button type="button" className="preset-btn" onClick={() => setReportForm(prev => ({ ...prev, ...datePresets().lastMonth }))}>Last month</button>
                      <button type="button" className="preset-btn" onClick={() => setReportForm(prev => ({ ...prev, ...datePresets().thisYear }))}>This year</button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Categories</label>
                    <CategoryPicker
                      options={categoryOptions}
                      value={reportForm.category_filter}
                      onChange={v => setReportForm(prev => ({ ...prev, category_filter: v }))}
                    />
                  </div>

                  {isAdmin ? (
                    <div className="form-group">
                      <label>Member</label>
                      <div className="select-wrap">
                        <select value={reportForm.member_filter} onChange={e => setReportForm(prev => ({ ...prev, member_filter: e.target.value }))}>
                          <option value="all">All Members (Household Total)</option>
                          {householdMembers.map(m => (<option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>))}
                        </select>
                        <ChevronDown size={14} className="select-arrow"/>
                      </div>
                    </div>
                  ) : (
                    <div className="report-for-note">Report for <strong>{profile?.full_name || 'you'}</strong></div>
                  )}

                  <SwitchRow
                    checked={reportForm.include_split_details}
                    onChange={v => setReportForm(prev => ({ ...prev, include_split_details: v }))}
                    title="Include per-member split details"
                    hint="Adds each member’s share and payment for every expense"
                  />

                  <button className="generate-btn" onClick={handleGenerateReport} disabled={loading}>{loading ? 'Generating...' : 'Generate Report'}</button>
                  <button className="export-pdf-btn" onClick={() => handleExportPDF(null)} disabled={loading}><Download size={16}/> Export PDF without saving</button>
                  <p className="schedule-note" style={{ textAlign: 'center' }}>
                    Generating saves the report in Statement History and sends you a notification.
                  </p>
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

                  <div className="form-group">
                    <label>Categories to include</label>
                    <CategoryPicker
                      options={categoryOptions}
                      value={scheduleForm.category_filter}
                      onChange={v => setScheduleForm(prev => ({ ...prev, category_filter: v }))}
                    />
                  </div>

                  {reportSchedule && (
                    <div className="schedule-info">
                      <p>✅ Schedule active</p>
                      <p>Next report: {new Date(reportSchedule.next_scheduled_at).toLocaleDateString()}</p>
                    </div>
                  )}

                  <p className="schedule-note">
                    🔔 On each report date at 8:00 AM your report is saved to Statement History and you’ll get a notification (and a phone push if you allowed notifications). Turn this off with “Report Schedules” in Settings.
                  </p>

                  <button className="generate-btn" onClick={handleSaveSchedule} disabled={loading}>{loading ? 'Saving...' : 'Save Schedule'}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Statement Detail Modal */}
      {showStatementDetail && selectedStatement && (() => {
        const st = selectedStatement;
        const hasPending = st.pending !== null && st.pending !== undefined;
        const chip = (status) => ({
          'paid': { color: '#065F46', background: '#D1FAE5' },
          'partly paid': { color: '#c05621', background: '#FEEBC8' },
          'verifying': { color: '#856404', background: '#FFF3CD' },
        }[status] || { color: '#856404', background: '#FFF3CD' });
        return (
          <div className="modal-overlay-reports">
            <div className="generate-modal">
              <div className="modal-header">
                <h2>{st.period}</h2>
                <button className="modal-close" onClick={() => setShowStatementDetail(false)}><X size={18}/></button>
              </div>
              <div className="modal-scroll">
                <div className="detail-tags">
                  <span className="detail-tag">{st.kind === 'scheduled' ? '🗓️ Scheduled' : st.kind === 'auto' ? '⚙️ Auto' : '📄 Custom'}</span>
                  <span className="detail-tag">👤 {st.memberLabel}</span>
                  <span className="detail-tag">{st.categories && st.categories.length ? st.categories.join(', ') : 'All categories'}</span>
                </div>

                <div className="statement-detail-summary">
                  <div className="stat-detail-item">
                    <span className="stat-detail-label">{hasPending ? 'Total' : 'Total paid'}</span>
                    <span className="stat-detail-value">{peso(st.total)}</span>
                  </div>
                  {hasPending ? (
                    <>
                      <div className="stat-detail-item">
                        <span className="stat-detail-label">Paid</span>
                        <span className="stat-detail-value" style={{ color: '#38a169' }}>{peso(st.paid)}</span>
                      </div>
                      <div className="stat-detail-item">
                        <span className="stat-detail-label">Pending</span>
                        <span className="stat-detail-value" style={{ color: '#c05621' }}>{peso(st.pending)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="stat-detail-item">
                      <span className="stat-detail-label">Expenses</span>
                      <span className="stat-detail-value">{st.rows.length}</span>
                    </div>
                  )}
                </div>

                {st.rows.length === 0 && <p className="no-data">No expenses in this report.</p>}
                {st.rows.map(r => (
                  <div key={r.id} className="detail-expense-block">
                    <div className="detail-expense-row">
                      <div className="detail-expense-info">
                        <p className="detail-expense-title">{r.title}</p>
                        <p className="detail-expense-meta">{r.category} | {r.expense_date}</p>
                      </div>
                      <div className="detail-expense-right">
                        <p className="detail-expense-amount">{peso(r.share)}</p>
                        <span className="detail-expense-status" style={chip(r.status)}>{r.status}</span>
                        {hasPending && r.paid > 0 && r.paid < r.share && (
                          <span className="detail-paid-note">paid {peso(r.paid)}</span>
                        )}
                      </div>
                    </div>
                    {r.splits && r.splits.length > 0 && (
                      <div className="detail-splits">
                        {r.splits.map(sp => (
                          <div key={sp.user_id} className="detail-split-row">
                            <span className="detail-split-name">{sp.name}</span>
                            <span className="detail-split-amt">{peso(sp.share)}</span>
                            <span className="detail-split-status" style={chip(sp.status)}>{sp.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <button className="export-pdf-btn" onClick={() => handleExportPDF(st)}><Download size={16}/> Export to PDF</button>
              </div>
            </div>
          </div>
        );
      })()}

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