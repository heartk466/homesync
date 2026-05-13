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

Deno.serve(async (req) => {
  const { user_id, title, body, url, notif_type } = await req.json();

  // Check: does this user have this notification type enabled?
  const { data: profile } = await supabase
    .from('profiles')
    .select('notification_preferences')
    .eq('id', user_id)
    .single();

  const prefs = profile?.notification_preferences || {};

  // Map notif_type to preference key
  const prefKeyMap: Record<string, string> = {
    approval_request:   'expense_approvals',
    payment_proof:      'payment_confirmations',
    payment_confirmed:  'payment_confirmations',
    utility_reminder:   'utility_reminders',
    report_schedule:    'report_schedules',
    group_invite:       'group_invites',
  };

  const prefKey = prefKeyMap[notif_type];
  if (prefKey && prefs[prefKey] === false) {
    return new Response(JSON.stringify({ skipped: true, reason: 'user preference off' }), { status: 200 });
  }

  // Get subscription
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', user_id)
    .single();

  if (!sub) {
    return new Response(JSON.stringify({ skipped: true, reason: 'no subscription' }), { status: 200 });
  }

  try {
    await webpush.sendNotification(
      sub.subscription,
      JSON.stringify({ title, body, url: url || '/' })
    );
    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err) {
    console.error('Push send error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});