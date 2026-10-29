import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  ArrowLeft, Users, Plus, Check, X, Camera,
  Copy, Share2, AlertCircle, Trash2, Eye, EyeOff, Lock, MoreVertical, RefreshCw, Pencil, ChevronDown, Search
} from 'lucide-react';
import './GroupDetailScreen.css';
import '../styles/pendingApprovals.css';
import AddExpenseModal from '../components/AddExpenseModal';
import MonthGroups from '../components/MonthGroups';
import { RemoveMemberModal } from '../components/HouseholdsSection';
import '../screens/SettingsScreen.css';
import { withFormerMemberNames } from '../utils/formerMembers';
import PayOnlineModal from '../components/PayOnlineModal';
import EditExpenseModal from '../components/EditExpenseModal';
import DeleteExpenseModal from '../components/DeleteExpenseModal';
import ReviewExpenseModal from '../components/ReviewExpenseModal';
import FollowupPaymentModal from '../components/FollowupPaymentModal';
import RefundModal from '../components/RefundModal';
import PaymentHistoryModal from '../components/PaymentHistoryModal';
import ProofViewModal from '../components/ProofViewModal';
import RejectExpenseModal from '../components/RejectExpenseModal';
import RequestRefundButton from '../components/RequestRefundButton';
import { approveMemberExpense, rejectMemberExpense } from '../utils/expenseApproval';
import {
  fetchExpenseExtras, softDeleteExpense, submitFollowupProof, reviewFollowupProof,
  sendRefund, reviewRefund, followupDueOf, overpaidOf, splitStatusMeta,
  num as toNum,
} from '../utils/expenseEditUtils';
import { formatMoney, formatDate } from '../utils/format';
import { deletionStateOf, DELETION_STATUS_META } from '../utils/refundsOwed';
import { resolvePaymentProofUrls, uploadPaymentProof } from '../utils/paymentProofStorage';

const NAME_REQUEST_LIMIT = 2; // rename requests per member per household/group per month (enforced in the DB)
import { openPaymentApp } from '../utils/paymentUtils';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

const ALL_EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Internet',
  'Food', 'Grocery', 'Transport', 'Entertainment', 'Subscription', 'Other',
];


const CATEGORY_COLORS = {
  Rent: '#3B2AAB', Electricity: '#2B6CB0', Water: '#2C7A7B',
  Internet: '#6B46C1', Food: '#C05621', Grocery: '#276749',
  Other: '#718096', Transport: '#DD6B20', Entertainment: '#D53F8C',
  Subscription: '#9B2C87',
  Gas: '#C05621', Mobile: '#3B2AAB', Cable: '#2C7A7B', 'Other utility': '#718096',
};

const fmtDate = formatDate;

