import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// trim: a key pasted into the dashboard with a trailing newline crashed the function at boot
webpush.setVapidDetails(
  Deno.env.get('VAPID_EMAIL')!.trim(),
  Deno.env.get('VAPID_PUBLIC_KEY')!.trim(),
  Deno.env.get('VAPID_PRIVATE_KEY')!.trim()
);

// Shared secret so only your database trigger can ask for pushes
const PUSH_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// notification type → the preference toggle in Settings that controls it
const prefKeyMap: Record<string, string> = {
  approval_request:   'expense_approvals',
  expense_added:      'expense_approvals',
  expense_approved:   'expense_approvals',
  expense_rejected:   'expense_approvals',
  expense_updated:    'expense_approvals',
  payment_proof:      'payment_confirmations',
  payment_confirmed:  'payment_confirmations',
  payment_rejected:   'payment_confirmations',
  utility_reminder:   'utility_reminders',
  payment_reminder:   'utility_reminders',
  report_schedule:    'report_schedules',
  group_invite:       'group_invites',
};

Deno.serve(async (req) => {
  if (!PUSH_SECRET || req.headers.get('x-push-secret') !== PUSH_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const { user_id, title, body, url, notif_type, tag } = await req.json();

  // Does this user have this notification type enabled?
  const { data: profile } = await supabase
    .from('profiles')
    .select('notification_preferences')
    .eq('id', user_id)
    .single();

  const prefs = profile?.notification_preferences || {};
  const prefKey = prefKeyMap[notif_type];
  if (prefKey && prefs[prefKey] === false) {
    return json({ skipped: true, reason: 'user preference off' });
  }

  // Every phone/browser this user turned push on for (one row per device)
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('user_id', user_id);

  if (!subs?.length) {
    return json({ skipped: true, reason: 'no subscription' });
  }

  // unique tag per notification so several pushes don't replace each other
  const payload = JSON.stringify({ title, body, url: url || '/', tag });
  const results = await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub.subscription, payload);
      return { sent: true };
    } catch (err: any) {
      // 404 / 410 = that device unsubscribed or its subscription expired → remove just it
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        return { removed: true };
      }
      console.error('Push send error:', err?.statusCode, err?.body, err);
      return { error: err?.message || 'push failed', push_status: err?.statusCode ?? null, push_body: err?.body ?? null };
    }
  }));

  const sent = results.filter(r => 'sent' in r).length;
  const failed = results.filter(r => 'error' in r);
  // include the push service's answers (e.g. 403 BadJwtToken) so they show in net._http_response
  return json(
    { sent, devices: subs.length, removed: results.filter(r => 'removed' in r).length, errors: failed },
    sent === 0 && failed.length ? 500 : 200,
  );
});