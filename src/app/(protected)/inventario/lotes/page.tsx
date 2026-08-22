'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { calcGanancia, costoKgAUnidad } from '@/lib/ganancia'
import { calcularBulto, rendimientoSugerido } from '@/lib/bultos'
import {
  unidadInventario, etiquetaInventario, decimales, pasoInput, formatInventario,
} from '@/lib/unidades'
import SinSucursal from '@/components/SinSucursal'
import type { Lote, Product } from '@/lib/types'

const EMPTY_FORM = {
  product_id: '',
  fecha_entrada: new Date().toISOString().slice(0, 10),  // today
  cantidad_inicial: '',
  costo_por_unidad: '',
  proveedor: '',
  notas: '',
  // Compra por bulto: se paga por caja/manojo grande y se vende por kilo o
  // pieza. El costo unitario se calcula del rendimiento real de esa compra.
  porBulto: false,
  bultos: '',
  costo_por_bulto: '',
  unidad_bulto: '',
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
        // Todas las unidades llevan lotes: un manojo de cilantro también es
        // inventario que se acaba.
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
    // Comprado por bulto: el costo unitario sale del rendimiento real de esta
    // compra, no de un factor fijo (un manojo grande rinde 20 unas veces y 30
    // otras, y eso mueve el costo de cada manojo chico).
    const bulto = form.porBulto ? calcularBulto({
      bultos:        parseFloat(form.bultos) || undefined,
      costoPorBulto: parseFloat(form.costo_por_bulto) || undefined,
      rendimiento:   cantidad,
    }) : null
    const costoNuevo = bulto
      ? bulto.costoUnitario
      : form.costo_por_unidad ? parseFloat(form.costo_por_unidad) : null
    const datosBulto = bulto ? {
      bultos:          parseFloat(form.bultos),
      costo_por_bulto: parseFloat(form.costo_por_bulto),
      unidad_bulto:    form.unidad_bulto.trim() || null,
    } : { bultos: null, costo_por_bulto: null, unidad_bulto: null }

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
          // Los bultos se acumulan con los de la tanda anterior del mismo día
          bultos: datosBulto.bultos != null
            ? parseFloat(((existente.bultos ?? 0) + datosBulto.bultos).toFixed(3))
            : existente.bultos,
          costo_por_bulto: datosBulto.costo_por_bulto ?? existente.costo_por_bulto,
          unidad_bulto:    datosBulto.unidad_bulto ?? existente.unidad_bulto,
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
        ...datosBulto,
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
      const costoEnUnidadVenta = unidadInventario(prod.unidad) === 'pieza'
        ? costoNuevo                              // ya viene por pieza
        : costoKgAUnidad(costoNuevo, prod.unidad) // por kg → a gramo si aplica
      await supabase
        .from('products')
        .update({ precio_compra: parseFloat(costoEnUnidadVenta.toFixed(4)) })
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
  const unidadProd  = prodElegido?.unidad ?? 'kg'

  // ── Compra por bulto ───────────────────────────────────────────────────────
  const calculoBulto = form.porBulto
    ? calcularBulto({
        bultos:        parseFloat(form.bultos) || undefined,
        costoPorBulto: parseFloat(form.costo_por_bulto) || undefined,
        rendimiento:   parseFloat(form.cantidad_inicial) || undefined,
      })
    : null

  // Última compra por bulto del mismo producto: sirve para prellenar cómo se
  // le llama al bulto y sugerir cuánto suele rendir.
  const ultimoBulto = prodElegido
    ? lotes.find((l) => l.product_id === prodElegido.id && l.bultos != null)
    : undefined

  const sugerido = ultimoBulto
    ? rendimientoSugerido(parseFloat(form.bultos) || 0, ultimoBulto.bultos, ultimoBulto.cantidad_inicial)
    : null
  const entradaExistente = prodElegido
    ? lotes.find((l) => l.product_id === prodElegido.id && l.fecha_entrada === form.fecha_entrada)
    : undefined
  // Margen que deja este costo contra el precio de venta actual del producto.
  // El costo se captura por kg; para productos en gramos se convierte.
  const costoForm = calculoBulto
    ? calculoBulto.costoUnitario
    : form.costo_por_unidad ? parseFloat(form.costo_por_unidad) : null
  const gananciaEntrada = prodElegido && costoForm != null
    ? calcGanancia(
        prodElegido.precio_por_unidad,
        // El inventario de piezas ya está en la unidad de venta; el de granel
        // se captura por kg y hay que bajarlo a gramos si así se vende.
        unidadInventario(prodElegido.unidad) === 'pieza'
          ? costoForm
          : costoKgAUnidad(costoForm, prodElegido.unidad),
      )
    : null

  // ── Stock actual: lo disponible HOY por producto, sin importar de qué día
  //    sea el lote. La tabla de abajo filtra por fecha de entrada, así que sin
  //    esto el stock viejo que sigue vivo no se ve en ninguna parte.
  const stockActual = (() => {
    const map = new Map<string, { nombre: string; unidad: string; kg: number; valor: number; costoCompleto: boolean }>()
    for (const l of lotes) {
      // Los lotes en 0 no aportan, pero los NEGATIVOS sí: son el faltante que
      // hay que capturar, y esconderlo sería tapar el descuadre.
      if (l.cantidad_disponible === 0) continue
      const prev = map.get(l.product_id) ?? {
        nombre: l.product?.nombre ?? '—',
        unidad: l.product?.unidad ?? 'kg',
        kg: 0, valor: 0, costoCompleto: true,
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

            {/* ── ¿Cómo se compró? ─────────────────────────────────────── */}
            <div className="col-span-2">
              <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, porBulto: false }))}
                  className={`flex-1 py-2 font-medium transition-colors ${
                    !form.porBulto ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Por {etiquetaInventario(unidadProd, 2)}
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({
                    ...f,
                    porBulto: true,
                    unidad_bulto: f.unidad_bulto || ultimoBulto?.unidad_bulto || '',
                  }))}
                  className={`flex-1 py-2 font-medium transition-colors border-l border-gray-300 ${
                    form.porBulto ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Por bulto (caja, manojo…)
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {form.porBulto
                  ? 'Se paga por bulto y se vende por unidad: el costo unitario se calcula de lo que rindió.'
                  : `El costo se captura directo por ${etiquetaInventario(unidadProd, 1)}.`}
              </p>
            </div>

            {form.porBulto && (
              <>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">¿Cuántos bultos? *</label>
                  <input
                    required type="number" min="0.001" step="0.001" value={form.bultos}
                    onChange={(e) => setForm((f) => ({ ...f, bultos: e.target.value }))}
                    placeholder="1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Costo por bulto *</label>
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white">
                    <span className="px-3 text-gray-400 text-sm">$</span>
                    <input
                      required type="number" min="0" step="0.01" value={form.costo_por_bulto}
                      onChange={(e) => setForm((f) => ({ ...f, costo_por_bulto: e.target.value }))}
                      placeholder="35.00"
                      className="flex-1 py-2 pr-3 text-sm focus:outline-none"
                    />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">
                    ¿Cómo le llamas al bulto? <span className="text-gray-400">(opcional)</span>
                  </label>
                  <input
                    type="text" value={form.unidad_bulto}
                    onChange={(e) => setForm((f) => ({ ...f, unidad_bulto: e.target.value }))}
                    placeholder="manojo grande, caja, arpilla, reja..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm text-gray-600 mb-1">Fecha de entrada *</label>
              <input
                required type="date" value={form.fecha_entrada}
                onChange={(e) => setForm((f) => ({ ...f, fecha_entrada: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                {form.porBulto
                  ? `¿Cuántos ${etiquetaInventario(unidadProd, 2)} salieron? *`
                  : `Cantidad (${etiquetaInventario(unidadProd, 2)}) *`}
              </label>
              <input
                required type="number" min={pasoInput(unidadProd)} step={pasoInput(unidadProd)}
                value={form.cantidad_inicial}
                onChange={(e) => setForm((f) => ({ ...f, cantidad_inicial: e.target.value }))}
                placeholder={unidadInventario(unidadProd) === 'pieza' ? '25' : '0.000'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              {form.porBulto && sugerido != null && !form.cantidad_inicial && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, cantidad_inicial: String(sugerido) }))}
                  className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                >
                  La vez pasada rindieron ~{sugerido} — usar ese número
                </button>
              )}
            </div>

            <div className={form.porBulto ? 'hidden' : ''}>
              <label className="block text-sm text-gray-600 mb-1">
                Costo por {etiquetaInventario(unidadProd, 1)} <span className="text-gray-400">(opcional)</span>
              </label>
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

          {/* ── Desglose de la compra por bulto ─────────────────────────── */}
          {form.porBulto && calculoBulto && prodElegido && (
            <div className={`rounded-xl border p-4 space-y-2 ${
              gananciaEntrada && gananciaEntrada.monto < 0
                ? 'bg-red-50 border-red-200'
                : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex justify-between text-sm text-gray-600">
                <span>
                  {form.bultos} {form.unidad_bulto || 'bulto'}{parseFloat(form.bultos) !== 1 ? 's' : ''} × ${parseFloat(form.costo_por_bulto).toFixed(2)}
                </span>
                <span className="font-semibold tabular-nums">${calculoBulto.costoTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600 border-t border-black/5 pt-2">
                <span>Rinde {formatInventario(parseFloat(form.cantidad_inicial), unidadProd)}</span>
                <span className="font-bold tabular-nums text-gray-800">
                  ${calculoBulto.costoUnitario.toFixed(2)} por {etiquetaInventario(unidadProd, 1)}
                </span>
              </div>
              {gananciaEntrada && (
                <div className={`text-sm font-medium border-t border-black/5 pt-2 ${
                  gananciaEntrada.monto < 0 ? 'text-red-700' : 'text-green-700'
                }`}>
                  {gananciaEntrada.monto < 0 ? (
                    <>
                      ⚠ Lo vendes a ${prodElegido.precio_por_unidad.toFixed(2)} y te cuesta $
                      {calculoBulto.costoUnitario.toFixed(2)}: <b>pierdes ${Math.abs(gananciaEntrada.monto).toFixed(2)}</b>{' '}
                      por cada {etiquetaInventario(unidadProd, 1)}.
                      {' '}Para ganar tendrías que venderlo arriba de ${(calculoBulto.costoUnitario * 1.05).toFixed(2)}.
                    </>
                  ) : (
                    <>
                      Lo vendes a ${prodElegido.precio_por_unidad.toFixed(2)} → ganas $
                      {gananciaEntrada.monto.toFixed(2)} por {etiquetaInventario(unidadProd, 1)} ({gananciaEntrada.pct}%).
                      {' '}El bulto completo deja ${(gananciaEntrada.monto * parseFloat(form.cantidad_inicial)).toFixed(2)}.
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {(form.costo_por_unidad || calculoBulto) && (
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
            {stockActual.filter((s) => s.kg < 0).map((s) => `${s.nombre} (${formatInventario(s.kg, s.unidad)})`).join(', ')}.
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
                  {s.kg.toFixed(decimales(s.unidad))}{' '}
                  <span className="text-xs font-normal text-gray-400">{etiquetaInventario(s.unidad, s.kg)}</span>
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
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Costo unit.</th>
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
                      {formatInventario(lote.cantidad_inicial, lote.product?.unidad ?? 'kg', true)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={faltante ? 'text-red-700 font-bold' : pct < 20 ? 'text-red-600 font-bold' : 'text-gray-800'}>
                        {formatInventario(lote.cantidad_disponible, lote.product?.unidad ?? 'kg', true)}
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
                      {lote.bultos != null && lote.costo_por_bulto != null && (
                        <div className="text-[11px] text-gray-300">
                          {lote.bultos} {lote.unidad_bulto ?? 'bulto'} × ${lote.costo_por_bulto.toFixed(0)}
                        </div>
                      )}
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
