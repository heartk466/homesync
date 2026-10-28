import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, FileText, Users, Zap, BarChart2, Settings } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { PENDING_CHANGED_EVENT } from '../utils/pendingEvents';
import './BottomNav.css';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/dashboard' },
  { id: 'expenses', label: 'Expenses', icon: FileText, path: '/expenses' },
  { id: 'groups', label: 'Groups', icon: Users, path: '/groups' },
  { id: 'utilities', label: 'Utilities', icon: Zap, path: '/utilities' },
  { id: 'reports', label: 'Reports', icon: BarChart2, path: '/reports' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
];

// Everything waiting on this user — the same items as the Pending Approvals
// sections. As an admin (households/groups they own): members' proposed
// expenses + payment proofs to review + refunds to send or resend. As a member (anywhere they have a
// share): refunds the admin sent for them to approve/reject + rejected proofs
// they still have to resubmit.
async function countPendingApprovals(userId) {
  const [asAdmin, asMember] = await Promise.all([countAdminApprovals(userId), countMemberActions(userId)]);
  return asAdmin + asMember;
}

async function countMemberActions(userId) {
  const { data: mySplits } = await supabase.from('expense_splits').select('expense_id, status').eq('user_id', userId);
  const splitExpenseIds = [...new Set((mySplits || []).map((s) => s.expense_id))];
  if (!splitExpenseIds.length) return 0;

  // Only expenses that are live (approved, not deleted) — what the lists show.
  const { data: live } = await supabase
    .from('expenses')
    .select('id')
    .in('id', splitExpenseIds)
    .eq('approval_status', 'approved')
    .is('deleted_at', null);
  const liveIds = new Set((live || []).map((e) => e.id));
  if (!liveIds.size) return 0;

  const unpaidIds = (mySplits || []).filter((s) => s.status === 'unpaid' && liveIds.has(s.expense_id)).map((s) => s.expense_id);
  const [{ count: refundCount }, { data: myProofs }] = await Promise.all([
    supabase
      .from('expense_refunds')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .in('expense_id', [...liveIds]),
    unpaidIds.length
      ? supabase.from('payment_proofs').select('expense_id, status, created_at').eq('submitted_by', userId).in('expense_id', unpaidIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Rejected proof still to resubmit = the newest proof for that expense is the rejected one.
  const latestByExpense = {};
  (myProofs || []).forEach((p) => {
    const cur = latestByExpense[p.expense_id];
    if (!cur || Date.parse(p.created_at) > Date.parse(cur.created_at)) latestByExpense[p.expense_id] = p;
  });
  // ...unless the admin sent / settled a deletion refund for it (being deleted).
  const rejectedIds = Object.values(latestByExpense).filter((p) => p.status === 'rejected').map((p) => p.expense_id);
  let deletingIds = new Set();
  if (rejectedIds.length) {
    const { data: deletionRefunds } = await supabase
      .from('expense_refunds')
      .select('expense_id')
      .eq('user_id', userId)
      .eq('refund_type', 'expense_deletion')
      .in('status', ['sent', 'confirmed'])
      .in('expense_id', rejectedIds);
    deletingIds = new Set((deletionRefunds || []).map((r) => r.expense_id));
  }
  const rejectedCount = rejectedIds.filter((id) => !deletingIds.has(id)).length;

  return (refundCount || 0) + rejectedCount;
}

async function countAdminApprovals(userId) {
  const [{ data: households }, { data: groups }] = await Promise.all([
    supabase.from('households').select('id').eq('created_by', userId),
    supabase.from('groups').select('id').eq('created_by', userId),
  ]);
  const householdIds = (households || []).map((h) => h.id);
  const groupIds = (groups || []).map((g) => g.id);
  if (!householdIds.length && !groupIds.length) return 0;

  const expenseQueries = [];
  const base = () => supabase.from('expenses').select('id, approval_status').in('approval_status', ['approved', 'pending_approval']).is('deleted_at', null);
  if (householdIds.length) expenseQueries.push(base().in('household_id', householdIds));
  if (groupIds.length) expenseQueries.push(base().in('group_id', groupIds));
  const expenses = (await Promise.all(expenseQueries)).flatMap((r) => r.data || []);

  const newExpenseCount = expenses.filter((e) => e.approval_status === 'pending_approval').length;
  const approvedIds = expenses.filter((e) => e.approval_status === 'approved').map((e) => e.id);
  if (!approvedIds.length) return newExpenseCount;

  const { data: memberSplits } = await supabase
    .from('expense_splits')
    .select('expense_id, user_id, status, share_amount, paid_amount')
    .in('expense_id', approvedIds)
    .neq('user_id', userId);
  const splits = memberSplits || [];
  const proofsToReview = splits.filter((s) => s.status === 'pending_verification').length;

  // Members left overpaid (e.g. after the admin lowered the amount) who still
  // need a refund: no refund to them is waiting for their review.
  const overpaid = splits.filter((s) => s.status === 'approved' && Number(s.paid_amount) - Number(s.share_amount) > 0.005);
  let refundsNeeded = 0;
  if (overpaid.length) {
    const { data: sent } = await supabase
      .from('expense_refunds')
      .select('expense_id, user_id')
      .in('expense_id', [...new Set(overpaid.map((s) => s.expense_id))])
      .eq('status', 'sent');
    const awaiting = new Set((sent || []).map((r) => `${r.expense_id}:${r.user_id}`));
    refundsNeeded = overpaid.filter((s) => !awaiting.has(`${s.expense_id}:${s.user_id}`)).length;
  }

  // Deletion refunds a member rejected that still need resending: the newest
  // deletion refund to that member is the rejected one. (A rejected overpayment
  // refund is already counted above — it puts the member back to overpaid.)
  const { data: deletionRefunds } = await supabase
    .from('expense_refunds')
    .select('expense_id, user_id, status, created_at')
    .in('expense_id', approvedIds)
    .eq('refund_type', 'expense_deletion');
  const latestDeletion = {};
  (deletionRefunds || []).forEach((r) => {
    const key = `${r.expense_id}:${r.user_id}`;
    if (!latestDeletion[key] || Date.parse(r.created_at) > Date.parse(latestDeletion[key].created_at)) latestDeletion[key] = r;
  });
  const deletionResends = Object.values(latestDeletion).filter((r) => r.status === 'rejected').length;

  return newExpenseCount + proofsToReview + refundsNeeded + deletionResends;
}

export default function BottomNav({ active }) {
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState(0);

  // Loaded here (not passed in) so the Expenses badge shows on every tab,
  // and kept live as proofs are submitted or reviewed.
  useEffect(() => {
    let cancelled = false;
    let channel = null;
    let refreshTimer = null;
    let onChanged = null;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId || cancelled) return;

      const refresh = async () => {
        try {
          const n = await countPendingApprovals(userId);
          if (!cancelled) setPendingCount(n);
        } catch (err) {
          console.error('Pending approvals count failed:', err);
        }
      };
      await refresh();
      if (cancelled) return;

      // Several rows often change at once (approving creates every split), so debounce.
      const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 400);
      };
      channel = supabase
        .channel(`nav-pending-${userId}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_refunds' }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_proofs' }, scheduleRefresh)
        .subscribe();

      // Recount right after this user handles something on any screen, and when
      // they come back to the app — so the badge never waits on realtime alone.
      onChanged = scheduleRefresh;
      window.addEventListener(PENDING_CHANGED_EVENT, onChanged);
      window.addEventListener('focus', onChanged);
      document.addEventListener('visibilitychange', onChanged);
    })();

    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      if (channel) supabase.removeChannel(channel);
      if (onChanged) {
        window.removeEventListener(PENDING_CHANGED_EVENT, onChanged);
        window.removeEventListener('focus', onChanged);
        document.removeEventListener('visibilitychange', onChanged);
      }
    };
  }, []);

  return (
    <div className="bottom-nav">
      {navItems.map(item => (
        <button
          key={item.id}
          className={`nav-item ${active === item.id ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          <div className="nav-icon-wrap">
            <item.icon size={24} strokeWidth={1.75} aria-hidden="true" />
            {item.id === 'expenses' && pendingCount > 0 && (
              <span className="nav-badge" aria-label={`${pendingCount} pending approval${pendingCount === 1 ? '' : 's'}`}>{pendingCount}</span>
            )}
          </div>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
