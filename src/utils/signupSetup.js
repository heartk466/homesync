// Account setup after sign-up: the profile row, then (optionally) a new or
// joined household. Needs a logged-in session (RLS), so:
//   • email confirmation OFF → Register runs it right after signUp
//   • email confirmation ON  → signUp gives no session; the choices are saved in
//     the user's metadata and finishPendingSignup() runs it on the first login
//     (Login screen, or the verification link landing on the start screen).
import { supabase } from '../supabaseClient';
import { generateInviteCode } from './generateInviteCode';

/**
 * type: 'none' | 'create' | 'join', value: household name (create) or invite code (join)
 * Returns { error: string|null, field?: 'householdCode' }
 */
export async function completeSignupSetup({ userId, email, fullName, type, value }) {
  // Join: check the invite code before creating anything
  let joinHousehold = null;
  const code = type === 'join' ? value.trim().toUpperCase() : '';
  if (type === 'join') {
    const { data, error: findError } = await supabase.rpc('lookup_household_by_code', { p_code: code });
    if (findError) return { error: `Error finding household: ${findError.message}` };
    if (!data) return { error: 'Household not found. Check the invite code.', field: 'householdCode' };
    joinHousehold = data;
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    full_name: fullName.trim(),
    email,
    household_id: null,
  });
  if (profileError) return { error: `Failed to create profile: ${profileError.message}` };

  if (type === 'create') {
    const { data: household, error: householdError } = await supabase
      .from('households')
      .insert({ name: value.trim(), code: generateInviteCode(), created_by: userId })
      .select()
      .single();
    if (householdError) return { error: `Failed to create household: ${householdError.message}` };

    const { error: memberError } = await supabase.from('household_members').insert({
      household_id: household.id, user_id: userId, role: 'owner', status: 'active',
    });
    if (memberError) return { error: `Failed to add you to the household: ${memberError.message}` };

    const { error: updateError } = await supabase.from('profiles').update({ household_id: household.id }).eq('id', userId);
    if (updateError) return { error: `Household created, but profile update failed: ${updateError.message}` };
  } else if (type === 'join') {
    const { error: memberError } = await supabase.rpc('join_household_by_code', { p_code: code });
    if (memberError) return { error: `Failed to join household: ${memberError.message}` };

    const { error: updateError } = await supabase.from('profiles').update({ household_id: joinHousehold.id }).eq('id', userId);
    if (updateError) return { error: `Joined household, but profile update failed: ${updateError.message}` };
  }

  return { error: null };
}

/**
 * First login after confirming the email: run the saved setup if this user has
 * no profile yet. Safe to call on every login (does nothing once set up).
 * Returns an error message (the account still works — e.g. a household code
 * that expired; they can join from the Groups screen) or null.
 */
export async function finishPendingSignup(user) {
  if (!user) return null;
  const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (existing) return null;

  const meta = user.user_metadata || {};
  const result = await completeSignupSetup({
    userId: user.id,
    email: user.email,
    fullName: meta.full_name || user.email.split('@')[0],
    type: meta.household_type || 'none',
    value: meta.household_value || '',
  });
  return result.error;
}
