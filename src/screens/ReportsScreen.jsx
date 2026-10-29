import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { rememberHousehold, pickRememberedHousehold } from '../utils/activeHousehold';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Tooltip
} from 'recharts';
import { Search, Filter, X, ChevronDown, FileText, Eye, Download, Users, Check } from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import SelectField from '../components/SelectField';
import DatePickerField from '../components/DatePickerField';
import {
  computeReport, periodLabel, statementFromReport, statementFromMonthly,
  exportReportPdf, datePresets, REPORT_CATEGORIES, peso, refundsForExpense, statementRefunds, toDeletionRefundEntries, toOverpaidRefundEntries,
} from '../utils/reportUtils';
import { fetchAwaitingRefundsMap, fetchDeletionRefundsMap, deletionStateOf, fetchConfirmedDeletionRefunds } from '../utils/refundsOwed';
import './ReportsScreen.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';
import { useCachedState, useScreenLoad } from '../utils/screenCache';
import { LoadGate, ReportsSkeleton } from '../components/Skeleton';

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

  const [profile, setProfile] = useCachedState('reports', 'profile', null);
  const [currentUser, setCurrentUser] = useCachedState('reports', 'currentUser', null);
  const [household, setHousehold] = useCachedState('reports', 'household', null);
  const [allHouseholds, setAllHouseholds] = useCachedState('reports', 'allHouseholds', []);
  const [selectedHousehold, setSelectedHousehold] = useCachedState('reports', 'selectedHousehold', null);
  const [notifications, setNotifications] = useCachedState('reports', 'notifications', []);
  const [unreadCount, setUnreadCount] = useCachedState('reports', 'unreadCount', 0);
  const [householdMembers, setHouseholdMembers] = useCachedState('reports', 'householdMembers', []);
  const [selectedMemberId, setSelectedMemberId] = useCachedState('reports', 'selectedMemberId', null); // for member filter (admin only)
  const [isAdmin, setIsAdmin] = useCachedState('reports', 'isAdmin', false);

  // Data
  const [yearlyTotal, setYearlyTotal] = useCachedState('reports', 'yearlyTotal', 0);
  const [lastYearTotal, setLastYearTotal] = useCachedState('reports', 'lastYearTotal', 0);
  const [monthlyData, setMonthlyData] = useCachedState('reports', 'monthlyData', []);
  const [categoryData, setCategoryData] = useCachedState('reports', 'categoryData', []);
  const [pendingBalances, setPendingBalances] = useCachedState('reports', 'pendingBalances', 0);
  const [lastYearPending, setLastYearPending] = useCachedState('reports', 'lastYearPending', 0);
  const [pendingByCategory, setPendingByCategory] = useCachedState('reports', 'pendingByCategory', []);
  const [owedRefunds, setOwedRefunds] = useCachedState('reports', 'owedRefunds', []);       // overpayment refunds the owner still owes
  const [statementHistory, setStatementHistory] = useCachedState('reports', 'statementHistory', []);
  const [recentActivity, setRecentActivity] = useCachedState('reports', 'recentActivity', []);
  const [reportSchedule, setReportSchedule] = useCachedState('reports', 'reportSchedule', null);
  const [savedReports, setSavedReports] = useCachedState('reports', 'savedReports', []);     // reports saved in Statement History
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
  const load = useScreenLoad('reports');
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [openRefundIds, setOpenRefundIds] = useState(() => new Set()); // expanded refund dropdowns
  const [showAllRefunds, setShowAllRefunds] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

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
    member_filter: 'all',          // admin only: 'all' (household total) or a user id
    include_split_details: false,
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
    // refunds sent but not yet confirmed by the member — still owed until they approve
    const refundsMap = await fetchAwaitingRefundsMap(allExpenseIds);
    // deletion refunds: sent → still paid ('verifying for deletion'); confirmed → settled
    const deletionMap = await fetchDeletionRefundsMap(allExpenseIds);
    const deletionOf = (expense, split) => deletionStateOf(split, deletionMap[expense.id]);

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
        const deletion = deletionOf(expense, userSplit);
        if (deletion === 'verifying') return share;  // refund not confirmed yet — still paid
        if (deletion === 'refunded') return 0;        // the money went back to them
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
        // being deleted (deletion refund sent or confirmed) — nothing left to pay
        if (deletionOf(expense, userSplit)) return 0;
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

    // ── Card 4: overpayment refunds still owed (any year — they're still owed).
    //    Kept for every member; the card shows the admin all of them, a member theirs. ──
    const ownerId = houseData.created_by;
    setOwedRefunds(
      allExpenses
        .filter(e => e.approval_status === 'approved')
        .flatMap(e => refundsForExpense(splitsMap[e.id], 'all', ownerId, {}, refundsMap[e.id]).map(f => ({
          ...f, expense_id: e.id, title: e.title, category: e.category, expense_date: e.expense_date,
        })))
    );

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
        const refunds = refundsForExpense(splitsMap[e.id], targetUserId, ownerId, {}, refundsMap[e.id]);
        monthlyStatements[key].expenses.push({ ...e, user_share: userAmount, refunds });
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
      .eq('household_id', householdId)
      .eq('status', 'active');   // past memberships (left / removed) would list people twice
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

      const primary = pickRememberedHousehold(households, households.find(h => h.id === profileData.household_id) || households[0]);
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
            member_filter: schedule.member_id || 'all',
            include_split_details: !!schedule.include_split_details,
          });
        }
      } catch { /* table may not exist yet */ }
      load.done();
    } catch (err) {
      load.fail(err);
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
      // a member confirming a refund settles it (splits don't change then)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expense_refunds',
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

  // The household owner owes overpayment refunds; a member is owed them.
  const viewerIsOwner = !!currentUser?.id && currentUser.id === selectedHousehold?.created_by;
  const refundLabel = viewerIsOwner ? 'Needs refund' : 'Refund still needed';

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
    rememberHousehold(h.id);
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
    const refundsMap = await fetchAwaitingRefundsMap(list.map((e) => e.id));
    const deletionMap = await fetchDeletionRefundsMap(list.map((e) => e.id));
    const names = memberNameMap();
    const result = computeReport({
      expenses: list,
      splitsMap,
      memberId,
      categories: reportForm.category_filter,
      includeSplits: reportForm.include_split_details,
      memberNames: names,
      ownerId: selectedHousehold.created_by,
      refundsMap,
      deletionMap,
    });
    // "Refunded for deletion of expense": deletion refunds the member approved.
    // The admin's household / own report lists everyone; a member's only theirs.
    const everyone = memberId === 'all' || memberId === selectedHousehold.created_by;
    const catSet = reportForm.category_filter && reportForm.category_filter.length ? new Set(reportForm.category_filter) : null;
    // "Refunded for overpaid expense": overpayment refunds the member approved — same rule.
    const confirmedOf = async (type) => (await fetchConfirmedDeletionRefunds(selectedHousehold.id, reportForm.from, reportForm.to, type))
      .filter((f) => (everyone || f.user_id === memberId) && (!catSet || catSet.has(f.category)))
      .map((f) => ({ ...f, name: names[f.user_id] || 'Member' }));
    const [deletionRefunds, overpaidRefunds] = await Promise.all([confirmedOf('expense_deletion'), confirmedOf('overpayment')]);
    return { memberId, names, ...result, deletionRefunds, overpaidRefunds };
  };

  const memberLabelOf = (memberId, names) => (memberId === 'all' ? 'All Members' : (names[memberId] || 'Member'));

  const handleGenerateReport = async () => {
    const problem = reportFormProblem();
    if (problem) { showToast(problem, 'error'); return; }
    setLoading(true);
    try {
      const built = await buildReportFromForm();
      if (built.count === 0 && !built.deletionRefunds.length && !built.overpaidRefunds.length) {
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
          // approved deletion / overpayment refunds ride along in rows (see toDeletionRefundEntries)
          rows: [...built.rows, ...toDeletionRefundEntries(built.deletionRefunds), ...toOverpaidRefundEntries(built.overpaidRefunds)],
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
          message: `${selectedHousehold.name} · ${label} · ${who}. Total ${peso(built.total)} (paid ${peso(built.paid)}, pending ${peso(built.pending)}) across ${built.count} expense${built.count === 1 ? '' : 's'}.${built.refundTotal > 0 ? ` ${refundLabel}: ${peso(built.refundTotal)}.` : ''}`,
          type: 'report_generated',
          link_path: '/reports',
          link_query: `report=${saved.id}`,
        });
      } catch { /* ignore – the report itself is saved */ }
      await fetchNotifications(currentUser.id);

      // 4. refresh history and show the new report
      await fetchReportData(selectedHousehold, selectedMemberId || currentUser?.id, currentUser?.id);
      setShowGenerateModal(false);
      showToast('Report generated! It’s in Statement History');
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
        if (built.count === 0 && !built.deletionRefunds.length && !built.overpaidRefunds.length) { showToast('No expenses match these filters.', 'error'); return; }
        st = {
          period: periodLabel(reportForm.from, reportForm.to),
          memberLabel: memberLabelOf(built.memberId, built.names),
          categories: reportForm.category_filter || [],
          includeSplits: reportForm.include_split_details,
          total: built.total, paid: built.paid, pending: built.pending,
          rows: built.rows,
          deletionRefunds: built.deletionRefunds,
          overpaidRefunds: built.overpaidRefunds,
        };
      }
      exportReportPdf({
        statement: { ...st, refunds: statementRefunds(st.rows).map(f => ({ ...f, name: f.name || memberNameMap()[f.user_id] })) },
        householdName: selectedHousehold?.name,
        generatedBy: profile?.full_name,
        refundLabel,
      });

      try {
        await supabase.from('report_activity').insert({
          user_id: currentUser.id,
          household_id: selectedHousehold?.id,
          action: 'exported',
          description: `${profile?.full_name} exported "${selectedHousehold?.name}" statement (${st.period}) for ${st.memberLabel}`,
        });
      } catch { /* table may not exist */ }

      showToast('PDF exported!');
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
        // null = All Members (household total); a member's schedule is always their own
        member_id: isAdmin ? (scheduleForm.member_filter === 'all' ? null : scheduleForm.member_filter) : currentUser.id,
        include_split_details: scheduleForm.include_split_details,
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
      showToast('Schedule saved!');
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
  // profile pictures for the refund rows (initials when there is none)
  const avatarOf = Object.fromEntries(householdMembers.map((m) => [m.user_id, m.profiles?.avatar_url || null]));
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

  // Card 4: the admin sees every refund they still owe (or one member's, when
  // viewing that member); a member sees the refunds owed to them.
  const refundScopeId = viewerIsOwner ? (selectedMemberId || currentUser?.id) : currentUser?.id;
  const visibleRefunds = owedRefunds
    .filter(f => refundScopeId === selectedHousehold?.created_by || f.user_id === refundScopeId)
    .map(f => ({ ...f, name: names[f.user_id] || 'Member' }));
  const visibleRefundTotal = visibleRefunds.reduce((sum, f) => sum + f.amount, 0);
  const visibleRefundAwaiting = visibleRefunds.reduce((sum, f) => sum + (f.awaiting || 0), 0);
  // One entry per expense (an expense can owe several members) — each opens as a dropdown.
  const refundGroups = Object.values(visibleRefunds.reduce((acc, f) => {
    const g = acc[f.expense_id] || (acc[f.expense_id] = {
      expense_id: f.expense_id, title: f.title, category: f.category, expense_date: f.expense_date, total: 0, members: [],
    });
    g.total += f.amount;
    g.members.push(f);
    return acc;
  }, {})).sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
  const refundChartData = [...refundGroups]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(g => ({ key: g.expense_id, label: g.title, value: Math.round(g.total * 100) / 100 }));
  const REFUND_PREVIEW = 3;
  const shownRefundGroups = showAllRefunds ? refundGroups : refundGroups.slice(0, REFUND_PREVIEW);
  const toggleRefundGroup = (id) => setOpenRefundIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const HISTORY_PREVIEW = 4;
  const ACTIVITY_PREVIEW = 3;
  const fmtShortDate = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const memberOptions = [
    { value: 'all', label: 'All Members (Household Total)' },
    ...householdMembers.map((m) => ({
      value: m.user_id,
      label: m.profiles?.full_name || 'Member',
      avatar: { url: m.profiles?.avatar_url, name: m.profiles?.full_name },
    })),
  ];
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
          <button aria-label="Generate report" className="export-icon-btn" onClick={() => setShowGenerateModal(true)}>
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
                  <span className="pill-text"><InlineIcon as={ICONS.household} /> {selectedHousehold?.name}</span>
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
                  <div className={`household-dropdown ${allHouseholds.length > 1 ? 'align-right' : ''}`}>
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
        <LoadGate load={load} skeleton={<ReportsSkeleton />} onRetry={fetchData}>

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

        {/* Card 4 — Overpayment refunds still owed (admin: to pay, member: owed to them).
            Refunds sent but not yet confirmed by the member still count. */}
        <div className="report-card refund-card">
          <div className="refund-card-head">
            <div>
              <p className="report-card-label">{viewerIsOwner ? 'Refunds You Still Need to Pay' : 'Refunds the Admin Still Owes You'}</p>
              <p className="report-card-amount">₱ {visibleRefundTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
              {refundGroups.length > 0 && (
                <p className="refund-card-sub">
                  {refundGroups.length} expense{refundGroups.length === 1 ? '' : 's'}
                  {viewerIsOwner && ` · ${new Set(visibleRefunds.map(f => f.user_id)).size} member${new Set(visibleRefunds.map(f => f.user_id)).size === 1 ? '' : 's'}`}
                </p>
              )}
            </div>
            <span className="refund-card-badge"><InlineIcon as={ICONS.refund} size={12} /> Overpaid</span>
          </div>
          {visibleRefundAwaiting > 0 && (
            <p className="refund-card-awaiting">
              <InlineIcon as={ICONS.pending} /> {peso(visibleRefundAwaiting)} {viewerIsOwner ? 'sent — waiting for the member to confirm' : 'sent to you — confirm it once received'}
            </p>
          )}

          {refundGroups.length > 0 ? (
            <>
              <div style={{ width: '100%', height: refundChartData.length * 30 + 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={refundChartData} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="refundBar" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#3B2AAB" />
                        <stop offset="100%" stopColor="#AE96FF" />
                      </linearGradient>
                    </defs>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 10, fill: '#2D1A7A', fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#F5F3FF' }} formatter={(value) => [`₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, 'To refund']} />
                    <Bar dataKey="value" name="To refund" fill="url(#refundBar)" radius={[0, 6, 6, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="refund-group-list">
                {shownRefundGroups.map(g => {
                  const open = openRefundIds.has(g.expense_id);
                  return (
                    <div key={g.expense_id} className={`refund-group ${open ? 'open' : ''}`}>
                      <button type="button" className="refund-group-head" onClick={() => toggleRefundGroup(g.expense_id)} aria-expanded={open}>
                        <span className="refund-group-icon">{(g.title || '?').charAt(0).toUpperCase()}</span>
                        <span className="refund-group-info">
                          <span className="refund-group-title">{g.title}</span>
                          <span className="refund-group-meta">
                            {fmtShortDate(g.expense_date)}
                            {viewerIsOwner && ` · ${g.members.length} member${g.members.length === 1 ? '' : 's'}`}
                          </span>
                        </span>
                        <span className="refund-group-amt">{peso(g.total)}</span>
                        <ChevronDown size={16} className={`refund-group-chev ${open ? 'open' : ''}`} />
                      </button>
                      {open && (
                        <div className="refund-group-body">
                          {g.members.map(f => (
                            <div key={f.user_id} className="refund-member-row">
                              <span className="refund-member-avatar">
                                {avatarOf[f.user_id]
                                  ? <img src={avatarOf[f.user_id]} alt="" className="refund-member-avatar-img" />
                                  : (f.name || 'M').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </span>
                              <span className="refund-member-info">
                                <span className="refund-member-name">{viewerIsOwner ? `Refund to ${f.name}` : 'Your overpayment'}</span>
                                {f.awaiting > 0 && <span className="refund-member-note">{peso(f.awaiting)} sent · awaiting confirmation</span>}
                              </span>
                              <span className="refund-member-right">
                                <span className="refund-member-amt">{peso(f.amount)}</span>
                                <span className="refund-owed-tag">Overpaid</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {refundGroups.length > REFUND_PREVIEW && (
                <button type="button" className="report-more-btn" onClick={() => setShowAllRefunds(v => !v)}>
                  {showAllRefunds ? 'Show less' : `Show all ${refundGroups.length} expenses`}
                  <ChevronDown size={14} className={`pill-chevron ${showAllRefunds ? 'open' : ''}`} />
                </button>
              )}
            </>
          ) : (
            <div className="refund-empty">
              <p className="no-data" style={{ margin: 0 }}>{viewerIsOwner ? 'No refunds to send' : 'No refunds owed to you'}</p>
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
          <div className="report-section-head">
            <p className="report-section-title">Statement History</p>
            {historyItems.length > 0 && <span className="report-count-chip">{historyItems.length}</span>}
          </div>
          {historyItems.length === 0 ? (
            <p className="no-data">No statements yet</p>
          ) : (
            <div className="stmt-list">
              {(showAllHistory ? historyItems : historyItems.slice(0, HISTORY_PREVIEW)).map((item) => {
                const st = item.statement;
                const statusClass = item.kind === 'scheduled' ? 'scheduled' : item.kind === 'auto' ? 'auto' : 'finalized';
                const statusText = item.kind === 'scheduled' ? 'Scheduled' : item.kind === 'auto' ? 'Auto' : 'Finalized';
                const icon = item.kind === 'scheduled' ? ICONS.schedule : item.kind === 'auto' ? ICONS.auto : ICONS.report;
                return (
                  <div key={item.key} className={`stmt-item ${highlightId === item.key ? 'highlight' : ''}`}>
                    <span className={`stmt-icon ${statusClass}`}><Icon as={icon} /></span>
                    <button type="button" className="stmt-main" onClick={() => { setSelectedStatement(st); setShowStatementDetail(true); }}>
                      <span className="stmt-period">{st.period}</span>
                      <span className="stmt-meta">
                        {item.kind === 'auto' ? 'AUTO' : `RPT-${String(st.id).slice(0, 4).toUpperCase()}`} · {fmtShortDate(item.createdDate)}
                      </span>
                      <span className="stmt-total-row">
                        <span className="stmt-total">{peso(st.total)}</span>
                        <span className={`statement-status ${statusClass}`}><StatusIcon status={statusText} />{statusText}</span>
                      </span>
                    </button>
                    <div className="stmt-actions">
                      <button className="icon-btn-report" aria-label="View" onClick={() => { setSelectedStatement(st); setShowStatementDetail(true); }}><Eye size={15}/></button>
                      <button className="icon-btn-report" aria-label="Download PDF" onClick={() => handleExportPDF(st)}><Download size={15}/></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {historyItems.length > HISTORY_PREVIEW && (
            <button type="button" className="report-more-btn" onClick={() => setShowAllHistory(v => !v)}>
              {showAllHistory ? 'Show less' : `Show all ${historyItems.length} statements`}
              <ChevronDown size={14} className={`pill-chevron ${showAllHistory ? 'open' : ''}`} />
            </button>
          )}
        </div>

        {/* Recent Activity */}
        <div className="report-section">
          <div className="report-section-head">
            <p className="report-section-title">Recent Report Activity</p>
            {filteredActivity.length > 0 && <span className="report-count-chip">{filteredActivity.length}</span>}
          </div>
          {filteredActivity.length === 0 ? (
            <p className="no-data">No recent activity</p>
          ) : (
            <div className={`activity-list ${showAllActivity ? 'expanded' : ''}`}>
              {(showAllActivity ? filteredActivity : filteredActivity.slice(0, ACTIVITY_PREVIEW)).map(a => {
                const exported = a.action === 'exported';
                return (
                  <div key={a.id} className="activity-item activity-item--v2">
                    <div className={`activity-icon ${exported ? 'exported' : 'generated'}`}>
                      {a.profiles?.avatar_url
                        ? <img src={a.profiles.avatar_url} alt="" className="activity-avatar-img"/>
                        : exported ? <Download size={15}/> : <FileText size={15}/>}
                    </div>
                    <div className="activity-info">
                      <p className="activity-desc">{a.description}</p>
                      <p className="activity-time">
                        <span className={`activity-tag ${exported ? 'exported' : 'generated'}`}>{exported ? 'Exported' : 'Generated'}</span>
                        {getTimeAgo(a.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {filteredActivity.length > ACTIVITY_PREVIEW && (
            <button type="button" className="report-more-btn" onClick={() => setShowAllActivity(v => !v)}>
              {showAllActivity ? 'Show less' : `Show all ${filteredActivity.length} activities`}
              <ChevronDown size={14} className={`pill-chevron ${showAllActivity ? 'open' : ''}`} />
            </button>
          )}
        </div>
        </LoadGate>
      </div>

      {/* Generate & Export Modal */}
      {showGenerateModal && (
        <div className="modal-overlay-reports">
          <div className="generate-modal">
            <div className="modal-header">
              <h2>Generate & Export Report</h2>
              <button aria-label="Close" className="modal-close" onClick={() => setShowGenerateModal(false)}><X size={18}/></button>
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
                    <div className="date-range-stack">
                      <span className="date-range-label">From</span>
                      <DatePickerField
                        value={reportForm.from}
                        max={reportForm.to || undefined}
                        placeholder="Start date"
                        allowClear={false}
                        onChange={v => setReportForm(prev => ({ ...prev, from: v }))}
                      />
                      <span className="date-range-label">To</span>
                      <DatePickerField
                        value={reportForm.to}
                        min={reportForm.from || undefined}
                        placeholder="End date"
                        allowClear={false}
                        onChange={v => setReportForm(prev => ({ ...prev, to: v }))}
                      />
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
                      <SelectField
                        label="Member"
                        options={memberOptions}
                        value={reportForm.member_filter}
                        onChange={v => setReportForm(prev => ({ ...prev, member_filter: v }))}
                      />
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

                  {isAdmin ? (
                    <div className="form-group">
                      <label>Member</label>
                      <SelectField
                        label="Member"
                        options={memberOptions}
                        value={scheduleForm.member_filter}
                        onChange={v => setScheduleForm(prev => ({ ...prev, member_filter: v }))}
                      />
                    </div>
                  ) : (
                    <div className="report-for-note">Report for <strong>{profile?.full_name || 'you'}</strong></div>
                  )}

                  <SwitchRow
                    checked={scheduleForm.include_split_details}
                    onChange={v => setScheduleForm(prev => ({ ...prev, include_split_details: v }))}
                    title="Include per-member split details"
                    hint="Adds each member’s share and payment for every expense"
                  />

                  {reportSchedule && (
                    <div className="schedule-info">
                      <p><InlineIcon as={ICONS.approved} /> Schedule active</p>
                      <p>Next report: {new Date(reportSchedule.next_scheduled_at).toLocaleDateString()}</p>
                    </div>
                  )}

                  <p className="schedule-note">
                    <InlineIcon as={ICONS.bell} /> On each report date at 8:00 AM your report is saved to Statement History and you’ll get a notification (and a phone push if you allowed notifications). Turn this off with “Report Schedules” in Settings.
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
          'verifying for deletion': { color: '#6B46C1', background: '#EDE9FF' },
          'refunded for deletion': { color: '#2C7A7B', background: '#E6FFFA' },
        }[status] || { color: '#856404', background: '#FFF3CD' });
        return (
          <div className="modal-overlay-reports">
            <div className="generate-modal">
              <div className="modal-header">
                <h2>{st.period}</h2>
                <button aria-label="Close" className="modal-close" onClick={() => setShowStatementDetail(false)}><X size={18}/></button>
              </div>
              <div className="modal-scroll">
                <div className="detail-tags">
                  <span className="detail-tag"><InlineIcon as={st.kind === 'scheduled' ? ICONS.schedule : st.kind === 'auto' ? ICONS.auto : ICONS.report} size={12} />{st.kind === 'scheduled' ? 'Scheduled' : st.kind === 'auto' ? 'Auto' : 'Custom'}</span>
                  <span className="detail-tag"><InlineIcon as={ICONS.member} size={12} />{st.memberLabel}</span>
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

                {/* Overpayment refunds still owed for the expenses in this report */}
                {(() => {
                  const refunds = st.refunds || statementRefunds(st.rows);
                  if (!refunds.length) return null;
                  const sum = refunds.reduce((a, f) => a + Number(f.amount || 0), 0);
                  return (
                    <div className="detail-refunds">
                      <div className="detail-refunds-head">
                        <span><InlineIcon as={ICONS.refund} /> {refundLabel}</span>
                        <span>{peso(sum)}</span>
                      </div>
                      {refunds.map(f => (
                        <div key={`${f.expense_id}-${f.user_id}`} className="detail-refund-row">
                          <span className="detail-refund-title">
                            {f.title}
                            {viewerIsOwner && <span className="detail-refund-who"> · {f.name || names[f.user_id] || 'Member'}</span>}
                          </span>
                          <span className="detail-refund-amt">{peso(f.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Deletion refunds the member approved */}
                {(st.deletionRefunds || []).length > 0 && (() => {
                  const list = st.deletionRefunds;
                  const sum = list.reduce((a, f) => a + Number(f.amount || 0), 0);
                  return (
                    <div className="detail-refunds detail-refunds--deletion">
                      <div className="detail-refunds-head">
                        <span><InlineIcon as={ICONS.delete} /> Refunded for deletion of expense</span>
                        <span>{peso(sum)}</span>
                      </div>
                      {list.map(f => (
                        <div key={`${f.expense_id}-${f.user_id}`} className="detail-refund-row">
                          <span className="detail-refund-title">
                            {f.title}
                            <span className="detail-refund-who"> · {f.name || names[f.user_id] || 'Member'}</span>
                            {f.deleted && <span className="detail-refund-deleted">deleted</span>}
                          </span>
                          <span className="detail-refund-amt">{peso(f.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Overpayment refunds the member approved */}
                {(st.overpaidRefunds || []).length > 0 && (() => {
                  const list = st.overpaidRefunds;
                  const sum = list.reduce((a, f) => a + Number(f.amount || 0), 0);
                  return (
                    <div className="detail-refunds detail-refunds--deletion">
                      <div className="detail-refunds-head">
                        <span><InlineIcon as={ICONS.refund} /> Refunded for overpaid expense</span>
                        <span>{peso(sum)}</span>
                      </div>
                      {list.map(f => (
                        <div key={f.refund_id || `${f.expense_id}-${f.user_id}-${f.amount}`} className="detail-refund-row">
                          <span className="detail-refund-title">
                            {f.title}
                            <span className="detail-refund-who"> · {f.name || names[f.user_id] || 'Member'}</span>
                            {f.deleted && <span className="detail-refund-deleted">deleted</span>}
                          </span>
                          <span className="detail-refund-amt">{peso(f.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

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
              <button aria-label="Close" className="modal-close" onClick={() => setShowFilter(false)}><X size={18}/></button>
            </div>
            <div className="form-group">
              <label>Date From</label>
              <DatePickerField value={filterFrom} max={filterTo || undefined} placeholder="Any date" onChange={setFilterFrom} />
            </div>
            <div className="form-group">
              <label>Date To</label>
              <DatePickerField value={filterTo} min={filterFrom || undefined} placeholder="Any date" onChange={setFilterTo} />
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