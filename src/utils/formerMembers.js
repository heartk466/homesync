// Members who left (or were removed from) a household no longer share a household
// with the others, so their profile join comes back empty on old expenses. Fill in
// just their name / avatar (former_member_names never returns payment details).
import { supabase } from '../supabaseClient';

export async function withFormerMemberNames(rows) {
  const missing = [...new Set((rows || []).filter((r) => !r.profiles && r.user_id).map((r) => r.user_id))];
  if (!missing.length) return rows || [];
  const { data, error } = await supabase.rpc('former_member_names', { p_user_ids: missing });
  if (error) return rows;
  const byId = Object.fromEntries((data || []).map((p) => [p.user_id, p]));
  return rows.map((r) => (!r.profiles && byId[r.user_id]
    ? { ...r, profiles: { id: r.user_id, full_name: byId[r.user_id].full_name, avatar_url: byId[r.user_id].avatar_url } }
    : r));
}
