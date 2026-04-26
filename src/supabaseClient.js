import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ebmbfwxddwkxrdejfoth.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVibWJmd3hkZHdreHJkZWpmb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzMwNzQsImV4cCI6MjA5MjMwOTA3NH0.Ztq4PRbrJW9dmeBC-kWA0N29R6XDGyPqQQ2B_grPk4w'

export const supabase = createClient(supabaseUrl, supabaseKey)