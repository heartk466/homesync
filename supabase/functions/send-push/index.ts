import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_EMAIL')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
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

  // The user's saved phone/browser subscription
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', user_id)
    .maybeSingle();

  if (!sub) {
    return json({ skipped: true, reason: 'no subscription' });
  }

  try {
    await webpush.sendNotification(
      sub.subscription,
      // unique tag per notification so several pushes don't replace each other
      JSON.stringify({ title, body, url: url || '/', tag })
    );
    return json({ sent: true });
  } catch (err: any) {
    // 404 / 410 = phone unsubscribed or subscription expired → clean it up
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', user_id);
      return json({ skipped: true, reason: 'subscription expired, removed' });
    }
    console.error('Push send error:', err?.statusCode, err?.body, err);
    // include the push service's answer (e.g. 403 BadJwtToken) so it shows in net._http_response
    return json({ error: err?.message || 'push failed', push_status: err?.statusCode ?? null, push_body: err?.body ?? null }, 500);
  }
});