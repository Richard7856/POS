'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductoReorden {
  id: string
  nombre: string
  categoria: string | null
  unidad: string
  stock_minimo: number
  stock_actual: number
  // How much to order to reach the minimum (or double it as a suggested quantity)
  faltante: number
  urgencia: 'agotado' | 'critico' | 'bajo'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgenciaConfig(u: ProductoReorden['urgencia']) {
  switch (u) {
    case 'agotado':  return { label: 'Agotado',  dot: 'bg-red-500',    row: 'bg-red-50',    text: 'text-red-700'    }
    case 'critico':  return { label: 'Crítico',  dot: 'bg-orange-400', row: 'bg-orange-50', text: 'text-orange-700' }
    case 'bajo':     return { label: 'Bajo',     dot: 'bg-yellow-400', row: 'bg-yellow-50', text: 'text-yellow-700' }
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PedidoPage() {
  const { profile, loading: authLoading } = useAuth()
  const router = useRouter()

  // Redirect cajeros — reorder view is staff only
  useEffect(() => {
    if (!authLoading && profile?.rol === 'cajero') router.replace('/pos')
  }, [profile, authLoading, router])

  const [loading, setLoading]   = useState(true)
  const [items, setItems]       = useState<ProductoReorden[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const isAdmin = profile?.rol === 'admin'

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)

    // 1. Fetch all active kg/g products that have a stock_minimo set
    const { data: products } = await supabase
      .from('products')
      .select('id, nombre, categoria, unidad, stock_minimo')
      .eq('activo', true)
      .in('unidad', ['kg', 'g'])
      .not('stock_minimo', 'is', null)
      .order('categoria', { ascending: true })
      .order('nombre', { ascending: true })

    if (!products || products.length === 0) {
      setItems([])
      setLoading(false)
      return
    }

    // 2. Fetch active lotes for those products in the relevant sucursal(es)
    //    Admin sees all sucursales; encargado sees only their own
    const productIds = products.map((p) => p.id)

    let lotesQuery = supabase
      .from('lotes')
      .select('product_id, cantidad_disponible')
      .in('product_id', productIds)
      .gt('cantidad_disponible', 0)

    if (!isAdmin && profile.sucursal_id) {
      lotesQuery = lotesQuery.eq('sucursal_id', profile.sucursal_id)
    }

    const { data: lotes } = await lotesQuery

    // 3. Sum available stock per product
    const stockMap = new Map<string, number>()
    for (const l of lotes ?? []) {
      stockMap.set(l.product_id, (stockMap.get(l.product_id) ?? 0) + l.cantidad_disponible)
    }

    // 4. Build reorder list — only products below their minimum
    const reorden: ProductoReorden[] = []
    for (const p of products) {
      const stockActual = stockMap.get(p.id) ?? 0
      const minimo      = p.stock_minimo as number

      if (stockActual >= minimo) continue // OK, no need to order

      const pct = stockActual / minimo

      reorden.push({
        id:          p.id,
        nombre:      p.nombre,
        categoria:   p.categoria,
        unidad:      p.unidad,
        stock_minimo: minimo,
        stock_actual: parseFloat(stockActual.toFixed(3)),
        faltante:    parseFloat((minimo - stockActual).toFixed(3)),
        urgencia:    stockActual === 0 ? 'agotado' : pct < 0.25 ? 'critico' : 'bajo',
      })
    }

    // Sort by urgency: agotado → critico → bajo, then alphabetically
    const ORDEN = { agotado: 0, critico: 1, bajo: 2 }
    reorden.sort((a, b) => ORDEN[a.urgencia] - ORDEN[b.urgencia] || a.nombre.localeCompare(b.nombre))

    setItems(reorden)
    setLastUpdated(new Date())
    setLoading(false)
  }, [profile, isAdmin])

  useEffect(() => { if (profile) load() }, [profile, load])

  // ── Share / print as plain text list ──────────────────────────────────────
  const handleCompartir = () => {
    const fecha = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    const lineas = [
      `📦 PEDIDO — ${fecha}`,
      isAdmin ? '(todas las sucursales)' : `Sucursal: ${profile?.sucursal?.nombre ?? ''}`,
      '',
      ...items.map((item) => {
        const emoji = item.urgencia === 'agotado' ? '🔴' : item.urgencia === 'critico' ? '🟠' : '🟡'
        return `${emoji} ${item.nombre.padEnd(24)} necesita ${item.faltante.toFixed(1)} kg  (tiene ${item.stock_actual.toFixed(1)} / mín ${item.stock_minimo} kg)`
      }),
    ]
    const texto = lineas.join('\n')

    if (navigator.share) {
      navigator.share({ title: 'Pedido', text: texto }).catch(() => null)
    } else {
      navigator.clipboard.writeText(texto).then(() => {
        alert('Lista copiada al portapapeles ✓')
      })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || !profile) return null

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto overflow-y-auto h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🛒 Lista de pedido</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {isAdmin
              ? 'Productos bajo mínimo — todas las sucursales'
              : `Sucursal: ${profile.sucursal?.nombre ?? '—'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="text-sm text-gray-400 hover:text-green-700 transition-colors px-2 py-1"
            title="Actualizar"
          >
            ↻
          </button>
          {items.length > 0 && (
            <button
              onClick={handleCompartir}
              className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Compartir lista
            </button>
          )}
        </div>
      </div>

      {lastUpdated && (
        <p className="text-xs text-gray-300 mb-4">
          Actualizado: {lastUpdated.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-gray-400 text-sm py-8 text-center">Calculando stock...</div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-600 font-medium">Todo en orden</p>
          <p className="text-sm text-gray-400 mt-1">
            Todos los productos están por encima de su mínimo configurado
          </p>
          <p className="text-xs text-gray-300 mt-3">
            Configura el stock mínimo de cada producto en la sección Productos → Editar
          </p>
        </div>
      )}

      {/* Reorder list */}
      {!loading && items.length > 0 && (
        <>
          {/* Summary pills */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['agotado', 'critico', 'bajo'] as const).map((u) => {
              const count = items.filter((i) => i.urgencia === u).length
              if (count === 0) return null
              const cfg = urgenciaConfig(u)
              return (
                <span key={u} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full ${cfg.row} ${cfg.text}`}>
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  {count} {cfg.label}{count !== 1 ? 's' : ''}
                </span>
              )
            })}
          </div>

          {/* Cards grouped by category */}
          {groupByCategoria(items).map(([cat, grupo]) => (
            <div key={cat} className="mb-5">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                {cat}
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-100">
                {grupo.map((item) => {
                  const cfg = urgenciaConfig(item.urgencia)
                  const pct = item.stock_minimo > 0
                    ? Math.max(0, (item.stock_actual / item.stock_minimo) * 100)
                    : 0
                  return (
                    <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${item.urgencia === 'agotado' ? 'bg-red-50/50' : ''}`}>

                      {/* Urgency dot */}
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />

                      {/* Name + bar */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 text-sm">{item.nombre}</p>
                        {/* Mini stock bar */}
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full max-w-[120px]">
                            <div
                              className={`h-1.5 rounded-full ${
                                item.urgencia === 'agotado' ? 'bg-red-400' :
                                item.urgencia === 'critico' ? 'bg-orange-400' : 'bg-yellow-400'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 tabular-nums">
                            {item.stock_actual.toFixed(1)} / {item.stock_minimo} kg
                          </span>
                        </div>
                      </div>

                      {/* Faltante — what to order */}
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold tabular-nums text-sm ${cfg.text}`}>
                          +{item.faltante.toFixed(1)} kg
                        </p>
                        <p className="text-xs text-gray-300">para llegar al mínimo</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── Helper: group items by category ─────────────────────────────────────────
function groupByCategoria(items: ProductoReorden[]): [string, ProductoReorden[]][] {
  const map = new Map<string, ProductoReorden[]>()
  for (const item of items) {
    const key = item.categoria ?? 'Sin categoría'
    const arr = map.get(key) ?? []
    arr.push(item)
    map.set(key, arr)
  }
  return [...map.entries()]
}
