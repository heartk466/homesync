import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { uploadPaymentProof } from '../utils/paymentProofStorage';
import {
  Search, Filter, Plus, X, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, Trash2, ExternalLink, Calendar,
} from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import PayOnlineModal from '../components/PayOnlineModal';
import AddExpenseModal from '../components/AddExpenseModal';
import UploadProofAfterAddModal from '../components/UploadProofAfterAddModal';
import DatePickerField from '../components/DatePickerField';
import { softDeleteExpense, sendRefund, overpaidOf, followupDueOf, num as toNum } from '../utils/expenseEditUtils';
import { deletionStateOf, DELETION_STATUS_META } from '../utils/refundsOwed';
import { formatMoney, formatDate } from '../utils/format';
import DeleteExpenseModal from '../components/DeleteExpenseModal';
import RefundModal from '../components/RefundModal';
import './UtilitiesScreen.css';
import {
  markItemAsPaid,
  UTILITY_CATEGORIES,
  categoryLabel,
} from '../utils/expenseUtils';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON, categoryIconOf } from '../utils/iconMap';
import { useCachedState, useScreenLoad } from '../utils/screenCache';
import { LoadGate, UtilitiesSkeleton } from '../components/Skeleton';

const ALL = 'all';

// Icon + colours per utility category (Entertainment = TV / streaming, not a plug)
const UTILITY_CONFIG = {
  Electricity:     { icon: categoryIconOf('Electricity'), color: '#B7791F', bg: '#FFFFF0' },
  Power:           { icon: categoryIconOf('Power'), color: '#B7791F', bg: '#FFFFF0' },
  Water:           { icon: categoryIconOf('Water'), color: '#2B6CB0', bg: '#EBF8FF' },
  Gas:             { icon: categoryIconOf('Gas'), color: '#C05621', bg: '#FFFAF0' },
  Internet:        { icon: categoryIconOf('Internet'), color: '#6B46C1', bg: '#FAF5FF' },
  Entertainment:   { icon: categoryIconOf('Entertainment'), color: '#D53F8C', bg: '#FFF5F7' },
  Subscription:    { icon: categoryIconOf('Subscription'), color: '#9B2C87', bg: '#FFF5F7' },
  Mobile:          { icon: categoryIconOf('Mobile'), color: '#3B2AAB', bg: '#F0EDFF' },
  Cable:           { icon: categoryIconOf('Cable'), color: '#2C7A7B', bg: '#E6FFFA' },
  'Other utility': { icon: categoryIconOf('Other utility'), color: '#718096', bg: '#F7FAFC' },
};
const configOf = (category) => UTILITY_CONFIG[category] || UTILITY_CONFIG['Other utility'];

// One month at a time. A utility belongs to its billing month (Electricity /
// Water) or the month it was added.
const pad2 = (n) => String(n).padStart(2, '0');
const localMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
const monthOfExpense = (exp) => String(exp.billing_period || exp.expense_date || '').slice(0, 7);
const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
const daysUntil = (date) => Math.round((new Date(`${date}T00:00:00`) - new Date(`${localToday()}T00:00:00`)) / 86400000);
const capitalize = (text) => String(text || '').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const providerKey = (exp) => `${exp.household_id}|${exp.category}|${String(exp.title || '').trim().toLowerCase()}`;

// What the card shows for the current user (unchanged payment rules):
// members see their OWN share's state; the owner sees the expense's.
function cardState(u) {
  const deletion = !u.isOwner ? u.myDeletion : null;
  const isPaid = !deletion && (u.status === 'paid' || u.myStatus === 'approved');
  const isVerifying = !deletion && !isPaid && (u.isOwner
    ? u.status === 'verifying' || u.myStatus === 'pending_verification'
    : u.myStatus === 'pending_verification');
  const isPartly = !deletion && !isPaid && !isVerifying && u.myStatus === 'partly_paid';
  return { deletion, isPaid, isVerifying, isPartly };
}

