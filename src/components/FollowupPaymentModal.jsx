import React, { useRef, useState } from 'react';
import { X, Camera } from 'lucide-react';
import { money, num, followupDueOf } from '../utils/expenseEditUtils';
import './ExpenseModals.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

/**
 * Member side: the admin raised their share after they paid, so they send a
 * follow-up proof for the difference. The admin then approves / rejects it.
 *
 * props: expense, split, loading, onSubmit({ file, note }), onClose, hidden,
 *        onPayOnline – optional; parent hides this modal and opens PayOnlineModal
 */
export default function FollowupPaymentModal({ expense, split, loading, onSubmit, onClose, onPayOnline, hidden }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');

  const due = followupDueOf(split);

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  return (
    <div className="xm-overlay" style={hidden ? { display: 'none' } : undefined}>
      <div className="xm-card">
        <div className="xm-header">
          <h2>Follow-up Payment</h2>
          <button aria-label="Close" className="xm-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="xm-body">
          <div className="xm-summary">
            <p className="xm-summary-title">{expense.title}</p>
            <div className="xm-split-row"><span>Your new share</span><strong>{money(split.share_amount)}</strong></div>
            <div className="xm-split-row"><span>Already paid (approved)</span><strong>{money(split.paid_amount)}</strong></div>
            <div className="xm-split-row">
              <span style={{ fontWeight: 700 }}>Amount due now</span>
              <strong style={{ color: '#e53e3e', fontSize: 15 }}>{money(due)}</strong>
            </div>
          </div>

          <div className="xm-box xm-purple">
            The admin changed this expense after you paid. Send the extra {money(due)} and upload a screenshot —
            your first payment proof stays on record.
          </div>

          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
          {preview && <img src={preview} alt="proof" className="xm-proof-img" />}
          <button className="xm-upload-btn" onClick={() => inputRef.current?.click()}>
            <Camera size={16} /> {file ? 'Change Screenshot' : 'Upload Screenshot'}
          </button>
          {onPayOnline && (
            <button className="xm-btn xm-outline" style={{ padding: '10px 0', fontSize: 13 }} onClick={onPayOnline}>
              <InlineIcon as={ICONS.payment} /> Pay Online
            </button>
          )}
          <textarea
            className="xm-textarea"
            placeholder="Optional note (e.g. GCash ref #)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button
            className="xm-btn"
            disabled={!file || loading || num(due) <= 0}
            onClick={() => onSubmit({ file, note })}
          >
            {loading ? 'Submitting…' : 'Submit Follow-up Proof'}
          </button>
          <button className="xm-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}