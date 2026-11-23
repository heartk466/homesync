import { createClient, processLock } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variable.')
}

// Opened from the sign-up verification email? Read before the client starts —
// it clears the tokens from the address bar as soon as it signs the user in.
export const openedFromVerifyLink = typeof window !== 'undefined'
  && /(?:^|[#&?])type=(?:signup|email)(?:&|$)/.test(window.location.hash + window.location.search)

// processLock: the default cross-tab navigator lock can get stuck (e.g. after the
// tab sat in the background) and then every request hangs forever.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { lock: processLock },
})
