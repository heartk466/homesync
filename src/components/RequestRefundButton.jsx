import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { formatMoney } from '../utils/format';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

/**
 * Member's "Request refund" button on an overpaid share: sends the admin a
 * notification that opens the expense (where the "Refund overpayment" button is).
 * Shared by ExpensesScreen and GroupDetailScreen.
 *
 * props: expense, amount (overpaid), adminId, memberName, link ({ link_path, link_state }),
 *        showToast(msg, type)
 */
export default function RequestRefundButton({ expense, amount, adminId, memberName, link, showToast }) {
  const [state, setState] = useState('idle'); // idle | sending | sent

  const request = async () => {
    setState('sending');
    const { error } = await supabase.from('notifications').insert({
      user_id: adminId,
      title: '💸 Refund Requested',
      message: `${memberName || 'A member'} overpaid ${formatMoney(amount)} on "${expense.title}" and is asking for a refund.`,
      type: 'refund_requested',
      ...link,
      link_query: `expenseId=${expense.id}`,
    });
    if (error) {
      setState('idle');
      showToast('Could not send the request. Try again.', 'error');
      return;
    }
    setState('sent');
    showToast('Refund request sent to the admin');
  };

  return (
    <button className="xm-btn-sm" disabled={state !== 'idle' || !adminId} onClick={request}>
      {state === 'sent' ? 'Refund requested ✓' : state === 'sending' ? 'Sending…' : <><InlineIcon as={ICONS.refund} /> Request refund {formatMoney(amount)}</>}
    </button>
  );
}
