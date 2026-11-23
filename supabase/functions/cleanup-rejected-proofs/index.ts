import { createClient } from 'npm:@supabase/supabase-js@2';

// Screenshots of rejected proofs are kept this long, then only the image file
// is deleted — the row (amount, status, reason, dates) stays as history.
// Keep in sync with PROOF_IMAGE_RETENTION_DAYS in src/utils/paymentProofStorage.js.
const RETENTION_DAYS = 60;
const BUCKET = 'payment-proofs';
const BATCH_SIZE = 200;
const TABLES = ['payment_proofs', 'expense_followup_proofs', 'expense_refunds'];

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Older rows may still hold a full storage URL instead of an object path.
function objectPath(reference: string) {
  const match = reference.match(new RegExp(`/object/(?:public|sign)/${BUCKET}/([^?]+)`));
  return match ? decodeURIComponent(match[1]) : reference;
}

async function cleanTable(table: string, cutoff: string) {
  let cleaned = 0;
  for (;;) {
    const { data: rows, error } = await supabase
      .from(table)
      .select('id, screenshot_url')
      .eq('status', 'rejected')
      .is('image_deleted_at', null)
      .not('screenshot_url', 'is', null)
      .lt('created_at', cutoff)
      .limit(BATCH_SIZE);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!rows?.length) return cleaned;

    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(rows.map((row) => objectPath(row.screenshot_url)));
    if (removeError) throw new Error(`${table} storage: ${removeError.message}`);

    const { error: updateError } = await supabase
      .from(table)
      .update({ screenshot_url: null, image_deleted_at: new Date().toISOString() })
      .in('id', rows.map((row) => row.id));
    if (updateError) throw new Error(`${table}: ${updateError.message}`);

    cleaned += rows.length;
    if (rows.length < BATCH_SIZE) return cleaned;
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CLEANUP_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result: Record<string, number> = {};
    for (const table of TABLES) result[table] = await cleanTable(table, cutoff);
    return new Response(JSON.stringify({ retentionDays: RETENTION_DAYS, cleaned: result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
