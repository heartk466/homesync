import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const VAPID_PUBLIC_KEY = 'BBcMhS6ZOXie4qlsAsjdMhgVqYVoS697eMkuiHI4J_PiB20t6J6vT4npuIFiHPO9kavudjoyg9w_VP4zHOnPNMA';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

function supportsPush() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
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

  const subscribe = useCallback(async (userIdToSubscribe) => {
    if (!supportsPush()) {
      setPushStatus('unsupported');
      return false;
    }
    if (Notification.permission !== 'granted') {
      setPushStatus(Notification.permission === 'denied' ? 'denied' : 'not-enabled');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: userIdToSubscribe,
          subscription: subscription.toJSON(),
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;

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
          const unsubscribed = await subscription.unsubscribe();
          if (!unsubscribed) throw new Error('The browser did not remove its push subscription.');
        }
      }

      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userIdToUnsubscribe);
      if (error) throw error;

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
