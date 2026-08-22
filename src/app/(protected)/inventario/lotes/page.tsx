'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { calcGanancia, costoKgAUnidad } from '@/lib/ganancia'
import SinSucursal from '@/components/SinSucursal'
import type { Lote, Product } from '@/lib/types'

const EMPTY_FORM = {
  product_id: '',
  fecha_entrada: new Date().toISOString().slice(0, 10),  // today
  cantidad_inicial: '',
  costo_por_unidad: '',
  proveedor: '',
  notas: '',
}

// Format a date string "YYYY-MM-DD" as "lunes 7 abr"
function formatFecha(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'short',
  })
}

// useSearchParams exige un límite de Suspense para el prerender estático.
export default function LotesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Cargando...</div>}>
      <LotesPageInner />
    </Suspense>
  )
}

function LotesPageInner() {
  const { profile, user } = useAuth()
  // ?producto=<id> — llega desde Productos ("registrar entrada") o desde la
  // lista de pedido: abre el formulario con ese producto ya elegido.
  const productoParam = useSearchParams().get('producto')
  const canWrite = profile?.rol === 'admin' || profile?.rol === 'encargado'

  const [lotes, setLotes]       = useState<Lote[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Al registrar la entrada, actualizar también el costo del producto en el
  // catálogo — así la ganancia de productos/dashboard siempre refleja el costo
  // real más reciente. Activado por default a propósito.
  const [actualizarCosto, setActualizarCosto] = useState(true)
  // Filter by date — default today
  const [filterFecha, setFilterFecha] = useState(new Date().toISOString().slice(0, 10))

  // Inline adjustment state — which lote is being adjusted right now
  const [adjustingId,    setAdjustingId]    = useState<string | null>(null)
  const [adjustQty,      setAdjustQty]      = useState('')
  const [adjustMotivo,   setAdjustMotivo]   = useState('Conteo físico')
  const [adjustSaving,   setAdjustSaving]   = useState(false)
  const [adjustError,    setAdjustError]    = useState<string | null>(null)

  const load = async () => {
    const [{ data: lotesData }, { data: productsData }] = await Promise.all([
      supabase
        .from('lotes')
        .select('*, product:products(id, nombre, unidad)')
        .eq('sucursal_id', profile?.sucursal_id ?? '')
        .order('fecha_entrada', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('*')
        .eq('activo', true)
        .in('unidad', ['kg', 'g'])       // only weight-based products use lotes
        .order('nombre'),
    ])
    setLotes(lotesData ?? [])
    setProducts(productsData ?? [])
    setLoading(false)
  }

  useEffect(() => { if (profile) load() }, [profile])

  // Abre el form prellenado cuando venimos con ?producto= y ya hay catálogo.
  useEffect(() => {
    if (!productoParam || products.length === 0) return
    if (products.some((p) => p.id === productoParam)) {
      setForm((f) => ({ ...f, product_id: productoParam }))
      setShowForm(true)
    }
    // Sólo al aterrizar: no re-abrir el form en cada recarga de products
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoParam, products.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)

    const cantidad = parseFloat(form.cantidad_inicial)
    const costoNuevo = form.costo_por_unidad ? parseFloat(form.costo_por_unidad) : null

    // ¿Ya hay una entrada de este producto en esta fecha? Entonces llegó otra
    // tanda: se SUMA al lote del día (antes se sobrescribía y se perdía la
    // primera). El costo del lote queda ponderado entre ambas tandas; para
    // corregir un error de captura está el botón Ajustar.
    const existente = lotes.find(
      (l) => l.product_id === form.product_id && l.fecha_entrada === form.fecha_entrada
    )

    let error: { message: string } | null = null
    if (existente) {
      const costoPonderado =
        costoNuevo == null ? existente.costo_por_unidad
        : existente.costo_por_unidad == null ? costoNuevo
        : (existente.cantidad_inicial * existente.costo_por_unidad + cantidad * costoNuevo) /
          (existente.cantidad_inicial + cantidad)

      ;({ error } = await supabase
        .from('lotes')
        .update({
          cantidad_inicial:    parseFloat((existente.cantidad_inicial + cantidad).toFixed(6)),
          cantidad_disponible: parseFloat((existente.cantidad_disponible + cantidad).toFixed(6)),
          costo_por_unidad:    costoPonderado != null ? parseFloat(costoPonderado.toFixed(4)) : null,
          proveedor:           form.proveedor.trim() || existente.proveedor,
          notas:               form.notas.trim() || existente.notas,
        })
        .eq('id', existente.id))
    } else {
      ;({ error } = await supabase.from('lotes').insert({
        product_id:          form.product_id,
        sucursal_id:         profile!.sucursal_id,
        fecha_entrada:       form.fecha_entrada,
        cantidad_inicial:    cantidad,
        cantidad_disponible: cantidad,
        costo_por_unidad:    costoNuevo,
        proveedor:           form.proveedor.trim() || null,
        notas:               form.notas.trim() || null,
        creado_por:          user?.id ?? null,
      }))
    }

    if (error) {
      setSaveError(error.message)
      setSaving(false)
      return
    }

    // Sincronizar el costo del catálogo con lo que realmente costó hoy.
    // El lote guarda costo por KG; precio_compra va en la unidad del producto.
    const prod = products.find((pr) => pr.id === form.product_id)
    if (actualizarCosto && costoNuevo != null && prod) {
      await supabase
        .from('products')
        .update({ precio_compra: parseFloat(costoKgAUnidad(costoNuevo, prod.unidad).toFixed(4)) })
        .eq('id', prod.id)
    }

    setForm(EMPTY_FORM)
    setShowForm(false)
    load()
    setSaving(false)
  }

  /**
   * Apply a manual stock adjustment to a lote.
   * Writes audit record to ajustes_inventario + updates lote.cantidad_disponible.
   */
  const handleAjuste = async (lote: Lote) => {
    const nuevaCantidad = parseFloat(adjustQty)
    if (isNaN(nuevaCantidad) || nuevaCantidad < 0) {
      setAdjustError('Ingresa una cantidad válida (≥ 0)')
      return
    }
    setAdjustSaving(true)
    setAdjustError(null)

    // 1. Audit trail
    const { error: auditError } = await supabase
      .from('ajustes_inventario')
      .insert({
        lote_id:           lote.id,
        sucursal_id:       profile!.sucursal_id,
        cantidad_anterior: lote.cantidad_disponible,
        cantidad_nueva:    nuevaCantidad,
        motivo:            adjustMotivo,
        ajustado_por:      user?.id ?? null,
      })

    if (auditError) { setAdjustError(auditError.message); setAdjustSaving(false); return }

    // 2. Update the lote
    const { error: loteError } = await supabase
      .from('lotes')
      .update({ cantidad_disponible: nuevaCantidad })
      .eq('id', lote.id)

    if (loteError) { setAdjustError(loteError.message); setAdjustSaving(false); return }

    setAdjustingId(null)
    setAdjustQty('')
    setAdjustMotivo('Conteo físico')
    load()
    setAdjustSaving(false)
  }

  const filtered = lotes.filter((l) => l.fecha_entrada === filterFecha)
  const uniqueFechas = [...new Set(lotes.map((l) => l.fecha_entrada))].slice(0, 14)

  // ── Derivados del formulario ───────────────────────────────────────────────
  const prodElegido = products.find((p) => p.id === form.product_id) ?? null
  const entradaExistente = prodElegido
    ? lotes.find((l) => l.product_id === prodElegido.id && l.fecha_entrada === form.fecha_entrada)
    : undefined
  // Margen que deja este costo contra el precio de venta actual del producto.
  // El costo se captura por kg; para productos en gramos se convierte.
  const costoForm = form.costo_por_unidad ? parseFloat(form.costo_por_unidad) : null
  const gananciaEntrada = prodElegido && costoForm != null
    ? calcGanancia(prodElegido.precio_por_unidad, costoKgAUnidad(costoForm, prodElegido.unidad))
    : null

  // ── Stock actual: lo disponible HOY por producto, sin importar de qué día
  //    sea el lote. La tabla de abajo filtra por fecha de entrada, así que sin
  //    esto el stock viejo que sigue vivo no se ve en ninguna parte.
  const stockActual = (() => {
    const map = new Map<string, { nombre: string; kg: number; valor: number; costoCompleto: boolean }>()
    for (const l of lotes) {
      // Los lotes en 0 no aportan, pero los NEGATIVOS sí: son el faltante que
      // hay que capturar, y esconderlo sería tapar el descuadre.
      if (l.cantidad_disponible === 0) continue
      const prev = map.get(l.product_id) ?? {
        nombre: l.product?.nombre ?? '—', kg: 0, valor: 0, costoCompleto: true,
      }
      prev.kg += l.cantidad_disponible
      if (l.costo_por_unidad != null) prev.valor += l.cantidad_disponible * l.costo_por_unidad
      else prev.costoCompleto = false
      map.set(l.product_id, prev)
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v, kg: parseFloat(v.kg.toFixed(3)) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  })()
  const valorInventario = stockActual.reduce((s, x) => s + x.valor, 0)

  // Sin sucursal no hay inventario que ver ni forma de registrar entradas.
  if (profile && !profile.sucursal_id) return <SinSucursal />
  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto overflow-y-auto h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">📦 Entradas de mercancía</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Registra lo que llega; abajo, las entradas por día
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => { setForm(EMPTY_FORM); setSaveError(null); setShowForm(true) }}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
          >
            + Registrar entrada
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && canWrite && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-700">Nueva entrada de mercancía</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Producto *</label>
              <select
                required value={form.product_id}
                onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="">— Selecciona un producto —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>
                ))}
              </select>
              {entradaExistente && (
                <p className="text-xs text-blue-600 mt-1">
                  Ya hay una entrada de {formatFecha(form.fecha_entrada)} con{' '}
                  {entradaExistente.cantidad_inicial.toFixed(1)} kg — esta cantidad se <b>sumará</b> al lote del día.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Fecha de entrada *</label>
              <input
                required type="date" value={form.fecha_entrada}
                onChange={(e) => setForm((f) => ({ ...f, fecha_entrada: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Cantidad (kg) *</label>
              <input
                required type="number" min="0.001" step="0.001" value={form.cantidad_inicial}
                onChange={(e) => setForm((f) => ({ ...f, cantidad_inicial: e.target.value }))}
                placeholder="0.000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Costo/kg <span className="text-gray-400">(opcional)</span></label>
              <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white">
                <span className="px-3 text-gray-400 text-sm">$</span>
                <input
                  type="number" min="0" step="0.01" value={form.costo_por_unidad}
                  onChange={(e) => setForm((f) => ({ ...f, costo_por_unidad: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 py-2 pr-3 text-sm focus:outline-none"
                />
              </div>
              {/* Margen en vivo contra el precio de venta actual del catálogo */}
              {gananciaEntrada && prodElegido && (
                <p className={`text-xs mt-1 font-medium ${
                  gananciaEntrada.monto < 0 ? 'text-red-600'
                    : gananciaEntrada.pct < 10 ? 'text-amber-600'
                    : 'text-green-700'
                }`}>
                  {gananciaEntrada.monto < 0 ? (
                    <>⚠ Vendes a ${prodElegido.precio_por_unidad.toFixed(2)}/{prodElegido.unidad} — <b>pierdes ${Math.abs(gananciaEntrada.monto).toFixed(2)}</b> por {prodElegido.unidad}. Sube el precio en Productos.</>
                  ) : (
                    <>Vendes a ${prodElegido.precio_por_unidad.toFixed(2)}/{prodElegido.unidad} → ganancia ${gananciaEntrada.monto.toFixed(2)} ({gananciaEntrada.pct}%)</>
                  )}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Proveedor <span className="text-gray-400">(opcional)</span></label>
              <input
                type="text" value={form.proveedor}
                onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value }))}
                placeholder="Mercado, bodega..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Notas <span className="text-gray-400">(opcional)</span></label>
              <input
                type="text" value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                placeholder="Ej: llegó muy maduro..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {form.costo_por_unidad && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={actualizarCosto}
                onChange={(e) => setActualizarCosto(e.target.checked)}
                className="w-4 h-4 accent-green-600"
              />
              Actualizar el costo del producto en el catálogo con este precio
            </label>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{saveError}</div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => setShowForm(false)}
              className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Registrar entrada'}
            </button>
          </div>
        </form>
      )}

      {/* Faltantes: productos que se vendieron sin haber capturado la entrada */}
      {stockActual.some((s) => s.kg < 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm font-semibold text-red-800">
            ⚠ Hay productos con inventario en negativo
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            Se vendió más de lo que se capturó:{' '}
            {stockActual.filter((s) => s.kg < 0).map((s) => `${s.nombre} (${s.kg.toFixed(1)} kg)`).join(', ')}.
            Registra la entrada que falta para que el inventario y el corte cuadren.
          </p>
        </div>
      )}

      {/* ── Stock actual: lo que hay disponible hoy, venga del lote que venga ── */}
      {stockActual.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Stock actual</h2>
            {canWrite && valorInventario > 0 && (
              <span className="text-xs text-gray-400">
                Valor a costo: <b className="text-gray-600">${valorInventario.toFixed(0)}</b>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-gray-100">
            {stockActual.map((s) => (
              <div key={s.id} className="bg-white px-4 py-3 flex flex-col">
                <span className="text-xs text-gray-500 truncate">{s.nombre}</span>
                <span className={`text-base font-bold tabular-nums ${s.kg < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                  {s.kg.toFixed(1)} <span className="text-xs font-normal text-gray-400">kg</span>
                </span>
                {canWrite && s.valor > 0 && (
                  <span className="text-[11px] text-gray-400 tabular-nums">
                    ${s.valor.toFixed(0)}{s.costoCompleto ? '' : '+'} a costo
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Date filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {uniqueFechas.map((f) => (
          <button
            key={f}
            onClick={() => setFilterFecha(f)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterFecha === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {formatFecha(f)}
          </button>
        ))}
        {uniqueFechas.length === 0 && (
          <span className="text-sm text-gray-400">Sin lotes registrados aún</span>
        )}
      </div>

      {/* Lotes table */}
      {filtered.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Producto</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Entrada</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Disponible</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Costo/kg</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Proveedor</th>
                <th className="px-4 py-3 text-gray-500 font-medium">Estado</th>
              {canWrite && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((lote) => {
                const pct = lote.cantidad_inicial > 0
                  ? (lote.cantidad_disponible / lote.cantidad_inicial) * 100
                  : 0
                const agotado  = lote.cantidad_disponible === 0
                // Negativo = se vendió más de lo que se capturó de entrada
                const faltante = lote.cantidad_disponible < 0
                return (
                  <React.Fragment key={lote.id}>
                  <tr className={faltante ? 'bg-red-50' : agotado ? 'opacity-40' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {lote.product?.nombre ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {lote.cantidad_inicial.toFixed(3)} kg
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={faltante ? 'text-red-700 font-bold' : pct < 20 ? 'text-red-600 font-bold' : 'text-gray-800'}>
                        {lote.cantidad_disponible.toFixed(3)} kg
                      </span>
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full ml-auto mt-1">
                        <div
                          className={`h-1.5 rounded-full ${faltante ? 'bg-red-600' : pct < 20 ? 'bg-red-400' : pct < 50 ? 'bg-yellow-400' : 'bg-green-500'}`}
                          style={{ width: faltante ? '100%' : `${Math.max(pct, 0)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 hidden sm:table-cell tabular-nums">
                      {lote.costo_por_unidad != null ? `$${lote.costo_por_unidad.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                      {lote.proveedor ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        title={faltante ? 'Se vendió más de lo capturado — registra la entrada que falta' : undefined}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          faltante ? 'bg-red-600 text-white'
                            : agotado ? 'bg-gray-100 text-gray-400'
                            : pct < 20 ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                        {faltante ? '⚠ Faltante' : agotado ? 'Agotado' : pct < 20 ? 'Poco' : 'OK'}
                      </span>
                    </td>
                    {/* Ajustar button — admin/encargado only */}
                    {canWrite && (
                      <td className="px-3 py-3 text-right">
                        {adjustingId === lote.id ? (
                          <button
                            onClick={() => { setAdjustingId(null); setAdjustError(null) }}
                            className="text-gray-400 hover:text-gray-600 text-xs"
                          >
                            Cancelar
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setAdjustingId(lote.id)
                              setAdjustQty(lote.cantidad_disponible.toFixed(3))
                              setAdjustMotivo('Conteo físico')
                              setAdjustError(null)
                            }}
                            className="text-blue-500 hover:text-blue-700 text-xs font-medium"
                          >
                            Ajustar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {canWrite && adjustingId === lote.id && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-3 pt-1 bg-blue-50 border-b border-blue-100">
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Nueva cantidad (kg)</label>
                            <input
                              type="number" min="0" step="0.001"
                              value={adjustQty}
                              onChange={(e) => setAdjustQty(e.target.value)}
                              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Motivo</label>
                            <select
                              value={adjustMotivo}
                              onChange={(e) => setAdjustMotivo(e.target.value)}
                              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              <option>Conteo físico</option>
                              <option>Error de registro</option>
                              <option>Ajuste proveedor</option>
                              <option>Otro</option>
                            </select>
                          </div>
                          <button
                            onClick={() => handleAjuste(lote)}
                            disabled={adjustSaving}
                            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                          >
                            {adjustSaving ? 'Guardando...' : 'Confirmar ajuste'}
                          </button>
                          {adjustError && (
                            <p className="text-red-600 text-xs w-full mt-1">{adjustError}</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">📦</p>
          <p className="text-sm">No hay entradas para {formatFecha(filterFecha)}</p>
        </div>
      )}
    </div>
  )
}
