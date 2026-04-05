'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

// Wraps all protected pages. Redirects to /login if there is no active session.
// Shows a spinner while the auth state is being resolved from localStorage.
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // user is null → redirect is in flight; render nothing to avoid flash
  if (!user) return null

  return <>{children}</>
}
