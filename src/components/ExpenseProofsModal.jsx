import React, { useState } from 'react';
import { X } from 'lucide-react';
import { money, fmtDate } from '../utils/expenseEditUtils';
import './ExpenseModals.css';

const dateOf = (iso) => (iso ? fmtDate(iso.split('T')[0]) : '');

const FOLLOWUP_META = {
  pending_verification: { label: 'Awaiting approval', color: '#856404', bg: '#FFF3CD' },
  verified: { label: 'Approved', color: '#065F46', bg: '#D1FAE5' },
  rejected: { label: 'Rejected', color: '#e53e3e', bg: '#FEE2E2' },
};

/**
 * One member's payment history for an expense:
 *   • original proof (read-only here — approving it stays in the existing flow)
 *   • follow-up proofs (admin approves / rejects pending ones)
 *   • refund proofs (the member can confirm receipt)
 *
 * Only the admin and that member ever receive these rows (RLS), so showing
 * everything passed in is safe.
 *
 * props: expense, split, originalProof, followups[], refunds[],
 *        isAdmin, currentUserId, loading,
 *        onReviewFollowup(proof, approve, reason), onConfirmRefund(refund),
 *        onRefund()  – optional (admin, when the member is overpaid), onClose
 */
export default function ExpenseProofsModal({
  expense, split, originalProof, followups = [], refunds = [], isAdmin, currentUserId,
  loading, onReviewFollowup, onConfirmRefund, onRefund, onClose,
}) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [zoom, setZoom] = useState(null);

  const nothing = !originalProof && followups.length === 0 && refunds.length === 0;

  return (
    <div className="xm-overlay">
      <div className="xm-card">
        <div className="xm-header">
          <h2>Payment History</h2>
          <button className="xm-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="xm-body">
          <p className="xm-sub" style={{ textAlign: 'center' }}>
            <strong>{split?.profiles?.full_name || 'Member'}</strong> · {expense.title}
            <br />Paid {money(split?.paid_amount)} of {money(split?.share_amount)}
          </p>

          {nothing && <p className="xm-empty">No proofs yet.</p>}

          {/* Original payment */}
          {originalProof && (
            <>
              <p className="xm-section-title">Original payment</p>
              <div className="xm-proof-card">
                <div className="xm-proof-head">
                  <p className="xm-proof-title">Main proof</p>
                  <span className="xm-badge" style={{
                    color: originalProof.status === 'verified' ? '#065F46' : originalProof.status === 'rejected' ? '#e53e3e' : '#856404',
                    background: originalProof.status === 'verified' ? '#D1FAE5' : originalProof.status === 'rejected' ? '#FEE2E2' : '#FFF3CD',
                  }}>
                    {originalProof.status === 'verified' ? 'Approved' : originalProof.status === 'rejected' ? 'Rejected' : 'Awaiting approval'}
                  </span>
                </div>
                {originalProof.screenshot_url && (
                  <img src={originalProof.screenshot_url} alt="original proof" className="xm-proof-img" onClick={() => setZoom(originalProof.screenshot_url)} />
                )}
                {originalProof.note && <p className="xm-proof-note">“{originalProof.note}”</p>}
                <p className="xm-proof-meta">{dateOf(originalProof.created_at)}</p>
              </div>
            </>
          )}

          {/* Follow-ups */}
          {followups.length > 0 && (
            <>
              <p className="xm-section-title">Follow-up payments ({followups.length})</p>
              {followups.map((f) => {
                const meta = FOLLOWUP_META[f.status] || FOLLOWUP_META.pending_verification;
                return (
                  <div className="xm-proof-card" key={f.id}>
                    <div className="xm-proof-head">
                      <p className="xm-proof-title">{money(f.amount)}</p>
                      <span className="xm-badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                    </div>
                    {f.screenshot_url && (
                      <img src={f.screenshot_url} alt="follow-up proof" className="xm-proof-img" onClick={() => setZoom(f.screenshot_url)} />
                    )}
                    {f.note && <p className="xm-proof-note">“{f.note}”</p>}
                    {f.status === 'rejected' && f.rejection_reason && (
                      <p className="xm-proof-note" style={{ color: '#e53e3e' }}>Reason: {f.rejection_reason}</p>
                    )}
                    <p className="xm-proof-meta">{dateOf(f.created_at)}</p>

                    {isAdmin && f.status === 'pending_verification' && (
                      rejectingId === f.id ? (
                        <>
                          <textarea className="xm-textarea" placeholder="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
                          <div className="xm-actions">
                            <button className="xm-btn-sm xm-soft" onClick={() => { setRejectingId(null); setReason(''); }}>Back</button>
                            <button
                              className="xm-btn-sm xm-red"
                              disabled={!reason.trim() || loading}
                              onClick={() => { onReviewFollowup(f, false, reason.trim()); setRejectingId(null); setReason(''); }}
                            >Confirm reject</button>
                          </div>
                        </>
                      ) : (
                        <div className="xm-actions">
                          <button className="xm-btn-sm xm-green" disabled={loading} onClick={() => onReviewFollowup(f, true)}>✓ Approve</button>
                          <button className="xm-btn-sm xm-red" disabled={loading} onClick={() => setRejectingId(f.id)}>✕ Reject</button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Refunds */}
          {(refunds.length > 0 || (isAdmin && onRefund)) && (
            <p className="xm-section-title">Refunds{refunds.length ? ` (${refunds.length})` : ''}</p>
          )}
          {refunds.map((r) => (
            <div className="xm-proof-card" key={r.id}>
              <div className="xm-proof-head">
                <p className="xm-proof-title">{money(r.amount)} refunded</p>
                <span className="xm-badge" style={{
                  color: r.status === 'confirmed' ? '#065F46' : '#2B6CB0',
                  background: r.status === 'confirmed' ? '#D1FAE5' : '#EBF8FF',
                }}>
                  {r.status === 'confirmed' ? 'Received ✓' : 'Sent'}
                </span>
              </div>
              {r.screenshot_url && (
                <img src={r.screenshot_url} alt="refund proof" className="xm-proof-img" onClick={() => setZoom(r.screenshot_url)} />
              )}
              {r.note && <p className="xm-proof-note">“{r.note}”</p>}
              <p className="xm-proof-meta">{dateOf(r.created_at)}</p>
              {!isAdmin && r.user_id === currentUserId && r.status === 'sent' && (
                <button className="xm-btn-sm xm-green" style={{ padding: '8px 0' }} disabled={loading} onClick={() => onConfirmRefund(r)}>
                  ✓ Confirm received
                </button>
              )}
            </div>
          ))}
          {isAdmin && onRefund && (
            <button className="xm-btn xm-soft" style={{ padding: '10px 0', fontSize: 13 }} onClick={onRefund}>
              💸 Refund overpayment
            </button>
          )}

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