'use client'

// Global offline/online sync provider.
// Wraps the entire app (inside AuthProvider) to:
//   1. Show a persistent "Sin conexión" banner when offline
//   2. Flush the offlineQueue when the connection is restored
//   3. Show a brief "Cambios sincronizados ✓" toast after a successful flush

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { syncQueue, getPendingCount } from '@/lib/offlineQueue'

export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]   = useState(true)   // optimistic default
  const [syncing, setSyncing]     = useState(false)
  const [toast, setToast]         = useState<string | null>(null)
  const [pending, setPending]     = useState(0)

  // Refresh pending count (called after each write, on mount, and after sync)
  const refreshPending = useCallback(() => setPending(getPendingCount()), [])

  const handleOnline = useCallback(async () => {
    setIsOnline(true)
    const count = getPendingCount()
    if (count === 0) return

    setSyncing(true)
    const { synced, failed } = await syncQueue(supabase)
    setSyncing(false)
    refreshPending()

    if (synced > 0 && failed === 0) {
      setToast(`✓ ${synced} cambio${synced !== 1 ? 's' : ''} sincronizado${synced !== 1 ? 's' : ''}`)
      setTimeout(() => setToast(null), 3500)
    } else if (failed > 0) {
      setToast(`⚠ ${failed} cambio${failed !== 1 ? 's' : ''} no se pudo sincronizar`)
      setTimeout(() => setToast(null), 5000)
    }
  }, [refreshPending])

  useEffect(() => {
    // Sync the initial state with the real browser value on mount
    setIsOnline(navigator.onLine)
    refreshPending()

    const onOnline  = () => handleOnline()
    const onOffline = () => setIsOnline(false)

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [handleOnline, refreshPending])

  // Expose refreshPending globally so pages can call it after each offline write
  // without needing prop drilling. Attach to window so it's reachable anywhere.
  useEffect(() => {
    (window as Window & { __posRefreshPending?: () => void }).__posRefreshPending = refreshPending
    return () => { delete (window as Window & { __posRefreshPending?: () => void }).__posRefreshPending }
  }, [refreshPending])

  return (
    <>
      {children}

      {/* Offline banner — persistent while offline */}
      {!isOnline && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-amber-500 text-white text-sm font-medium flex items-center justify-center gap-2 py-2 px-4">
          <span>📵</span>
          <span>Sin conexión{pending > 0 ? ` · ${pending} cambio${pending !== 1 ? 's' : ''} pendiente${pending !== 1 ? 's' : ''}` : ''}</span>
        </div>
      )}

      {/* Syncing indicator */}
      {syncing && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-green-600 text-white text-sm font-medium flex items-center justify-center gap-2 py-2 px-4">
          <span className="animate-spin">⟳</span>
          <span>Sincronizando cambios pendientes...</span>
        </div>
      )}

      {/* Success / error toast */}
      {toast && !syncing && (
        <div
          className={`fixed bottom-4 left-4 right-4 z-50 rounded-xl text-white text-sm font-medium text-center py-3 px-4 shadow-lg transition-all ${
            toast.startsWith('✓') ? 'bg-green-600' : 'bg-red-500'
          }`}
        >
          {toast}
        </div>
      )}
    </>
  )
}
