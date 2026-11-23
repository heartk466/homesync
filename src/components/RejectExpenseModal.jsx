import React, { useState } from 'react';
import { X } from 'lucide-react';
import './ProofViewModal.css';

/**
 * Owner rejects an expense a member proposed: asks for a reason, then calls
 * onConfirm(reason). Shared by GroupDetailScreen and ExpensesScreen.
 *
 * props: expense, loading, onConfirm(reason), onClose()
 */
export default function RejectExpenseModal({ expense, loading, onConfirm, onClose }) {
  const [reason, setReason] = useState('');

  return (
    <div className="pvm-overlay">
      <div className="pvm-card" role="dialog" aria-modal="true" aria-labelledby="rem-title">
        <div className="pvm-header">
          <h2 id="rem-title">Reject Expense</h2>
          <button className="pvm-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="pvm-body">
          <p className="pvm-text">
            Rejecting "<strong>{expense?.title}</strong>" will delete it and notify the member.
          </p>
          <textarea
            className="pvm-textarea"
            placeholder="Reason for rejection *"
            aria-label="Reason for rejection"
            value={reason}
            maxLength={500}
            onChange={e => setReason(e.target.value)}
            rows={3}
          />
          <button className="pvm-btn pvm-btn-danger" disabled={loading || !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {loading ? 'Rejecting...' : 'Reject & Delete Expense'}
          </button>
          <button className="pvm-close-text" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
