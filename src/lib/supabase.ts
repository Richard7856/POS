// Singleton Supabase client — safe to import from both client and server components.
// Fallback placeholders prevent createClient from throwing during Next.js static prerendering;
// all real data fetching happens client-side inside useEffect where env vars are available.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,      // keeps the session in localStorage between page loads
    autoRefreshToken: true,    // silently refreshes the JWT before it expires
    detectSessionInUrl: true,  // picks up the token from the URL after email magic links
  },
})
