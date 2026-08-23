'use client'

/**
 * CheckoutModal
 *
 * Handles payment collection and persisting a sale to Supabase.
 *
 * Payment modes:
 *   - Single method (default): one button selected, metodo_pago = method
 *   - Split (pago mixto): 3 amount inputs, metodo_pago = 'mixto',
 *     individual amounts stored in venta_pagos table
 *
 * Momentos importantes:
 *   onVentaGuardada() — en cuanto la venta quedó en la base. La cuenta se
 *     cierra AQUÍ, no al descartar el ticket: si el cajero cerrara la pestaña
 *     con el ticket abierto, el carrito (que ahora se persiste) seguiría vivo
 *     y podría cobrarse dos veces. El ticket se pinta de una copia
 *     (completedSale), así que vaciar el carrito no lo afecta.
 *   onConfirm() — el cajero descartó el ticket; sólo cierra el modal.
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { CartItem } from '@/lib/types'
// El FIFO, el costo y las escrituras viven en el RPC registrar_venta
// (una sola transacción en Postgres); aquí sólo se arma el payload.
import { enqueue } from '@/lib/offlineQueue'
import TicketReceipt from '@/components/TicketReceipt'

type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia'

const METODOS: { value: MetodoPago; label: string; icon: string }[] = [
  { value: 'efectivo',      label: 'Efectivo',      icon: '💵' },
  { value: 'tarjeta',       label: 'Tarjeta',        icon: '💳' },
  { value: 'transferencia', label: 'Transferencia',  icon: '📲' },
]

interface Props {
  cart: CartItem[]
  total: number
  /** La venta ya quedó guardada: cerrar la cuenta y refrescar inventario */
  onVentaGuardada: () => void
  /** El ticket se descartó */
  onConfirm: () => void
  onClose: () => void
}

type DescuentoMode = 'porcentaje' | 'monto'

// ── Sale data passed to TicketReceipt after payment ───────────────────────────
export interface CompletedSale {
  ventaId: string
  items: CartItem[]
  total: number
  descuento: number
  metodo: string
  pagos: { metodo: MetodoPago; monto: number }[]  // populated for 'mixto'
  sucursalNombre: string
  cajeroNombre: string
  fecha: Date
  /** true si se cobró sin señal: quedó en cola y se registra al reconectar */
  pendienteSync?: boolean
}

