'use client'

/**
 * Corte de Caja
 *
 * Cash drawer reconciliation page for admin and encargado.
 *
 * Formula:
 *   efectivo_esperado = ventas_efectivo + fondo_inicial − gastos − retiros
 *   diferencia = efectivo_contado − efectivo_esperado
 *
 * Cash movements (movimientos_caja) must be registered during the day.
 * They are fetched here and shown in a breakdown section before the count input.
 * When the corte is saved, the movement totals are snapshotted in the cortes row
 * so historical records remain accurate even if movements are later edited.
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import type { Corte, MovimientoCaja } from '@/lib/types'
import MovimientoCajaModal from '@/components/MovimientoCajaModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function fmtPeso(n: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
  }).format(n)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CorteCajaPage() {
  const { profile, user } = useAuth()
  const router = useRouter()

  const canCorte = profile?.rol === 'admin' || profile?.rol === 'encargado'

  useEffect(() => {
    if (profile && profile.rol === 'cajero') router.replace('/historial')
  }, [profile, router])

  const [selectedDate, setSelectedDate] = useState(isoDate(0))
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [saved, setSaved]               = useState(false)

  // System totals from ventas
  const [efectivoSistema,      setEfectivoSistema]      = useState(0)
  const [tarjetaSistema,       setTarjetaSistema]        = useState(0)
  const [transferenciaSistema, setTransferenciaSistema]  = useState(0)
  const [numVentas,            setNumVentas]             = useState(0)

  // Cash movements for the selected date
  const [movimientos,   setMovimientos]   = useState<MovimientoCaja[]>([])
  // Total cash refunded to customers via devoluciones
  const [totalDevoluciones, setTotalDevoluciones] = useState(0)
  const [showMovModal,  setShowMovModal]  = useState(false)
  const [showMovList,   setShowMovList]   = useState(false) // expand/collapse

  // User input
  const [efectivoContado, setEfectivoContado] = useState('')
  const [notas,           setNotas]           = useState('')

  // Previously saved corte
  const [corteGuardado, setCorteGuardado] = useState<Corte | null>(null)

  // ── Load data ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setSaved(false)
    setSaveError(null)

    const sucursalId = profile.sucursal_id
    const isAdmin    = profile.rol === 'admin'

    // Run all queries in parallel
    const [ventasRes, ventaPagosRes, devRes, movRes, corteRes] = await Promise.all([
      // 1. Ventas for the day (includes mixed: metodo_pago = 'mixto')
      (() => {
        let q = supabase
          .from('ventas')
          .select('id, total, metodo_pago')
          .gte('created_at', `${selectedDate}T00:00:00`)
          .lte('created_at', `${selectedDate}T23:59:59`)
        if (!isAdmin && sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      })(),

      // 2. venta_pagos for mixed-method sales that day
      //    Supabase RLS already scopes this via the policy join on ventas.
      (() => {
        let q = supabase
          .from('venta_pagos')
          .select('metodo, monto, venta_id')
          .gte('created_at', `${selectedDate}T00:00:00`)
          .lte('created_at', `${selectedDate}T23:59:59`)
        return q
      })(),

      // 3. Devoluciones for the day (cash returns reduce efectivo_esperado)
      (() => {
        let q = supabase
          .from('devoluciones')
          .select('monto_devuelto, metodo_devolucion')
          .eq('fecha', selectedDate)
        if (!isAdmin && sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      })(),

      // 2. Cash movements for the day
      (() => {
        let q = supabase
          .from('movimientos_caja')
          .select('*')
          .eq('fecha', selectedDate)
          .order('created_at', { ascending: true })
        if (!isAdmin && sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      })(),

      // 3. Existing corte for this date (if already saved)
      (() => {
        let q = supabase
          .from('cortes')
          .select('*')
          .eq('fecha', selectedDate)
        if (!isAdmin && sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q.maybeSingle()
      })(),
    ])

    // Build a set of mixto venta IDs for cross-referencing
    const mixtoIds = new Set(
      (ventasRes.data ?? []).filter((v) => v.metodo_pago === 'mixto').map((v) => v.id)
    )

    // Process single-method ventas (skip 'mixto' — handled via venta_pagos)
    let ef = 0, tj = 0, tr = 0
    for (const v of ventasRes.data ?? []) {
      if (v.metodo_pago === 'efectivo')           ef += v.total
      else if (v.metodo_pago === 'tarjeta')       tj += v.total
      else if (v.metodo_pago === 'transferencia') tr += v.total
      // 'mixto' deliberately skipped here — summed from venta_pagos below
    }

    // Add split payment amounts from venta_pagos (only for mixto ventas in this sucursal/day)
    for (const p of ventaPagosRes.data ?? []) {
      if (!mixtoIds.has(p.venta_id)) continue  // only count mixed-method sales
      if (p.metodo === 'efectivo')           ef += p.monto
      else if (p.metodo === 'tarjeta')       tj += p.monto
      else if (p.metodo === 'transferencia') tr += p.monto
    }

    setEfectivoSistema(ef)
    setTarjetaSistema(tj)
    setTransferenciaSistema(tr)
    setNumVentas(ventasRes.data?.length ?? 0)

    // Process cash devoluciones (only efectivo refunds reduce expected cash)
    const devEfectivo = (devRes.data ?? [])
      .filter((d) => d.metodo_devolucion === 'efectivo')
      .reduce((s, d) => s + d.monto_devuelto, 0)
    setTotalDevoluciones(devEfectivo)

    // Process movements
    setMovimientos(movRes.data ?? [])

    // Process existing corte
    const c = corteRes.data ?? null
    setCorteGuardado(c)
    if (c) {
      setEfectivoContado(c.efectivo_contado?.toString() ?? '')
      setNotas(c.notas ?? '')
      setSaved(true)
    } else {
      setEfectivoContado('')
      setNotas('')
    }

    setLoading(false)
  }, [selectedDate, profile])

  useEffect(() => { load() }, [load])

  // ── Derived values ─────────────────────────────────────────────────────────
  const fondoInicial  = movimientos.filter((m) => m.tipo === 'fondo_inicial').reduce((s, m) => s + m.monto, 0)
  const totalGastos   = movimientos.filter((m) => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0)
  const totalRetiros  = movimientos.filter((m) => m.tipo === 'retiro').reduce((s, m) => s + m.monto, 0)

  // Expected cash = sales cash + opening float − expenses − withdrawals − cash refunds
  const efectivoEsperado = efectivoSistema + fondoInicial - totalGastos - totalRetiros - totalDevoluciones

  const contado    = parseFloat(efectivoContado) || 0
  const diferencia = contado - efectivoEsperado
  const totalSistema = efectivoSistema + tarjetaSistema + transferenciaSistema

  // ── Save corte ─────────────────────────────────────────────────────────────
  const handleGuardar = async () => {
    if (!profile?.sucursal_id) return
    setSaving(true)
    setSaveError(null)

    const payload = {
      sucursal_id:           profile.sucursal_id,
      cajero_id:             user?.id ?? null,
      fecha:                 selectedDate,
      efectivo_sistema:      efectivoSistema,
      tarjeta_sistema:       tarjetaSistema,
      transferencia_sistema: transferenciaSistema,
      efectivo_contado:      efectivoContado ? parseFloat(efectivoContado) : null,
      notas:                 notas.trim() || null,
      // Snapshot movement totals for historical accuracy
      fondo_inicial:         fondoInicial,
      total_gastos:          totalGastos,
      total_retiros:         totalRetiros,
      total_devoluciones:    totalDevoluciones,
    }

    const { error } = await supabase
      .from('cortes')
      .upsert(payload, { onConflict: 'sucursal_id,fecha' })

    if (error) {
      setSaveError(error.message)
    } else {
      setSaved(true)
      load()
    }
    setSaving(false)
  }

  // ── Share ──────────────────────────────────────────────────────────────────
  const handleCompartir = () => {
    const fecha = new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })

    const movLines = [
      fondoInicial      > 0 ? `  💰 Fondo inicial: +${fmtPeso(fondoInicial)}` : '',
      totalGastos       > 0 ? `  🧾 Gastos:         −${fmtPeso(totalGastos)}` : '',
      totalRetiros      > 0 ? `  💸 Retiros:        −${fmtPeso(totalRetiros)}` : '',
      totalDevoluciones > 0 ? `  ↩ Devoluciones:   −${fmtPeso(totalDevoluciones)}` : '',
    ].filter(Boolean).join('\n')

    const diff = efectivoContado
      ? `\nDiferencia efectivo: ${diferencia >= 0 ? '+' : ''}${fmtPeso(diferencia)} ${diferencia < 0 ? '⚠️ FALTANTE' : '✅'}`
      : ''

    const texto = [
      `🏪 CORTE DE CAJA — ${fecha}`,
      `Sucursal: ${profile?.sucursal?.nombre ?? ''}`,
      '',
      `Ventas totales:    ${fmtPeso(totalSistema)}  (${numVentas} ventas)`,
      `  💵 Efectivo:     ${fmtPeso(efectivoSistema)}`,
      `  💳 Tarjeta:      ${fmtPeso(tarjetaSistema)}`,
      `  📲 Transferencia: ${fmtPeso(transferenciaSistema)}`,
      movLines ? `\nMovimientos de caja:\n${movLines}` : '',
      movLines ? `\nEfectivo esperado: ${fmtPeso(efectivoEsperado)}` : '',
      diff,
      notas ? `\nNotas: ${notas}` : '',
    ].filter(Boolean).join('\n')

    if (navigator.share) {
      navigator.share({ title: 'Corte de caja', text: texto }).catch(() => null)
    } else {
      navigator.clipboard.writeText(texto).then(() => alert('Resumen copiado ✓'))
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Calculando...</div>

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto overflow-y-auto h-full">

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">🏦 Corte de caja</h1>
          <p className="text-xs text-gray-400 mt-0.5">{profile?.sucursal?.nombre ?? '—'}</p>
        </div>
        <input
          type="date"
          value={selectedDate}
          max={isoDate(0)}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
        />
      </div>

      {/* ── Ventas del sistema ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Ventas del sistema</h2>
        <div className="space-y-2">
          {[
            { label: '💵 Efectivo',      val: efectivoSistema      },
            { label: '💳 Tarjeta',       val: tarjetaSistema       },
            { label: '📲 Transferencia', val: transferenciaSistema },
          ].map(({ label, val }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-600">{label}</span>
              <span className="font-medium tabular-nums text-gray-800">{fmtPeso(val)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 pt-3 flex justify-between font-bold">
          <span className="text-gray-700">Total ({numVentas} ventas)</span>
          <span className="text-green-700 tabular-nums text-lg">{fmtPeso(totalSistema)}</span>
        </div>
      </div>

      {/* ── Movimientos de caja ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowMovList((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
          >
            <span className={`text-xs transition-transform ${showMovList ? 'rotate-90' : ''}`}>▶</span>
            💸 Movimientos de caja
            {movimientos.length > 0 && (
              <span className="text-xs font-normal text-gray-400">({movimientos.length})</span>
            )}
          </button>
          {canCorte && (
            <button
              onClick={() => setShowMovModal(true)}
              className="text-xs text-green-600 hover:text-green-800 border border-green-200 hover:border-green-400 bg-green-50 hover:bg-green-100 px-2.5 py-1 rounded-full transition-colors"
            >
              + Agregar
            </button>
          )}
        </div>

        {/* Movement totals summary (always visible) */}
        <div className="space-y-2">
          {fondoInicial > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-blue-600">💰 Fondo inicial</span>
              <span className="text-blue-600 font-medium tabular-nums">+{fmtPeso(fondoInicial)}</span>
            </div>
          )}
          {totalGastos > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-amber-600">🧾 Gastos</span>
              <span className="text-amber-600 font-medium tabular-nums">−{fmtPeso(totalGastos)}</span>
            </div>
          )}
          {totalRetiros > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-red-600">💸 Retiros</span>
              <span className="text-red-600 font-medium tabular-nums">−{fmtPeso(totalRetiros)}</span>
            </div>
          )}
          {totalDevoluciones > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-red-500">↩ Devoluciones en efectivo</span>
              <span className="text-red-500 font-medium tabular-nums">−{fmtPeso(totalDevoluciones)}</span>
            </div>
          )}
          {movimientos.length === 0 && totalDevoluciones === 0 && (
            <p className="text-xs text-gray-400 text-center py-1">Sin movimientos registrados hoy</p>
          )}
        </div>

        {/* Expandable detail list */}
        {showMovList && movimientos.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
            {movimientos.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-xs text-gray-500">
                <span>
                  {m.tipo === 'fondo_inicial' ? '💰' : m.tipo === 'gasto' ? '🧾' : '💸'}
                </span>
                <span className="flex-1 truncate">{m.descripcion ?? m.tipo}</span>
                <span className={`font-medium tabular-nums ${
                  m.tipo === 'fondo_inicial' ? 'text-blue-600' : 'text-red-500'
                }`}>
                  {m.tipo === 'fondo_inicial' ? '+' : '−'}{fmtPeso(m.monto)}
                </span>
                <span className="text-gray-300">{new Date(m.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Effective expected cash summary — show when anything adjusts the base */}
        {(movimientos.length > 0 || totalDevoluciones > 0) && (
          <div className="border-t border-gray-100 mt-3 pt-3 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">💵 Efectivo esperado</span>
            <span className="text-gray-900 tabular-nums">{fmtPeso(efectivoEsperado)}</span>
          </div>
        )}
      </div>

      {/* ── Conteo físico de efectivo ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Conteo de efectivo</h2>

        <div>
          <label className="block text-sm text-gray-600 mb-1">
            Efectivo contado en caja
          </label>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-green-500">
            <span className="px-3 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={efectivoContado}
              onChange={(e) => setEfectivoContado(e.target.value)}
              placeholder="0.00"
              className="flex-1 py-2 pr-3 text-sm focus:outline-none tabular-nums"
            />
          </div>
          {movimientos.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Se compara contra efectivo esperado: {fmtPeso(efectivoEsperado)}
            </p>
          )}
        </div>

        {/* Live difference */}
        {efectivoContado !== '' && (
          <div className={`rounded-xl px-4 py-3 text-center ${
            diferencia === 0 ? 'bg-green-50 border border-green-200'
            : diferencia > 0 ? 'bg-blue-50 border border-blue-200'
            : 'bg-red-50 border border-red-200'
          }`}>
            <p className="text-xs text-gray-500 mb-1">Diferencia</p>
            <p className={`text-2xl font-bold tabular-nums ${
              diferencia === 0 ? 'text-green-700' : diferencia > 0 ? 'text-blue-700' : 'text-red-600'
            }`}>
              {diferencia >= 0 ? '+' : ''}{fmtPeso(diferencia)}
            </p>
            <p className="text-xs mt-1 font-medium">
              {diferencia === 0 && '✅ Cuadra perfecto'}
              {diferencia > 0  && '🔵 Sobrante'}
              {diferencia < 0  && '⚠️ Faltante'}
            </p>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-sm text-gray-600 mb-1">
            Notas <span className="text-gray-400">(opcional)</span>
          </label>
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Observaciones del corte..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
          {saveError}
        </div>
      )}

      {/* Actions */}
      {canCorte && (
        <div className="flex gap-3">
          <button
            onClick={handleCompartir}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors"
          >
            Compartir
          </button>
          <button
            onClick={handleGuardar}
            disabled={saving}
            className="flex-1 py-3 rounded-xl text-sm font-bold bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando...' : saved ? '✓ Corte guardado' : 'Guardar corte'}
          </button>
        </div>
      )}

      {corteGuardado && (
        <p className="text-center text-xs text-gray-400 mt-3">
          Corte registrado el {new Date(corteGuardado.created_at).toLocaleString('es-MX', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}. Puedes actualizarlo.
        </p>
      )}

      {/* Cash movement modal (also accessible from here) */}
      {showMovModal && (
        <MovimientoCajaModal
          onSaved={() => load()}
          onClose={() => setShowMovModal(false)}
        />
      )}
    </div>
  )
}
