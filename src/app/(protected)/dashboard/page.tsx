'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { DashboardSkeleton } from '@/components/Skeleton'

// ─── Local Types ──────────────────────────────────────────────────────────────

interface KpiBlock {
  label: string
  value: string
  sub?: string
  color?: string   // Tailwind text color class
}

interface TopProducto {
  nombre: string
  total_kg: number
  total_pesos: number
  veces: number
}

interface PagoBreakdown {
  metodo_pago: string
  total: number
  count: number
}

interface SucursalRow {
  sucursal_id: string
  nombre: string
  total_ventas: number
  num_ventas: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date) {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function startOfWeek(d: Date) {
  // Week starts Monday
  const r = new Date(d)
  const day = r.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  r.setDate(r.getDate() + diff)
  r.setHours(0, 0, 0, 0)
  return r
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function toISO(d: Date) {
  return d.toISOString()
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n)
}

const METODO_LABEL: Record<string, string> = {
  efectivo: '💵 Efectivo',
  tarjeta: '💳 Tarjeta',
  transferencia: '📲 Transferencia',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { profile, loading: authLoading } = useAuth()
  const router = useRouter()

  const isAdmin   = profile?.rol === 'admin'
  const isStaff   = isAdmin || profile?.rol === 'encargado'

  // Redirect cajeros away — dashboard is staff-only
  useEffect(() => {
    if (!authLoading && profile?.rol === 'cajero') router.replace('/pos')
  }, [profile, authLoading, router])

  const [loading, setLoading]             = useState(true)
  const [kpisHoy, setKpisHoy]             = useState<KpiBlock[]>([])
  const [kpisSemana, setKpisSemana]       = useState<KpiBlock[]>([])
  const [kpisMes, setKpisMes]             = useState<KpiBlock[]>([])
  const [topProductos, setTopProductos]   = useState<TopProducto[]>([])
  const [pagosHoy, setPagosHoy]           = useState<PagoBreakdown[]>([])
  const [sucursales, setSucursales]       = useState<SucursalRow[]>([])
  const [mermaPct, setMermaPct]           = useState<number | null>(null)
  // Count of products below their stock minimum — shown as alert banner
  const [productosAgotados, setProductosAgotados] = useState(0)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)

    const now    = new Date()
    const today  = toISO(startOfDay(now))
    const lunes  = toISO(startOfWeek(now))
    const mes    = toISO(startOfMonth(now))

    // ── Round 1: 5 independent queries fired in parallel ─────────────────────
    // Previously these ran sequentially (each blocked by the previous).
    // sucursalesQuery only makes sense for admin — non-admins get a null promise.
    let ventasQ = supabase
      .from('ventas')
      .select('id, total, metodo_pago, sucursal_id, created_at')
      .gte('created_at', mes)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (!isAdmin && profile.sucursal_id) ventasQ = ventasQ.eq('sucursal_id', profile.sucursal_id)

    let mermaQ = supabase.from('mermas').select('cantidad').gte('created_at', mes)
    let lotesQ = supabase.from('lotes').select('cantidad_inicial').gte('created_at', mes)
    if (!isAdmin && profile.sucursal_id) {
      mermaQ = mermaQ.eq('sucursal_id', profile.sucursal_id)
      lotesQ = lotesQ.eq('sucursal_id', profile.sucursal_id)
    }

    let prodsMinQ = supabase
      .from('products')
      .select('id, stock_minimo')
      .eq('activo', true)
      .in('unidad', ['kg', 'g'])
      .not('stock_minimo', 'is', null)
    if (!isAdmin && profile.sucursal_id) prodsMinQ = prodsMinQ.eq('sucursal_id', profile.sucursal_id)

    const sucQ = isAdmin
      ? supabase.from('sucursales').select('id, nombre').eq('activa', true).order('nombre')
      : null

    const [
      { data: ventasMes },
      { data: mermasData },
      { data: lotesData },
      { data: productsConMinimo },
      sucResult,
    ] = await Promise.all([
      ventasQ,
      mermaQ,
      lotesQ,
      prodsMinQ,
      sucQ ?? Promise.resolve({ data: null }),
    ])

    const ventasData = ventasMes ?? []

    // ── Round 2: 2 queries that depend on Round 1 results, fired in parallel ──
    const ventaIds = ventasData.map((v) => v.id)
    const pids     = (productsConMinimo ?? []).map((p) => p.id)

    let lotesMinQ = supabase
      .from('lotes')
      .select('product_id, cantidad_disponible')
      .gt('cantidad_disponible', 0)
    if (pids.length > 0) lotesMinQ = lotesMinQ.in('product_id', pids)
    if (!isAdmin && profile.sucursal_id) lotesMinQ = lotesMinQ.eq('sucursal_id', profile.sucursal_id)

    const [itemsResult, { data: lotesMin }] = await Promise.all([
      ventaIds.length > 0
        ? supabase
            .from('venta_items')
            .select('nombre_producto, cantidad, unidad, subtotal')
            .in('venta_id', ventaIds)
            .in('unidad', ['kg', 'g'])
        : Promise.resolve({ data: [] as { nombre_producto: string; cantidad: number; unidad: string; subtotal: number }[] }),
      pids.length > 0 ? lotesMinQ : Promise.resolve({ data: [] as { product_id: string; cantidad_disponible: number }[] }),
    ])

    // ── Derive KPIs from in-memory ventas (no extra queries) ──────────────────
    const ventasHoy    = ventasData.filter((v) => v.created_at >= today)
    const ventasSemana = ventasData.filter((v) => v.created_at >= lunes)

    function buildKpis(ventas: typeof ventasData): KpiBlock[] {
      const total   = ventas.reduce((s, v) => s + v.total, 0)
      const count   = ventas.length
      const ticket  = count > 0 ? total / count : 0
      return [
        { label: 'Total vendido',   value: fmt(total), color: 'text-green-700' },
        { label: 'Ventas',          value: count.toString() },
        { label: 'Ticket promedio', value: fmt(ticket) },
      ]
    }

    setKpisHoy(buildKpis(ventasHoy))
    setKpisSemana(buildKpis(ventasSemana))
    setKpisMes(buildKpis(ventasData))

    // Métodos de pago (hoy) — computed from already-fetched ventas
    const pagoMap = new Map<string, { total: number; count: number }>()
    for (const v of ventasHoy) {
      const prev = pagoMap.get(v.metodo_pago) ?? { total: 0, count: 0 }
      pagoMap.set(v.metodo_pago, { total: prev.total + v.total, count: prev.count + 1 })
    }
    setPagosHoy(
      [...pagoMap.entries()]
        .map(([metodo_pago, { total, count }]) => ({ metodo_pago, total, count }))
        .sort((a, b) => b.total - a.total)
    )

    // Top productos — computed from venta_items fetched in Round 2
    const items = itemsResult.data ?? []
    if (items.length > 0) {
      const productMap = new Map<string, TopProducto>()
      for (const item of items) {
        const kgQty = item.unidad === 'g' ? item.cantidad / 1000 : item.cantidad
        const prev = productMap.get(item.nombre_producto) ?? {
          nombre: item.nombre_producto, total_kg: 0, total_pesos: 0, veces: 0,
        }
        productMap.set(item.nombre_producto, {
          ...prev,
          total_kg:    parseFloat((prev.total_kg + kgQty).toFixed(3)),
          total_pesos: prev.total_pesos + item.subtotal,
          veces:       prev.veces + 1,
        })
      }
      setTopProductos([...productMap.values()].sort((a, b) => b.total_pesos - a.total_pesos).slice(0, 8))
    } else {
      setTopProductos([])
    }

    // Merma % — from Round 1 results
    const kgMerma   = (mermasData ?? []).reduce((s, m) => s + m.cantidad, 0)
    const kgEntrada = (lotesData  ?? []).reduce((s, l) => s + l.cantidad_inicial, 0)
    setMermaPct(kgEntrada > 0 ? (kgMerma / kgEntrada) * 100 : null)

    // Comparativa sucursales (admin only) — from Round 1 results
    if (isAdmin && sucResult.data) {
      const sucMap = new Map<string, { total: number; count: number }>()
      for (const v of ventasData) {
        if (!v.sucursal_id) continue
        const prev = sucMap.get(v.sucursal_id) ?? { total: 0, count: 0 }
        sucMap.set(v.sucursal_id, { total: prev.total + v.total, count: prev.count + 1 })
      }
      setSucursales(
        sucResult.data.map((s) => ({
          sucursal_id:  s.id,
          nombre:       s.nombre,
          total_ventas: sucMap.get(s.id)?.total ?? 0,
          num_ventas:   sucMap.get(s.id)?.count ?? 0,
        })).sort((a, b) => b.total_ventas - a.total_ventas)
      )
    }

    // Productos bajo mínimo — from Round 2 lotes results
    if (productsConMinimo && productsConMinimo.length > 0) {
      const stockActualMap = new Map<string, number>()
      for (const l of lotesMin ?? []) {
        stockActualMap.set(l.product_id, (stockActualMap.get(l.product_id) ?? 0) + l.cantidad_disponible)
      }
      setProductosAgotados(
        productsConMinimo.filter(
          (p) => (stockActualMap.get(p.id) ?? 0) < (p.stock_minimo as number)
        ).length
      )
    }

    setLoading(false)
  }, [profile, isAdmin])

  useEffect(() => { if (profile && isStaff) load() }, [profile, isStaff, load])

  if (authLoading || !profile) return <DashboardSkeleton />
  if (loading) return <DashboardSkeleton />

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto overflow-y-auto h-full space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">📊 Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {isAdmin ? 'Vista global de todas las sucursales' : `Sucursal: ${profile.sucursal?.nombre ?? '—'}`}
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm text-gray-400 hover:text-green-700 flex items-center gap-1 transition-colors"
        >
          ↻ Actualizar
        </button>
      </div>

      {/* Alerta de productos bajo mínimo */}
      {productosAgotados > 0 && (
        <Link
          href="/inventario/pedido"
          className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 hover:bg-orange-100 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛒</span>
            <div>
              <p className="font-semibold text-orange-800 text-sm">
                {productosAgotados} producto{productosAgotados !== 1 ? 's' : ''} bajo mínimo
              </p>
              <p className="text-xs text-orange-500">Ver lista de pedido →</p>
            </div>
          </div>
          <span className="text-orange-300 group-hover:text-orange-500 text-lg transition-colors">›</span>
        </Link>
      )}

      {/* Period KPI sections */}
      {(
        [
          { title: 'Hoy',         kpis: kpisHoy    },
          { title: 'Esta semana', kpis: kpisSemana },
          { title: 'Este mes',    kpis: kpisMes    },
        ]
      ).map(({ title, kpis }) => (
        <section key={title}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</h2>
          <div className="grid grid-cols-3 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className={`text-xl font-bold tabular-nums mt-0.5 ${k.color ?? 'text-gray-800'}`}>{k.value}</p>
                {k.sub && <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Bottom row: métodos de pago + merma */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Métodos de pago hoy */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Métodos de pago — hoy</h2>
          {pagosHoy.length === 0 ? (
            <p className="text-sm text-gray-400">Sin ventas hoy</p>
          ) : (
            <div className="space-y-2">
              {pagosHoy.map((p) => (
                <div key={p.metodo_pago} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{METODO_LABEL[p.metodo_pago] ?? p.metodo_pago}</span>
                  <div className="text-right">
                    <span className="font-semibold text-gray-800">{fmt(p.total)}</span>
                    <span className="text-gray-400 ml-1 text-xs">({p.count} vta{p.count !== 1 ? 's' : ''})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Merma % este mes */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Merma — este mes</h2>
          {mermaPct === null ? (
            <p className="text-sm text-gray-400">Sin entradas de mercancía este mes</p>
          ) : (
            <div>
              <p className={`text-3xl font-bold tabular-nums ${mermaPct > 10 ? 'text-red-600' : mermaPct > 5 ? 'text-yellow-600' : 'text-green-700'}`}>
                {mermaPct.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-400 mt-1">
                kg merma / kg entrada registradas
              </p>
              {/* Visual bar */}
              <div className="w-full h-2 bg-gray-100 rounded-full mt-3">
                <div
                  className={`h-2 rounded-full transition-all ${mermaPct > 10 ? 'bg-red-400' : mermaPct > 5 ? 'bg-yellow-400' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(mermaPct, 30) / 30 * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-300 mt-1">
                <span>0%</span><span>Óptimo &lt;5%</span><span>30%+</span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Top productos */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Top productos — este mes (kg/g)</h2>
        </div>
        {topProductos.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">Sin ventas de productos a granel este mes</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">#</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Producto</th>
                <th className="text-right px-4 py-2 text-gray-500 font-medium">kg vendidos</th>
                <th className="text-right px-4 py-2 text-gray-500 font-medium">Total $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topProductos.map((p, i) => (
                <tr key={p.nombre} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400 font-medium">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{p.nombre}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {p.total_kg.toFixed(2)} kg
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-green-700">
                    {fmt(p.total_pesos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Comparativa sucursales — admin only */}
      {isAdmin && sucursales.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Comparativa sucursales — este mes</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Sucursal</th>
                <th className="text-right px-4 py-2 text-gray-500 font-medium">Ventas</th>
                <th className="text-right px-4 py-2 text-gray-500 font-medium">Total $</th>
                <th className="text-right px-4 py-2 text-gray-500 font-medium">Ticket prom.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sucursales.map((s) => (
                <tr key={s.sucursal_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{s.nombre}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{s.num_ventas}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-green-700">
                    {fmt(s.total_ventas)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {s.num_ventas > 0 ? fmt(s.total_ventas / s.num_ventas) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

    </div>
  )
}
