import { Wallet } from 'lucide-react';
import { supabase } from '../supabaseClient';

// ── Payment method config ────────────────────────────────────────────────────
export const PAYMENT_METHODS = {
  gcash: {
    key: 'gcash',
    label: 'GCash',
    color: '#3B2AAB',
    icon: Wallet,
    scheme: 'gcash://',
    androidPackage: 'com.globe.gcash.android',
    storeUrl: 'https://www.gcash.com/app',
  },
  paymaya: {
    key: 'paymaya',
    label: 'PayMaya',
    color: '#5A4AAA',
    icon: Wallet,
    scheme: 'paymaya://',
    androidPackage: 'com.paymaya',
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

// ── Open the GCash / PayMaya app. The recipient's number (if given) is copied
//    to the clipboard first so it can be pasted into "Send Money" — the apps
//    don't accept a prefilled recipient via deep link.
//    • Android: intent:// URL — Chrome opens the app, or the fallback page if
//      it isn't installed (a bare gcash:// is silently ignored by Chrome).
//    • iOS: URL scheme, falling back to the store page if the page never hides.
//    • Desktop: no app exists, so open the provider's site in a new tab
//      instead of navigating HomeSync away. ──
export function openPaymentApp(methodKey, number) {
  const config = PAYMENT_METHODS[methodKey];
  if (!config) return;

  if (number) navigator.clipboard?.writeText(number).catch(() => {});

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isAndroid) {
    const scheme = config.scheme.replace('://', '');
    window.location.href = `intent://#Intent;scheme=${scheme};package=${config.androidPackage};`
      + `S.browser_fallback_url=${encodeURIComponent(config.storeUrl)};end`;
    return;
  }

  if (!isIOS) {
    window.open(config.storeUrl, '_blank', 'noopener');
    return;
  }

  let left = false;
  const onHide = () => { if (document.hidden) left = true; };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  window.location.href = config.scheme;

  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    if (!left && !document.hidden) window.location.href = config.storeUrl;
  }, 1500);
}