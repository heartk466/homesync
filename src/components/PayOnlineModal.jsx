import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, Copy, Check as CheckIcon, ExternalLink } from 'lucide-react';
import { PAYMENT_METHODS, fetchReceiverPaymentDetails, openPaymentApp } from '../utils/paymentUtils';
import './PayOnlineModal.css';

/**
 * Shared "Pay Online" flow used across GroupDetailScreen, ExpensesScreen and
 * UtilitiesScreen. Pure UI/flow component — the parent screen still owns the
 * actual proof-of-payment upload step.
 *
 * Props:
 *  show          – boolean
 *  onClose       – () => void
 *  receiverId    – user id of the group admin who should receive payment
 *  itemTitle     – e.g. expense/utility title, shown in the summary
 *  amount        – numeric amount owed
 *  onProceed     – ({ method, email }) => void, called once the user has
 *                  "sent" the payment and entered their receipt email.
 *                  The parent should close this modal and open its own
 *                  Upload Screenshot modal, carrying `email` forward.
 */
export default function PayOnlineModal({ show, onClose, receiverId, itemTitle, amount, onProceed }) {
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState(null);
  const [receiverDetails, setReceiverDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!show) return;
    setStep(1);
    setMethod(null);
    setCopied(false);
    if (receiverId) {
      setLoading(true);
      fetchReceiverPaymentDetails(receiverId).then((d) => {
        setReceiverDetails(d);
        setLoading(false);
      });
    }
  }, [show, receiverId]);

  if (!show) return null;

  const config = method ? PAYMENT_METHODS[method] : null;
  const getNumber = () => (method === 'gcash' ? receiverDetails?.gcash_number : receiverDetails?.paymaya_number);
  const getName = () => (method === 'gcash' ? receiverDetails?.gcash_account_name : receiverDetails?.paymaya_account_name);
  const hasDetails = !loading && !!getNumber();

  const selectMethod = (key) => {
    setMethod(key);
    setStep(2);
  };

  const handleCopy = () => {
    if (!getNumber()) return;
    navigator.clipboard?.writeText(getNumber());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleContinue = () => {
    openPaymentApp(method);
  };

  const handleDone = () => {
    onProceed({ method });
  };

  const stepLabel = step === 1 ? 'Select Payment Method' : 'Account Details';

  return (
    <div className="pom-overlay">
      <div className="pom-card">
        <div className="pom-header">
          <div className="pom-header-left">
            {step > 1 && (
              <button className="pom-back-btn" onClick={() => setStep(step - 1)} aria-label="Back">
                <ChevronLeft size={18} />
              </button>
            )}
            <h2>{stepLabel}</h2>
          </div>
          <button className="pom-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="pom-steps-row">
          {[1, 2].map((n) => (
            <div key={n} className={`pom-step-dot ${step >= n ? 'active' : ''}`}>{n}</div>
          ))}
        </div>

        {itemTitle && (
          <div className="pom-item-summary">
            <span className="pom-item-title">{itemTitle}</span>
            {amount != null && <span className="pom-item-amount">₱{Number(amount).toFixed(2)}</span>}
          </div>
        )}

        {step === 1 && (
          <div className="pom-method-list">
            {Object.values(PAYMENT_METHODS).map((m) => (
              <button
                key={m.key}
                className="pom-method-btn"
                style={{ '--method-color': m.color }}
                onClick={() => selectMethod(m.key)}
              >
                <span className="pom-method-icon">{m.icon}</span>
                <span className="pom-method-label">{m.label}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="pom-account-details">
            {loading ? (
              <div className="pom-loading">Loading account details…</div>
            ) : !hasDetails ? (
              <div className="pom-empty">
                The admin hasn't added their {config?.label} details yet. Ask them to add it in
                Settings, or upload your proof of payment another way.
              </div>
            ) : (
              <>
                <div className="pom-account-card">
                  <span className="pom-account-method">{config.icon} {config.label}</span>
                  <span className="pom-account-name">{getName() || 'Household Admin'}</span>
                  <div className="pom-account-number-row">
                    <span className="pom-account-number">{getNumber()}</span>
                    <button className="pom-copy-btn" onClick={handleCopy} aria-label="Copy number">
                      {copied ? <CheckIcon size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                <p className="pom-hint">
                  Send the exact amount to this number in the {config.label} app, then come back
                  and upload your screenshot.
                </p>
                <button className="pom-continue-btn" onClick={handleContinue}>
                  <ExternalLink size={16} /> Continue to {config.label}
                </button>
                <button className="pom-submit-btn" onClick={handleDone}>I've Sent the Payment</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}