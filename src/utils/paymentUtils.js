import { supabase } from '../supabaseClient';

// ── Payment method config ────────────────────────────────────────────────────
export const PAYMENT_METHODS = {
  gcash: {
    key: 'gcash',
    label: 'GCash',
    color: '#3B2AAB',
    icon: '💙',
    scheme: 'gcash://',
    storeUrl: 'https://www.gcash.com/app',
  },
  paymaya: {
    key: 'paymaya',
    label: 'PayMaya',
    color: '#5A4AAA',
    icon: '💚',
    scheme: 'paymaya://',
    storeUrl: 'https://www.maya.ph/app',
  },
};

// ── Fetch the receiving account's saved GCash/PayMaya details ───────────────
// receiverId is normally the group/household admin (group.created_by)
export async function fetchReceiverPaymentDetails(receiverId) {
  if (!receiverId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, gcash_number, gcash_account_name, paymaya_number, paymaya_account_name')
    .eq('id', receiverId)
    .single();
  if (error) return null;
  return data;
}

// ── Attempt to open the native app via URL scheme, falling back to the
//    app/web store if the app isn't installed (detected via page blur/focus). ──
export function openPaymentApp(methodKey) {
  const config = PAYMENT_METHODS[methodKey];
  if (!config) return;

  let didBlur = false;
  const onBlur = () => { didBlur = true; };
  window.addEventListener('blur', onBlur, { once: true });

  window.location.href = config.scheme;

  setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    if (!didBlur) {
      window.location.href = config.storeUrl;
    }
  }, 1200);
}