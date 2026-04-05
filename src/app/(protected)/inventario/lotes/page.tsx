'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
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

export default function LotesPage() {
  const { profile, user } = useAuth()
  const canWrite = profile?.rol === 'admin' || profile?.rol === 'encargado'

  const [lotes, setLotes]       = useState<Lote[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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
        .select('id, nombre, unidad, categoria, activo')
        .eq('activo', true)
        .in('unidad', ['kg', 'g'])       // only weight-based products use lotes
        .order('nombre'),
    ])
    setLotes(lotesData ?? [])
    setProducts(productsData ?? [])
    setLoading(false)
  }

  useEffect(() => { if (profile) load() }, [profile])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)

    const cantidad = parseFloat(form.cantidad_inicial)
    const payload = {
      product_id:          form.product_id,
      sucursal_id:         profile!.sucursal_id,
      fecha_entrada:       form.fecha_entrada,
      cantidad_inicial:    cantidad,
      cantidad_disponible: cantidad,
      costo_por_unidad:    form.costo_por_unidad ? parseFloat(form.costo_por_unidad) : null,
      proveedor:           form.proveedor.trim() || null,
      notas:               form.notas.trim() || null,
      creado_por:          user?.id ?? null,
    }

    // Upsert: if a lote for this product+date already exists, update qty
    const { error } = await supabase
      .from('lotes')
      .upsert(payload, { onConflict: 'product_id,sucursal_id,fecha_entrada' })

    if (error) {
      setSaveError(error.message)
    } else {
      setForm(EMPTY_FORM)
      setShowForm(false)
      load()
    }
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

  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto overflow-y-auto h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">📦 Entradas de mercancía</h1>
          <p className="text-sm text-gray-500 mt-0.5">Un lote por producto por día</p>
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
                const agotado = lote.cantidad_disponible <= 0
                return (
                  <tr key={lote.id} className={agotado ? 'opacity-40' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {lote.product?.nombre ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {lote.cantidad_inicial.toFixed(3)} kg
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={pct < 20 ? 'text-red-600 font-bold' : 'text-gray-800'}>
                        {lote.cantidad_disponible.toFixed(3)} kg
                      </span>
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full ml-auto mt-1">
                        <div
                          className={`h-1.5 rounded-full ${pct < 20 ? 'bg-red-400' : pct < 50 ? 'bg-yellow-400' : 'bg-green-500'}`}
                          style={{ width: `${Math.max(pct, 0)}%` }}
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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        agotado ? 'bg-gray-100 text-gray-400' : pct < 20 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {agotado ? 'Agotado' : pct < 20 ? 'Poco' : 'OK'}
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
