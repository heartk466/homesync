import { createClient, processLock } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variable.')
}

// processLock: the default cross-tab navigator lock can get stuck (e.g. after the
// tab sat in the background) and then every request hangs forever.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { lock: processLock },
})
