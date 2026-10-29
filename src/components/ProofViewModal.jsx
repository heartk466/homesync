import React from 'react';
import { X } from 'lucide-react';
import { formatDate } from '../utils/format';
import './ProofViewModal.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

const STATUS = {
  verified: { label: 'Payment Verified', className: 'pvm-status--verified' },
  rejected: { label: 'Proof Rejected', className: 'pvm-status--rejected' },
  pending: { label: 'Pending Verification', className: 'pvm-status--pending' },
};

/**
 * One main payment proof: who sent it, the screenshot, note, status, and the
 * owner's Confirm / Reject actions. Shared by ExpensesScreen and
 * GroupDetailScreen so both show the same thing.
 *
 * props: proof, submitterName (fallback when proof.profiles is missing),
 *        canReview, canResubmit, loading,
 *        onConfirm(), onReject(), onResubmit(), onClose()
 */
export default function ProofViewModal({
  proof, submitterName, canReview, canResubmit, loading, onConfirm, onReject, onResubmit, onClose,
}) {
  const name = proof.profiles?.full_name || submitterName || 'Member';
  const status = STATUS[proof.status] || STATUS.pending;

  return (
    <div className="pvm-overlay">
      <div className="pvm-card" role="dialog" aria-modal="true" aria-labelledby="pvm-title">
        <div className="pvm-header">
          <h2 id="pvm-title">Payment Proof</h2>
          <button className="pvm-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="pvm-body">
          <div className="pvm-submitter">
            <div className="pvm-avatar">{name[0]?.toUpperCase()}</div>
            <div>
              <div className="pvm-name">{name}</div>
              <div className="pvm-date">{formatDate(proof.created_at)}</div>
            </div>
          </div>

          {proof.image_deleted_at ? (
            <p className="pvm-note">Image removed after the retention period.</p>
          ) : proof.image_missing ? (
            <p className="pvm-note">The screenshot couldn’t be loaded.</p>
          ) : proof.screenshot_url && (
            <img
              src={proof.screenshot_url}
              className="pvm-image"
              alt="payment proof"
            />
          )}
          {proof.note && <div className="pvm-note"><InlineIcon as={ICONS.chat} /> {proof.note}</div>}
          {proof.rejection_reason && <div className="pvm-reason"><InlineIcon as={ICONS.rejected} /> Rejection reason: {proof.rejection_reason}</div>}
          <div className={`pvm-status ${status.className}`}><StatusIcon status={proof.status} />{status.label}</div>

          {canReview && (
            <>
              <button className="pvm-btn pvm-btn-primary" disabled={loading} onClick={onConfirm}><InlineIcon as={ICONS.approved} size={16} /> Confirm Payment</button>
              <button className="pvm-btn pvm-btn-danger" disabled={loading} onClick={onReject}><InlineIcon as={ICONS.rejected} size={16} /> Reject Proof</button>
            </>
          )}
          {canResubmit && (
            <button className="pvm-btn pvm-btn-resubmit" onClick={onResubmit}>Resubmit New Proof</button>
          )}
          <button className="pvm-close-text" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
