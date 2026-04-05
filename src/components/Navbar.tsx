'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// Visible to all authenticated roles
const BASE_LINKS = [
  { href: '/pos',                  label: 'POS',       icon: '🛒' },
  { href: '/productos',            label: 'Productos',  icon: '🥑' },
  { href: '/historial',            label: 'Historial',  icon: '📋' },
  { href: '/inventario/merma',     label: 'Merma',      icon: '🗑️' },
]

// Only visible to admin and encargado
const STAFF_LINKS = [
  { href: '/dashboard',            label: 'Dashboard',  icon: '📊' },
  { href: '/inventario',           label: 'Inventario', icon: '📦' },
  { href: '/historial/corte',      label: 'Corte',      icon: '🏦' },
  { href: '/admin',                label: 'Admin',      icon: '⚙️' },
]

// Role badge colors
const ROL_COLORS: Record<string, string> = {
  admin:   'bg-yellow-400 text-yellow-900',
  encargado: 'bg-blue-400 text-blue-900',
  cajero:  'bg-green-300 text-green-900',
}

/**
 * Determines if a nav link should appear "active".
 * Rules:
 * - /historial/corte: exact match only (not on /historial)
 * - /inventario: active on /inventario and sub-routes EXCEPT /inventario/merma
 * - everything else: startsWith match
 */
function isLinkActive(href: string, pathname: string): boolean {
  if (href === '/historial/corte') return pathname === '/historial/corte'
  if (href === '/historial') return pathname === '/historial'
  if (href === '/inventario') {
    return pathname === '/inventario' ||
      (pathname.startsWith('/inventario/') && pathname !== '/inventario/merma')
  }
  return pathname.startsWith(href)
}

export default function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, signOut } = useAuth()

  // Count products below stock minimum for the alert badge on Inventario link
  const [bajosMinimo, setBajosMinimo] = useState(0)

  const isStaff = profile?.rol === 'admin' || profile?.rol === 'encargado'

  useEffect(() => {
    if (!isStaff || !profile) return

    // Lightweight check: fetch products with minimum + their stock
    async function checkStock() {
      const { data: prods } = await supabase
        .from('products')
        .select('id, stock_minimo')
        .eq('activo', true)
        .in('unidad', ['kg', 'g'])
        .not('stock_minimo', 'is', null)

      if (!prods || prods.length === 0) return

      let q = supabase
        .from('lotes')
        .select('product_id, cantidad_disponible')
        .in('product_id', prods.map((p) => p.id))
        .gt('cantidad_disponible', 0)

      if (profile?.rol !== 'admin' && profile?.sucursal_id) {
        q = q.eq('sucursal_id', profile.sucursal_id)
      }

      const { data: lotes } = await q
      const stockMap = new Map<string, number>()
      for (const l of lotes ?? []) {
        stockMap.set(l.product_id, (stockMap.get(l.product_id) ?? 0) + l.cantidad_disponible)
      }
      const count = prods.filter((p) => (stockMap.get(p.id) ?? 0) < (p.stock_minimo as number)).length
      setBajosMinimo(count)
    }

    checkStock()
    // Refresh badge every 5 minutes while the app is open
    const interval = setInterval(checkStock, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [profile, isStaff])

  // Don't render nav chrome on the login page
  if (pathname === '/login') return null

  const visibleLinks = [
    ...BASE_LINKS,
    ...(isStaff ? STAFF_LINKS : []),
  ]

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  return (
    <nav className="bg-green-700 text-white shadow-md flex-shrink-0">
      <div className="flex items-center justify-between px-4 py-2 gap-2">

        {/* Logo + branch name */}
        <div className="flex flex-col leading-tight min-w-0">
          <span className="font-bold text-lg tracking-tight whitespace-nowrap">
            🌿<span className="hidden sm:inline"> POS Verde</span>
          </span>
          {/* Branch name — tablet+ only */}
          {profile?.sucursal?.nombre && (
            <span className="hidden md:block text-green-200 text-xs truncate">
              {profile.sucursal.nombre}
            </span>
          )}
        </div>

        {/* Nav links */}
        <div className="flex gap-1 flex-1 justify-center">
          {visibleLinks.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isLinkActive(href, pathname)
                  ? 'bg-green-900 text-white'
                  : 'text-green-100 hover:bg-green-600'
              }`}
            >
              <span>{icon}</span>
              <span className="hidden sm:inline">{label}</span>
              {/* Alert badge — only on Inventario when products are below minimum */}
              {href === '/inventario' && bajosMinimo > 0 && (
                <span className="absolute -top-1 -right-1 bg-orange-400 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                  {bajosMinimo}
                </span>
              )}
            </Link>
          ))}
        </div>

        {/* User info + sign-out */}
        {user && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Role badge — hidden on small mobile */}
            {profile?.rol && (
              <span className={`hidden sm:inline text-xs font-bold px-2 py-0.5 rounded-full ${ROL_COLORS[profile.rol] ?? 'bg-gray-300 text-gray-800'}`}>
                {profile.rol}
              </span>
            )}
            {/* User name — md+ only */}
            <span className="hidden md:inline text-sm text-green-100 truncate max-w-[120px]">
              {profile?.nombre ?? user.email}
            </span>
            <button
              onClick={handleSignOut}
              title="Cerrar sesión"
              className="text-green-200 hover:text-white hover:bg-green-600 rounded-md p-1.5 transition-colors text-lg leading-none"
            >
              ↩
            </button>
          </div>
        )}

      </div>
    </nav>
  )
}