export default function CheckoutModal({
  cart, total, onVentaGuardada, onConfirm, onClose,
}: Props) {
  const { profile } = useAuth()

  // ── Step state ─────────────────────────────────────────────────────────────
  // 'form'   → payment entry
  // 'ticket' → show receipt after successful payment
  const [step, setStep] = useState<'form' | 'ticket'>('form')
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null)

  // ── Payment state ──────────────────────────────────────────────────────────
  const [metodoPago,    setMetodoPago]    = useState<MetodoPago>('efectivo')
  const [pagoMixto,     setPagoMixto]     = useState(false)
  const [pagosAmounts,  setPagosAmounts]  = useState<Record<MetodoPago, string>>({
    efectivo: '', tarjeta: '', transferencia: '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // ── Discount state ─────────────────────────────────────────────────────────
  const [showDescuento,  setShowDescuento]  = useState(false)
  const [descuentoMode,  setDescuentoMode]  = useState<DescuentoMode>('porcentaje')
  const [descuentoValor, setDescuentoValor] = useState('')

  const canDiscount = profile?.rol === 'admin' || profile?.rol === 'encargado'

  // ── Derived values ─────────────────────────────────────────────────────────
  const descuentoAmt = (() => {
    const v = parseFloat(descuentoValor) || 0
    if (!showDescuento || v <= 0) return 0
    if (descuentoMode === 'porcentaje') return Math.min(total * (v / 100), total)
    return Math.min(v, total)
  })()
  const finalTotal = total - descuentoAmt

  // Split payment derived
  const pagoMixtoTotal = METODOS.reduce(
    (s, m) => s + (parseFloat(pagosAmounts[m.value]) || 0), 0
  )
  const pagoMixtoFaltan = parseFloat((finalTotal - pagoMixtoTotal).toFixed(2))
  const pagoMixtoValid  = Math.abs(pagoMixtoFaltan) < 0.02  // ±2¢ tolerance

  // ── Handle payment ─────────────────────────────────────────────────────────
  const handlePagar = async () => {
    setLoading(true)
    setError(null)

    try {
      const metodoFinal: string = pagoMixto ? 'mixto' : metodoPago

      const activePagosRpc = pagoMixto
        ? METODOS
            .filter((m) => parseFloat(pagosAmounts[m.value]) > 0)
            .map((m) => ({ metodo: m.value, monto: parseFloat(pagosAmounts[m.value]) }))
        : []

      const rpcArgs = {
        p_total:     finalTotal,
        p_descuento: descuentoAmt,
        p_metodo:    metodoFinal,
        p_items: cart.map((item) => ({
          product_id:      item.product.id,
          nombre:          item.product.nombre,
          cantidad:        item.cantidad,
          unidad:          item.product.unidad,
          precio_unitario: item.precio_unitario,
          subtotal:        item.subtotal,
        })),
        p_pagos: activePagosRpc,
      }

      let venta: { id: string }
      let pendienteSync = false

      if (navigator.onLine) {
        // Todo el cobro en UNA transacción del servidor: venta + pagos + items
        // + descuento FIFO con lock. O entra completa o no entra nada — y dos
        // cajas cobrando lo mismo se forman en fila en vez de pisarse.
        const { data: ventaId, error: rpcError } = await supabase.rpc('registrar_venta', rpcArgs)
        if (rpcError) throw new Error(`No se pudo registrar la venta: ${rpcError.message}`)
        venta = { id: ventaId as string }
      } else {
        // Sin señal: el dinero ya está en la mano y el cliente no puede esperar
        // al módem. La venta se encola y SyncProvider la registra al reconectar
        // con el mismo RPC (el FIFO se calcula entonces, con el inventario
        // real de ese momento). El ticket sale igual, marcado como pendiente.
        enqueue({ table: 'registrar_venta', action: 'rpc', payload: rpcArgs })
        ;(window as Window & { __posRefreshPending?: () => void }).__posRefreshPending?.()
        venta = { id: crypto.randomUUID() }   // folio provisional del ticket
        pendienteSync = true
      }

      // Show ticket (step 2) instead of closing immediately
      setCompletedSale({
        ventaId:       venta.id,
        items:         cart,
        total:         finalTotal,
        descuento:     descuentoAmt,
        metodo:        metodoFinal,
        pagos:         activePagosRpc,
        sucursalNombre: profile?.sucursal?.nombre ?? '',
        cajeroNombre:   profile?.nombre ?? '',
        fecha:          new Date(),
        pendienteSync,
      })
      setStep('ticket')
      // La venta ya está en la base: liberar la cuenta de inmediato para que
      // no exista un carrito cobrado que se pueda volver a cobrar.
      onVentaGuardada()

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  // ── Ticket step ────────────────────────────────────────────────────────────
  if (step === 'ticket' && completedSale) {
    return (
      <TicketReceipt
        sale={completedSale}
        onClose={() => { onConfirm() }}
      />
    )
  }

  // ── Form step ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="font-bold text-lg text-gray-800 mb-4">💳 Cobrar</h3>

          {/* Order summary */}
          <div className="bg-gray-50 rounded-xl p-3 mb-4 max-h-48 overflow-y-auto space-y-1">
            {cart.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-700 truncate mr-2">
                  {item.product.nombre}{' '}
                  <span className="text-gray-400">({item.cantidad} {item.product.unidad})</span>
                </span>
                <span className="font-medium whitespace-nowrap">${item.subtotal.toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between font-bold">
              <span>Total</span>
              <span className="text-green-700">${total.toFixed(2)}</span>
            </div>
          </div>

          {/* Discount — admin/encargado only */}
          {canDiscount && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => { setShowDescuento(!showDescuento); setDescuentoValor('') }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-green-700 transition-colors"
              >
                <span className={`text-xs transition-transform ${showDescuento ? 'rotate-90' : ''}`}>▶</span>
                {showDescuento ? 'Quitar descuento' : '+ Aplicar descuento'}
              </button>

              {showDescuento && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                  <div className="flex gap-2">
                    {(['porcentaje', 'monto'] as DescuentoMode[]).map((m) => (
                      <button key={m} type="button"
                        onClick={() => { setDescuentoMode(m); setDescuentoValor('') }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          descuentoMode === m
                            ? 'bg-amber-500 text-white'
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {m === 'porcentaje' ? '% Porcentaje' : '$ Monto fijo'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-amber-400">
                    <span className="px-2 text-gray-400 text-sm">
                      {descuentoMode === 'porcentaje' ? '%' : '$'}
                    </span>
                    <input type="number" min="0"
                      max={descuentoMode === 'porcentaje' ? '100' : total.toString()}
                      step={descuentoMode === 'porcentaje' ? '1' : '0.50'}
                      value={descuentoValor}
                      onChange={(e) => setDescuentoValor(e.target.value)}
                      placeholder={descuentoMode === 'porcentaje' ? '10' : '5.00'}
                      className="flex-1 py-2 pr-3 text-sm focus:outline-none tabular-nums"
                    />
                  </div>
                  {descuentoAmt > 0 && (
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-amber-700">Descuento</span>
                      <span className="text-amber-700 tabular-nums">−${descuentoAmt.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Payment method */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Método de pago:</p>
              <button
                type="button"
                onClick={() => {
                  setPagoMixto((v) => !v)
                  setPagosAmounts({ efectivo: '', tarjeta: '', transferencia: '' })
                }}
                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
              >
                {pagoMixto ? '← Un solo método' : '⊕ Pago mixto'}
              </button>
            </div>

            {/* Single method */}
            {!pagoMixto && (
              <div className="flex gap-2">
                {METODOS.map(({ value, label, icon }) => (
                  <button key={value} onClick={() => setMetodoPago(value)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      metodoPago === value
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            )}

            {/* Split payment */}
            {pagoMixto && (
              <div className="space-y-2">
                {METODOS.map(({ value, label, icon }) => (
                  <div key={value} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-28 flex-shrink-0">{icon} {label}</span>
                    <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-green-500">
                      <span className="px-2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.50"
                        value={pagosAmounts[value]}
                        onChange={(e) => setPagosAmounts((prev) => ({ ...prev, [value]: e.target.value }))}
                        placeholder="0.00"
                        className="flex-1 py-2 pr-2 text-sm focus:outline-none tabular-nums"
                      />
                    </div>
                  </div>
                ))}

                {/* Running total / remainder indicator */}
                <div className={`text-xs text-right font-medium mt-1 ${
                  pagoMixtoValid ? 'text-green-600' : pagoMixtoFaltan < 0 ? 'text-red-500' : 'text-amber-600'
                }`}>
                  {pagoMixtoValid
                    ? '✓ Monto completo'
                    : pagoMixtoFaltan > 0
                    ? `Faltan $${pagoMixtoFaltan.toFixed(2)} por asignar`
                    : `Excede por $${Math.abs(pagoMixtoFaltan).toFixed(2)}`
                  }
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-red-500 text-sm mb-4 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} disabled={loading}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handlePagar}
              disabled={loading || (pagoMixto && !pagoMixtoValid)}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 active:scale-95 transition-all"
            >
              {loading ? 'Guardando...' : (
                descuentoAmt > 0
                  ? <span>✓ Cobrar <span className="line-through opacity-60 text-sm">${total.toFixed(2)}</span> ${finalTotal.toFixed(2)}</span>
                  : `✓ Cobrar $${finalTotal.toFixed(2)}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
