import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Copy, Download } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { money, num, round2, overpaidOf } from '../utils/expenseEditUtils';
import './ExpenseModals.css';

/**
 * Admin side: pay a member back (overpayment, or before removing / deleting).
 * Shows the member's GCash / PayMaya / bank details from their Settings, then
 * the admin sends the money outside the app and uploads a screenshot.
 *
 * props: expense, split (with .profiles), loading, onSubmit({ amount, file, note }), onClose
 */
export default function RefundModal({ expense, split, loading, onSubmit, onClose }) {
  const inputRef = useRef(null);
  const over = overpaidOf(split);
  const maxAmount = round2(num(split.paid_amount));

  const [details, setDetails] = useState(null);
  const [method, setMethod] = useState(null);
  const [amount, setAmount] = useState(String(over > 0 ? over : maxAmount));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, gcash_number, gcash_account_name, gcash_qr_url, paymaya_number, paymaya_account_name, paymaya_qr_url, bank_name, bank_account_number, bank_account_name')
        .eq('id', split.user_id)
        .single();
      if (cancelled) return;
      setDetails(data || {});
      const first = data?.gcash_number || data?.gcash_qr_url ? 'gcash'
        : data?.paymaya_number || data?.paymaya_qr_url ? 'paymaya'
        : data?.bank_account_number ? 'bank' : null;
      setMethod(first);
    })();
    return () => { cancelled = true; };
  }, [split.user_id]);

  const methods = [];
  if (details?.gcash_number || details?.gcash_qr_url) methods.push({ key: 'gcash', label: '💙 GCash' });
  if (details?.paymaya_number || details?.paymaya_qr_url) methods.push({ key: 'paymaya', label: '💚 PayMaya' });
  if (details?.bank_account_number) methods.push({ key: 'bank', label: '🏦 Bank' });

  const current = (() => {
    if (!details) return null;
    if (method === 'gcash') return { label: 'GCash', name: details.gcash_account_name || details.full_name, number: details.gcash_number, qr: details.gcash_qr_url };
    if (method === 'paymaya') return { label: 'PayMaya', name: details.paymaya_account_name || details.full_name, number: details.paymaya_number, qr: details.paymaya_qr_url };
    if (method === 'bank') return { label: details.bank_name || 'Bank', name: details.bank_account_name || details.full_name, number: details.bank_account_number, qr: null };
    return null;
  })();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };

  const downloadQr = async () => {
    try {
      const res = await fetch(current.qr);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${current.label}-qr.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(current.qr, '_blank');
    }
  };

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const amt = round2(num(amount));
  const tooMuch = amt > maxAmount + 0.001;
  const invalid = !(amt > 0) || tooMuch || !file;

  return (
    <div className="xm-overlay">
      <div className="xm-card">
        <div className="xm-header">
          <h2>Refund {split.profiles?.full_name?.split(' ')[0] || 'member'}</h2>
          <button className="xm-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="xm-body">
          <div className="xm-summary">
            <p className="xm-summary-title">{expense.title}</p>
            <div className="xm-split-row"><span>Their share</span><strong>{money(split.share_amount)}</strong></div>
            <div className="xm-split-row"><span>They’ve paid</span><strong>{money(split.paid_amount)}</strong></div>
            {over > 0 && (
              <div className="xm-split-row">
                <span style={{ fontWeight: 700, color: '#2B6CB0' }}>Overpaid</span>
                <strong style={{ color: '#2B6CB0' }}>{money(over)}</strong>
              </div>
            )}
          </div>

          {/* Member's payment details */}
          <p className="xm-section-title">Send the refund to</p>
          {!details ? (
            <p className="xm-empty">Loading payment details…</p>
          ) : methods.length === 0 ? (
            <div className="xm-box xm-yellow">
              {split.profiles?.full_name || 'This member'} hasn’t added GCash, PayMaya or bank details in Settings yet.
              Ask them to add one — or send it another way and still upload the proof below.
            </div>
          ) : (
            <>
              <div className="xm-pay-tabs">
                {methods.map((m) => (
                  <button key={m.key} className={method === m.key ? 'active' : ''} onClick={() => setMethod(m.key)}>
                    {m.label}
                  </button>
                ))}
              </div>
              {current?.qr && (
                <div className="xm-qr-box">
                  <img src={current.qr} alt={`${current.label} QR`} />
                  <button className="xm-btn-sm xm-soft" onClick={downloadQr}>
                    <Download size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Download QR
                  </button>
                </div>
              )}
              {current && (
                <div className="xm-account-card">
                  <div style={{ minWidth: 0 }}>
                    <p className="xm-account-label">{current.label}</p>
                    <p className="xm-account-name">{current.name}</p>
                    {current.number && <p className="xm-account-num">{current.number}</p>}
                  </div>
                  {current.number && (
                    <button className="xm-copy-btn" onClick={copy} title="Copy number">
                      {copied ? '✓' : <Copy size={15} />}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Amount + proof */}
          <div className="xm-field">
            <label>Refund amount <span style={{ fontWeight: 400, color: '#9E8FCC' }}>(max {money(maxAmount)})</span></label>
            <div className={`xm-amount-wrap${tooMuch ? ' xm-error' : ''}`}>
              <span className="xm-peso">₱</span>
              <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            {tooMuch && <span className="xm-err-text">More than the member has paid</span>}
            {over > 0 && maxAmount > over && (
              <span className="xm-hint">
                Overpaid only: {money(over)} · Full payment: {money(maxAmount)}
              </span>
            )}
          </div>

          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
          {preview && <img src={preview} alt="refund proof" className="xm-proof-img" />}
          <button className="xm-upload-btn" onClick={() => inputRef.current?.click()}>
            <Camera size={16} /> {file ? 'Change Screenshot' : 'Upload Refund Screenshot'}
          </button>
          <textarea
            className="xm-textarea"
            placeholder="Optional note (e.g. GCash ref #)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="xm-box xm-purple">The member is notified and can confirm they received it.</div>

          <button className="xm-btn" disabled={invalid || loading} onClick={() => onSubmit({ amount: amt, file, note })}>
            {loading ? 'Sending…' : 'Send Refund Proof'}
          </button>
          <button className="xm-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}