// Utilities of one household for `month` (+ the month before, for "paused").
async function loadHouseholdUtilities(household, user, month) {
  const { data: me } = await supabase
    .from('household_members')
    .select('role')
    .eq('household_id', household.id)
    .eq('user_id', user.id)
    .maybeSingle();
  const isOwner = me?.role === 'owner' || household.created_by === user.id;

  const prev = shiftMonth(month, -1);
  const { data: rows, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('household_id', household.id)
    .in('category', UTILITY_CATEGORIES)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false });
  if (error) throw error;
  // Months with utilities this user can see (members: only ones they're in)
  let mine = null;
  if (!isOwner && (rows || []).length) {
    const { data: myRows } = await supabase
      .from('expense_splits')
      .select('expense_id')
      .eq('user_id', user.id)
      .in('expense_id', rows.map((e) => e.id));
    mine = new Set((myRows || []).map((r) => r.expense_id));
  }
  const months = [...new Set((rows || []).filter((e) => !mine || mine.has(e.id)).map(monthOfExpense).filter(Boolean))];

  const relevant = (rows || []).filter((e) => [month, prev].includes(monthOfExpense(e)));
  const ids = relevant.map((e) => e.id);
  if (!ids.length) return { items: [], prevKeys: [], months };

  const [{ data: splitsData }, { data: refundRows }] = await Promise.all([
    supabase.from('expense_splits').select('*, profiles:user_id (id, full_name, email, avatar_url)').in('expense_id', ids),
    supabase.from('expense_refunds').select('*').in('expense_id', ids),
  ]);
  const splitsByExpense = {};
  (splitsData || []).forEach((s) => { (splitsByExpense[s.expense_id] ||= []).push(s); });
  const refundsByExpense = {};
  (refundRows || []).forEach((r) => { (refundsByExpense[r.expense_id] ||= []).push(r); });

  // Members only see utilities they have a share in; the owner sees them all.
  const visible = relevant.filter((e) => isOwner || (splitsByExpense[e.id] || []).some((s) => s.user_id === user.id));
  const items = visible.filter((e) => monthOfExpense(e) === month).map((exp) => {
    const splits = splitsByExpense[exp.id] || [];
    const mySplit = splits.find((s) => s.user_id === user.id);
    return {
      id: exp.id,
      title: exp.title,
      amount: exp.amount,
      category: exp.category,
      expense_date: exp.expense_date,
      due_date: exp.due_date,
      split_method: exp.split_type,
      status: exp.status,
      approval_status: exp.approval_status,
      paid_by: exp.paid_by,
      members_split: exp.members_split,
      source: 'expenses',
      householdId: household.id,
      householdName: household.name,
      ownerId: household.created_by,
      isOwner,
      splits,
      mySplit,
      myShareAmount: mySplit ? Number(mySplit.share_amount) : 0,
      myStatus: mySplit ? mySplit.status : 'unpaid',
      myPaidAmount: mySplit ? toNum(mySplit.paid_amount) : 0,
      myOverpaid: mySplit ? overpaidOf(mySplit) : 0,
      myFollowupDue: mySplit ? followupDueOf(mySplit) : 0,
      myDeletion: deletionStateOf(mySplit, refundsByExpense[exp.id]),
      refunds: refundsByExpense[exp.id] || [],
      expense: exp,
    };
  });
  const prevKeys = visible.filter((e) => monthOfExpense(e) === prev).map(providerKey);
  return { items, prevKeys, months };
}

