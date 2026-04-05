'use client'

/**
 * DevolucionModal
 *
 * Processes a product return against an existing sale.
 * Available to encargado and admin only.
 *
 * Flow:
 *   1. Show venta items with checkbox + editable return quantity
 *   2. Auto-calculate total monto_devuelto
 *   3. Choose motivo + metodo_devolucion + optional inventory reintegration
 *   4. Insert devoluciones + devolucion_items
 *   5. If reintegrar_inventario: update lotes.cantidad_disponible for kg/g items
 *
 * Called from historial/page.tsx via the "Devolver" button on each sale.
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { VentaItem } from '@/lib/types'

interface Props {
  ventaId: string
  items: VentaItem[]
  onConfirm: () => void
  onClose: () => void
}

interface ItemState {
  selected: boolean
  cantidadDevuelta: string   // string for input binding
}

export default function DevolucionModal({ ventaId, items, onConfirm, onClose }: Props) {
  const { profile, user } = useAuth()

  // Per-item state: checkbox + editable quantity
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>(
    Object.fromEntries(
      items.map((item) => [
        item.id,
        { selected: false, cantidadDevuelta: item.cantidad.toString() },
      ])
    )
  )

  const [motivo,                setMotivo]                = useState('')
  const [metodoDevolucion,      setMetodoDevolucion]      = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [reintegrarInventario,  setReintegrarInventario]  = useState(false)
  const [saving,                setSaving]                = useState(false)
  const [error,                 setError]                 = useState<string | null>(null)

  // ── Derived: total monto_devuelto ─────────────────────────────────────────
  const montoDevuelto = items.reduce((sum, item) => {
    const state = itemStates[item.id]
    if (!state.selected) return sum
    const cant = parseFloat(state.cantidadDevuelta) || 0
    const ratio = Math.min(cant / item.cantidad, 1)
    return sum + parseFloat((item.subtotal * ratio).toFixed(2))
  }, 0)

  const selectedCount = Object.values(itemStates).filter((s) => s.selected).length

  // ── Helpers ─────────────────────��────────────────────────────────���────────
  const toggleItem = (id: string) =>
    setItemStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], selected: !prev[id].selected },
    }))

  const setCantidad = (id: string, val: string) =>
    setItemStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], cantidadDevuelta: val },
    }))

  // ── Submit ────────────────────────��───────────────────────────────��───────
  const handleConfirmar = async () => {
    setError(null)
    if (selectedCount === 0) return setError('Selecciona al menos un producto a devolver.')
    if (montoDevuelto <= 0) return setError('El monto a devolver debe ser mayor a $0.')
    if (!profile?.sucursal_id) return setError('Tu perfil no tiene sucursal asignada.')

    setSaving(true)
    try {
      // 1. Insert devolucion header
      const { data: dev, error: devError } = await supabase
        .from('devoluciones')
        .insert({
          venta_id:              ventaId,
          sucursal_id:           profile.sucursal_id,
          procesado_por:         user?.id ?? null,
          monto_devuelto:        parseFloat(montoDevuelto.toFixed(2)),
          motivo:                motivo.trim() || null,
          reintegrar_inventario: reintegrarInventario,
          metodo_devolucion:     metodoDevolucion,
          fecha:                 new Date().toISOString().slice(0, 10),
        })
        .select()
        .single()

      if (devError) throw new Error(`Error al crear devolución: ${devError.message}`)

      // 2. Insert devolucion_items for each selected item
      const devItems = items
        .filter((item) => itemStates[item.id].selected)
        .map((item) => {
          const cant  = parseFloat(itemStates[item.id].cantidadDevuelta) || 0
          const ratio = Math.min(cant / item.cantidad, 1)
          return {
            devolucion_id:    dev.id,
            venta_item_id:    item.id,
            cantidad_devuelta: parseFloat(cant.toFixed(4)),
            monto_devuelto:   parseFloat((item.subtotal * ratio).toFixed(2)),
            lote_id:          item.lote_id ?? null,
          }
        })

      const { error: itemsError } = await supabase
        .from('devolucion_items')
        .insert(devItems)
      if (itemsError) throw new Error(`Error al guardar ítems: ${itemsError.message}`)

      // 3. Reintegrate inventory for kg/g items if requested
      if (reintegrarInventario) {
        for (const item of items.filter((i) => itemStates[i.id].selected)) {
          if (item.unidad !== 'kg' && item.unidad !== 'g') continue
          // lote_id was recorded at sale time in venta_items
          const loteId = item.lote_id
          if (!loteId) continue

          const cant = parseFloat(itemStates[item.id].cantidadDevuelta) || 0
          const cantKg = item.unidad === 'g' ? cant / 1000 : cant

          // Fetch current amount and add back the returned qty
          const { data: lote } = await supabase
            .from('lotes')
            .select('cantidad_disponible')
            .eq('id', loteId)
            .single()

          if (lote) {
            const nueva = parseFloat((lote.cantidad_disponible + cantKg).toFixed(6))
            const { error: loteError } = await supabase
              .from('lotes')
              .update({ cantidad_disponible: nueva })
              .eq('id', loteId)
            if (loteError) {
              console.error(`Inventory reintegration failed for lote ${loteId}:`, loteError.message)
            }
          }
        }
      }

      onConfirm()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-800">↩ Procesar devolución</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Items checklist */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">¿Qué productos devuelve el cliente?</p>
            <div className="space-y-2">
              {items.map((item) => {
                const state = itemStates[item.id]
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                      state.selected ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={state.selected}
                      onChange={() => toggleItem(item.id)}
                      className="w-4 h-4 accent-green-600 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.nombre_producto}</p>
                      <p className="text-xs text-gray-400">Original: {item.cantidad} {item.unidad} · ${item.subtotal.toFixed(2)}</p>
                    </div>
                    {state.selected && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <input
                          type="number"
                          min="0.001"
                          max={item.cantidad}
                          step={item.unidad === 'pieza' ? '1' : '0.1'}
                          value={state.cantidadDevuelta}
                          onChange={(e) => setCantidad(item.id, e.target.value)}
                          className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-green-500 tabular-nums"
                        />
                        <span className="text-xs text-gray-400">{item.unidad}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Motivo <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ej. Producto en mal estado, error de peso..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Método de devolución */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Cómo se devuelve el dinero:</p>
            <div className="flex gap-2">
              {([
                ['efectivo',      '💵 Efectivo'],
                ['tarjeta',       '💳 Tarjeta'],
                ['transferencia', '📲 Transferencia'],
              ] as [typeof metodoDevolucion, string][]).map(([val, label]) => (
                <button key={val} type="button"
                  onClick={() => setMetodoDevolucion(val)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    metodoDevolucion === val
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Inventory reintegration toggle */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Regresar mercancía al inventario</p>
              <p className="text-xs text-gray-400">Solo si el producto se puede volver a vender</p>
            </div>
            <button
              type="button"
              onClick={() => setReintegrarInventario((v) => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                reintegrarInventario ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                reintegrarInventario ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Sticky footer */}
        <div className="border-t border-gray-200 px-5 py-4 flex-shrink-0">
          {selectedCount > 0 && (
            <div className="flex justify-between text-sm font-semibold mb-3">
              <span className="text-gray-600">Monto a devolver</span>
              <span className="text-red-600 tabular-nums">−${montoDevuelto.toFixed(2)}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm"
            >
              Cancelar
            </button>
            <button type="button" onClick={handleConfirmar} disabled={saving || selectedCount === 0}
              className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 disabled:opacity-50 active:scale-95 transition-all text-sm"
            >
              {saving ? 'Procesando...' : `↩ Devolver $${montoDevuelto.toFixed(2)}`}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
