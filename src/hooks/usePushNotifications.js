import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Must be the pair of the VAPID_PRIVATE_KEY secret on the send-push Edge Function
// (rotated 2026-10-29: the old app key didn't match the server → Apple answered VapidPkHashMismatch).
const VAPID_PUBLIC_KEY = 'BGeApZy06idUqGgln9QANgEE3c2aDHPBrJrIhLYUkAheBOOXmH5H0ilr1fMmsVA_2EVSj7PIv7SwygH6nONcIqQ';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

// Was this browser subscription made with the current VAPID key? (old ones can never receive pushes)
function usesCurrentKey(subscription) {
  const key = subscription?.options?.applicationServerKey;
  if (!key) return true;   // browser doesn't expose it — assume fine
  const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const bytes = new Uint8Array(key);
  return bytes.length === current.length && bytes.every((b, i) => b === current[i]);
}

function supportsPush() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

// Register this browser for pushes with the current key (replacing an old-key
// subscription) and save it for the user. Throws on failure.
async function registerSubscription() {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !usesCurrentKey(subscription)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  // one row per device (a user can have several); the RPC also moves this
  // device to whoever is logged in on it now
  const { error } = await supabase.rpc('save_push_subscription', { p_subscription: subscription.toJSON() });
  if (error) throw error;
}

export function usePushNotifications(userId) {
  const [pushStatus, setPushStatus] = useState(() => (
    supportsPush() ? 'checking' : 'unsupported'
  ));

  useEffect(() => {
    if (!userId || !supportsPush()) return undefined;

    let active = true;
    const checkSubscription = async () => {
      if (Notification.permission === 'denied') {
        if (active) setPushStatus('denied');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (subscription && !usesCurrentKey(subscription) && Notification.permission === 'granted') {
          // made with the old key: it can never receive pushes — replace it now
          await registerSubscription();
          if (active) setPushStatus('enabled');
          return;
        }
        if (active) setPushStatus(subscription ? 'enabled' : 'not-enabled');
      } catch (error) {
        console.error('Could not check browser push status:', error);
        if (active) setPushStatus('unavailable');
      }
    };

    void checkSubscription();
    return () => { active = false; };
  }, [userId]);

  const requestPermission = useCallback(async () => {
    if (!supportsPush()) {
      setPushStatus('unsupported');
      return 'unsupported';
    }
    if (Notification.permission !== 'default') return Notification.permission;

    try {
      const permission = await Notification.requestPermission();
      setPushStatus(permission === 'granted' ? 'not-enabled' : 'denied');
      return permission;
    } catch (error) {
      console.error('Notification permission request failed:', error);
      setPushStatus('unavailable');
      return 'unavailable';
    }
  }, []);

  // the RPC saves the device for whoever is logged in (auth.uid())
  const subscribe = useCallback(async () => {
    if (!supportsPush()) {
      setPushStatus('unsupported');
      return false;
    }
    if (Notification.permission !== 'granted') {
      setPushStatus(Notification.permission === 'denied' ? 'denied' : 'not-enabled');
      return false;
    }

    try {
      await registerSubscription();
      setPushStatus('enabled');
      return true;
    } catch (error) {
      console.error('Push subscription setup failed:', error);
      setPushStatus('unavailable');
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (userIdToUnsubscribe) => {
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (subscription) {
          // only this device: the user's other phones / browsers keep receiving
          const { error } = await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', userIdToUnsubscribe)
            .eq('endpoint', subscription.endpoint);
          if (error) throw error;
          const unsubscribed = await subscription.unsubscribe();
          if (!unsubscribed) throw new Error('The browser did not remove its push subscription.');
        }
      }

      setPushStatus('not-enabled');
      return true;
    } catch (error) {
      console.error('Could not remove browser push subscription:', error);
      setPushStatus('unavailable');
      return false;
    }
  }, []);

  return { pushStatus, requestPermission, subscribe, unsubscribe };
}
