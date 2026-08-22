'use client'

import { useState } from 'react'
import { Product } from '@/lib/types'
import type { ScaleHookReturn } from '@/hooks/useBluetoothScale'
import { evaluarStock, aKg } from '@/lib/stock'

interface Props {
  product: Product
  scale: ScaleHookReturn
  /**
   * kg disponibles, ya descontando lo apartado en las cuentas abiertas.
   * null = el producto no lleva control de inventario (por pieza, o sin
   * ninguna entrada capturada todavía): no se avisa nada.
   */
  stockDisponible: number | null
  /** admin/encargado pueden vender aunque no haya inventario; el cajero no */
  puedeForzar: boolean
  // cantidad is in the product's native unit (kg for 'kg' products, g for 'g' products)
  onConfirm: (cantidad: number) => void
  onClose: () => void
}

export default function WeightModal({
  product, scale, stockDisponible, puedeForzar, onConfirm, onClose,
}: Props) {
  const [manualInput, setManualInput] = useState('')

  const isConnected = scale.status === 'connected'

  // Convert normalized kg reading to the product's unit for display
  const scaleValueInUnit =
    product.unidad === 'g' ? scale.weightKg * 1000 : scale.weightKg

  // Manual input overrides scale when provided
  const hasManual = manualInput !== '' && parseFloat(manualInput) > 0
  const effectiveValue = hasManual
    ? parseFloat(manualInput)
    : isConnected
    ? scaleValueInUnit
    : 0

  const subtotal = effectiveValue * product.precio_por_unidad

  // ── Control de existencias ────────────────────────────────────────────────
  // El inventario se lleva en kg aunque el producto se venda por gramo.
  const pedidoKg = aKg(effectiveValue, product.unidad)
  const estado   = evaluarStock(stockDisponible, pedidoKg)
  const faltanKg = parseFloat((pedidoKg - (stockDisponible ?? 0)).toFixed(3))
  const hayProblema = effectiveValue > 0 && estado !== 'ok'
  // El cajero queda bloqueado; el staff confirma sabiendo que quedará negativo.
  const canConfirm = effectiveValue > 0 && (!hayProblema || puedeForzar)

  const step = product.unidad === 'g' ? '1' : '0.001'
  const unitLabel = product.unidad === 'g' ? 'g' : 'kg'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="font-bold text-lg text-gray-800 mb-1">{product.nombre}</h3>
          <p className="text-sm text-gray-500 mb-4">
            ${product.precio_por_unidad.toFixed(2)} / {product.unidad}
          </p>

          {/* Live scale reading — shown only when connected */}
          {isConnected && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4 text-center">
              <div className="text-xs text-blue-500 mb-1">⚖️ {scale.deviceName}</div>
              <div className="text-3xl font-mono font-bold text-gray-800 tabular-nums">
                {scale.reading
                  ? `${scale.reading.value} ${scale.reading.unit}`
                  : '— —'}
              </div>
              {/* All readings are normalized to kg now — no conversion needed */}
            </div>
          )}

          {/* Manual input — always available as fallback/override */}
          <div className="mb-4">
            <label className="block text-sm text-gray-600 mb-1">
              {isConnected ? 'Sobrescribir manualmente:' : 'Ingresa la cantidad:'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={step}
                min="0"
                placeholder={
                  isConnected ? scaleValueInUnit.toFixed(product.unidad === 'g' ? 1 : 3) : '0.000'
                }
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-gray-500 font-medium w-8">{unitLabel}</span>
            </div>
          </div>

          {/* Aviso de existencias — antes del subtotal, para que se lea primero */}
          {hayProblema && (
            <div className={`rounded-xl px-4 py-3 mb-4 text-sm border ${
              puedeForzar
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <p className="font-semibold">
                {estado === 'sin_stock'
                  ? '⚠ Sin inventario registrado'
                  : `⚠ Solo hay ${(stockDisponible ?? 0).toFixed(3)} kg`}
              </p>
              <p className="text-xs mt-0.5">
                {puedeForzar
                  ? `Si continúas, el inventario quedará en −${faltanKg.toFixed(3)} kg. Registra la entrada que falta para que el corte cuadre.`
                  : 'Pídele al encargado que registre la entrada de mercancía antes de vender.'}
              </p>
            </div>
          )}

          {/* Subtotal summary */}
          <div className="flex justify-between items-center bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-6">
            <div>
              <div className="text-xs text-gray-500">Cantidad</div>
              <div className="font-mono text-gray-700 tabular-nums">
                {effectiveValue.toFixed(product.unidad === 'g' ? 1 : 3)} {unitLabel}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">Subtotal</div>
              <div className="text-2xl font-bold text-green-700">
                ${subtotal.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => canConfirm && onConfirm(effectiveValue)}
              disabled={!canConfirm}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
            >
              {hayProblema && puedeForzar ? 'Agregar de todos modos' : 'Agregar →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
