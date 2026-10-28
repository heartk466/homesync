import React, { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { formatMoney, formatDate } from '../utils/format';
import { PROOF_IMAGE_RETENTION_DAYS, setRejectedProofHidden } from '../utils/paymentProofStorage';
import './ExpenseModals.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

const timeOf = (iso) => Date.parse(iso || '') || 0;

// Each proof kind uses its own status words; Payment History buckets them.
const BUCKET_OF = {
  main: { verified: 'approved', rejected: 'rejected' },
  followup: { verified: 'approved', rejected: 'rejected' },
  refund: { confirmed: 'approved', rejected: 'rejected' },
};
const BADGE = {
  main: { approved: 'Approved', pending: 'Awaiting approval' },
  followup: { approved: 'Approved', pending: 'Awaiting approval' },
  refund: { approved: 'Received ✓', pending: 'Awaiting review' },
};
const BADGE_STYLE = {
  approved: { color: '#065F46', background: '#D1FAE5' },
  pending: { color: '#856404', background: '#FFF3CD' },
  pendingRefund: { color: '#2B6CB0', background: '#EBF8FF' },
  rejected: { color: '#e53e3e', background: '#FEE2E2' },
};
const SORT_RANK = { pending: 0, approved: 1, rejected: 2 };
const FILTERS = [
  { key: 'all', label: 'All', empty: 'No proofs yet.' },
  { key: 'approved', label: 'Approved', empty: 'No approved proofs yet.' },
  { key: 'pending', label: 'Pending', empty: 'Nothing is awaiting review.' },
  { key: 'rejected', label: 'Rejected', empty: 'No rejected proofs.' },
];

function refundTitle(r) {
  if (r.refund_type === 'overpayment') return 'Overpayment refund';
  if (r.refund_type === 'expense_deletion') return 'Deletion refund';
  return 'Refund';
}

function toEntries(mainProofs, followups, refunds) {
  return [
    ...mainProofs.map((row) => ({ kind: 'main', row, group: 'main', title: 'Main proof', amount: null })),
    ...followups.map((row) => ({ kind: 'followup', row, group: 'followup', title: 'Follow-up payment', amount: row.amount })),
    ...refunds.map((row) => ({ kind: 'refund', row, group: `refund:${row.refund_type}`, title: refundTitle(row), amount: row.amount })),
  ].map((e) => ({ ...e, key: `${e.kind}:${e.row.id}`, bucket: BUCKET_OF[e.kind][e.row.status] || 'pending' }));
}

function ProofImage({ row, alt, onZoom }) {
  if (row.image_deleted_at) {
    return <p className="xm-proof-removed">Image removed after {PROOF_IMAGE_RETENTION_DAYS} days</p>;
  }
  if (!row.screenshot_url) return null;
  return (
    <img
      src={row.screenshot_url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="xm-proof-img"
      onClick={() => onZoom(row.screenshot_url)}
    />
  );
}

/**
 * One member's payment history for an expense — shared by ExpensesScreen and
 * GroupDetailScreen. Main proofs, follow-up proofs and refunds are merged into
 * one list with All / Approved / Pending / Rejected filters.
 *
 * Rejected entries are never deleted: they collapse to a compact row (tap to
 * see the screenshot), members may hide their own, and the scheduled cleanup
 * only removes the image file after PROOF_IMAGE_RETENTION_DAYS.
 *
 * Only the admin and that member ever receive these rows (RLS), so showing
 * everything passed in is safe.
 *
 * props: expense, split, mainProofs[], followups[], refunds[],
 *        isAdmin, currentUserId, loading,
 *        onReviewFollowup(proof, approve, reason), onReviewRefund(refund, approve, reason),
 *        onResendRefund(refund), onReviewMainProof(proof) – optional, opens the
 *        screen's approve/reject modal, onHidden() – parent refetch after a hide, onClose
 */
export default function PaymentHistoryModal({
  expense, split, title = 'Payment History', mainProofs = [], followups = [], refunds = [], isAdmin, currentUserId,
  loading, onReviewFollowup, onReviewRefund, onResendRefund, onReviewMainProof, onHidden, onClose,
}) {
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  const [hiddenNow, setHiddenNow] = useState(() => new Set());
  const [hideError, setHideError] = useState('');
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [rejectingRefundId, setRejectingRefundId] = useState(null);
  const [refundReason, setRefundReason] = useState('');
  const [zoom, setZoom] = useState(null);

  const allEntries = toEntries(mainProofs, followups, refunds);

  // A rejected entry was "resubmitted" when the same payment (main proof,
  // follow-up, or refund of the same type) has a later non-rejected entry.
  const resubmitted = new Set(
    allEntries
      .filter((e) => e.bucket === 'rejected' && allEntries.some((o) => (
        o.group === e.group && o.bucket !== 'rejected' && timeOf(o.row.created_at) > timeOf(e.row.created_at)
      )))
      .map((e) => e.key),
  );

  // Only the newest refund of each type can be resent, and only while it is
  // still rejected — older rejected proofs are history, and a newer sent /
  // confirmed refund means the resend already happened.
  const latestRefundByType = {};
  for (const r of refunds) {
    const latest = latestRefundByType[r.refund_type];
    if (!latest || timeOf(r.created_at) > timeOf(latest.created_at)) latestRefundByType[r.refund_type] = r;
  }
  const resendableRefundIds = new Set(
    Object.values(latestRefundByType).filter((r) => r.status === 'rejected').map((r) => r.id),
  );

  // Members don't see entries they hid; admins see everything.
  const entries = isAdmin
    ? allEntries
    : allEntries.filter((e) => !e.row.hidden_by_member && !hiddenNow.has(e.key));

  const counts = { all: entries.length, approved: 0, pending: 0, rejected: 0 };
  entries.forEach((e) => { counts[e.bucket] += 1; });
  const activeFilter = counts[filter] ? filter : 'all';
  const visibleFilters = FILTERS.filter((f) => counts[f.key] > 0);

  const shown = entries
    .filter((e) => activeFilter === 'all' || e.bucket === activeFilter)
    .sort((a, b) => (
      (activeFilter === 'all' ? SORT_RANK[a.bucket] - SORT_RANK[b.bucket] : 0)
      || timeOf(b.row.created_at) - timeOf(a.row.created_at)
    ));

  const ownsEntry = (e) => (e.kind === 'main' ? e.row.submitted_by : e.row.user_id) === currentUserId;
  const canHide = (e) => !isAdmin && e.bucket === 'rejected' && ownsEntry(e);

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const hide = async (e) => {
    setHideError('');
    setHiddenNow((prev) => new Set(prev).add(e.key));
    try {
      await setRejectedProofHidden(e.kind, e.row.id, true);
      onHidden?.();
    } catch (err) {
      setHiddenNow((prev) => { const next = new Set(prev); next.delete(e.key); return next; });
      setHideError(err.message || 'Could not hide this entry.');
    }
  };

  const renderRejected = (e) => {
    const r = e.row;
    const open = expanded.has(e.key);
    const panelId = `ph-panel-${e.key.replace(':', '-')}`;
    return (
      <div className="xm-proof-card xm-reject-row" key={e.key}>
        <button type="button" className="xm-reject-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => toggle(e.key)}>
          <span className="xm-reject-line">
            <span className="xm-proof-title">{e.title}{e.amount != null && ` · ${formatMoney(e.amount)}`}</span>
            <span className="xm-badge" style={BADGE_STYLE.rejected}>Rejected</span>
          </span>
          {r.rejection_reason && <span className="xm-reject-reason">Reason: {r.rejection_reason}</span>}
          <span className="xm-reject-line">
            <span className="xm-proof-meta">
              {formatDate(r.created_at)}
              {resubmitted.has(e.key) && <span className="xm-resubmitted">Resubmitted</span>}
              {isAdmin && r.hidden_by_member && <span className="xm-resubmitted">Hidden by member</span>}
            </span>
            <ChevronDown size={14} className={`xm-reject-chevron${open ? ' open' : ''}`} aria-hidden="true" />
          </span>
        </button>
        {open && (
          <div id={panelId} className="xm-reject-panel">
            <ProofImage row={r} alt={`${e.title} (rejected)`} onZoom={setZoom} />
            {r.note && <p className="xm-proof-note">“{r.note}”</p>}
            {isAdmin && e.kind === 'refund' && resendableRefundIds.has(r.id) && onResendRefund && (
              <button className="xm-btn xm-soft" style={{ padding: '9px 0', fontSize: 13 }} onClick={() => onResendRefund(r)}>
                <InlineIcon as={ICONS.refund} /> Resend refund proof
              </button>
            )}
            {canHide(e) && (
              <button className="xm-btn-sm xm-soft" disabled={loading} onClick={() => hide(e)}>
                Hide from my history
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCard = (e) => {
    const r = e.row;
    const badgeStyle = e.bucket === 'pending' && e.kind === 'refund' ? BADGE_STYLE.pendingRefund : BADGE_STYLE[e.bucket];
    return (
      <div className="xm-proof-card" key={e.key}>
        <div className="xm-proof-head">
          <p className="xm-proof-title">{e.title}{e.amount != null && ` · ${formatMoney(e.amount)}`}</p>
          <span className="xm-badge" style={badgeStyle}>{BADGE[e.kind][e.bucket]}</span>
        </div>
        <ProofImage row={r} alt={`${e.title} proof`} onZoom={setZoom} />
        {r.note && <p className="xm-proof-note">“{r.note}”</p>}
        <p className="xm-proof-meta">{formatDate(r.created_at)}</p>

        {/* Admin reviews a pending main proof in the screen's existing proof modal */}
        {e.kind === 'main' && isAdmin && r.status === 'pending_verification' && onReviewMainProof && (
          <button className="xm-btn xm-soft" style={{ padding: '9px 0', fontSize: 13 }} onClick={() => onReviewMainProof(r)}>
            Review proof
          </button>
        )}

        {/* Admin reviews a pending follow-up */}
        {e.kind === 'followup' && isAdmin && r.status === 'pending_verification' && (
          rejectingId === r.id ? (
            <>
              <textarea className="xm-textarea" placeholder="Reason for rejecting" value={reason} onChange={(ev) => setReason(ev.target.value)} />
              <div className="xm-actions">
                <button className="xm-btn-sm xm-soft" onClick={() => { setRejectingId(null); setReason(''); }}>Back</button>
                <button
                  className="xm-btn-sm xm-red"
                  disabled={!reason.trim() || loading}
                  onClick={() => { onReviewFollowup(r, false, reason.trim()); setRejectingId(null); setReason(''); }}
                >Confirm reject</button>
              </div>
            </>
          ) : (
            <div className="xm-actions">
              <button className="xm-btn-sm xm-green" disabled={loading} onClick={() => onReviewFollowup(r, true)}>✓ Approve</button>
              <button className="xm-btn-sm xm-red" disabled={loading} onClick={() => setRejectingId(r.id)}>✕ Reject</button>
            </div>
          )
        )}

        {/* Member confirms or rejects a refund the admin sent */}
        {e.kind === 'refund' && !isAdmin && r.user_id === currentUserId && r.status === 'sent' && (
          rejectingRefundId === r.id ? (
            <>
              <textarea
                className="xm-textarea"
                placeholder="Reason for rejecting this refund"
                value={refundReason}
                maxLength={500}
                onChange={(ev) => setRefundReason(ev.target.value)}
              />
              <div className="xm-actions">
                <button className="xm-btn-sm xm-soft" onClick={() => { setRejectingRefundId(null); setRefundReason(''); }}>Back</button>
                <button
                  className="xm-btn-sm xm-red"
                  disabled={!refundReason.trim() || loading}
                  onClick={() => {
                    onReviewRefund(r, false, refundReason.trim());
                    setRejectingRefundId(null);
                    setRefundReason('');
                  }}
                >Confirm reject</button>
              </div>
            </>
          ) : (
            <div className="xm-actions">
              <button className="xm-btn-sm xm-green" disabled={loading} onClick={() => onReviewRefund(r, true)}>✓ Approve received</button>
              <button className="xm-btn-sm xm-red" disabled={loading} onClick={() => setRejectingRefundId(r.id)}>✕ Reject</button>
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <div className="xm-overlay">
      <div className="xm-card" role="dialog" aria-modal="true" aria-labelledby="ph-title">
        <div className="xm-header">
          <h2 id="ph-title">{title}</h2>
          <button className="xm-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        {visibleFilters.length > 1 && (
          <div className="xm-filter-bar" role="toolbar" aria-label="Filter payment history">
            {visibleFilters.map((f) => (
              <button
                key={f.key}
                type="button"
                className="xm-chip"
                aria-pressed={activeFilter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="xm-chip-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        )}

        <div className="xm-body">
          <p className="xm-sub" style={{ textAlign: 'center' }}>
            <strong>{split?.profiles?.full_name || 'Member'}</strong> · {expense.title}
            <br />Paid {formatMoney(split?.paid_amount)} of {formatMoney(split?.share_amount)}
          </p>

          {hideError && <p className="xm-err-text" role="alert">{hideError}</p>}

          {shown.length === 0
            ? <p className="xm-empty">{FILTERS.find((f) => f.key === activeFilter).empty}</p>
            : shown.map((e) => (e.bucket === 'rejected' ? renderRejected(e) : renderCard(e)))}

          <button className="xm-cancel" onClick={onClose}>Close</button>
        </div>
      </div>

      {zoom && (
        <div className="xm-overlay" style={{ zIndex: 400, background: 'rgba(0,0,0,0.85)' }} onClick={() => setZoom(null)}>
          <img src={zoom} alt="proof" style={{ maxWidth: '92%', maxHeight: '88%', borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
