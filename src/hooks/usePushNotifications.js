// src/hooks/usePushNotifications.js
// Drop this file into your src/hooks/ folder
import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const VAPID_PUBLIC_KEY = 'BBcMhS6ZOXie4qlsAsjdMhgVqYVoS697eMkuiHI4J_PiB20t6J6vT4npuIFiHPO9kavudjoyg9w_VP4zHOnPNMA';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications(userId, notifPrefs) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!userId || subscribedRef.current) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    // Only subscribe if at least one notification type is enabled
    const anyEnabled = notifPrefs && Object.values(notifPrefs).some(Boolean);
    if (!anyEnabled) return;

    async function subscribe() {
      try {
        // Register the service worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        // Check existing subscription
        let subscription = await registration.pushManager.getSubscription();

        // If no subscription yet, ask browser permission and create one
        if (!subscription) {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;

          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        // Save subscription to Supabase (upsert so it's idempotent)
        await supabase.from('push_subscriptions').upsert(
          {
            user_id: userId,
            subscription: subscription.toJSON(),
          },
          { onConflict: 'user_id' }
        );

        subscribedRef.current = true;
      } catch (err) {
        console.error('Push subscription failed:', err);
      }
    }

    subscribe();
  }, [userId, notifPrefs]);
}