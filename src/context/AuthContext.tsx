'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => null,
  signOut: async () => {},
})

// Cache key: stores { userId, profile } so the profile is available instantly
// on every page load after the first visit, eliminating the RouteGuard spinner.
const PROFILE_CACHE_KEY = 'pos_profile_v1'

function getCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const { id, data } = JSON.parse(raw) as { id: string; data: Profile }
    return id === userId ? data : null
  } catch {
    return null
  }
}

function setCachedProfile(userId: string, profile: Profile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ id: userId, data: profile }))
  } catch { /* quota exceeded or private browsing — silently ignore */ }
}

function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY) } catch { /* ignore */ }
}

// Fetches the profile row for a given user ID, including the sucursal name.
// Returns null if not found (e.g. trigger hasn't run yet on first sign-in).
async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*, sucursal:sucursales(id, nombre, direccion, activa, created_at)')
    .eq('id', userId)
    .single()
  return data ?? null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (u: User) => {
    // Restore from cache immediately so the spinner clears without a network round-trip.
    // Then fetch fresh data in the background and update if anything changed.
    const cached = getCachedProfile(u.id)
    if (cached) {
      setProfile(cached)
      setLoading(false)
      // Background refresh — update cache and state if data changed
      fetchProfile(u.id).then((fresh) => {
        if (fresh) {
          setCachedProfile(u.id, fresh)
          setProfile(fresh)
        }
      })
    } else {
      // First visit: must wait for the network response
      const p = await fetchProfile(u.id)
      if (p) {
        setCachedProfile(u.id, p)
        setProfile(p)
      }
    }
  }, [])

  useEffect(() => {
    // getSession resolves from localStorage without a network request — fast.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Subscribe to auth events (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          await loadProfile(session.user)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error?.message ?? null
  }, [])

  const signOut = useCallback(async () => {
    clearCachedProfile() // remove cache on logout so next user starts clean
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