// Scroll a (just expanded) expense card into view. Waits two frames so the
// member rows have rendered, then aligns the card's top under the header —
// centring a tall card would push its bottom half off screen.
const scrollExpenseIntoView = (expenseId) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById(`expense-${expenseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
};

// Newest main payment proof a user sent for an expense (any status).
const latestOwnProof = (proofs, expenseId, userId) => proofs
  .filter(p => p.expense_id === expenseId && p.submitted_by === userId)
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

export default function GroupDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const contextType = location.state?.type || new URLSearchParams(location.search).get('type') || 'group';

  const searchParams = new URLSearchParams(location.search);
  const openProofId = searchParams.get('proofId');
  const highlightExpenseId = searchParams.get('expenseId');
  const highlightRefundId = searchParams.get('refundId');
  const jumpNameRequestId = searchParams.get('nameRequest');   // owner: request to review
  const jumpNameRejectedId = searchParams.get('nameRejected'); // member: their rejected request

  const proofInputRef = useRef(null);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [expenseSplits, setExpenseSplits] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showViewProofModal, setShowViewProofModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectProofModal, setShowRejectProofModal] = useState(false);
  const [showDeleteGroupModal, setShowDeleteGroupModal] = useState(false);
  const [showKickMemberModal, setShowKickMemberModal] = useState(false);
  const [kickBlockers, setKickBlockers] = useState(null); // household: what the member still has to settle
  const [showOwnerProofModal, setShowOwnerProofModal] = useState(false);
  const [showResubmitModal, setShowResubmitModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [selectedSplit, setSelectedSplit] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [allPaymentProofs, setAllPaymentProofs] = useState([]);
  const [selectedProof, setSelectedProof] = useState(null);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState(null);
  const [highlightedApprovalSplitId, setHighlightedApprovalSplitId] = useState(null); // pending proof card a notification pointed to
  const [highlightedRefundId, setHighlightedRefundId] = useState(null);
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [toast, setToast] = useState(null);
  const [pendingExpenseApprovals, setPendingExpenseApprovals] = useState([]);
  const [showRejectExpenseModal, setShowRejectExpenseModal] = useState(false);
  const [selectedPendingExpense, setSelectedPendingExpense] = useState(null);
  const [reviewExpense, setReviewExpense] = useState(null); // pending expense being reviewed by the admin
  const [showUploadAfterAdd, setShowUploadAfterAdd] = useState(false);
  const [justAddedExpense, setJustAddedExpense] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [showPaymentCard, setShowPaymentCard] = useState(false);
  const [paymentCardMember, setPaymentCardMember] = useState(null);
  const [showPayOnlineModal, setShowPayOnlineModal] = useState(false);
  const [payOnlineOrigin, setPayOnlineOrigin] = useState(null); // 'proof' | 'resubmit'

  const openPayOnline = (origin) => {
    setPayOnlineOrigin(origin);
    if (origin === 'proof') setShowPaymentProofModal(false);
    if (origin === 'resubmit') setShowResubmitModal(false);
    setShowPayOnlineModal(true);
  };

  const handlePayOnlineProceed = () => {
    setShowPayOnlineModal(false);
    if (payOnlineOrigin === 'proof') setShowPaymentProofModal(true);
    if (payOnlineOrigin === 'resubmit') setShowResubmitModal(true);
  };

  // Edit / follow-up / refund / proofs (shared modals)
  const [editExpense, setEditExpense] = useState(null);
  const [extras, setExtras] = useState({ followups: {}, refunds: {} });
  const [followupFor, setFollowupFor] = useState(null);   // { expense, split }
  const [showFollowupPayOnline, setShowFollowupPayOnline] = useState(false);
  const [refundFor, setRefundFor] = useState(null);       // { expense, split }
  const [proofsFor, setProofsFor] = useState(null);       // { expense, split }
  // Expense list: collapsed cards, payment-status chips, search (shown when > 8 expenses)
  const [expandedExpenseIds, setExpandedExpenseIds] = useState(() => new Set());
  const [expenseFilter, setExpenseFilter] = useState('all'); // 'all' | 'unpaid' | 'partial' | 'paid'
  const [expenseSearch, setExpenseSearch] = useState('');
  const [remindedSplitIds, setRemindedSplitIds] = useState(() => new Set());
  const [xmLoading, setXmLoading] = useState(false);

  // Rename household / group
  const [renameStep, setRenameStep] = useState(null); // null | 'edit' | 'confirm'
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [nameRequests, setNameRequests] = useState([]);
  // Members get NAME_REQUEST_LIMIT requests per household/group per month
  const [nameRequestsUsed, setNameRequestsUsed] = useState(0);
  const [highlightedNameRequestId, setHighlightedNameRequestId] = useState(null);
  const [approveNameReq, setApproveNameReq] = useState(null);   // owner: password step before approving
  const [approveNamePassword, setApproveNamePassword] = useState('');
  const [showApproveNamePassword, setShowApproveNamePassword] = useState(false);
  const [approveNameError, setApproveNameError] = useState('');
  const [rejectNameReq, setRejectNameReq] = useState(null);     // owner: reason step before rejecting
  const [rejectNameReason, setRejectNameReason] = useState('');
  const [rejectedNameModal, setRejectedNameModal] = useState(null); // member: "your request was rejected"

  // Nobody to split with when the household/group has a single member
  const isSolo = members.length <= 1;
  const contextLabel = contextType === 'household' ? 'household' : 'group';
  const myPendingNameRequest = !isAdmin
    ? nameRequests.find(r => r.requested_by === currentUser?.id)
    : null;
  const nameRequestsLeft = Math.max(NAME_REQUEST_LIMIT - nameRequestsUsed, 0);

  // Header actions dropdown (copy / share / delete)
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Delete confirmation: password for email accounts, typing the name for
  // accounts that sign in with Google etc. (they have no password to check)
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteTypedName, setDeleteTypedName] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const authProviders = currentUser?.app_metadata?.providers
    || (currentUser?.app_metadata?.provider ? [currentUser.app_metadata.provider] : []);
  const canUsePassword = authProviders.includes('email') && !!currentUser?.email;

  const [proofForm, setProofForm] = useState({
    note: '', screenshot: null, screenshotPreview: null
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchExpenseSplits = useCallback(async (expenseIds) => {
    if (!expenseIds.length) return {};
    const { data, error } = await supabase
      .from('expense_splits')
      .select(`*, profiles:user_id (id, full_name, avatar_url)`)
      .in('expense_id', expenseIds);
    if (error) {
      console.error(error);
      return {};
    }
    const grouped = {};
    // people who left the household keep their name on old expenses
    (await withFormerMemberNames(data)).forEach(split => {
      if (!grouped[split.expense_id]) grouped[split.expense_id] = [];
      grouped[split.expense_id].push(split);
    });
    return grouped;
  }, []);

  const fetchGroupAndData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      let groupData;
      if (contextType === 'household') {
        const { data, error } = await supabase
          .from('households')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        groupData = data;
      } else {
        const { data, error } = await supabase
          .from('groups')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        groupData = data;
      }
      setGroup(groupData);

      let membersData = [];
      if (contextType === 'household') {
        const { data, error } = await supabase
          .from('household_members')
          .select('user_id, role, status')
          .eq('household_id', id)
          .eq('status', 'active');
        if (error) throw error;
        membersData = data || [];
      } else {
        const { data, error } = await supabase
          .from('group_members')
          .select('user_id, role, status')
          .eq('group_id', id)
          .eq('status', 'active');
        if (error) throw error;
        membersData = data || [];
      }

      const userIds = membersData.map(m => m.user_id);
      let profilesMap = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, gcash_number, bank_name, bank_account_number, bank_account_name')
          .in('id', userIds);
        profilesMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
      }

      const membersList = membersData.map(m => ({
        user_id: m.user_id,
        role: m.role,
        profiles: profilesMap[m.user_id] || { full_name: 'Unknown', email: '' }
      }));
      setMembers(membersList);

      const userMember = membersList.find(m => m.user_id === user.id);
      const adminStatus = userMember?.role === 'owner' || groupData.created_by === user.id;
      setIsAdmin(adminStatus);

      const expenseColumn = contextType === 'household' ? 'household_id' : 'group_id';
      const { data: expensesData, error: expError } = await supabase
        .from('expenses')
        .select('*')
        .eq(expenseColumn, id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (expError) throw expError;
      const allExpenses = expensesData || [];
      setExpenses(allExpenses.filter(e => e.approval_status === 'approved'));

      if (adminStatus) {
        const { data: pendingExp } = await supabase
          .from('expenses')
          .select('*')
          .eq(contextType === 'household' ? 'household_id' : 'group_id', id)
          .is('deleted_at', null)
          .eq('approval_status', 'pending_approval');

        if (pendingExp && pendingExp.length > 0) {
          const enriched = pendingExp.map(exp => ({
            ...exp,
            profiles: profilesMap[exp.created_by] || { full_name: 'Unknown', avatar_url: null }
          }));
          setPendingExpenseApprovals(enriched);
        } else {
          setPendingExpenseApprovals([]);
        }
      } else {
        setPendingExpenseApprovals([]);
      }

      // Pending rename requests (owner sees all, a member sees only their own).
      // If the table doesn't exist yet this just returns an error and we show none.
      const { data: nameReqData } = await supabase
        .from('name_change_requests')
        .select('*')
        .eq(contextType === 'household' ? 'household_id' : 'group_id', id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      // A request by whoever owns it now is moot — the owner renames directly
      // (e.g. a member who asked, then became the owner).
      const ownerNow = groupData.created_by;
      setNameRequests((nameReqData || []).filter(r => !ownerNow || r.requested_by !== ownerNow).map(r => ({
        ...r,
        profiles: profilesMap[r.requested_by] || { full_name: 'A member' },
      })));
      if (!adminStatus) {
        const { data: used } = await supabase.rpc('name_requests_used_this_month', {
          p_household: contextType === 'household' ? id : null,
          p_group: contextType === 'household' ? null : id,
          p_user: user.id,
        });
        setNameRequestsUsed(Number(used) || 0);
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, contextType, navigate]);

  useEffect(() => {
    const loadSplitsAndProofs = async () => {
      if (expenses.length === 0) {
        setExpenseSplits({});
        setPendingApprovals([]);
        setAllPaymentProofs([]);
        return;
      }

      try {
        const expenseIds = expenses.map(e => e.id);
        const followupExtras = await fetchExpenseExtras(expenseIds, isAdmin ? currentUser?.id : null);
        const [splitsMap, proofsResult] = await Promise.all([
          fetchExpenseSplits(expenseIds),
          supabase
            .from('payment_proofs')
            .select(`*, profiles:submitted_by (id, full_name, email, avatar_url)`)
            .in('expense_id', expenseIds),
        ]);

        setExtras(followupExtras);
        setExpenseSplits(splitsMap);
        const proofsData = await resolvePaymentProofUrls(proofsResult.data || []);
        setAllPaymentProofs(proofsData);

        const pending = [];
        for (const exp of expenses) {
          const splits = splitsMap[exp.id] || [];
          const pendingSplits = splits.filter(s => (
            s.status === 'pending_verification'
            && !(isAdmin && s.user_id === currentUser?.id)
          ));
          pending.push(...pendingSplits);
        }
        setPendingApprovals(pending);
      } catch (err) {
        console.error('Failed to load payment proofs:', err);
        showToast(err.message || 'Failed to load payment proofs', 'error');
      }
    };

    loadSplitsAndProofs();
  }, [expenses, fetchExpenseSplits, isAdmin, currentUser?.id]);

  // ── Scroll to + briefly highlight the specific expense when arriving from
  // a "New Expense Pending Approval" / "Expense Approved" / "Expense Amount
  // Updated" notification. Retries as pendingExpenseApprovals/expenses load.
  useEffect(() => {
    if (!highlightExpenseId || highlightRefundId || loading) return;
    const el = document.getElementById(`expense-${highlightExpenseId}`);
    if (!el) return;

    const timer = setTimeout(() => {
      setHighlightedExpenseId(highlightExpenseId);
      setExpandedExpenseIds(prev => new Set(prev).add(highlightExpenseId));
      scrollExpenseIntoView(highlightExpenseId);
      navigate(`${location.pathname}?type=${contextType}`, { replace: true, state: location.state });
    }, 0);
    return () => clearTimeout(timer);
  }, [highlightExpenseId, highlightRefundId, loading, contextType, location, navigate]);

  // Clears the highlight a few seconds after it's set. Kept as its own effect
  // (depending only on highlightedExpenseId, not the URL) so the query-string
  // cleanup above doesn't cancel this timer before it fires.
  useEffect(() => {
    if (!highlightedExpenseId) return;
    const t = setTimeout(() => setHighlightedExpenseId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightedExpenseId]);

  useEffect(() => {
    if (!highlightedNameRequestId) return;
    const t = setTimeout(() => setHighlightedNameRequestId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightedNameRequestId]);

  // Rename notifications:
  //   owner, "Name change request" → its Pending Approvals card (pulsing);
  //          already handled → toast
  //   member, "Name change rejected" → the rejected modal (reason + resubmit)
  useEffect(() => {
    const requestId = jumpNameRequestId || jumpNameRejectedId;
    if (!requestId || loading) return;
    let cancelled = false;
    const clearParams = () => {
      const params = new URLSearchParams(location.search);
      params.delete('nameRequest');
      params.delete('nameRejected');
      navigate(`${location.pathname}?${params.toString()}`, { replace: true, state: location.state });
    };
    (async () => {
      const { data: req } = await supabase.from('name_change_requests').select('*').eq('id', requestId).maybeSingle();
      if (cancelled) return;
      if (jumpNameRejectedId) {
        if (req) setRejectedNameModal(req);
        else showToast('This name change request no longer exists.', 'error');
      } else if (req?.status === 'pending' && isAdmin) {
        const el = document.getElementById(`name-request-${req.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedNameRequestId(req.id);
        }
      } else {
        showToast(!req ? 'This name change request no longer exists.'
          : req.status === 'approved' ? 'You already approved this name change.'
          : req.status === 'rejected' ? 'You already rejected this name change.'
          : 'This request is handled by the owner.', 'success');
      }
      clearParams();
    })();
    return () => { cancelled = true; };
  }, [jumpNameRequestId, jumpNameRejectedId, loading, isAdmin, location, navigate]);

  useEffect(() => {
    if (!highlightRefundId || loading) return;
    const refund = Object.values(extras.refunds)
      .flat()
      .find((item) => item.id === highlightRefundId);
    if (!refund) return;

    // A rejected refund only needs resending while it is still the newest one
    // of its type for that member, and (for overpayments) there's still
    // something overpaid. Otherwise the admin already resent it — opening the
    // form again would create a duplicate refund.
    const split = (expenseSplits[refund.expense_id] || []).find((s) => s.user_id === refund.user_id);
    const supersededBy = (extras.refunds[refund.expense_id] || []).find((item) => (
      item.id !== refund.id
      && item.user_id === refund.user_id
      && item.refund_type === refund.refund_type
      && Date.parse(item.created_at) > Date.parse(refund.created_at)
    ));
    const nothingLeftToRefund = refund.refund_type === 'overpayment' && split && overpaidOf(split) <= 0.001;
    const isMemberApproval = !isAdmin && refund.status === 'sent';
    const isAdminResend = isAdmin && refund.status === 'rejected' && !supersededBy && !nothingLeftToRefund;

    // Nothing left to act on (member already approved/rejected it, admin already
    // resent it, ...): jump to the expense the refund belongs to instead, and
    // clear the URL params so the card can be collapsed and filters work again.
    if (!isMemberApproval && !isAdminResend) {
      if (isAdmin && refund.status === 'rejected' && !split && !supersededBy) return; // splits still loading
      let message;
      if (isAdmin && refund.status === 'rejected') {
        message = supersededBy ? 'You already resent this refund — it’s now awaiting the member’s review.' : 'Nothing left to refund for this member.';
      } else if (isAdmin) {
        message = refund.status === 'confirmed' ? 'The member already confirmed receiving this refund.' : 'This refund is awaiting the member’s review.';
      } else {
        message = refund.status === 'confirmed' ? 'You already confirmed receiving this refund.' : 'You already rejected this refund.';
      }
      const expenseStillListed = expenses.some((e) => e.id === refund.expense_id);
      if (!expenseStillListed) message += ' The expense has since been deleted.';
      const timer = setTimeout(() => {
        showToast(message, 'success');
        if (expenseStillListed) {
          setExpandedExpenseIds(prev => new Set(prev).add(refund.expense_id));
          setHighlightedExpenseId(refund.expense_id);
          scrollExpenseIntoView(refund.expense_id);
        }
        const params = new URLSearchParams(location.search);
        params.delete('refundId');
        params.delete('expenseId');
        navigate(`${location.pathname}?${params.toString()}`, { replace: true, state: location.state });
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      const targetId = isMemberApproval
        ? `refund-approval-${highlightRefundId}`
        : `refund-payment-${refund.expense_id}-${refund.user_id}`;
      const el = document.getElementById(targetId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedRefundId(highlightRefundId);
      setExpandedExpenseIds(prev => new Set(prev).add(refund.expense_id));
      // "Refund Rejected" → open the resend form straight away so the admin can pay again.
      if (isAdminResend) {
        const expense = expenses.find((e) => e.id === refund.expense_id);
        if (expense && split) {
          setRefundFor({
            expense,
            split,
            refundType: refund.refund_type === 'overpayment' ? 'overpayment' : 'expense_deletion',
            resending: true,
            initialAmount: refund.amount,
          });
        }
      }
      const params = new URLSearchParams(location.search);
      params.delete('refundId');
      params.delete('expenseId');
      navigate(`${location.pathname}?${params.toString()}`, { replace: true, state: location.state });
    }, 0);
    return () => clearTimeout(timer);
  }, [highlightRefundId, loading, extras.refunds, isAdmin, location, navigate, expenses, expenseSplits]);

  useEffect(() => {
    if (!highlightedRefundId) return;
    const timer = setTimeout(() => setHighlightedRefundId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightedRefundId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGroupAndData();
  }, [fetchGroupAndData]);

  useEffect(() => {
    if (!currentUser || !group) return;
    const expenseColumn = contextType === 'household' ? 'household_id' : 'group_id';
    const channel = supabase
      .channel('group-detail')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `${expenseColumn}=eq.${id}`,
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_proofs',
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: contextType === 'household' ? 'households' : 'groups',
        filter: `id=eq.${id}`,
      }, () => fetchGroupAndData())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expense_splits',
      }, () => {
        if (expenses.length) {
          fetchExpenseSplits(expenses.map(e => e.id)).then(setExpenseSplits);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, group, id, contextType, fetchGroupAndData, fetchExpenseSplits, expenses]);

  // Separate channel so a missing table can never break the expense updates above
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel(`name-requests-${id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'name_change_requests',
        filter: `${contextType === 'household' ? 'household_id' : 'group_id'}=eq.${id}`,
      }, () => fetchGroupAndData())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser, id, contextType, fetchGroupAndData]);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [menuOpen]);

  const resetProofForm = () => {
    setProofForm({ note: '', screenshot: null, screenshotPreview: null });
  };

  const getStatusBadge = (expense, splits) => {
    if (expense.approval_status === 'pending_approval') return { label: 'Waiting Approval', color: '#3B2AAB', bg: '#F0EDFF' };
    if (expense.approval_status === 'rejected') return { label: 'Rejected', color: '#e53e3e', bg: '#ffe5e5' };
    const paidCount = splits.filter(s => s.status === 'approved').length;
    const total = splits.length;
    if (total === 0) return { label: 'No splits', color: '#856404', bg: '#fff3cd' };
    // "Who Paid: None" and nothing paid or awaiting review yet
    if (!expense.paid_by && paidCount === 0 && !splits.some(s => s.status === 'pending_verification')) {
      return { label: 'Unpaid', color: '#e53e3e', bg: '#FEE2E2' };
    }
    if (paidCount === total) return { label: 'Fully Paid', color: '#38a169', bg: '#f0fff4' };
    if (splits.some(s => s.status === 'partly_paid')) return { label: 'Partly Paid', color: '#c05621', bg: '#FEEBC8' };
    return { label: `${paidCount}/${total} Paid`, color: '#856404', bg: '#fff3cd' };
  };

  // Payment-status bucket for the filter chips, from the expense's splits.
  const paymentBucketOf = (splits) => {
    if (splits.length > 0 && splits.every(s => s.status === 'approved')) return 'paid';
    if (splits.every(s => s.status === 'unpaid' && !toNum(s.paid_amount))) return 'unpaid';
    return 'partial';
  };

  const getMemberAvatar = (member) => {
    const p = member.profiles;
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="detail-avatar-img" />;
    const initials = p?.full_name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
    return <div className="detail-avatar-initials">{initials}</div>;
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(group?.code || '');
    showToast('Code copied!');
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: `Join ${group?.name}`, text: `Use code: ${group?.code}` }).catch(() => handleCopyCode());
    } else {
      handleCopyCode();
    }
  };

  const openProofModal = (proof, split) => {
    setSelectedProof(proof);
    setSelectedSplit(split);
    setShowViewProofModal(true);
  };

  useEffect(() => {
    if (!openProofId || loading) return;
    const proof = allPaymentProofs.find(p => p.id === openProofId);
    if (!proof) return;

    const splits = expenseSplits[proof.expense_id] || [];
    const split = splits.find(s => s.proof_id === proof.id)
      || splits.find(s => s.user_id === proof.submitted_by);

    const clearParams = () => navigate(`${location.pathname}?type=${contextType}`, { replace: true, state: location.state });

    // Same rule for every proof notification, wherever the proof was sent from
    // (Expenses, this screen, Utilities):
    //   1st tap, still needs action → its card in Pending Approvals (pulsing)
    //   once it's been handled      → the expense itself (pulsing)
    const jumpToCard = (elementId, splitId) => {
      const el = document.getElementById(elementId);
      if (!el) return null; // card not rendered yet — the effect runs again when lists load
      const timer = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedApprovalSplitId(splitId);
        clearParams();
      }, 0);
      return () => clearTimeout(timer);
    };

    let message;
    if (isAdmin) {
      // Admin, proof still waiting: its Pending Approvals card.
      if (proof.status === 'pending_verification' && split) {
        const cleanup = jumpToCard(`proof-approval-${split.id}`, split.id);
        if (!cleanup) return;
        return cleanup;
      }
      message = `You already ${proof.status === 'verified' ? 'approved' : 'rejected'} this payment proof.`;
    } else {
      // Member, rejected proof not replaced yet: its "Resubmit needed" card.
      const mySplit = splits.find(s => s.user_id === currentUser?.id);
      const latest = latestOwnProof(allPaymentProofs, proof.expense_id, proof.submitted_by);
      if (proof.status === 'rejected' && proof.submitted_by === currentUser?.id
          && latest?.id === proof.id && mySplit?.status === 'unpaid') {
        const cleanup = jumpToCard(`proof-rejected-${mySplit.id}`, mySplit.id);
        if (!cleanup) return;
        return cleanup;
      }
      if (proof.status === 'rejected' && latest && latest.id !== proof.id) {
        message = latest.status === 'verified'
          ? 'You already sent a new proof and it was approved.'
          : latest.status === 'pending_verification'
            ? 'You already sent a new proof — it’s waiting for the owner’s review.'
            : 'You already sent a new proof.';
      } else if (proof.status === 'verified') {
        message = proof.submitted_by === currentUser?.id
          ? 'This payment was confirmed by the owner.'
          : 'The owner paid their share — tap Proofs on their row to see the receipt.';
      } else if (proof.status === 'pending_verification') {
        message = 'This proof is waiting for the owner’s review.';
      } else {
        message = 'This proof was already handled.';
      }
    }

    // Already handled: take them to the expense instead.
    const expenseListed = expenses.some(e => e.id === proof.expense_id);
    const timer = setTimeout(() => {
      showToast(message + (expenseListed ? '' : ' The expense is no longer listed.'), 'success');
      if (expenseListed) {
        setExpandedExpenseIds(prev => new Set(prev).add(proof.expense_id));
        setHighlightedExpenseId(proof.expense_id);
        scrollExpenseIntoView(proof.expense_id);
      }
      clearParams();
    }, 0);
    return () => clearTimeout(timer);
  }, [openProofId, loading, allPaymentProofs, expenseSplits, pendingApprovals, expenses, isAdmin, currentUser?.id, contextType, location, navigate]);

  useEffect(() => {
    if (!highlightedApprovalSplitId) return;
    const timer = setTimeout(() => setHighlightedApprovalSplitId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightedApprovalSplitId]);

  // "Electricity already exists for October" → close the form and jump to that expense
  const openExistingExpense = (expense) => {
    setShowAddExpense(false);
    setEditExpense(null);
    setExpandedExpenseIds(prev => new Set(prev).add(expense.id));
    setHighlightedExpenseId(expense.id);
    scrollExpenseIntoView(expense.id);
  };

  // The shared AddExpenseModal inserted it — same follow-ups as before
  const handleExpenseAdded = (inserted, { paidUpfront, isAdmin: addedAsAdmin }) => {
    setShowAddExpense(false);
    if (paidUpfront) {
      // Payer → offer the "upload proof now" step.
      setJustAddedExpense(inserted);
      resetProofForm();
      setShowUploadAfterAdd(true);
    } else {
      showToast(addedAsAdmin ? 'Expense added!' : 'Expense submitted for approval!');
    }
    fetchGroupAndData();
  };

  // Approve / reject a member's proposed expense (logic shared with ExpensesScreen).
  const expenseLink = { link_path: `/groups/${id}?type=${contextType}`, link_state: JSON.stringify({ type: contextType }) };

  const handleApproveExpense = async (expense) => {
    setLoadingAction(true);
    try {
      await approveMemberExpense({ expense, ownerId: group?.created_by, actorId: currentUser?.id, link: expenseLink });
      showToast('Expense approved!');
    } catch (err) {
      showToast(err.message || 'Could not approve the expense.', 'error');
    }
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const handleRejectExpense = async (reason) => {
    if (!selectedPendingExpense) return;
    setLoadingAction(true);
    try {
      await rejectMemberExpense({
        expense: selectedPendingExpense,
        reason,
        actorId: profile?.id,
        actorName: profile?.full_name,
        link: expenseLink,
      });
      showToast('Expense rejected — member notified');
      setShowRejectExpenseModal(false);
      setSelectedPendingExpense(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoadingAction(false);
  };

  const handleApproveSplit = async (split) => {
    // If the member submitted a payment proof, approving MUST go through the exact
    // same flow as the "Confirm Payment" button in the proof modal. Before, this
    // function only flipped the split to 'approved' and left the proof stuck on
    // 'pending_verification' (and never notified the member), so the proof modal
    // still showed "Pending Verification" + Confirm/Reject buttons.
    const proof = allPaymentProofs.find(p => p.id === split.proof_id)
      || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id && p.status === 'pending_verification');
    if (proof) {
      await handleConfirmPayment(proof, split);
      return;
    }

    // No proof attached (manual "✓" mark-as-paid) — keep the original behavior.
    setLoadingAction(true);
    const { error } = await supabase
      .from('expense_splits')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', split.id);
    if (!error) {
      const { data: expense } = await supabase
        .from('expenses')
        .select('approval_status')
        .eq('id', split.expense_id)
        .single();
      if (expense && expense.approval_status === 'pending_approval') {
        await supabase
          .from('expenses')
          .update({ approval_status: 'approved' })
          .eq('id', split.expense_id);
      }
      const { data: allSplits } = await supabase
        .from('expense_splits')
        .select('status')
        .eq('expense_id', split.expense_id);
      const allApproved = allSplits.every(s => s.status === 'approved');
      if (allApproved) {
        await supabase.from('expenses').update({ status: 'paid' }).eq('id', split.expense_id);
      }
      showToast('Payment approved!');
      const newSplitsMap = await fetchExpenseSplits(expenses.map(e => e.id));
      setExpenseSplits(newSplitsMap);
      fetchGroupAndData();
    } else {
      showToast('Error approving payment', 'error');
    }
    setLoadingAction(false);
  };

  // ── shared helpers for the edit / follow-up / refund / delete flows ──
  const flowLink = (expenseId) => ({
    link_path: `/groups/${id}?type=${contextType}`,
    link_state: JSON.stringify({ type: contextType }),
    link_query: `expenseId=${expenseId}`,
  });
  const flowActor = () => ({ id: currentUser.id, name: profile?.full_name || 'The admin' });

  const handleDeleteExpense = async () => {
    if (!selectedExpense) return;
    setXmLoading(true);
    try {
      const res = await softDeleteExpense({ expense: selectedExpense, actor: flowActor(), linkFor: flowLink });
      if (res.blocked) {
        showToast('Refund the members who paid first', 'error');
      } else if (res.pendingRefunds?.length) {
        showToast('Wait for the member to confirm the refund before deleting this expense.', 'error');
      } else {
        setShowDeleteModal(false);
        setSelectedExpense(null);
        showToast('Expense deleted');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not delete expense', 'error');
    }
    setXmLoading(false);
    fetchGroupAndData();
  };

  const handleSubmitFollowup = async ({ file, note }) => {
    setXmLoading(true);
    try {
      const proof = await submitFollowupProof({
        expense: followupFor.expense, split: followupFor.split, user: currentUser,
        userName: profile?.full_name || 'A member', adminId: group?.created_by, isExpenseAdmin: isAdmin,
        file, note, linkFor: flowLink,
      });
      showToast(proof.status === 'verified' ? 'Follow-up payment confirmed!' : 'Follow-up proof submitted!');
      setFollowupFor(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Could not submit follow-up', 'error');
    }
    setXmLoading(false);
  };

  const handleReviewFollowup = async (proof, approve, reason) => {
    setXmLoading(true);
    try {
      await reviewFollowupProof({ proof, approve, reason, expense: proofsFor?.expense, actor: flowActor(), linkFor: flowLink });
      showToast(approve ? 'Follow-up payment approved!' : 'Follow-up payment rejected');
      setProofsFor(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Could not update follow-up', 'error');
    }
    setXmLoading(false);
  };

  const handleSendRefund = async ({ amount, file, note }) => {
    setXmLoading(true);
    try {
      await sendRefund({
        expense: refundFor.expense,
        split: refundFor.split,
        amount,
        file,
        note,
        refundType: refundFor.refundType,
        actor: flowActor(),
        linkFor: flowLink,
      });
      showToast(refundFor.refundType === 'overpayment' ? 'Overpayment refund sent and member notified!' : 'Refund sent and member notified!');
      setRefundFor(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Could not send refund', 'error');
    }
    setXmLoading(false);
  };

  const handleReviewRefund = async (refund, approve, reason = '') => {
    setXmLoading(true);
    try {
      await reviewRefund({
        refund,
        expense: proofsFor?.expense,
        approve,
        reason,
        user: currentUser,
        userName: profile?.full_name || 'A member',
        adminId: group?.created_by,
        linkFor: flowLink,
      });
      showToast(approve ? 'Refund approved. The admin has been notified.' : 'Refund rejected. The admin has been notified.');
      setProofsFor(null);
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Could not review refund', 'error');
    }
    setXmLoading(false);
  };

  const originalProofFor = (split) =>
    allPaymentProofs.find(p => p.id === split.proof_id)
    || [...allPaymentProofs].reverse().find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);

  // Every main proof the member submitted for this expense (rejected ones included),
  // plus the one linked to the split in case someone else submitted it.
  const mainProofsFor = (split) => {
    const linked = originalProofFor(split);
    const own = allPaymentProofs.filter(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);
    return linked && !own.some(p => p.id === linked.id) ? [...own, linked] : own;
  };

  // Everything Payment History would list for this member on this expense.
  const proofCountFor = (split) =>
    mainProofsFor(split).length
    + (extras.followups[split.expense_id] || []).filter(f => f.user_id === split.user_id).length
    + (extras.refunds[split.expense_id] || []).filter(r => r.user_id === split.user_id).length;

  // Notification params force a card open and the "All" filter until they're
  // handled. If one can't be resolved (e.g. its refund no longer exists), the
  // first tap on a card or chip drops them so the list is never stuck.
  const clearNotifParams = () => {
    if (!highlightExpenseId && !highlightRefundId) return;
    const params = new URLSearchParams(location.search);
    params.delete('refundId');
    params.delete('expenseId');
    navigate(`${location.pathname}?${params.toString()}`, { replace: true, state: location.state });
  };

  const toggleExpense = (expenseId) => {
    const forcedOpen = expenseId === highlightExpenseId
      || Object.values(extras.refunds).flat().some(r => r.id === highlightRefundId && r.expense_id === expenseId);
    clearNotifParams();
    setExpandedExpenseIds(prev => {
      const next = new Set(prev);
      // A card held open by a notification counts as open, so this tap closes it.
      if (next.has(expenseId) || forcedOpen) next.delete(expenseId); else next.add(expenseId);
      return next;
    });
  };

  // "Upload proof" on the current user's unpaid row → the same modals the old
  // "You owe" / "Your proof was rejected" / "Submit as Owner" boxes opened.
  const openUploadProof = (expense) => {
    setSelectedExpense(expense);
    resetProofForm();
    const rejected = allPaymentProofs.find(p => p.expense_id === expense.id && p.submitted_by === currentUser?.id && p.status === 'rejected');
    if (isAdmin) setShowOwnerProofModal(true);
    else if (rejected) setShowResubmitModal(true);
    else setShowPaymentProofModal(true);
  };

  const handleRemind = async (expense, split) => {
    setRemindedSplitIds(prev => new Set(prev).add(split.id));
    const { error } = await supabase.from('notifications').insert({
      user_id: split.user_id,
      title: '🔔 Payment Reminder',
      message: `${profile?.full_name || 'The owner'} reminded you to pay your ${formatMoney(toNum(split.share_amount))} share for "${expense.title}".`,
      type: 'payment_reminder',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `expenseId=${expense.id}`,
    });
    if (error) {
      setRemindedSplitIds(prev => { const next = new Set(prev); next.delete(split.id); return next; });
      showToast('Could not send the reminder. Try again.', 'error');
    } else {
      showToast(`Reminder sent to ${split.profiles?.full_name?.split(' ')[0] || 'member'}`);
    }
  };

  const closeDeleteGroupModal = () => {
    if (loadingAction) return;
    setShowDeleteGroupModal(false);
    setDeletePassword('');
    setDeleteTypedName('');
    setDeleteError('');
    setShowDeletePassword(false);
  };

  const deleteConfirmReady = canUsePassword
    ? deletePassword.length > 0
    : deleteTypedName.trim() === (group?.name || '');

  const handleDeleteGroup = async () => {
    if (!isAdmin || !deleteConfirmReady) return;
    setDeleteError('');
    setLoadingAction(true);

    // Nothing is deleted until the owner proves it is them
    if (canUsePassword) {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: deletePassword,
      });
      if (authError) {
        setDeleteError('Incorrect password. Please try again.');
        setLoadingAction(false);
        return;
      }
    }

    try {
      if (contextType === 'household') {
        // Backend rule: only when the owner is the last member
        const { error: deleteErr } = await supabase.rpc('delete_household', { p_household: id });
        if (deleteErr) throw deleteErr;
      } else {
        for (const [table, column] of [['expenses', 'group_id'], ['group_members', 'group_id'], ['groups', 'id']]) {
          const { error: deleteErr } = await supabase.from(table).delete().eq(column, id);
          if (deleteErr) throw deleteErr;
        }
      }
      showToast(`${contextType === 'household' ? 'Household' : 'Group'} deleted`);
      setShowDeleteGroupModal(false);
      navigate('/groups');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to delete', 'error');
    }
    setLoadingAction(false);
  };

  // "Remove from household/group": a household first checks what the member
  // still has to settle — the same modal as Settings → Manage Members.
  const openKickMember = async (member) => {
    setSelectedMember(member);
    if (contextType !== 'household') { setShowKickMemberModal(true); return; }
    const { data: blockers, error: blockersErr } = await supabase.rpc('household_leave_blockers', { p_household: id, p_user: member.user_id });
    if (blockersErr) { showToast(blockersErr.message || 'Could not check this member', 'error'); return; }
    setKickBlockers(blockers || []);
    setShowKickMemberModal(true);
  };

  const closeKickMember = () => {
    setShowKickMemberModal(false);
    setSelectedMember(null);
    setKickBlockers(null);
  };

  const handleKickMember = async () => {
    if (!selectedMember) return;
    setLoadingAction(true);
    try {
      if (contextType === 'household') {
        // Same rule as leaving: no unpaid shares / pending reviews (enforced by the RPC,
        // which also notifies the member and the rest of the household)
        const { error: removeErr } = await supabase.rpc('remove_household_member', { p_household: id, p_user: selectedMember.user_id });
        if (removeErr) throw removeErr;
      } else {
        await supabase.from('group_members')
          .update({ status: 'kicked' })
          .eq('group_id', id)
          .eq('user_id', selectedMember.user_id);
        await supabase.from('notifications').insert({
          user_id: selectedMember.user_id,
          title: 'Removed from Group',
          message: `You have been removed from "${group?.name}"`,
          type: 'kicked',
        });
      }
      showToast('Member removed');
      closeKickMember();
      fetchGroupAndData();
    } catch (err) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
    setLoadingAction(false);
  };

  const handleSubmitProof = async (isResubmit = false) => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot', 'error'); return; }
    setLoadingAction(true);
    
    let objectPath;
    try {
      objectPath = await uploadPaymentProof(proofForm.screenshot, currentUser.id, 'expenses', selectedExpense.id);
    } catch (uploadError) {
      showToast(`Upload failed: ${uploadError.message}`, 'error');
      setLoadingAction(false);
      return;
    }

    if (isResubmit) {
      await supabase
        .from('payment_proofs')
        .delete()
        .eq('expense_id', selectedExpense.id)
        .eq('submitted_by', currentUser.id)
        .eq('status', 'rejected');
    }

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: selectedExpense.id,
      submitted_by: currentUser.id,
      screenshot_url: objectPath,
      note: proofForm.note,
      status: 'pending_verification',
    }).select().single();

    if (proofError) {
      showToast('Failed to save proof', 'error');
      setLoadingAction(false);
      return;
    }

    const { data: existingSplit } = await supabase
      .from('expense_splits')
      .select('id')
      .eq('expense_id', selectedExpense.id)
      .eq('user_id', currentUser.id)
      .maybeSingle();

    let splitUpdateError = null;
    if (!existingSplit) {
      const myShare = selectedExpense.members_split?.[currentUser.id];
      if (!myShare) {
        showToast('Error: Your share not found in expense.', 'error');
        setLoadingAction(false);
        return;
      }
      const { error: insertError } = await supabase
        .from('expense_splits')
        .insert({
          expense_id: selectedExpense.id,
          user_id: currentUser.id,
          share_amount: Number(myShare),
          status: 'pending_verification',
          proof_id: insertedProof.id,
          updated_at: new Date().toISOString(),
        });
      splitUpdateError = insertError;
    } else {
      const { error: updateError } = await supabase
        .from('expense_splits')
        .update({ status: 'pending_verification', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
        .eq('id', existingSplit.id);
      splitUpdateError = updateError;
    }

    if (splitUpdateError) {
      showToast('Failed to update payment status', 'error');
      setLoadingAction(false);
      return;
    }

    await supabase.from('expenses').update({ status: 'verifying' }).eq('id', selectedExpense.id);

    await supabase.from('notifications').insert({
      user_id: group?.created_by,
      title: isResubmit ? '📸 Payment Proof Resubmitted' : '📸 Payment Proof Submitted',
      message: `${profile?.full_name} ${isResubmit ? 'resubmitted' : 'submitted'} proof for "${selectedExpense.title}". Tap to review.`,
      type: 'payment_proof',
      // Household proofs open the Expenses screen (Pending Approvals card first,
      // the expense once reviewed); group proofs keep the group screen.
      ...(contextType === 'household'
        ? { link_path: '/expenses', link_query: `householdId=${id}&expenseId=${selectedExpense.id}&proofId=${insertedProof.id}` }
        : { link_path: `/groups/${id}?type=${contextType}`, link_state: JSON.stringify({ type: contextType }), link_query: `openProof=${selectedExpense.id}&proofId=${insertedProof.id}` }),
    });

    setShowPaymentProofModal(false);
    setShowResubmitModal(false);
    resetProofForm();
    setSelectedExpense(null);
    showToast('Proof submitted for verification');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  const handleConfirmPayment = async (proof, split) => {
    setLoadingAction(true);
    
    await supabase.from('payment_proofs').update({ status: 'verified' }).eq('id', proof.id);
    await supabase.from('expense_splits').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', split.id);
    
    const { data: expense } = await supabase
      .from('expenses')
      .select('approval_status')
      .eq('id', split.expense_id)
      .single();
    if (expense && expense.approval_status === 'pending_approval') {
      await supabase
        .from('expenses')
        .update({ approval_status: 'approved' })
        .eq('id', split.expense_id);
    }
    
    const { data: allSplits } = await supabase
      .from('expense_splits')
      .select('status')
      .eq('expense_id', split.expense_id);
    const allApproved = allSplits.every(s => s.status === 'approved');
    if (allApproved) {
      await supabase.from('expenses').update({ status: 'paid' }).eq('id', split.expense_id);
    }
    
    await supabase.from('notifications').insert({
      user_id: proof.submitted_by,
      title: '✅ Owner approved your proof!',
      message: `The owner has approved your payment proof for "${expenses.find(e => e.id === split.expense_id)?.title}". Your payment is now marked as paid.`,
      type: 'payment_confirmed',
      link_path: `/groups/${id}?type=${contextType}`,
      link_state: JSON.stringify({ type: contextType }),
      link_query: `openProof=${split.expense_id}&proofId=${proof.id}`,
    });
    
    setShowViewProofModal(false);
    showToast('Payment confirmed');
    setLoadingAction(false);
    fetchGroupAndData();
  };

  // Owner's own proof: the owner is the approver, so it is verified instantly
  // and their share becomes Paid. Returns true on success.
  const confirmOwnerPayment = async (expense) => {
    if (!proofForm.screenshot) { showToast('Please upload a screenshot', 'error'); return false; }
    setLoadingAction(true);

    let objectPath;
    try {
      objectPath = await uploadPaymentProof(proofForm.screenshot, currentUser.id, 'expenses', expense.id);
    } catch (uploadError) {
      showToast(`Upload failed: ${uploadError.message}`, 'error');
      setLoadingAction(false);
      return false;
    }

    const { data: insertedProof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: expense.id,
      submitted_by: currentUser.id,
      screenshot_url: objectPath,
      note: proofForm.note,
      status: 'verified',
    }).select().single();
    if (proofError) {
      showToast(`Failed to save proof: ${proofError.message}`, 'error');
      setLoadingAction(false);
      return false;
    }

    await supabase
      .from('expense_splits')
      .update({ status: 'approved', proof_id: insertedProof.id, updated_at: new Date().toISOString() })
      .eq('expense_id', expense.id)
      .eq('user_id', currentUser.id);

    const { data: splits } = await supabase.from('expense_splits').select('status, user_id').eq('expense_id', expense.id);
    if ((splits || []).length && splits.every(s => s.status === 'approved')) {
      await supabase.from('expenses').update({ status: 'paid' }).eq('id', expense.id);
    }

    const others = (splits || []).filter(s => s.user_id !== currentUser.id);
    if (others.length) {
      await supabase.from('notifications').insert(others.map(split => ({
        user_id: split.user_id,
        // The owner paid their OWN share (or the whole bill) — not the member's payment.
        title: '📸 Owner Paid Their Share',
        message: expense.paid_by === currentUser.id
          ? `${profile?.full_name || 'The owner'} paid the bill for "${expense.title}" and uploaded the receipt. Tap to view proof.`
          : `${profile?.full_name || 'The owner'} uploaded proof of paying their share for "${expense.title}". Tap to view proof.`,
        type: 'payment_confirmed',
        link_path: `/groups/${id}?type=${contextType}`,
        link_state: JSON.stringify({ type: contextType }),
        link_query: `openProof=${expense.id}&proofId=${insertedProof.id}`,
      })));
    }

    resetProofForm();
    setLoadingAction(false);
    fetchGroupAndData();
    return true;
  };

  const handleOwnerSubmitProof = async () => {
    if (!(await confirmOwnerPayment(selectedExpense))) return;
    setShowOwnerProofModal(false);
    setSelectedExpense(null);
    showToast('Payment confirmed and proof saved!');
  };

  // Single handler for rejecting a payment — used by BOTH the "Reject" button on the
  // Pending Approvals card and the "Reject Proof" button inside the proof modal.
  const handleRejectProof = async () => {
    const reason = rejectProofReason.trim();
    if (!reason) { showToast('Please provide a reason', 'error'); return; }

    const proof = selectedProof || null;
    // The split can be missing when the modal was opened from a notification — look it up.
    const split = selectedSplit
      || (proof ? (expenseSplits[proof.expense_id] || []).find(sp => sp.proof_id === proof.id || sp.user_id === proof.submitted_by) : null);
    if (!split) { showToast('Could not find this payment. Please refresh.', 'error'); return; }

    setLoadingAction(true);
    const expenseId = proof?.expense_id || split.expense_id;
    const expense = expenses.find(e => e.id === expenseId);
    const memberId = proof?.submitted_by || split.user_id;
    const ownerName = profile?.full_name || 'The owner';

    // 1) Send the member's share back to "unpaid" with the reason
    const { error: splitError } = await supabase.from('expense_splits').update({
      status: 'unpaid',
      rejection_reason: reason,
      proof_id: null,
      updated_at: new Date().toISOString(),
    }).eq('id', split.id);

    if (splitError) {
      showToast('Error rejecting payment', 'error');
      setLoadingAction(false);
      return;
    }

    // 2) Mark the proof itself as rejected (if the member attached one)
    const proofId = proof?.id || split.proof_id;
    if (proofId) {
      await supabase.from('payment_proofs').update({
        status: 'rejected',
        rejection_reason: reason,
      }).eq('id', proofId);
    }

    // 3) Expense goes back to pending since a share is unpaid again
    await supabase.from('expenses').update({ status: 'pending' }).eq('id', expenseId);

    // 4) Notify the member: tap → their rejected card in Pending Approvals so they
    // can resubmit (households open the Expenses screen; groups stay here)
    const proofLink = contextType === 'household'
      ? {
          link_path: '/expenses',
          link_query: `householdId=${id}&expenseId=${expenseId}${proofId ? `&proofId=${proofId}` : ''}`,
        }
      : {
          link_path: `/groups/${id}?type=${contextType}`,
          link_state: JSON.stringify({ type: contextType }),
          link_query: proofId ? `openProof=${expenseId}&proofId=${proofId}` : `expenseId=${expenseId}`,
        };
    const { error: notifError } = await supabase.from('notifications').insert({
      user_id: memberId,
      title: '❌ Payment Proof Rejected',
      message: `${ownerName} (owner) rejected your payment proof for "${expense?.title || 'an expense'}" (${formatMoney(split.share_amount)}). Reason: ${reason}. Please submit a new proof.`,
      type: 'payment_rejected',
      ...proofLink,
    });
    if (notifError) console.error('Failed to notify member of rejected proof:', notifError);

    closeRejectProofModal();
    showToast('Payment rejected — member notified');
    setLoadingAction(false);
    const newSplitsMap = await fetchExpenseSplits(expenses.map(e => e.id));
    setExpenseSplits(newSplitsMap);
    fetchGroupAndData();
  };

  const closeRejectProofModal = () => {
    setShowRejectProofModal(false);
    setRejectProofReason('');
    setSelectedProof(null);
    setSelectedSplit(null);
  };

  // ── Rename household / group ─────────────────────────────────────────────
  const nameTable = contextType === 'household' ? 'households' : 'groups';
  const nameColumn = contextType === 'household' ? 'household_id' : 'group_id';
  const trimmedRename = renameValue.trim();
  const renameInvalid =
    trimmedRename.length < 2 ? 'Name must be at least 2 characters'
    : trimmedRename === group?.name ? 'Enter a different name'
    : '';

  const openRename = () => {
    if (myPendingNameRequest) {
      showToast('Your rename request is still waiting for the owner', 'error');
      return;
    }
    if (!isAdmin && nameRequestsLeft === 0) {
      showToast('You used up your name change requests this month. Request again next month.', 'error');
      return;
    }
    setRenameValue(group?.name || '');
    setRenameStep('edit');
  };

  const closeRename = () => {
    if (renameLoading) return;
    setRenameStep(null);
    setRenameValue('');
  };

  const handleConfirmRename = async () => {
    if (renameInvalid) return;
    const newName = trimmedRename;
    const oldName = group.name;
    setRenameLoading(true);

    if (isAdmin) {
      const { error: updateError } = await supabase.from(nameTable).update({ name: newName }).eq('id', id);
      if (updateError) {
        showToast('Could not change the name. Please try again.', 'error');
        setRenameLoading(false);
        return;
      }
      // Keep the name shown on older expenses in sync (best effort)
      await supabase.from('expenses').update({ location: newName }).eq(nameColumn, id).eq('location', oldName);
      // Logged for the "Export My Data" name history (best effort)
      await supabase.from('name_change_requests').insert({
        [nameColumn]: id, requested_by: currentUser.id, old_name: oldName, new_name: newName,
        status: 'approved', resolved_by: currentUser.id, resolved_at: new Date().toISOString(),
      });

      const rows = members
        .filter(m => m.user_id !== currentUser.id)
        .map(m => ({
          user_id: m.user_id,
          title: `${contextLabel === 'household' ? 'Household' : 'Group'} renamed`,
          message: `${profile?.full_name} renamed "${oldName}" to "${newName}".`,
          type: 'name_changed',
          link_path: `/groups/${id}?type=${contextType}`,
          link_state: JSON.stringify({ type: contextType }),
        }));
      if (rows.length) await supabase.from('notifications').insert(rows);

      setGroup(g => ({ ...g, name: newName }));
      showToast(`${contextLabel === 'household' ? 'Household' : 'Group'} name changed`);
    } else {
      const { data: inserted, error: requestError } = await supabase.from('name_change_requests').insert({
        [nameColumn]: id,
        requested_by: currentUser.id,
        old_name: oldName,
        new_name: newName,
        status: 'pending',
      }).select('id').single();
      if (requestError) {
        const msg = requestError.message || '';
        showToast(
          msg.includes('NAME_CHANGE_LIMIT') ? 'You used up your name change requests this month. Request again next month.'
          : msg.includes('NAME_CHANGE_PENDING') ? 'Your rename request is still waiting for the owner.'
          : 'Could not send your request. Please try again.', 'error');
        setRenameLoading(false);
        return;
      }
      await supabase.from('notifications').insert({
        user_id: group.created_by,
        title: '✏️ Name change request',
        message: `${profile?.full_name} wants to rename "${oldName}" to "${newName}". Tap to review.`,
        type: 'approval_request',
        link_path: `/groups/${id}?type=${contextType}`,
        link_query: `nameRequest=${inserted.id}`,
        link_state: JSON.stringify({ type: contextType }),
      });
      const left = nameRequestsLeft - 1;
      showToast(`Request sent to the owner · ${left} request${left === 1 ? '' : 's'} left this month`);
    }

    setRenameLoading(false);
    setRenameStep(null);
    setRenameValue('');
    fetchGroupAndData();
  };

  const openApproveName = (req) => {
    setApproveNameReq(req);
    setApproveNamePassword('');
    setShowApproveNamePassword(false);
    setApproveNameError('');
  };

  const closeApproveName = () => {
    if (loadingAction) return;
    setApproveNameReq(null);
    setApproveNamePassword('');
    setApproveNameError('');
  };

  // Accounts without a password (Google etc.) type the current name instead
  const approveNameReady = canUsePassword
    ? approveNamePassword.length > 0
    : approveNamePassword.trim() === (group?.name || '');

  const handleVerifyAndApproveName = async () => {
    if (!approveNameReq || !approveNameReady) return;
    setApproveNameError('');
    if (canUsePassword) {
      setLoadingAction(true);
      const { error: authError } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: approveNamePassword });
      setLoadingAction(false);
      if (authError) { setApproveNameError('Incorrect password. Please try again.'); return; }
    }
    const req = approveNameReq;
    setApproveNameReq(null);
    setApproveNamePassword('');
    await handleApproveNameRequest(req);
  };

  const handleApproveNameRequest = async (req) => {
    setLoadingAction(true);
    const { error: updateError } = await supabase.from(nameTable).update({ name: req.new_name }).eq('id', id);
    if (updateError) {
      showToast('Could not change the name. Please try again.', 'error');
      setLoadingAction(false);
      return;
    }
    await supabase.from('name_change_requests')
      .update({ status: 'approved', resolved_by: currentUser.id, resolved_at: new Date().toISOString() })
      .eq('id', req.id);
    await supabase.from('expenses').update({ location: req.new_name }).eq(nameColumn, id).eq('location', group.name);

    const rows = members
      .filter(m => m.user_id !== currentUser.id)
      .map(m => m.user_id === req.requested_by
        ? {
            user_id: m.user_id,
            title: '✅ Name change approved',
            message: `The owner approved renaming "${req.old_name}" to "${req.new_name}".`,
            type: 'name_change_approved',
            link_path: `/groups/${id}?type=${contextType}`,
            link_state: JSON.stringify({ type: contextType }),
          }
        : {
            user_id: m.user_id,
            title: `${contextLabel === 'household' ? 'Household' : 'Group'} renamed`,
            message: `"${req.old_name}" is now called "${req.new_name}".`,
            type: 'name_changed',
            link_path: `/groups/${id}?type=${contextType}`,
            link_state: JSON.stringify({ type: contextType }),
          });
    if (rows.length) await supabase.from('notifications').insert(rows);

    setGroup(g => ({ ...g, name: req.new_name }));
    showToast('Name change approved');
    fetchGroupAndData();
    setLoadingAction(false);
  };

  const openRejectName = (req) => { setRejectNameReq(req); setRejectNameReason(''); };
  const closeRejectName = () => { if (!loadingAction) { setRejectNameReq(null); setRejectNameReason(''); } };

  const handleRejectNameRequest = async () => {
    const req = rejectNameReq;
    const reason = rejectNameReason.trim();
    if (!req || !reason) return;
    setLoadingAction(true);
    const { error: updateError } = await supabase.from('name_change_requests')
      .update({ status: 'rejected', rejection_reason: reason, resolved_by: currentUser.id, resolved_at: new Date().toISOString() })
      .eq('id', req.id);
    if (updateError) {
      showToast('Could not reject the request. Please try again.', 'error');
      setLoadingAction(false);
      return;
    }
    const link = { link_path: `/groups/${id}?type=${contextType}`, link_state: JSON.stringify({ type: contextType }) };
    const rows = [{
      user_id: req.requested_by,
      title: '❌ Name change rejected',
      message: `The owner rejected renaming "${req.old_name}" to "${req.new_name}". Reason: ${reason}`,
      type: 'name_change_rejected',
      link_query: `nameRejected=${req.id}`,
      ...link,
    }];
    const { data: used } = await supabase.rpc('name_requests_used_this_month', {
      p_household: contextType === 'household' ? id : null,
      p_group: contextType === 'household' ? null : id,
      p_user: req.requested_by,
    });
    if ((Number(used) || 0) >= NAME_REQUEST_LIMIT) {
      rows.push({
        user_id: req.requested_by,
        title: '🚫 No name change requests left',
        message: `You used up all your name change requests for "${group.name}" this month. You can request a name change again next month.`,
        type: 'name_change_rejected',
        ...link,
      });
    }
    await supabase.from('notifications').insert(rows);
    setRejectNameReq(null);
    setRejectNameReason('');
    showToast('Request rejected · the member was notified');
    fetchGroupAndData();
    setLoadingAction(false);
  };

  if (loading) {
    return (
      <div className="group-detail-screen">
        <div className="detail-header">
          <button aria-label="Back" className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
          <div className="detail-header-info"><span className="detail-group-name">Loading...</span></div>
        </div>
        <div className="loading-spinner">Loading group…</div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="group-detail-screen">
        <div className="detail-header">
          <button aria-label="Back" className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
          <div className="detail-header-info"><span className="detail-group-name">Error</span></div>
        </div>
        <div className="empty-state" style={{ padding: 40, textAlign: 'center' }}>
          <p>{error || 'Group not found'}</p>
          <button className="add-expense-btn" style={{ marginTop: 16, width: 'auto', padding: '8px 20px' }} onClick={fetchGroupAndData}>Retry</button>
          <button className="cancel-btn" style={{ marginTop: 8 }} onClick={() => navigate('/groups')}>Back to Groups</button>
        </div>
      </div>
    );
  }

  // Member's own main proofs that were rejected and not yet replaced: their
  // share is still unpaid and the newest proof they sent is the rejected one.
  // (Paying again from any screen — Expenses, here, Utilities — adds a newer
  // proof, which drops the expense from this list.)
  const rejectedToResubmit = isAdmin ? [] : expenses.flatMap((expense) => {
    const split = (expenseSplits[expense.id] || []).find(s => s.user_id === currentUser?.id);
    if (!split || split.status !== 'unpaid') return [];
    if (deletionStateOf(split, extras.refunds[expense.id])) return []; // being deleted — nothing to resubmit
    const proof = latestOwnProof(allPaymentProofs, expense.id, currentUser?.id);
    return proof?.status === 'rejected' ? [{ expense, split, proof }] : [];
  });

  const pendingRefundApprovals = isAdmin ? [] : expenses.flatMap((expense) => (
    (extras.refunds[expense.id] || [])
      .filter((refund) => refund.user_id === currentUser?.id && refund.status === 'sent')
      .map((refund) => ({
        refund,
        expense,
        split: (expenseSplits[expense.id] || []).find((item) => item.user_id === refund.user_id),
      }))
      .filter((item) => item.split)
  ));

  return (
    <div className="group-detail-screen">
      {/* Header */}
      <div className="detail-header">
        <button aria-label="Back" className="back-btn" onClick={() => navigate(-1)}><ArrowLeft size={24} /></button>
        <div className="detail-header-info">
          <div className="detail-name-row">
            <span className="detail-name-spacer" aria-hidden="true" />
            <h1 className="detail-group-name">{group.name}</h1>
            <button
              className="detail-rename-btn"
              onClick={openRename}
              title={isAdmin ? `Rename ${contextLabel}` : `Request a new ${contextLabel} name`}
              aria-label={`Rename ${contextLabel}`}
            >
              <Pencil size={12} />
            </button>
          </div>
          <p className="detail-group-type">{contextType === 'household' ? <><InlineIcon as={ICONS.household} /> Household</> : <><InlineIcon as={ICONS.trip} /> Trip Group</>}</p>
          {myPendingNameRequest && (
            <span className="detail-rename-pending"><InlineIcon as={ICONS.pending} /> Rename to “{myPendingNameRequest.new_name}” awaiting approval</span>
          )}
        </div>
        <div className={`detail-menu${menuOpen ? ' open' : ''}`} ref={menuRef}>
          <button
            className="icon-btn-sm detail-menu-trigger"
            onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label="Group actions"
          >
            <MoreVertical size={18} />
          </button>
          <div className="detail-menu-list">
            <button className="icon-btn-sm detail-menu-item" style={{ '--i': 0 }} title="Copy invite code" aria-label="Copy invite code"
              onClick={() => { handleCopyCode(); setMenuOpen(false); }}>
              <Copy size={16} />
            </button>
            <button className="icon-btn-sm detail-menu-item" style={{ '--i': 1 }} title="Share invite code" aria-label="Share invite code"
              onClick={() => { handleShare(); setMenuOpen(false); }}>
              <Share2 size={16} />
            </button>
            {isAdmin && (
              <button className="icon-btn-sm detail-menu-item detail-menu-delete" style={{ '--i': 2 }} title={`Delete ${contextLabel}`} aria-label={`Delete ${contextLabel}`}
                onClick={() => { setMenuOpen(false); setShowDeleteGroupModal(true); }}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="detail-members-section">
        <h3 className="section-title"><InlineIcon as={ICONS.members} size={20} /> Members ({members.length})</h3>
        {members.length === 0 ? (
          <p style={{ fontSize: 12, color: '#9E8FCC', margin: 0 }}>No members found.</p>
        ) : (
          <div className="members-avatar-row">
            {members.map(member => (
              <button
                key={member.user_id}
                type="button"
                className={`member-avatar-tooltip member-avatar-clickable members-avatar-chip${member.role === 'owner' ? ' is-owner' : ''}`}
                onClick={() => { setPaymentCardMember(member); setShowPaymentCard(true); }}
                title={`${member.profiles?.full_name || 'Member'}${member.role === 'owner' ? ' (Owner)' : ''}`}
                aria-label={`${member.profiles?.full_name || 'Member'}${member.role === 'owner' ? ', owner' : ''} — view details`}
              >
                {getMemberAvatar(member)}
              </button>
            ))}
          </div>
        )}
      </div>

      {!isAdmin && (pendingRefundApprovals.length + rejectedToResubmit.length) > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title"><InlineIcon as={ICONS.pending} /> Pending Approvals ({pendingRefundApprovals.length + rejectedToResubmit.length})</h3>
          <div className="pa-list">
            {/* Rejected payment proofs the member still has to resubmit */}
            {rejectedToResubmit.map(({ expense, split, proof }) => (
              <div
                className={`pa-card ${highlightedApprovalSplitId === split.id ? 'notif-highlight' : ''}`}
                id={`proof-rejected-${split.id}`}
                key={`rejected-${proof.id}`}
              >
                <div className="pa-top">
                  <div className="pa-icon pa-icon-rejected"><Icon as={ICONS.rejected} /></div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">{expense.title}</span>
                      <span className="pa-amount">{formatMoney(split.share_amount)}</span>
                    </div>
                    <div className="pa-meta">
                      Your proof was rejected{proof.rejection_reason ? `: ${proof.rejection_reason}` : ''}
                    </div>
                    <span className="pa-tag pa-tag-rejected">Resubmit needed</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-reject" onClick={() => openUploadProof(expense)}>
                    <Camera size={14} /> Resubmit
                  </button>
                  <button className="pa-btn pa-btn-approve" style={{ background: 'white', color: '#3B2AAB', borderColor: '#E0D9FF' }} onClick={() => openProofModal(proof, split)}>
                    <Eye size={14} /> View proof
                  </button>
                </div>
              </div>
            ))}
            {pendingRefundApprovals.map(({ refund, expense, split }) => (
              <div
                className={`pa-card ${highlightedRefundId === refund.id ? 'notif-highlight' : ''}`}
                id={`refund-approval-${refund.id}`}
                key={`refund-${refund.id}`}
              >
                <div className="pa-top">
                  <div className="pa-icon pa-icon-payment"><Icon as={ICONS.refund} /></div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">{expense.title}</span>
                      <span className="pa-amount">{formatMoney(refund.amount)}</span>
                    </div>
                    <div className="pa-meta">
                      {refund.refund_type === 'overpayment' ? 'Overpayment refund' : 'Deletion refund'} from the admin
                    </div>
                    <span className="pa-tag pa-tag-payment">Refund proof</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-proof" onClick={() => setProofsFor({ expense, split })}>
                    <Eye size={14} /> Review refund
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Approvals — payment proofs are reviewed from their proof modal. */}
      {isAdmin && (pendingExpenseApprovals.length + pendingApprovals.length + nameRequests.length) > 0 && (
        <div className="detail-pending-section">
          <h3 className="section-title">
            <InlineIcon as={ICONS.pending} /> Pending Approvals ({pendingExpenseApprovals.length + pendingApprovals.length + nameRequests.length})
          </h3>

          <div className="pa-list">
            {/* Rename requests from members */}
            {nameRequests.map(req => (
              <div
                key={`name-${req.id}`}
                id={`name-request-${req.id}`}
                className={`pa-card ${highlightedNameRequestId === req.id ? 'notif-highlight' : ''}`}
              >
                <div className="pa-top">
                  <div className="pa-icon pa-icon-name"><Icon as={ICONS.edit} /></div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">Rename {contextLabel}</span>
                    </div>
                    <div className="pa-meta">{req.profiles?.full_name} wants to change “{req.old_name}” to “{req.new_name}”</div>
                    <span className="pa-tag pa-tag-name">Name change</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-approve" disabled={loadingAction} onClick={() => openApproveName(req)}>
                    <Check size={14} /> Approve
                  </button>
                  <button className="pa-btn pa-btn-reject" disabled={loadingAction} onClick={() => openRejectName(req)}>
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            ))}

            {/* New expenses waiting for approval */}
            {pendingExpenseApprovals.map(expense => (
              <div
                key={`exp-${expense.id}`}
                id={`expense-${expense.id}`}
                className={`pa-card ${highlightedExpenseId === expense.id ? 'notif-highlight' : ''}`}
              >
                <div
                  className="pa-top pa-top-tap"
                  role="button"
                  tabIndex={0}
                  onClick={() => setReviewExpense(expense)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setReviewExpense(expense); }}
                >
                  <div className="pa-icon pa-icon-expense"><CategoryIcon category={expense.category} tile={false} /></div>
                  <div className="pa-info">
                    <div className="pa-title-row">
                      <span className="pa-title">{expense.title}</span>
                      <span className="pa-amount">{formatMoney(expense.amount)}</span>
                    </div>
                    <div className="pa-meta">by {expense.profiles?.full_name} · {formatDate(expense.expense_date)}{expense.due_date ? ` · Due ${fmtDate(expense.due_date)}` : ''}</div>
                    <span className="pa-tag pa-tag-expense">New expense</span>
                  </div>
                </div>
                <div className="pa-actions">
                  <button className="pa-btn pa-btn-proof" onClick={() => setReviewExpense(expense)}>
                    <Eye size={14} /> Review details
                  </button>
                </div>
              </div>
            ))}

            {/* Payment proofs waiting for approval */}
            {pendingApprovals.map(split => {
              const expense = expenses.find(e => e.id === split.expense_id);
              const proof = allPaymentProofs.find(p => p.id === split.proof_id)
                || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id && p.status === 'pending_verification');
              const pendingFollowup = (extras.followups[split.expense_id] || []).find(f => f.user_id === split.user_id && f.status === 'pending_verification');
              if (pendingFollowup) {
                return (
                  <div key={`pay-${split.id}`} className="pa-card">
                    <div className="pa-top">
                      <div className="pa-icon pa-icon-payment"><Icon as={ICONS.proof} /></div>
                      <div className="pa-info">
                        <div className="pa-title-row">
                          <span className="pa-title">{expense?.title}</span>
                          <span className="pa-amount">{formatMoney(pendingFollowup.amount)}</span>
                        </div>
                        <div className="pa-meta">{split.profiles?.full_name}'s follow-up payment</div>
                        <span className="pa-tag pa-tag-payment">Follow-up proof</span>
                      </div>
                    </div>
                    <div className="pa-actions">
                      <button className="pa-btn pa-btn-proof" onClick={() => expense && setProofsFor({ expense, split })}>
                        <Eye size={14} /> Review
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={`pay-${split.id}`}
                  id={`proof-approval-${split.id}`}
                  className={`pa-card ${highlightedApprovalSplitId === split.id ? 'notif-highlight' : ''}`}
                >
                  <div className="pa-top">
                    <div className="pa-icon pa-icon-payment"><Icon as={ICONS.proof} /></div>
                    <div className="pa-info">
                      <div className="pa-title-row">
                        <span className="pa-title">{expense?.title}</span>
                        <span className="pa-amount">{formatMoney(split.share_amount)}</span>
                      </div>
                      <div className="pa-meta">{split.profiles?.full_name}'s share</div>
                      <span className="pa-tag pa-tag-payment">Payment proof</span>
                    </div>
                  </div>
                  <div className="pa-actions">
                    {proof && (
                      <button className="pa-btn pa-btn-proof" onClick={() => openProofModal(proof, split)}>
                        <Eye size={14} /> View Proof
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expenses List */}
      <div className="detail-expenses-section">
        <h3 className="section-title"><InlineIcon as={ICONS.list} size={20} /> Expenses ({expenses.length})</h3>
        {(() => {
          if (expenses.length === 0) {
            return <div className="empty-state">No expenses yet. Tap + to add one!</div>;
          }

          // Same search rule as ExpensesScreen (title contains, case-insensitive);
          // status comes from the splits. A notification jump shows everything so
          // its target card is never filtered out.
          const notifTargetExpenseId = highlightExpenseId
            || Object.values(extras.refunds).flat().find(r => r.id === highlightRefundId)?.expense_id
            || null;
          const jumping = Boolean(notifTargetExpenseId);
          const bucketed = expenses.map(expense => ({ expense, bucket: paymentBucketOf(expenseSplits[expense.id] || []) }));
          const counts = { all: bucketed.length, unpaid: 0, partial: 0, paid: 0 };
          bucketed.forEach(({ bucket }) => { counts[bucket] += 1; });
          const showSearch = expenses.length > 8;
          const query = showSearch && !jumping ? expenseSearch.trim().toLowerCase() : '';
          const activeFilter = jumping ? 'all' : expenseFilter;
          const visible = bucketed
            .filter(({ bucket }) => activeFilter === 'all' || bucket === activeFilter)
            .filter(({ expense }) => !query || expense.title?.toLowerCase().includes(query))
            .map(({ expense }) => expense)
            // Expenses I'm part of (I have a share) first; otherwise keep the order
            .map((expense, index) => ({ expense, index, mine: (expenseSplits[expense.id] || []).some(s => s.user_id === currentUser?.id) }))
            .sort((a, b) => (b.mine - a.mine) || (a.index - b.index))
            .map(({ expense }) => expense);

          return (
            <>
              <div className="detail-filter-bar" role="toolbar" aria-label="Filter expenses by payment status">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'unpaid', label: 'Unpaid' },
                  { key: 'partial', label: 'Partial' },
                  { key: 'paid', label: 'Fully paid' },
                ].map(f => (
                  <button
                    key={f.key}
                    type="button"
                    className="detail-filter-chip"
                    aria-pressed={activeFilter === f.key}
                    onClick={() => { clearNotifParams(); setExpenseFilter(f.key); }}
                  >
                    {f.label} <span className="detail-filter-count">{counts[f.key]}</span>
                  </button>
                ))}
              </div>

              {showSearch && (
                <div className="detail-expense-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Search expenses"
                    aria-label="Search expenses"
                    value={expenseSearch}
                    onChange={e => { clearNotifParams(); setExpenseSearch(e.target.value); }}
                  />
                </div>
              )}

              {visible.length === 0 && (
                <div className="empty-state">
                  {query ? `No expenses match "${expenseSearch.trim()}".` : 'No expenses in this filter.'}
                </div>
              )}

              <MonthGroups
                items={visible}
                openFor={notifTargetExpenseId}
                expandAll={!!query || activeFilter !== 'all'}
                renderItem={expense => {
                const splits = expenseSplits[expense.id] || [];
                const badge = getStatusBadge(expense, splits);
                const isOwner = isAdmin;
                const ownerSplit = splits.find(s => s.user_id === group?.created_by);
                const ownerVerifiedProof = allPaymentProofs.find(p => p.expense_id === expense.id && p.submitted_by === group?.created_by && p.status === 'verified');
                const myRejectedProof = allPaymentProofs.find(p => p.expense_id === expense.id && p.submitted_by === currentUser?.id && p.status === 'rejected');
                const paidCount = splits.filter(s => s.status === 'approved').length;
                const progress = splits.length ? Math.round((paidCount / splits.length) * 100) : 0;
                const open = expandedExpenseIds.has(expense.id) || expense.id === notifTargetExpenseId;
                const bodyId = `expense-body-${expense.id}`;

                return (
                  <div
                    key={expense.id}
                    id={`expense-${expense.id}`}
                    className={`expense-item-detail expense-collapsible ${highlightedExpenseId === expense.id ? 'notif-highlight' : ''}`}
                  >
                    <button
                      type="button"
                      className="expense-head"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => toggleExpense(expense.id)}
                    >
                      <span className="expense-icon" style={{ background: CATEGORY_COLORS[expense.category] || '#3B2AAB' }}>
                        <CategoryIcon category={expense.category} tile={false} />
                      </span>
                      <span className="expense-head-info">
                        <span className="expense-head-top">
                          <span className="expense-title">{expense.title}</span>
                          <span className="expense-amount">{formatMoney(expense.amount)}</span>
                        </span>
                        <span className="expense-head-progress">
                          <span className="expense-progress-text">{paidCount}/{splits.length} paid</span>
                          <span
                            className="expense-progress-track"
                            role="progressbar"
                            aria-label={`${paidCount} of ${splits.length} members paid`}
                            aria-valuemin={0}
                            aria-valuemax={splits.length}
                            aria-valuenow={paidCount}
                          >
                            <span className="expense-progress-fill" style={{ width: `${progress}%` }} />
                          </span>
                        </span>
                      </span>
                      <ChevronDown size={18} className={`expense-chevron${open ? ' open' : ''}`} aria-hidden="true" />
                    </button>

                    {open && (
                      <div id={bodyId} className="expense-body">
                        <div className="expense-body-top">
                          <div className="expense-meta">
                            {formatDate(expense.expense_date)}{expense.location ? ` • ${expense.location}` : ''}{expense.due_date ? ` • Due ${fmtDate(expense.due_date)}` : ''}
                          </div>
                          <div className="expense-body-actions">
                            <span className="expense-badge" style={{ background: badge.bg, color: badge.color, width: 'auto' }}>
                              {badge.label}
                            </span>
                            {isAdmin && (
                              <>
                                <button className="icon-btn" onClick={() => setEditExpense(expense)} title="Edit expense" aria-label="Edit expense" style={{ color: '#3B2AAB' }}>
                                  <Pencil size={14} />
                                </button>
                                <button className="icon-btn delete" onClick={() => { setSelectedExpense(expense); setShowDeleteModal(true); }} title="Delete expense" aria-label="Delete expense">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="member-splits-list">
                          {splits.map(split => {
                            const member = members.find(m => m.user_id === split.user_id);
                            const proof = allPaymentProofs.find(p => p.id === split.proof_id)
                              || allPaymentProofs.find(p => p.expense_id === split.expense_id && p.submitted_by === split.user_id);
                            // The owner can't refund themselves: an overpaid owner share
                            // (e.g. after lowering the amount) just counts as Paid.
                            const ownerSelf = split.user_id === group?.created_by;
                            // Deletion refund sent / confirmed: not "Unpaid" — the expense is being deleted.
                            const deletionState = deletionStateOf(split, extras.refunds[expense.id]);
                            const statusMeta = deletionState
                              ? DELETION_STATUS_META[deletionState]
                              : ownerSelf && overpaidOf(split) > 0 && split.status === 'approved'
                                ? splitStatusMeta({ ...split, paid_amount: split.share_amount })
                                : splitStatusMeta(split);
                            const mine = split.user_id === currentUser?.id;
                            const due = followupDueOf(split);
                            const over = ownerSelf ? 0 : overpaidOf(split);
                            const splitRefunds = (extras.refunds[expense.id] || []).filter(r => r.user_id === split.user_id);
                            const latestRefund = splitRefunds
                              .slice()
                              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
                            const rejectedRefund = latestRefund?.status === 'rejected' ? latestRefund : null;
                            const refundPending = latestRefund?.status === 'sent';
                            const myUnconfirmed = mine && splitRefunds.some(refund => refund.status === 'sent');
                            const showPayLine = (isOwner || mine) && (
                              split.status === 'partly_paid' || over > 0
                              || (extras.followups[expense.id] || []).some(f => f.user_id === split.user_id)
                              || splitRefunds.length > 0);
                            const unpaid = split.status === 'unpaid' && !toNum(split.paid_amount) && !deletionState;
                            const proofCount = proofCountFor(split);
                            // Upload is offered where the old "You owe" / "Submit as Owner" boxes appeared.
                            const canUpload = mine && unpaid && (isOwner ? !ownerVerifiedProof : expense.status !== 'paid');
                            const reminded = remindedSplitIds.has(split.id);
                            // Members see the refund proofs the admin sent them (approved,
                            // rejected or pending) on the admin's row, so they can always
                            // check what was actually sent.
                            const mySplitHere = !isOwner && split.user_id === group?.created_by
                              ? splits.find(s => s.user_id === currentUser?.id)
                              : null;
                            const refundsToMe = mySplitHere
                              ? (extras.refunds[expense.id] || []).filter(r => r.user_id === currentUser?.id)
                              : [];

                            return (
                              <React.Fragment key={split.id}>
                                <div className="member-split-row member-split-row-v2">
                                  <div className="member-split-person">
                                    <div className="member-avatar-tooltip" style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}>
                                      {getMemberAvatar(member || { profiles: split.profiles })}
                                    </div>
                                    <span className="member-split-name">
                                      {split.profiles?.full_name || 'Member'}{mine && <span className="member-split-you"> (you)</span>}
                                      {!member && <span className="former-member-pill">Former member</span>}
                                    </span>
                                  </div>
                                  <span className="member-split-amount">{formatMoney(split.share_amount)}</span>
                                  <span className="member-split-status" style={{ background: statusMeta.bg, color: statusMeta.color }}>
                                    <StatusIcon status={statusMeta.label} />{statusMeta.label}
                                  </span>
                                  <div className="member-split-action">
                                    {unpaid ? (
                                      canUpload ? (
                                        <button className="split-action-chip split-action-primary" onClick={() => openUploadProof(expense)}>
                                          {myRejectedProof && !isOwner ? 'Re-upload proof' : 'Upload proof'}
                                        </button>
                                      ) : isOwner && !mine ? (
                                        <button className="split-action-chip" disabled={reminded} onClick={() => handleRemind(expense, split)}>
                                          {reminded ? <><InlineIcon as={ICONS.check} size={12} />Reminded</> : <><InlineIcon as={ICONS.bell} size={12} />Remind</>}
                                        </button>
                                      ) : null
                                    ) : (
                                      <>
                                        {isOwner && split.status === 'pending_verification' && !proof && (
                                          <button className="approve-btn" aria-label={`Approve ${split.profiles?.full_name || 'member'}`} onClick={() => handleApproveSplit(split)}>✓</button>
                                        )}
                                        {proofCount > 0 && (
                                          <button
                                            className="split-action-chip"
                                            aria-label={`View ${split.profiles?.full_name || 'member'} proofs (${proofCount})`}
                                            onClick={() => setProofsFor({ expense, split })}
                                          >
                                            Proofs · {proofCount}
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {refundsToMe.length > 0 && (
                                      <button
                                        className="split-action-chip"
                                        aria-label={`View refunds ${split.profiles?.full_name || 'the admin'} sent you (${refundsToMe.length})`}
                                        onClick={() => setProofsFor({ expense, split: mySplitHere, only: 'refunds' })}
                                      >
                                        <InlineIcon as={ICONS.refund} /> Refunds · {refundsToMe.length}
                                      </button>
                                    )}
                                  </div>
                                  {mine && unpaid && myRejectedProof && (
                                    <p className="member-split-note"><InlineIcon as={ICONS.rejected} /> Your proof was rejected{myRejectedProof.rejection_reason ? `: ${myRejectedProof.rejection_reason}` : ''}</p>
                                  )}
                                </div>
                                {showPayLine && (
                                  <div
                                    id={isOwner && splitRefunds.length ? `refund-payment-${expense.id}-${split.user_id}` : undefined}
                                    className={`xm-pay-line${splitRefunds.some(refund => refund.id === highlightedRefundId) ? ' notif-highlight' : ''}`}
                                    style={{ marginBottom: 6 }}
                                  >
                                    <span className="xm-pay-line-text">Paid {formatMoney(toNum(split.paid_amount))} of {formatMoney(toNum(split.share_amount))}</span>
                                    {due > 0 && <p className="xm-pay-line-text" style={{ color: '#c05621', fontWeight: 600 }}>{mine ? `Follow-up payment due: ${formatMoney(due)}` : `Needs to pay ${formatMoney(due)} more`}</p>}
                                    {/* Admin: skipped while the "Refund overpayment ₱X" button is shown — it already says it */}
                                    {over > 0 && !(isOwner && !mine && !rejectedRefund && !refundPending) && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}>{mine ? `You overpaid ${formatMoney(over)} — the admin will refund you` : `Overpaid ${formatMoney(over)} — refund needed`}</p>}
                                    {myUnconfirmed && <p className="xm-pay-line-text" style={{ color: '#2B6CB0', fontWeight: 600 }}><InlineIcon as={ICONS.refund} /> A refund was sent — please confirm once received</p>}
                                    {((mine && due > 0) || (mine && !isOwner && over > 0 && !refundPending) || (isOwner && !mine && (rejectedRefund || (over > 0 && !refundPending) || splitRefunds.length > 0)) || myUnconfirmed) && (
                                      <div className="xm-pay-line-actions">
                                        {mine && due > 0 && (
                                          <button className="xm-btn-sm" onClick={() => setFollowupFor({ expense, split })}>Follow-up Payment</button>
                                        )}
                                        {mine && !isOwner && over > 0 && !refundPending && (
                                          <RequestRefundButton
                                            expense={expense}
                                            amount={over}
                                            adminId={group?.created_by}
                                            memberName={profile?.full_name}
                                            link={{ link_path: `/groups/${id}?type=${contextType}`, link_state: JSON.stringify({ type: contextType }) }}
                                            showToast={showToast}
                                          />
                                        )}
                                        {isOwner && !mine && rejectedRefund && (
                                          <button
                                            className="xm-btn-sm"
                                            onClick={() => setRefundFor({
                                              expense,
                                              split,
                                              refundType: rejectedRefund.refund_type === 'overpayment' ? 'overpayment' : 'expense_deletion',
                                              resending: true,
                                              initialAmount: rejectedRefund.amount,
                                            })}
                                          >{rejectedRefund.refund_type === 'overpayment' ? <><InlineIcon as={ICONS.refund} /> Resend refund proof</> : <><InlineIcon as={ICONS.delete} /> Resend refund proof for deletion</>}</button>
                                        )}
                                        {isOwner && !mine && over > 0 && !rejectedRefund && !refundPending && (
                                          <button className="xm-btn-sm" onClick={() => setRefundFor({ expense, split, refundType: 'overpayment' })}>Refund overpayment {formatMoney(over)}</button>
                                        )}
                                        {isOwner && !mine && splitRefunds.length > 0 && (
                                          <button className="xm-btn-sm xm-soft" onClick={() => setProofsFor({ expense, split, only: 'refunds' })}>
                                            Refund proofs · {splitRefunds.length}
                                          </button>
                                        )}
                                        {myUnconfirmed && (
                                          <button className="xm-btn-sm xm-soft" onClick={() => setProofsFor({ expense, split })}>Confirm refund</button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>

                        {/* Owner isn't part of this split but hasn't confirmed paying the biller yet */}
                        {isOwner && !ownerSplit && !ownerVerifiedProof && (
                          <div className="owe-row" style={{ marginTop: 8 }}>
                            <button className="pay-btn-small" onClick={() => openUploadProof(expense)}>
                              Submit Payment Proof (as Owner)
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
                }}
              />
            </>
          );
        })()}
      </div>

      {/* FAB */}
      <button aria-label="Add" className="fab-detail" onClick={() => { setShowAddExpense(true); }}><Plus size={24} /></button>

      {/* Add Expense Modal */}
      {showAddExpense && group && (
        <AddExpenseModal
          context={{ type: contextType === 'household' ? 'household' : 'group', id, name: group.name, ownerId: group.created_by }}
          members={members}
          categories={ALL_EXPENSE_CATEGORIES}
          currentUser={currentUser}
          profile={profile}
          showToast={showToast}
          onOpenExpense={openExistingExpense}
          onAdded={handleExpenseAdded}
          onClose={() => setShowAddExpense(false)}
        />
      )}

      {/* Member Payment Proof Modal */}
      {showPaymentProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Submit Payment Proof</h2>
              <button aria-label="Close" className="modal-close" onClick={() => { setShowPaymentProofModal(false); resetProofForm(); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" /> : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>No screenshot selected yet</div>}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}</button>
              {selectedExpense?.paid_by !== currentUser?.id && <button className="pom-trigger-btn" onClick={() => openPayOnline('proof')}><InlineIcon as={ICONS.payment} /> Pay Online</button>}
              <textarea placeholder="Optional note (e.g. GCash ref #)" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <button className="add-expense-btn" onClick={() => handleSubmitProof(false)} disabled={loadingAction}>{loadingAction ? 'Submitting...' : 'Submit Proof'}</button>
              <button className="cancel-btn" onClick={() => { setShowPaymentProofModal(false); resetProofForm(); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Resubmit Modal */}
      {showResubmitModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Resubmit Payment Proof</h2>
              <button aria-label="Close" className="modal-close" onClick={() => { setShowResubmitModal(false); resetProofForm(); }}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <div style={{ background: '#FFF3CD', borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontSize: 12, color: '#856404', textAlign: 'center' }}><InlineIcon as={ICONS.warning} /> Your previous proof was rejected. Please upload a new, clear screenshot.</div>
              {proofForm.screenshotPreview ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" /> : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>Upload a new screenshot</div>}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload New Screenshot'}</button>
              {selectedExpense?.paid_by !== currentUser?.id && <button className="pom-trigger-btn" onClick={() => openPayOnline('resubmit')}><InlineIcon as={ICONS.payment} /> Pay Online</button>}
              <textarea placeholder="Optional note (e.g. GCash ref #)" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <button className="add-expense-btn" onClick={() => handleSubmitProof(true)} disabled={loadingAction}>{loadingAction ? 'Submitting...' : 'Resubmit Proof'}</button>
              <button className="cancel-btn" onClick={() => { setShowResubmitModal(false); resetProofForm(); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Owner Proof Modal */}
      {showOwnerProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Confirm Payment</h2>
              <button aria-label="Close" className="modal-close" onClick={() => setShowOwnerProofModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              {proofForm.screenshotPreview ? <img src={proofForm.screenshotPreview} className="proof-preview" alt="proof" /> : <div style={{ textAlign: 'center', padding: '20px 0', color: '#9E8FCC', fontSize: 13 }}>No screenshot selected yet</div>}
              <button className="upload-proof-btn" onClick={() => proofInputRef.current.click()}><Camera size={16} /> {proofForm.screenshotPreview ? 'Change Screenshot' : 'Upload Screenshot'}</button>
              <div className="pom-quick-pay-row">
                <button className="pom-trigger-btn" style={{ flex: 1, margin: 0 }} onClick={() => openPaymentApp('gcash')}><InlineIcon as={ICONS.wallet} /> GCash</button>
                <button className="pom-trigger-btn" style={{ flex: 1, margin: 0 }} onClick={() => openPaymentApp('paymaya')}><InlineIcon as={ICONS.wallet} /> PayMaya</button>
              </div>
              <p className="pom-owner-hint">Pay your biller directly, then upload the screenshot above.</p>
              <textarea placeholder="Optional note" value={proofForm.note} onChange={e => setProofForm({ ...proofForm, note: e.target.value })} className="detail-textarea" rows={3} />
              <div style={{ background: '#F0EDFF', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#3B2AAB', textAlign: 'center' }}><InlineIcon as={ICONS.notify} /> {isSolo ? 'This will mark the expense as paid.' : 'This marks your share as paid. The expense is fully paid once every member’s share is approved.'}</div>
              <button className="add-expense-btn" onClick={handleOwnerSubmitProof} disabled={loadingAction}>{loadingAction ? 'Confirming...' : 'Confirm Payment'}</button>
              <button className="cancel-btn" onClick={() => setShowOwnerProofModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* View Proof Modal (shared with ExpensesScreen) */}
      {showViewProofModal && selectedProof && (
        <ProofViewModal
          proof={selectedProof}
          submitterName={selectedSplit?.profiles?.full_name}
          loading={loadingAction}
          canReview={isAdmin && selectedProof.status === 'pending_verification' && selectedProof.submitted_by !== currentUser?.id}
          canResubmit={!isAdmin && selectedProof.status === 'rejected' && selectedProof.submitted_by === currentUser?.id}
          onConfirm={() => handleConfirmPayment(selectedProof, selectedSplit)}
          onReject={() => { setShowViewProofModal(false); setShowRejectProofModal(true); }}
          onResubmit={() => {
            setShowViewProofModal(false);
            const expense = expenses.find(e => e.id === selectedProof.expense_id);
            if (expense) { setSelectedExpense(expense); resetProofForm(); setShowResubmitModal(true); }
          }}
          onClose={() => setShowViewProofModal(false)}
        />
      )}

      {/* Review a member's new expense before approving / rejecting it */}
      {reviewExpense && isAdmin && (
        <ReviewExpenseModal
          expense={reviewExpense}
          members={members}
          icon={<CategoryIcon category={reviewExpense.category} tile={false} />}
          color={CATEGORY_COLORS[reviewExpense.category] || '#3B2AAB'}
          loading={loadingAction}
          onApprove={async (exp) => { await handleApproveExpense(exp); setReviewExpense(null); }}
          onReject={(exp) => {
            setReviewExpense(null);
            setSelectedPendingExpense(exp);
            setShowRejectExpenseModal(true);
          }}
          onClose={() => setReviewExpense(null)}
        />
      )}

      {/* Delete Expense (shows what is being deleted; blocked until paid members are refunded) */}
      {showDeleteModal && selectedExpense && (
        <DeleteExpenseModal
          expense={selectedExpense}
          splits={expenseSplits[selectedExpense.id] || []}
          currentUserId={currentUser?.id}
          pendingRefunds={(extras.refunds[selectedExpense.id] || []).filter(refund => refund.status === 'sent')}
          icon={<CategoryIcon category={selectedExpense.category} tile={false} />}
          color={CATEGORY_COLORS[selectedExpense.category] || '#3B2AAB'}
          loading={xmLoading}
          onConfirm={handleDeleteExpense}
          onClose={() => { setShowDeleteModal(false); setSelectedExpense(null); }}
          onRefund={(split) => { setShowDeleteModal(false); setRefundFor({ expense: selectedExpense, split, refundType: 'expense_deletion' }); }}
        />
      )}

      {/* Reject Payment Modal (shared by the approvals card and the proof modal) */}
      {showRejectProofModal && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Reject Payment</h2>
              <button aria-label="Close" className="modal-close" onClick={closeRejectProofModal}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll">
              <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
                Rejecting <strong>{(selectedSplit?.profiles?.full_name) || 'this member'}</strong>'s payment for
                {' '}"<strong>{expenses.find(e => e.id === (selectedProof?.expense_id || selectedSplit?.expense_id))?.title || 'this expense'}</strong>"
                {' '}will notify them with your reason so they can submit a new proof.
              </p>
              <textarea
                placeholder="Reason for rejection *"
                value={rejectProofReason}
                onChange={e => setRejectProofReason(e.target.value)}
                className="detail-textarea"
                rows={3}
              />
              <button className="delete-confirm-btn" onClick={handleRejectProof} disabled={loadingAction}>
                {loadingAction ? 'Rejecting...' : 'Reject & Notify Member'}
              </button>
              <button className="cancel-btn" onClick={closeRejectProofModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Modal — needs the owner's password first */}
      {showDeleteGroupModal && (
        <div className="modal-overlay-detail" onClick={closeDeleteGroupModal}>
          <div className="rn-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="rn-icon"><Lock size={22} /></div>
            <h2 className="rn-title">Delete {contextLabel}?</h2>
            <p className="rn-sub">
              You’re about to delete <strong>{group.name}</strong>. This can’t be undone.
            </p>
            <div className="rn-note rn-note-danger">
              All expenses and members in this {contextLabel} will be removed for everyone.
            </div>
            <label className="rn-label" htmlFor="dg-input">
              {canUsePassword ? 'Enter your password to confirm' : `Type “${group.name}” to confirm`}
            </label>
            <div className="rn-input-wrap">
              <input
                id="dg-input"
                className="rn-input"
                type={canUsePassword && !showDeletePassword ? 'password' : 'text'}
                autoFocus
                autoComplete={canUsePassword ? 'current-password' : 'off'}
                placeholder={canUsePassword ? 'Your password' : group.name}
                value={canUsePassword ? deletePassword : deleteTypedName}
                onChange={e => {
                  setDeleteError('');
                  if (canUsePassword) setDeletePassword(e.target.value);
                  else setDeleteTypedName(e.target.value);
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleDeleteGroup(); }}
              />
              {canUsePassword && (
                <button
                  type="button"
                  className="rn-eye"
                  onClick={() => setShowDeletePassword(v => !v)}
                  aria-label={showDeletePassword ? 'Hide password' : 'Show password'}
                >
                  {showDeletePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
            <div className="rn-meta">
              <span className="rn-error">{deleteError}</span>
            </div>
            <button className="rn-btn-primary rn-btn-danger" disabled={!deleteConfirmReady || loadingAction} onClick={handleDeleteGroup}>
              {loadingAction ? 'Verifying…' : `Delete ${contextLabel}`}
            </button>
            <button className="rn-btn-ghost" disabled={loadingAction} onClick={closeDeleteGroupModal}>Cancel</button>
          </div>
        </div>
      )}

      {/* Kick Member Modal */}
      {showKickMemberModal && selectedMember && contextType === 'household' && kickBlockers && (
        <RemoveMemberModal
          overlayClassName="modal-overlay-detail"
          householdId={id}
          householdName={group?.name}
          member={{ user_id: selectedMember.user_id, full_name: selectedMember.profiles?.full_name || 'This member' }}
          blockers={kickBlockers}
          busy={loadingAction}
          onGo={(path) => { closeKickMember(); navigate(path); }}
          onConfirm={handleKickMember}
          onClose={closeKickMember}
        />
      )}
      {showKickMemberModal && selectedMember && contextType !== 'household' && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={40} color="#e53e3e" /><h2>Remove Member?</h2>
            </div>
            <div className="modal-body-scroll">
              <p style={{ textAlign: 'center' }}>Remove <strong>{selectedMember.profiles?.full_name}</strong>?</p>
              <button className="delete-confirm-btn" onClick={handleKickMember} disabled={loadingAction}>{loadingAction ? 'Removing...' : 'Yes, Remove'}</button>
              <button className="cancel-btn" onClick={closeKickMember}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Expense Modal (shared with ExpensesScreen) */}
      {showRejectExpenseModal && selectedPendingExpense && (
        <RejectExpenseModal
          expense={selectedPendingExpense}
          loading={loadingAction}
          onConfirm={handleRejectExpense}
          onClose={() => { setShowRejectExpenseModal(false); setSelectedPendingExpense(null); }}
        />
      )}

      {/* Upload Proof After Adding Expense (member paid upfront) */}
      {showUploadAfterAdd && justAddedExpense && (
        <div className="modal-overlay-detail">
          <div className="modal-detail-card">
            <div className="modal-header">
              <h2>Upload Payment Proof</h2>
            </div>
            <div className="modal-body-scroll">
              <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
                You marked yourself as the payer for "<strong>{justAddedExpense.title}</strong>".{' '}
                {isAdmin
                  ? 'Upload a screenshot of your payment — as the owner, your share is marked Paid right away. You can also skip and upload it later from the expense card.'
                  : 'Please upload a screenshot proof of payment.'}
              </p>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={el => el && (el.id = 'afterAddProofInput')}
                onChange={e => {
                  const file = e.target.files[0];
                  if (file) setProofForm({ ...proofForm, screenshot: file, screenshotPreview: URL.createObjectURL(file) });
                }}
              />
              {proofForm.screenshotPreview && (
                <img src={proofForm.screenshotPreview} alt="Preview" className="proof-preview" />
              )}
              <button className="upload-proof-btn" onClick={() => document.getElementById('afterAddProofInput').click()}>
                <InlineIcon as={ICONS.proof} /> {proofForm.screenshot ? 'Change Screenshot' : 'Upload Screenshot'}
              </button>
              <button className="add-expense-btn" disabled={!proofForm.screenshot || loadingAction}
                onClick={async () => {
                  if (isAdmin) {
                    // Owner's proof needs no approval — verified instantly.
                    if (!(await confirmOwnerPayment(justAddedExpense))) return;
                    showToast('Expense added and your payment is confirmed!');
                    setShowUploadAfterAdd(false);
                    setJustAddedExpense(null);
                    return;
                  }
                  setLoadingAction(true);
                  let objectPath;
                  try {
                    objectPath = await uploadPaymentProof(
                      proofForm.screenshot,
                      currentUser.id,
                      'expenses',
                      justAddedExpense.id,
                    );
                  } catch (uploadError) {
                    showToast(`Upload failed: ${uploadError.message}`, 'error');
                    setLoadingAction(false);
                    return;
                  }
                  const { error: proofError } = await supabase.from('payment_proofs').insert({
                    expense_id: justAddedExpense.id,
                    submitted_by: currentUser.id,
                    screenshot_url: objectPath,
                    status: 'pending_verification',
                  });
                  if (proofError) {
                    showToast(`Failed to save proof: ${proofError.message}`, 'error');
                    setLoadingAction(false);
                    return;
                  }
                  showToast('Expense submitted with proof!');
                  setShowUploadAfterAdd(false);
                  setJustAddedExpense(null);
                  resetProofForm();
                  fetchGroupAndData();
                  setLoadingAction(false);
                }}>
                {loadingAction ? 'Submitting...' : isAdmin ? 'Confirm Payment' : 'Submit Expense + Proof'}
              </button>
              <button className="cancel-btn" onClick={() => {
                showToast(isAdmin
                  ? 'Expense added — your share stays Unpaid until you upload proof'
                  : 'Submitted for approval — upload your proof after the owner approves');
                setShowUploadAfterAdd(false);
                setJustAddedExpense(null);
                resetProofForm();
                fetchGroupAndData();
              }}>Skip for now</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input type="file" ref={proofInputRef} style={{ display: 'none' }} accept="image/*" onChange={e => { const file = e.target.files[0]; if (file) setProofForm({ ...proofForm, screenshot: file, screenshotPreview: URL.createObjectURL(file) }); }} />

      <PayOnlineModal
        show={showPayOnlineModal}
        onClose={() => {
          setShowPayOnlineModal(false);
          if (payOnlineOrigin === 'proof') setShowPaymentProofModal(true);
          if (payOnlineOrigin === 'resubmit') setShowResubmitModal(true);
        }}
        receiverId={group?.created_by}
        itemTitle={selectedExpense?.title}
        amount={selectedExpense?.members_split?.[currentUser?.id]}
        onProceed={handlePayOnlineProceed}
      />

      {/* Rename household / group — step 1: edit, step 2: confirm */}
      {renameStep && (
        <div className="modal-overlay-detail" onClick={closeRename}>
          <div className="rn-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            {renameStep === 'edit' ? (
              <>
                <div className="rn-icon"><Pencil size={22} /></div>
                <h2 className="rn-title">Rename {contextLabel}</h2>
                <p className="rn-sub">
                  {isAdmin
                    ? `Fix a typo or pick a new name. Everyone in the ${contextLabel} will see it.`
                    : `Suggest a new name. The owner needs to approve it before it changes.`}
                </p>
                {!isAdmin && (
                  <div className="rn-quota">
                    {nameRequestsLeft} of {NAME_REQUEST_LIMIT} requests left this month
                  </div>
                )}
                <label className="rn-label" htmlFor="rn-input">New name</label>
                <input
                  id="rn-input"
                  className="rn-input"
                  type="text"
                  autoFocus
                  maxLength={40}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !renameInvalid) setRenameStep('confirm'); }}
                  placeholder={`e.g. ${contextType === 'household' ? 'Win and K House' : 'Cebu Trip 2026'}`}
                />
                <div className="rn-meta">
                  <span className={renameValue && renameInvalid ? 'rn-error' : ''}>{renameValue ? renameInvalid : ''}</span>
                  <span>{renameValue.length}/40</span>
                </div>
                <button className="rn-btn-primary" disabled={!!renameInvalid} onClick={() => setRenameStep('confirm')}>
                  Continue
                </button>
                <button className="rn-btn-ghost" onClick={closeRename}>Cancel</button>
              </>
            ) : (
              <>
                <div className="rn-icon rn-icon-confirm"><AlertCircle size={24} /></div>
                <h2 className="rn-title">
                  {isAdmin ? `Change the ${contextLabel} name?` : 'Send name change request?'}
                </h2>
                <div className="rn-diff">
                  <div className="rn-diff-row">
                    <span className="rn-diff-label">Current</span>
                    <span className="rn-old">{group.name}</span>
                  </div>
                  <div className="rn-diff-row">
                    <span className="rn-diff-label">New</span>
                    <span className="rn-new">{trimmedRename}</span>
                  </div>
                </div>
                <div className={`rn-note ${isAdmin ? '' : 'rn-note-warn'}`}>
                  {isAdmin
                    ? `Are you sure? All members will be notified of the new ${contextLabel} name.`
                    : 'Are you sure? Your request goes to the owner, and the name only changes once they approve it.'}
                </div>
                <button className="rn-btn-primary" disabled={renameLoading} onClick={handleConfirmRename}>
                  {renameLoading ? 'Saving…' : isAdmin ? 'Yes, change name' : 'Yes, send request'}
                </button>
                <button className="rn-btn-ghost" disabled={renameLoading} onClick={() => setRenameStep('edit')}>
                  Go back
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Owner approves a rename — password (or typing the name) first */}
      {approveNameReq && (
        <div className="modal-overlay-detail" onClick={closeApproveName}>
          <div className="rn-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="rn-icon"><Lock size={22} /></div>
            <h2 className="rn-title">Approve name change?</h2>
            <p className="rn-sub">{approveNameReq.profiles?.full_name || 'A member'} asked to rename this {contextLabel}.</p>
            <div className="rn-diff" style={{ marginTop: 0 }}>
              <div className="rn-diff-row"><span className="rn-diff-label">Current</span><span className="rn-old">{approveNameReq.old_name}</span></div>
              <div className="rn-diff-row"><span className="rn-diff-label">New</span><span className="rn-new">{approveNameReq.new_name}</span></div>
            </div>
            <label className="rn-label" htmlFor="an-input">
              {canUsePassword ? 'Enter your password to confirm' : `Type “${group.name}” to confirm`}
            </label>
            <div className="rn-input-wrap">
              <input
                id="an-input"
                className="rn-input"
                type={canUsePassword && !showApproveNamePassword ? 'password' : 'text'}
                autoFocus
                autoComplete={canUsePassword ? 'current-password' : 'off'}
                placeholder={canUsePassword ? 'Your password' : group.name}
                value={approveNamePassword}
                onChange={e => { setApproveNameError(''); setApproveNamePassword(e.target.value); }}
                onKeyDown={e => { if (e.key === 'Enter') handleVerifyAndApproveName(); }}
              />
              {canUsePassword && (
                <button type="button" className="rn-eye" onClick={() => setShowApproveNamePassword(v => !v)}
                  aria-label={showApproveNamePassword ? 'Hide password' : 'Show password'}>
                  {showApproveNamePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
            <div className="rn-meta"><span className="rn-error">{approveNameError}</span></div>
            <button className="rn-btn-primary" disabled={!approveNameReady || loadingAction} onClick={handleVerifyAndApproveName}>
              {loadingAction ? 'Verifying…' : 'Approve & rename'}
            </button>
            <button className="rn-btn-ghost" disabled={loadingAction} onClick={closeApproveName}>Cancel</button>
          </div>
        </div>
      )}

      {/* Owner rejects a rename — a reason is required */}
      {rejectNameReq && (
        <div className="modal-overlay-detail" onClick={closeRejectName}>
          <div className="rn-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="rn-icon rn-icon-reject"><X size={24} /></div>
            <h2 className="rn-title">Reject name change?</h2>
            <p className="rn-sub">
              {rejectNameReq.profiles?.full_name || 'The member'} wants “{rejectNameReq.new_name}”. Tell them why — they’ll see your reason.
            </p>
            <label className="rn-label" htmlFor="rj-input">Reason</label>
            <textarea
              id="rj-input"
              className="rn-textarea"
              rows={3}
              maxLength={200}
              autoFocus
              placeholder="e.g. Let’s keep the current name for now"
              value={rejectNameReason}
              onChange={e => setRejectNameReason(e.target.value)}
            />
            <div className="rn-meta"><span /><span>{rejectNameReason.length}/200</span></div>
            <button className="rn-btn-primary rn-btn-danger" disabled={!rejectNameReason.trim() || loadingAction} onClick={handleRejectNameRequest}>
              {loadingAction ? 'Rejecting…' : 'Reject & notify member'}
            </button>
            <button className="rn-btn-ghost" disabled={loadingAction} onClick={closeRejectName}>Cancel</button>
          </div>
        </div>
      )}

      {/* Member: "your name change was rejected" (from the notification) */}
      {rejectedNameModal && (
        <div className="modal-overlay-detail" onClick={() => setRejectedNameModal(null)}>
          <div className="rn-card nr-card" role="dialog" aria-modal="true" aria-labelledby="nr-title" onClick={e => e.stopPropagation()}>
            <button className="nr-close" aria-label="Close" onClick={() => setRejectedNameModal(null)}><X size={18} /></button>
            <div className="rn-icon rn-icon-reject nr-pop"><X size={24} /></div>
            <h2 id="nr-title" className="rn-title nr-pop-text">Name change rejected</h2>
            <p className="rn-sub">The owner didn’t approve your request for this {contextLabel}.</p>
            <div className="rn-diff" style={{ marginTop: 0 }}>
              <div className="rn-diff-row"><span className="rn-diff-label">Current name</span><span className="rn-new" style={{ color: '#2D1A7A' }}>{group.name}</span></div>
              <div className="rn-diff-row"><span className="rn-diff-label">You asked for</span><span className="rn-old">{rejectedNameModal.new_name}</span></div>
            </div>
            <div className="nr-reason">
              <span className="nr-reason-label">Reason</span>
              <p>{rejectedNameModal.rejection_reason || 'No reason was given.'}</p>
            </div>
            {isAdmin ? (
              <div className="rn-note">You’re the owner now — you can rename it directly.</div>
            ) : myPendingNameRequest ? (
              <div className="rn-note">You already have a request waiting: “{myPendingNameRequest.new_name}”.</div>
            ) : nameRequestsLeft === 0 ? (
              <div className="rn-note rn-note-warn">You used up all your name change requests this month. Request a name change again next month.</div>
            ) : (
              <div className="rn-quota">{nameRequestsLeft} of {NAME_REQUEST_LIMIT} requests left this month</div>
            )}
            <button
              className="rn-btn-primary"
              disabled={!isAdmin && (!!myPendingNameRequest || nameRequestsLeft === 0)}
              onClick={() => { setRejectedNameModal(null); openRename(); }}
            >
              Resubmit name change
            </button>
          </div>
        </div>
      )}

      {toast && <div className={`toast-detail toast-${toast.type}`}>{toast.msg}</div>}

      {/* Payment Details Card */}
      {showPaymentCard && paymentCardMember && (
        <div className="modal-overlay-detail" onClick={() => setShowPaymentCard(false)}>
          <div className="modal-detail-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
            <div className="modal-header" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="member-avatar-tooltip" style={{ width: 44, height: 44, minWidth: 44, minHeight: 44 }}>
                  {getMemberAvatar(paymentCardMember)}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, color: '#2D1A7A', fontWeight: 700 }}>{paymentCardMember.profiles?.full_name}</h2>
                  <span style={{ fontSize: 11, color: '#9E8FCC' }}>{paymentCardMember.role === 'owner' ? <><InlineIcon as={ICONS.owner} /> Owner</> : <><InlineIcon as={ICONS.member} /> Member</>}</span>
                </div>
              </div>
              <button aria-label="Close" className="modal-close" onClick={() => setShowPaymentCard(false)}><X size={20} /></button>
            </div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#5A4AAA', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}><InlineIcon as={ICONS.payment} /> Payment Details</p>
            {[
              { label: 'GCash', value: paymentCardMember.profiles?.gcash_number },
              { label: 'Bank', value: paymentCardMember.profiles?.bank_name },
              { label: 'Account #', value: paymentCardMember.profiles?.bank_account_number },
              { label: 'Account Name', value: paymentCardMember.profiles?.bank_account_name },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0EDFF' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA' }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: value ? 700 : 400, color: value ? '#2D1A7A' : '#C4B5FD' }}>{value || 'Not set'}</span>
                  {value && (
                    <button onClick={() => { navigator.clipboard?.writeText(value); showToast(`${label} copied!`); }}
                      style={{ background: '#F0EDFF', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: '#3B2AAB', fontSize: 10, fontWeight: 700, fontFamily: 'Poppins' }}>
                      Copy
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!paymentCardMember.profiles?.gcash_number && !paymentCardMember.profiles?.bank_name && !paymentCardMember.profiles?.bank_account_number && (
              <p style={{ fontSize: 12, color: '#9E8FCC', textAlign: 'center', padding: '16px 0 4px', margin: 0 }}>No payment details set yet</p>
            )}
            {isAdmin && paymentCardMember.user_id !== currentUser?.id && (
              <button
                className="delete-confirm-btn"
                style={{ width: '100%', marginTop: 16 }}
                onClick={() => { setShowPaymentCard(false); openKickMember(paymentCardMember); }}
              >
                Remove from {contextType === 'household' ? 'household' : 'group'}
              </button>
            )}
            <button onClick={() => setShowPaymentCard(false)}
              style={{ width: '100%', marginTop: 16, background: '#3B2AAB', color: 'white', border: 'none', borderRadius: 50, padding: '12px 0', fontFamily: 'Poppins', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
      {/* Edit Expense (admin only) */}
      {editExpense && isAdmin && (
        <EditExpenseModal
          expense={editExpense}
          splits={expenseSplits[editExpense.id] || []}
          members={members}
          actor={flowActor()}
          linkFor={flowLink}
          categories={ALL_EXPENSE_CATEGORIES}
          showToast={showToast}
          onOpenExpense={openExistingExpense}
          onClose={() => setEditExpense(null)}
          onSaved={() => { setEditExpense(null); fetchGroupAndData(); }}
        />
      )}

      {/* Follow-up payment (member) */}
      {followupFor && (
        <FollowupPaymentModal
          hidden={showFollowupPayOnline}
          expense={followupFor.expense}
          split={followupFor.split}
          loading={xmLoading}
          onSubmit={handleSubmitFollowup}
          onClose={() => setFollowupFor(null)}
          onPayOnline={() => setShowFollowupPayOnline(true)}
        />
      )}
      <PayOnlineModal
        show={showFollowupPayOnline}
        onClose={() => setShowFollowupPayOnline(false)}
        receiverId={group?.created_by}
        itemTitle={followupFor?.expense?.title}
        amount={followupDueOf(followupFor?.split)}
        onProceed={() => setShowFollowupPayOnline(false)}
      />

      {/* Refund (admin) */}
      {refundFor && isAdmin && (
        <RefundModal
          expense={refundFor.expense}
          split={refundFor.split}
          refundType={refundFor.refundType}
          resending={refundFor.resending}
          initialAmount={refundFor.initialAmount}
          loading={xmLoading}
          onSubmit={handleSendRefund}
          onClose={() => setRefundFor(null)}
        />
      )}

      {/* Payment history: original proof, follow-ups, refunds */}
      {proofsFor && (
        <PaymentHistoryModal
          expense={proofsFor.expense}
          split={(expenseSplits[proofsFor.expense.id] || []).find(x => x.id === proofsFor.split.id) || proofsFor.split}
          title={proofsFor.only === 'refunds' ? 'Refund Proofs' : undefined}
          mainProofs={proofsFor.only === 'refunds' ? [] : mainProofsFor(proofsFor.split)}
          onReviewMainProof={(proof) => { const split = proofsFor.split; setProofsFor(null); openProofModal(proof, split); }}
          followups={proofsFor.only === 'refunds' ? [] : (extras.followups[proofsFor.expense.id] || []).filter(f => f.user_id === proofsFor.split.user_id)}
          refunds={(extras.refunds[proofsFor.expense.id] || []).filter(r => r.user_id === proofsFor.split.user_id)}
          isAdmin={isAdmin && proofsFor.split.user_id !== currentUser?.id}
          currentUserId={currentUser?.id}
          loading={xmLoading}
          onReviewFollowup={handleReviewFollowup}
          onReviewRefund={handleReviewRefund}
          onResendRefund={(refund) => {
            const refundType = refund.refund_type === 'overpayment' ? 'overpayment' : 'expense_deletion';
            setRefundFor({ ...proofsFor, refundType, resending: true, initialAmount: refund.amount });
            setProofsFor(null);
          }}
          onHidden={fetchGroupAndData}
          onClose={() => setProofsFor(null)}
        />
      )}

    </div>
  );
}