// Mouse/trackpad → menus open on hover; touch → on tap (same as ReportsScreen).
const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Month pill: ‹ arrows jump to the nearest month that has bills (hidden when
// there is none); the label opens every month with bills at once.
function MonthNav({ month, months, onChange, open, onOpenChange }) {
  const sorted = [...months].sort();
  const prev = [...sorted].reverse().find((m) => m < month);
  const next = sorted.find((m) => m > month);
  const byYear = {};
  [...sorted].reverse().forEach((m) => { (byYear[m.slice(0, 4)] ||= []).push(m); });
  const now = localMonth();
  const short = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });

  return (
    <div
      className={`ut-switch${open ? ' is-open' : ''}`}
      onMouseEnter={() => { if (canHover()) onOpenChange(true); }}
      onMouseLeave={() => { if (canHover()) onOpenChange(false); }}
    >
      <div className="ut-month-pill">
        <button type="button" className="ut-month-arrow" disabled={!prev} aria-label={prev ? `Previous month with bills: ${monthLabel(prev)}` : 'No earlier bills'} onClick={() => prev && onChange(prev)}>
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="ut-month-label"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { if (!canHover()) onOpenChange(!open); }}
        >
          <Calendar size={13} aria-hidden="true" /> {short(month)}
          <ChevronDown size={13} aria-hidden="true" className={`pill-chevron${open ? ' open' : ''}`} />
        </button>
        <button type="button" className="ut-month-arrow" disabled={!next} aria-label={next ? `Next month with bills: ${monthLabel(next)}` : 'No later bills'} onClick={() => next && onChange(next)}>
          <ChevronRight size={15} />
        </button>
      </div>

      {open && (
        <div className="ut-dropdown ut-month-panel" role="dialog" aria-label="Choose a month">
          {month !== now && (
            <button type="button" className="ut-month-today" onClick={() => { onChange(now); onOpenChange(false); }}>Back to {monthLabel(now)}</button>
          )}
          {Object.keys(byYear).sort().reverse().map((year) => (
            <div key={year} className="ut-month-year">
              <p className="ut-month-year-label">{year}</p>
              <div className="ut-month-grid">
                {byYear[year].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`ut-month-chip${m === month ? ' active' : ''}${m === now ? ' current' : ''}`}
                    aria-pressed={m === month}
                    onClick={() => { onChange(m); onOpenChange(false); }}
                  >
                    {new Date(`${m}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short' })}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="ut-month-hint">Only months with utility bills are listed.</p>
        </div>
      )}
    </div>
  );
}

// "⋮" menu on a card (admin): open in Expenses / delete.
function CardMenu({ onOpen, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div className="ut-menu" ref={ref}>
      <button type="button" className="ut-menu-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="ut-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpen(); }}><ExternalLink size={14} /> Open in Expenses</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} /> Delete…</button>
        </div>
      )}
    </div>
  );
}

export default function UtilitiesScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useCachedState('utilities', 'profile', null);
  const [currentUser, setCurrentUser] = useCachedState('utilities', 'currentUser', null);
  const [allHouseholds, setAllHouseholds] = useCachedState('utilities', 'allHouseholds', []);
  const [activeHousehold, setActiveHousehold] = useCachedState('utilities', 'activeHousehold', null);   // a household or { id: 'all' }
  const [utilities, setUtilities] = useCachedState('utilities', 'utilities', []);
  const [pausedCount, setPausedCount] = useCachedState('utilities', 'pausedCount', 0);
  const [availableMonths, setAvailableMonths] = useCachedState('utilities', 'availableMonths', []);
  const [notifications, setNotifications] = useCachedState('utilities', 'notifications', []);
  const [unreadCount, setUnreadCount] = useCachedState('utilities', 'unreadCount', 0);
  const [viewMonth, setViewMonth] = useCachedState('utilities', 'viewMonth', localMonth);
  const realMonthRef = useRef(localMonth());

  // UI State
  const [openMenu, setOpenMenu] = useState(null);   // 'month' | 'household' | null — one at a time
  const [householdSearch, setHouseholdSearch] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [proofAfterAdd, setProofAfterAdd] = useState(null); // { expense, isAdmin }
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUtility, setSelectedUtility] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chip, setChip] = useState(null);   // provider chip filter (a category)
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useScreenLoad('utilities');
  const { done: loadDone, fail: loadFail } = load;
  const [refundFor, setRefundFor] = useState(null);   // deletion refund from the delete window
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Filter
  const [filterStatus, setFilterStatus] = useState([]);
  const [filterType, setFilterType] = useState([]);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Payment Proof
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showPayOnlineModal, setShowPayOnlineModal] = useState(false);
  const [proofForm, setProofForm] = useState({ note: '', screenshot: null, screenshotPreview: null });
  const proofInputRef = useRef(null);

  const isAll = activeHousehold?.id === ALL;

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchUtilities = useCallback(async (scope, user, month, households) => {
    if (!scope || !user) return;
    try {
      const targets = scope.id === ALL ? households : [scope];
      const results = await Promise.all(targets.map((h) => loadHouseholdUtilities(h, user, month)));
      const items = results.flatMap((r) => r.items);
      const nowKeys = new Set(items.map((u) => providerKey(u.expense)));
      const prevKeys = new Set(results.flatMap((r) => r.prevKeys));
      setUtilities(items);
      // the current month is always reachable, even before its first bill
      setAvailableMonths([...new Set([...results.flatMap((r) => r.months), localMonth(), month])]);
      setPausedCount([...prevKeys].filter((k) => !nowKeys.has(k)).length);
      loadDone();
    } catch (err) {
      loadFail(err);
      showToast('Error loading utility expenses.', 'error');
    }
  }, [showToast, loadDone, loadFail, setAvailableMonths, setPausedCount, setUtilities]);

  const reload = useCallback(
    () => fetchUtilities(activeHousehold, currentUser, viewMonth, allHouseholds),
    [fetchUtilities, activeHousehold, currentUser, viewMonth, allHouseholds],
  );

  async function fetchNotifications(userId) {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotifications(data || []);
    setUnreadCount((data || []).filter(n => !n.is_read).length);
  }

  const fetchData = useCallback(async () => {
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

      const { data: memberData, error: memberError } = await supabase
        .from('household_members')
        .select('household_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (memberError) { showToast('Error loading household memberships.', 'error'); loadFail(memberError); return; }
      if (!memberData || memberData.length === 0) {
        showToast('You are not a member of any household. Please join or create one.', 'error');
        setAllHouseholds([]);
        setActiveHousehold(null);
        loadDone();   // nothing to load — the empty state shows
        return;
      }

      const { data: householdsData, error: housesError } = await supabase
        .from('households')
        .select('*')
        .in('id', memberData.map(m => m.household_id));
      if (housesError) { showToast('Error loading household details.', 'error'); loadFail(housesError); return; }

      const householdsWithRole = householdsData.map(h => ({
        ...h,
        role: memberData.find(m => m.household_id === h.id)?.role || 'member',
      }));
      setAllHouseholds(householdsWithRole);
      // Default stays the current (owned, else first) household
      setActiveHousehold(householdsWithRole.find(h => h.role === 'owner') || householdsWithRole[0]);
      await fetchNotifications(user.id);
    } catch (err) {
      loadFail(err);
      showToast('Failed to load data. Check your connection.', 'error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable cache setters / plain helper (adding it would refetch every render)
  }, [navigate, showToast, loadDone, loadFail]);

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // (Re)load whenever the household scope or the viewed month changes
  useEffect(() => {
    void reload();
  }, [reload]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // New month: if the current month was on screen, move to the new one
  // (checked every minute and when returning to the app).
  useEffect(() => {
    const check = () => {
      const now = localMonth();
      if (now === realMonthRef.current) return;
      const was = realMonthRef.current;
      realMonthRef.current = now;
      setViewMonth((m) => (m === was ? now : m));
    };
    const timer = setInterval(check, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [setViewMonth]);

  useEffect(() => {
    if (!currentUser || !activeHousehold) return undefined;
    const expensesFilter = isAll ? {} : { filter: `household_id=eq.${activeHousehold.id}` };
    const channel = supabase
      .channel('utilities-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', ...expensesFilter }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, () => reload())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, activeHousehold, isAll, reload]);

  const switchRowRef = useRef(null);
  useEffect(() => {
    if (!openMenu) return undefined;
    const onDown = (e) => { if (!switchRowRef.current?.contains(e.target)) setOpenMenu(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [openMenu]);

  // ── Derived ──
  const presentCategories = useMemo(() => [...new Set(utilities.map(u => u.category))], [utilities]);
  const activeCount = useMemo(() => new Set(utilities.map(u => providerKey(u.expense))).size, [utilities]);
  const monthlyTotal = useMemo(() => utilities.reduce((a, u) => a + Number(u.amount || 0), 0), [utilities]);
  const pendingSplits = useMemo(() => utilities.filter(u => (
    u.approval_status === 'pending_approval' || u.splits.some(s => s.status === 'pending_verification')
  )).length, [utilities]);
  const dueInfo = useMemo(() => {
    let overdue = 0;
    let soon = 0;
    utilities.forEach((u) => {
      const st = cardState(u);
      if (!u.due_date || st.isPaid || st.deletion) return;
      const d = daysUntil(u.due_date);
      if (d < 0) overdue += 1;
      else if (d <= 7) soon += 1;
    });
    return { overdue, soon };
  }, [utilities]);

  const filteredUtilities = useMemo(() => {
    let result = [...utilities];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(u => u.title?.toLowerCase().includes(q) || categoryLabel(u.category).toLowerCase().includes(q));
    }
    if (chip) result = result.filter(u => u.category === chip);
    if (filterStatus.length > 0) result = result.filter(u => filterStatus.includes(u.status));
    if (filterType.length > 0) result = result.filter(u => filterType.includes(u.category));
    if (filterFrom) result = result.filter(u => u.expense_date >= filterFrom);
    if (filterTo) result = result.filter(u => u.expense_date <= filterTo);
    // By due date (soonest first, no due date last), then newest
    return result.sort((a, b) => (
      (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1)
      || (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0)
      || (b.expense_date || '').localeCompare(a.expense_date || '')
    ));
  }, [searchQuery, chip, filterStatus, filterType, filterFrom, filterTo, utilities]);

  const handleSwitchHousehold = (household) => {
    setActiveHousehold(household);
    setOpenMenu(null);
    setHouseholdSearch('');
    setChip(null);
    showToast(household.id === ALL ? 'Showing all households' : `Switched to ${household.name}`);
  };

  const utilityActor = () => ({ id: currentUser.id, name: profile?.full_name || 'The admin' });
  const utilityLink = (expenseId, householdId) => ({
    link_path: `/groups/${householdId}?type=household`,
    link_state: JSON.stringify({ type: 'household' }),
    link_query: `expenseId=${expenseId}`,
  });
  const linkForSelected = (expenseId) => utilityLink(expenseId, selectedUtility?.householdId || refundFor?.expense?.household_id);

  const handleDeleteUtility = async () => {
    if (!selectedUtility) return;
    setDeleteBusy(true);
    try {
      // Keep the utility visible until member payments and sent refunds are resolved.
      const res = await softDeleteExpense({ expense: selectedUtility.expense, actor: utilityActor() });
      if (res.blocked) {
        showToast('Refund the members who paid first.', 'error');
      } else if (res.pendingRefunds?.length) {
        showToast('Wait for the member to confirm the refund before deleting this utility.', 'error');
      } else {
        setShowDeleteModal(false);
        setSelectedUtility(null);
        showToast('Utility deleted.');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not delete utility.', 'error');
    }
    setDeleteBusy(false);
    reload();
  };

  // "Refund" from the delete window: the member must get back what they paid
  const handleSendDeletionRefund = async ({ amount, file, note }) => {
    setDeleteBusy(true);
    try {
      await sendRefund({
        expense: refundFor.expense,
        split: refundFor.split,
        amount, file, note,
        refundType: refundFor.refundType,
        actor: utilityActor(),
        linkFor: linkForSelected,
      });
      showToast('Refund sent and member notified!');
      setRefundFor(null);
      setSelectedUtility(null);
      await reload();
    } catch (err) {
      showToast(err.message || 'Could not send refund', 'error');
    }
    setDeleteBusy(false);
  };

  const handleExpenseAdded = (inserted, { paidUpfront, isAdmin: addedAsAdmin }) => {
    setShowAddExpense(false);
    // Whoever marked themselves as the payer gets the "upload proof now" step.
    if (paidUpfront) setProofAfterAdd({ expense: inserted, isAdmin: addedAsAdmin });
    else showToast(addedAsAdmin ? 'Utility added!' : 'Utility submitted for approval!');
    // Jump to the month it belongs to so it's visible right away
    const month = monthOfExpense(inserted);
    if (month && month !== viewMonth) setViewMonth(month);
    else reload();
  };

  const openInExpenses = (u) => navigate(`/expenses?householdId=${u.householdId}&expenseId=${u.id}`);

  const householdOptions = [{ id: ALL, name: 'All households' }, ...allHouseholds];
  const filteredHouseholds = householdOptions.filter(h => h.name.toLowerCase().includes(householdSearch.toLowerCase()));
  const dueTone = dueInfo.overdue ? 'red' : dueInfo.soon ? 'amber' : 'clear';

  return (
    <div className="utilities-screen">
      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
      <TopBar
        profile={profile}
        setProfile={setProfile}
        household={isAll ? allHouseholds[0] : activeHousehold}
        currentUser={currentUser}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
        title="Utilities"
        showBell={true}
      />
      <div className="utilities-title-section">
        <h2 className="utilities-title">Utilities Management</h2>
        <div className="ut-switch-row" ref={switchRowRef}>
          <MonthNav
            month={viewMonth}
            months={availableMonths}
            onChange={setViewMonth}
            open={openMenu === 'month'}
            onOpenChange={(v) => setOpenMenu(v ? 'month' : null)}
          />
          {allHouseholds.length > 1 && (
            <div
              className={`ut-switch ut-switch--grow${openMenu === 'household' ? ' is-open' : ''}`}
              onMouseEnter={() => { if (canHover()) setOpenMenu('household'); }}
              onMouseLeave={() => { if (canHover()) setOpenMenu(null); }}
            >
              <button
                type="button"
                className="household-switcher-pill ut-household-switch"
                aria-haspopup="listbox"
                aria-expanded={openMenu === 'household'}
                onClick={() => { if (!canHover()) setOpenMenu(openMenu === 'household' ? null : 'household'); }}
              >
                <span className="pill-text"><InlineIcon as={ICONS.household} /> {activeHousehold?.name}</span>
                <ChevronDown size={14} className={`pill-chevron${openMenu === 'household' ? ' open' : ''}`} />
              </button>
              {openMenu === 'household' && (
                <div className="ut-dropdown household-dropdown align-right">
                  <div className="household-search-wrap">
                    <Search size={13} className="household-search-icon"/>
                    <input type="text" placeholder="Search household..." value={householdSearch} onChange={e => setHouseholdSearch(e.target.value)} className="household-search-input" />
                  </div>
                  {filteredHouseholds.map(h => (
                    <button key={h.id} className={`household-option ${activeHousehold?.id === h.id ? 'active' : ''}`} onClick={() => handleSwitchHousehold(h)}>
                      <span className="household-option-name">{h.name}</span>
                      {h.role && <span className="household-option-role">{h.role}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="utilities-content">
        <LoadGate load={load} skeleton={<UtilitiesSkeleton />} onRetry={fetchData}>
        <div className="utility-summary-row">
          <div className="utility-summary-card">
            <p className="summary-card-label">Monthly total</p>
            <p className="summary-card-count">{formatMoney(monthlyTotal)}</p>
            <p className="ut-summary-sub">{isAll ? 'All households' : activeHousehold?.name}</p>
          </div>
          <div className={`utility-summary-card ut-due ut-due--${dueTone}`}>
            <p className="summary-card-label">Due soon</p>
            <p className="summary-card-count">
              {dueTone === 'clear' ? 'All clear' : dueInfo.overdue ? `${dueInfo.overdue} overdue` : `${dueInfo.soon} due`}
            </p>
            <p className="ut-summary-sub">
              {dueTone === 'clear' ? 'Nothing due in 7 days' : dueInfo.overdue && dueInfo.soon ? `+${dueInfo.soon} due within 7 days` : 'Within the next 7 days'}
            </p>
          </div>
        </div>

        {pendingSplits > 0 && (
          <div className="ut-pending-banner" role="status">
            <InlineIcon as={ICONS.pending} /> <strong>{pendingSplits}</strong> pending split approval{pendingSplits === 1 ? '' : 's'}
          </div>
        )}

        <section className="ut-providers" aria-label="Providers">
          <div className="ut-providers-head">
            <p className="ut-providers-title">Providers</p>
            <p className="ut-count-line">{activeCount} active · {pausedCount} paused</p>
          </div>
          {presentCategories.length > 0 ? (
            <div className="ut-chips" role="group" aria-label="Filter by provider">
              <button type="button" className={`ut-chip${chip === null ? ' active' : ''}`} aria-pressed={chip === null} onClick={() => setChip(null)}>
                All <span className="ut-chip-count">{utilities.length}</span>
              </button>
              {presentCategories.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`ut-chip${chip === c ? ' active' : ''}`}
                  aria-pressed={chip === c}
                  onClick={() => setChip(chip === c ? null : c)}
                >
                  <span className="ut-chip-icon" aria-hidden="true"><Icon as={configOf(c).icon} size={14} /></span>
                  {categoryLabel(c)}
                  <span className="ut-chip-count">{utilities.filter(u => u.category === c).length}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="ut-providers-empty">No providers billed this month yet.</p>
          )}
        </section>

        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon"/>
            <input type="text" placeholder="Search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}><Filter size={14}/> Filter</button>
        </div>

        {filteredUtilities.length === 0 ? (
          <div className="empty-state">
            <p>No utilities for {monthLabel(viewMonth)}.</p>
            <p>Tap + to add one.</p>
          </div>
        ) : (
          filteredUtilities.map(utility => {
            const config = configOf(utility.category);
            const myShare = utility.myShareAmount;
            const { deletion, isPaid, isVerifying, isPartly } = cardState(utility);
            const days = utility.due_date ? daysUntil(utility.due_date) : null;
            const dueText = days === null ? null
              : days < 0 ? `Overdue · ${formatDate(utility.due_date)}`
                : days === 0 ? 'Due today'
                  : days <= 7 ? `Due in ${days} day${days === 1 ? '' : 's'}`
                    : `Due ${new Date(`${utility.due_date}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
            return (
              <div key={utility.id} className="utility-item ut-card">
                <div className="utility-icon-wrap" style={{ background: config.bg, color: config.color }} aria-hidden="true"><Icon as={config.icon} /></div>
                <div className="utility-details">
                  <div className="ut-card-top">
                    <p className="utility-name ut-provider">{capitalize(utility.title)}</p>
                    <div className="ut-card-actions">
                    {deletion ? (
                      <span className="status-badge" style={{ background: DELETION_STATUS_META[deletion].bg, color: DELETION_STATUS_META[deletion].color }}>
                        {deletion === 'verifying' ? <><StatusIcon status="verifying" />Verifying for deletion</> : <><StatusIcon status="refunded" />Refunded for deletion</>}
                      </span>
                    ) : (
                      <span className={`status-badge ut-status ut-status--${isPaid ? 'paid' : isPartly ? 'partly' : isVerifying ? 'verifying' : utility.approval_status === 'pending_approval' ? 'approval' : 'pending'}`}>
                        {(() => {
                        const label = isPaid ? 'Paid' : isPartly ? 'Partly Paid' : isVerifying ? 'Verifying' : utility.approval_status === 'pending_approval' ? 'Needs Approval' : 'Pending';
                        return <><StatusIcon status={label} />{label}</>;
                      })()}
                      </span>
                    )}
                    {utility.isOwner && (
                      <CardMenu
                        onOpen={() => openInExpenses(utility)}
                        onDelete={() => { setSelectedUtility(utility); setShowDeleteModal(true); }}
                      />
                    )}
                    </div>
                  </div>

                  <div className="ut-tags">
                    <span className="ut-tag ut-tag--cat">{categoryLabel(utility.category)}</span>
                    <span className="ut-tag">Monthly</span>
                    <span className="ut-tag ut-tag--split">{utility.split_method === 'custom' ? 'Custom split' : 'Equal split'}</span>
                    {dueText && !isPaid && !deletion && (
                      <span className={`ut-tag ut-tag--due${days < 0 ? ' overdue' : days <= 7 ? ' soon' : ''}`}>
                        <Calendar size={11} aria-hidden="true" /> {dueText}
                      </span>
                    )}
                  </div>
                  {isAll && <p className="ut-household-line"><InlineIcon as={ICONS.household} /> {utility.householdName}</p>}

                  {!deletion && (
                    <div className="ut-footer">
                      <div className="ut-share">
                        <span className="ut-share-label">{myShare > 0 ? 'Your share' : 'Total'}</span>
                        <span className="ut-share-amount">{formatMoney(myShare > 0 ? myShare : utility.amount)}</span>
                        {myShare > 0 && <span className="ut-share-of">of {formatMoney(utility.amount)} total</span>}
                      </div>
                      {!utility.isOwner && !isPaid && !isVerifying && !isPartly && (
                        <button className="pay-btn ut-pay" onClick={() => { setSelectedUtility(utility); setShowPaymentProofModal(true); }}>Pay</button>
                      )}
                      {!utility.isOwner && isPartly && (
                        <button className="pay-btn ut-pay" onClick={() => navigate('/expenses')}>Pay in Expenses</button>
                      )}
                    </div>
                  )}

                  {deletion && (
                    <p className="utility-my-share" style={{ color: DELETION_STATUS_META[deletion].color }}>
                      {deletion === 'verifying'
                        ? 'The admin sent a refund to delete this expense — confirm it in Expenses'
                        : 'Your payment was refunded — this expense will soon be deleted'}
                    </p>
                  )}
                  {!deletion && utility.myPaidAmount > 0 && utility.myStatus !== 'approved' && (
                    <p className="utility-my-share" style={{ color: '#c05621' }}>Paid {formatMoney(utility.myPaidAmount)} so far</p>
                  )}
                  {utility.myOverpaid > 0 && (
                    <p className="utility-my-share" style={{ color: '#2B6CB0' }}>Overpaid {formatMoney(utility.myOverpaid)} — refund pending</p>
                  )}
                  {!utility.isOwner && isPartly && (
                    <p className="ut-note ut-note--warn">{formatMoney(utility.myFollowupDue)} follow-up due</p>
                  )}
                  {!utility.isOwner && isVerifying && (
                    <p className="ut-note"><InlineIcon as={ICONS.pending} /> Proof submitted, awaiting owner approval</p>
                  )}
                </div>
              </div>
            );
          })
        )}
        </LoadGate>
      </div>

      <button className="fab-btn ut-fab" aria-label="Add utility expense" onClick={() => setShowAddExpense(true)}><Plus size={24} /></button>

      {/* Same Add Expense form as the Expenses / household screens, utility categories only */}
      {showAddExpense && activeHousehold && (
        <AddExpenseModal
          context={isAll ? null : { type: 'household', id: activeHousehold.id, name: activeHousehold.name, ownerId: activeHousehold.created_by }}
          householdChoices={isAll ? allHouseholds : undefined}
          categoryScope="utilities"
          currentUser={currentUser}
          profile={profile}
          showToast={showToast}
          onOpenExpense={(e) => { setShowAddExpense(false); navigate(`/expenses?householdId=${e.household_id}&expenseId=${e.id}`); }}
          onAdded={handleExpenseAdded}
          onClose={() => setShowAddExpense(false)}
        />
      )}

      {proofAfterAdd && (
        <UploadProofAfterAddModal
          expense={proofAfterAdd.expense}
          isAdmin={proofAfterAdd.isAdmin}
          currentUser={currentUser}
          profile={profile}
          showToast={showToast}
          onDone={() => { setProofAfterAdd(null); reload(); }}
        />
      )}

      {/* Filter Modal (same layout as the Expenses screen) */}
      {showFilter && (
        <div className="modal-overlay">
          <div className="filter-modal">
            <div className="modal-header">
              <h2>Filter</h2>
              <button aria-label="Close" className="modal-close" onClick={() => setShowFilter(false)}><X size={18} /></button>
            </div>

            <div className="form-group">
              <div className="filter-group-head">
                <label>Status</label>
                {(() => {
                  const all = ['paid', 'pending', 'verifying'].every(st => filterStatus.includes(st));
                  return (
                    <button type="button" className="filter-select-all" onClick={() => setFilterStatus(all ? [] : ['paid', 'pending', 'verifying'])}>
                      {all ? 'Clear all' : 'Select all'}
                    </button>
                  );
                })()}
              </div>
              <div className="checkbox-group">
                {['paid', 'pending', 'verifying'].map(st => (
                  <label key={st} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={filterStatus.includes(st)}
                      onChange={e => {
                        if (e.target.checked) setFilterStatus([...filterStatus, st]);
                        else setFilterStatus(filterStatus.filter(x => x !== st));
                      }}
                    />
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <div className="filter-group-head">
                <label>Utility Type</label>
                {(() => {
                  const all = UTILITY_CATEGORIES.every(c => filterType.includes(c));
                  return (
                    <button type="button" className="filter-select-all" onClick={() => setFilterType(all ? [] : [...UTILITY_CATEGORIES])}>
                      {all ? 'Clear all' : 'Select all'}
                    </button>
                  );
                })()}
              </div>
              <div className="checkbox-group">
                {UTILITY_CATEGORIES.map(c => (
                  <label key={c} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={filterType.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setFilterType([...filterType, c]);
                        else setFilterType(filterType.filter(x => x !== c));
                      }}
                    />
                    {categoryLabel(c)}
                  </label>
                ))}
              </div>
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
              <button
                className="filter-reset-btn"
                onClick={() => { setFilterStatus([]); setFilterType([]); setFilterFrom(''); setFilterTo(''); setShowFilter(false); }}
              >
                Reset
              </button>
              <button className="filter-apply-btn" onClick={() => setShowFilter(false)}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete: confirm dialog with the same refund-first flow as the Expenses
          screen — members who paid must be refunded (and confirm) first. */}
      {showDeleteModal && selectedUtility && (
        <DeleteExpenseModal
          expense={selectedUtility.expense}
          splits={selectedUtility.splits}
          currentUserId={currentUser?.id}
          pendingRefunds={selectedUtility.refunds.filter(refund => refund.status === 'sent')}
          icon={<Icon as={configOf(selectedUtility.category).icon} />}
          color={configOf(selectedUtility.category).color}
          loading={deleteBusy}
          onConfirm={handleDeleteUtility}
          onClose={() => { setShowDeleteModal(false); setSelectedUtility(null); }}
          onRefund={(split) => { setShowDeleteModal(false); setRefundFor({ expense: selectedUtility.expense, split, refundType: 'expense_deletion' }); }}
        />
      )}

      {refundFor && (
        <RefundModal
          expense={refundFor.expense}
          split={refundFor.split}
          refundType={refundFor.refundType}
          loading={deleteBusy}
          onSubmit={handleSendDeletionRefund}
          onClose={() => setRefundFor(null)}
        />
      )}

      {/* Payment Proof Modal */}
      {showPaymentProofModal && selectedUtility && (
        <div className="modal-overlay">
          <div className="small-modal">
            <h2>Submit Payment Proof</h2>
            {proofForm.screenshotPreview && <img src={proofForm.screenshotPreview} alt="proof" className="proof-preview"/>}
            <button className="save-config-btn" style={{ background: '#F0EDFF', color: '#3B2AAB', marginTop: 0 }} onClick={() => proofInputRef.current.click()}>
              <InlineIcon as={ICONS.proof} /> {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
            </button>
            <button className="pom-trigger-btn" onClick={() => { setShowPaymentProofModal(false); setShowPayOnlineModal(true); }}><InlineIcon as={ICONS.payment} /> Pay Online</button>
            <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm(prev => ({ ...prev, note: e.target.value }))} className="reject-textarea" />
            <button className="save-config-btn" onClick={async () => {
              if (!proofForm.screenshot) { showToast('Please upload a screenshot.', 'error'); return; }
              setLoading(true);
              let objectPath;
              try {
                objectPath = await uploadPaymentProof(proofForm.screenshot, currentUser.id, 'utilities', selectedUtility.id);
              } catch (uploadError) {
                showToast(`Upload failed: ${uploadError.message}`, 'error');
                setLoading(false);
                return;
              }
              const insertedProof = await markItemAsPaid(selectedUtility, objectPath, proofForm.note, currentUser.id);
              if (!insertedProof) { showToast('Failed to submit proof. Please try again.', 'error'); setLoading(false); return; }
              if (selectedUtility.ownerId) {
                // Tap → Expenses screen: the Pending Approvals card while it's
                // waiting, or the expense itself once the proof was reviewed.
                await supabase.from('notifications').insert({
                  user_id: selectedUtility.ownerId,
                  title: 'Payment Proof Submitted 📸',
                  message: `${profile?.full_name || 'A member'} submitted payment proof for "${selectedUtility.title}". Tap to review.`,
                  type: 'payment_proof',
                  link_path: '/expenses',
                  link_query: `householdId=${selectedUtility.householdId}&expenseId=${selectedUtility.id}&proofId=${insertedProof.id}`,
                });
              }
              setShowPaymentProofModal(false);
              setProofForm({ note: '', screenshot: null, screenshotPreview: null });
              setSelectedUtility(null);
              showToast('Payment proof submitted!');
              setLoading(false);
              reload();
            }} disabled={loading}>{loading ? 'Submitting...' : 'Submit for Verification'}</button>
            <button className="cancel-btn" onClick={() => { setShowPaymentProofModal(false); setProofForm({ note: '', screenshot: null, screenshotPreview: null }); }}>Cancel</button>
          </div>
        </div>
      )}

      <PayOnlineModal
        show={showPayOnlineModal}
        onClose={() => { setShowPayOnlineModal(false); setShowPaymentProofModal(true); }}
        receiverId={selectedUtility?.ownerId}
        itemTitle={selectedUtility?.title}
        amount={selectedUtility?.amount}
        onProceed={() => { setShowPayOnlineModal(false); setShowPaymentProofModal(true); }}
      />

      <input type="file" ref={proofInputRef} style={{ display: 'none' }} accept="image/*" onChange={e => { const file = e.target.files[0]; if (file) setProofForm(prev => ({ ...prev, screenshot: file, screenshotPreview: URL.createObjectURL(file) })); }} />

      <BottomNav active="utilities"/>
    </div>
  );
}
