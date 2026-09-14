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
    .select('full_name, gcash_number, gcash_account_name, gcash_qr_url, paymaya_number, paymaya_account_name, paymaya_qr_url')
    .eq('id', receiverId)
    .single();
  if (error) return null;
  return data;
}

// ── Upload a QR code image for a payment method to the 'payment-qr' bucket ──
// Returns the public URL on success, or null on failure. Mirrors the same
// upload pattern already used for payment-proof screenshots elsewhere.
export async function uploadPaymentQr(userId, methodKey, file) {
  if (!userId || !file) return null;
  const ext = file.name?.split('.').pop() || 'png';
  const fileName = `${userId}/${methodKey}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('payment-qr')
    .upload(fileName, file, { upsert: true });
  if (uploadError) return null;

  const { data: urlData } = supabase.storage.from('payment-qr').getPublicUrl(fileName);
  return urlData?.publicUrl || null;
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