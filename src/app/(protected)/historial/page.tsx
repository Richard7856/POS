'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { VentaWithItems } from '@/lib/types'
import DevolucionModal from '@/components/DevolucionModal'

const METODO_ICON: Record<string, string> = {
  efectivo:      '💵',
  tarjeta:       '💳',
  transferencia: '📲',
  mixto:         '💳💵',
}

// Returns YYYY-MM-DD for a given Date offset (0=today, -1=yesterday)
function isoDate(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export default function HistorialPage() {
  const { profile } = useAuth()

  // Default: today — stored as YYYY-MM-DD string for the <input type="date">
  const [selectedDate, setSelectedDate] = useState(isoDate(0))
  const [ventas, setVentas]     = useState<VentaWithItems[]>([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Devolucion modal state
  const [devolucionVenta, setDevolucionVenta] = useState<VentaWithItems | null>(null)

  const canReturn = profile?.rol === 'admin' || profile?.rol === 'encargado'

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setExpanded(null)

    // Query: all ventas for the selected date, within the user's sucursal.
    // Also fetch venta_pagos for mixed-payment sales and devolucion count.
    let query = supabase
      .from('ventas')
      .select('*, venta_items(*), venta_pagos(*), devoluciones(count)')
      .gte('created_at', `${selectedDate}T00:00:00`)
      .lte('created_at', `${selectedDate}T23:59:59`)
      .order('created_at', { ascending: false })

    if (profile.rol !== 'admin' && profile.sucursal_id) {
      query = query.eq('sucursal_id', profile.sucursal_id)
    }

    const { data, error } = await query
    if (error) console.error('Error cargando historial:', error.message)
    setVentas((data as VentaWithItems[]) ?? [])
    setLoading(false)
  }, [selectedDate, profile])

  useEffect(() => { load() }, [load])

  // ── Derived stats ───────────────────────────────────────────���──────────────
  const totalDia = ventas.reduce((s, v) => s + v.total, 0)

  // Breakdown by payment method — for mixto, show as a single 'mixto' entry
  const pagoMap = new Map<string, { total: number; count: number }>()
  for (const v of ventas) {
    const key  = v.metodo_pago
    const prev = pagoMap.get(key) ?? { total: 0, count: 0 }
    pagoMap.set(key, { total: prev.total + v.total, count: prev.count + 1 })
  }
  const pagos = [...pagoMap.entries()].sort((a, b) => b[1].total - a[1].total)

  // ── Date label for the header ──────────────────────────────────────────────
  const fechaLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const isHoy  = selectedDate === isoDate(0)
  const isAyer = selectedDate === isoDate(-1)

  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto overflow-y-auto h-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800 mb-3">📋 Historial de ventas</h1>

        {/* Date selector + quick jumps */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedDate(isoDate(0))}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isHoy ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Hoy
          </button>
          <button
            onClick={() => setSelectedDate(isoDate(-1))}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isAyer ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Ayer
          </button>
          <input
            type="date"
            value={selectedDate}
            max={isoDate(0)}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          />
        </div>
      </div>

      {/* ── Summary card ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-gray-700 capitalize">{fechaLabel}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'}
            </p>
          </div>
          <p className="text-2xl font-bold text-green-700 tabular-nums">
            ${totalDia.toFixed(2)}
          </p>
        </div>

        {pagos.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 flex-wrap">
            {pagos.map(([metodo, { total, count }]) => (
              <div key={metodo} className="flex items-center gap-1.5 text-sm">
                <span>{METODO_ICON[metodo] ?? '💰'}</span>
                <span className="text-gray-600 capitalize">{metodo}</span>
                <span className="font-semibold tabular-nums text-gray-800">
                  ${total.toFixed(2)}
                </span>
                <span className="text-gray-400 text-xs">({count})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sales list ─────────────────────────────────────────────────────── */}
      {ventas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <div className="text-5xl mb-3">🧾</div>
          <div className="text-sm text-gray-400">
            No hay ventas registradas {isHoy ? 'hoy' : isAyer ? 'ayer' : `el ${fechaLabel}`}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {ventas.map((venta) => {
            const hasDevolucion = (venta.devoluciones?.[0]?.count ?? 0) > 0
            return (
              <div
                key={venta.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* Row header — tap to expand */}
                <button
                  onClick={() => setExpanded(expanded === venta.id ? null : venta.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">
                        {new Date(venta.created_at).toLocaleTimeString('es-MX', {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      {/* Return badge */}
                      {hasDevolucion && (
                        <span className="text-[10px] bg-red-100 text-red-600 font-semibold px-1.5 py-0.5 rounded-full">
                          ↩ Devuelta
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {venta.metodo_pago === 'mixto' ? (
                        // Show individual split amounts
                        <span>
                          {(venta.venta_pagos ?? []).map((p, i) => (
                            <span key={p.id}>
                              {i > 0 && ' + '}
                              {METODO_ICON[p.metodo] ?? ''} ${p.monto.toFixed(0)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="capitalize">
                          {METODO_ICON[venta.metodo_pago] ?? ''} {venta.metodo_pago}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-green-700 tabular-nums">
                      ${venta.total.toFixed(2)}
                    </span>
                    <span className="text-gray-300 text-xs">
                      {expanded === venta.id ? '▲' : '▼'}
                    </span>
                  </div>
                </button>

                {/* Expanded: items + devolucion button */}
                {expanded === venta.id && (
                  <div className="border-t border-gray-100 bg-gray-50">
                    <div className="px-5 py-3 space-y-1">
                      {venta.venta_items?.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-gray-600">
                            {item.nombre_producto}{' '}
                            <span className="text-gray-400 tabular-nums">
                              ({item.cantidad} {item.unidad})
                            </span>
                          </span>
                          <span className="text-gray-700 tabular-nums">
                            ${item.subtotal.toFixed(2)}
                          </span>
                        </div>
                      ))}
                      {venta.descuento > 0 && (
                        <div className="flex justify-between text-xs text-amber-600 pt-1">
                          <span>Descuento aplicado</span>
                          <span>−${venta.descuento.toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    {/* Devolucion button — encargado/admin only */}
                    {canReturn && !hasDevolucion && (
                      <div className="px-5 pb-3">
                        <button
                          onClick={() => setDevolucionVenta(venta)}
                          className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-full transition-colors"
                        >
                          ↩ Procesar devolución
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Devolucion modal */}
      {devolucionVenta && (
        <DevolucionModal
          ventaId={devolucionVenta.id}
          items={devolucionVenta.venta_items ?? []}
          onConfirm={() => { setDevolucionVenta(null); load() }}
          onClose={() => setDevolucionVenta(null)}
        />
      )}
    </div>
  )
}
