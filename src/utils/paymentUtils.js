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
    siteUrl: 'https://www.gcash.com/',   // desktop (no app); gcash.com/app is a 404
  },
  paymaya: {
    key: 'paymaya',
    label: 'PayMaya',
    color: '#5A4AAA',
    icon: Wallet,
    scheme: 'paymaya://',
    androidPackage: 'com.paymaya',
    siteUrl: 'https://www.maya.ph/',
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
//    • Android: intent:// URL — Chrome opens the app, or the Play Store page if
//      it isn't installed (a bare gcash:// is silently ignored by Chrome).
//    • iOS: just the URL scheme. No timed web fallback: from the Home Screen app
//      iOS often doesn't report that the page was hidden, so the fallback fired
//      even though the app had opened, leaving a gcash.com page behind.
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
    const playStore = `https://play.google.com/store/apps/details?id=${config.androidPackage}`;
    window.location.href = `intent://#Intent;scheme=${scheme};package=${config.androidPackage};`
      + `S.browser_fallback_url=${encodeURIComponent(playStore)};end`;
    return;
  }

  if (isIOS) {
    window.location.href = config.scheme;
    return;
  }

  window.open(config.siteUrl, '_blank', 'noopener');
}
