// "Upload Payment Proof" step shown right after someone adds an expense and
// marks themselves as the payer. Same flow as the Expenses screen:
//   owner  → proof is verified at once, their split is approved, the others notified
//   member → proof is stored as pending and linked when the owner approves
import React, { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { uploadPaymentProof } from '../utils/paymentProofStorage';
import { notifyPendingChanged } from '../utils/pendingEvents';

// whole-expense status from all of its splits (same rule as the Expenses screen)
async function recalculateExpenseStatus(expenseId) {
  const { data: allSplits } = await supabase.from('expense_splits').select('status').eq('expense_id', expenseId);
  if (!allSplits || allSplits.length === 0) return;
  let status = 'pending';
  if (allSplits.every(s => s.status === 'approved')) status = 'paid';
  else if (allSplits.some(s => s.status === 'pending_verification')) status = 'verifying';
  await supabase.from('expenses').update({ status }).eq('id', expenseId);
  notifyPendingChanged();
}

export default function UploadProofAfterAddModal({ expense, isAdmin, currentUser, profile, showToast, onDone }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!file) return;
    setLoading(true);
    let objectPath;
    try {
      objectPath = await uploadPaymentProof(file, currentUser.id, 'expenses', expense.id);
    } catch (uploadError) {
      showToast(`Upload failed: ${uploadError.message}`, 'error');
      setLoading(false);
      return;
    }

    const { data: proof, error: proofError } = await supabase.from('payment_proofs').insert({
      expense_id: expense.id,
      submitted_by: currentUser.id,
      screenshot_url: objectPath,
      note: '',
      status: isAdmin ? 'verified' : 'pending_verification',
    }).select().single();
    if (proofError) { showToast('Failed to save proof', 'error'); setLoading(false); return; }

    if (isAdmin) {
      await supabase
        .from('expense_splits')
        .update({ status: 'approved', proof_id: proof.id, updated_at: new Date().toISOString() })
        .eq('expense_id', expense.id)
        .eq('user_id', currentUser.id);
      await recalculateExpenseStatus(expense.id);

      const { data: allSplits } = await supabase.from('expense_splits').select('user_id').eq('expense_id', expense.id);
      const others = (allSplits || []).filter(sp => sp.user_id !== currentUser.id);
      if (others.length) {
        await supabase.from('notifications').insert(others.map(sp => ({
          user_id: sp.user_id,
          title: '📸 Owner Paid Their Share',
          message: expense.paid_by === currentUser.id
            ? `${profile?.full_name || 'The owner'} paid the bill for "${expense.title}" and uploaded the receipt. Tap to view proof.`
            : `${profile?.full_name || 'The owner'} uploaded proof of paying their share for "${expense.title}". Tap to view proof.`,
          type: 'payment_confirmed',
          link_path: `/groups/${expense.household_id}?type=household`,
          link_state: JSON.stringify({ type: 'household' }),
          link_query: `openProof=${expense.id}&proofId=${proof.id}`,
        })));
      }
    }

    setLoading(false);
    showToast(isAdmin ? 'Expense added and your payment is confirmed!' : 'Expense submitted with proof!');
    onDone();
  };

  const skip = () => {
    showToast(isAdmin
      ? 'Expense added — your share stays Unpaid until you upload proof'
      : 'Submitted for approval — upload your proof after the owner approves');
    onDone();
  };

  return (
    <div className="modal-overlay">
      <input type="file" ref={inputRef} style={{ display: 'none' }} accept="image/*" onChange={e => {
        const picked = e.target.files[0];
        if (picked) { setFile(picked); setPreview(URL.createObjectURL(picked)); }
      }} />
      <div className="small-modal">
        <h2>Upload Payment Proof</h2>
        <p style={{ fontSize: 13, color: '#5A4AAA', margin: 0 }}>
          You marked yourself as the payer for "<strong>{expense.title}</strong>".{' '}
          {isAdmin
            ? 'Upload a screenshot of your payment — as the owner, your share is marked Paid right away. You can also skip and upload it later from the expense card.'
            : 'Upload a screenshot of your payment now, or do it after the owner approves.'}
        </p>
        {preview && <img src={preview} className="proof-preview" alt="proof" />}
        <button className="upload-proof-btn" onClick={() => inputRef.current.click()}>
          <Camera size={16} /> {file ? 'Change Screenshot' : 'Upload Screenshot'}
        </button>
        <button className="add-expense-btn" onClick={submit} disabled={!file || loading}>
          {loading ? 'Submitting…' : isAdmin ? 'Confirm Payment' : 'Submit Expense + Proof'}
        </button>
        <button className="edit-cancel-btn" onClick={skip} disabled={loading}>Skip for now</button>
      </div>
    </div>
  );
}
