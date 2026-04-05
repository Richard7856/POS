'use client'

type MarginMode = 'porcentaje' | 'monto'

interface Props {
  precioCompra: string
  marginMode: MarginMode
  marginValue: string
  onPrecioCompraChange: (v: string) => void
  onMarginModeChange: (v: MarginMode) => void
  onMarginValueChange: (v: string) => void
}

// Compute sell price from cost + margin. Returns null when inputs are invalid.
export function computePrecioVenta(
  precioCompra: string,
  marginMode: MarginMode,
  marginValue: string
): number | null {
  const costo = parseFloat(precioCompra)
  const margen = parseFloat(marginValue)
  if (!isFinite(costo) || costo <= 0 || !isFinite(margen) || margen < 0) return null

  const precio =
    marginMode === 'porcentaje'
      ? costo * (1 + margen / 100)  // e.g. cost=$10, margin=30% → $13.00
      : costo + margen               // e.g. cost=$10, margin=$3 → $13.00

  // Round to 2 decimal places for display; stored unrounded in DB via precio_por_unidad
  return Math.round(precio * 100) / 100
}

export default function MarginCalculator({
  precioCompra,
  marginMode,
  marginValue,
  onPrecioCompraChange,
  onMarginModeChange,
  onMarginValueChange,
}: Props) {
  const computed = computePrecioVenta(precioCompra, marginMode, marginValue)

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Calculador de margen
      </p>

      {/* Costo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Precio de compra
        </label>
        <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white">
          <span className="px-3 text-gray-400 text-sm">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={precioCompra}
            onChange={(e) => onPrecioCompraChange(e.target.value)}
            placeholder="0.00"
            className="flex-1 py-2 pr-3 text-sm focus:outline-none"
          />
        </div>
      </div>

      {/* Margin mode toggle */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tipo de margen
        </label>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => onMarginModeChange('porcentaje')}
            className={`flex-1 py-2 font-medium transition-colors ${
              marginMode === 'porcentaje'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            % Porcentaje
          </button>
          <button
            type="button"
            onClick={() => onMarginModeChange('monto')}
            className={`flex-1 py-2 font-medium transition-colors border-l border-gray-300 ${
              marginMode === 'monto'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            $ Monto fijo
          </button>
        </div>
      </div>

      {/* Margin value */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {marginMode === 'porcentaje' ? 'Porcentaje (%)' : 'Ganancia ($)'}
        </label>
        <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white">
          <span className="px-3 text-gray-400 text-sm">
            {marginMode === 'porcentaje' ? '%' : '$'}
          </span>
          <input
            type="number"
            min="0"
            step={marginMode === 'porcentaje' ? '1' : '0.01'}
            value={marginValue}
            onChange={(e) => onMarginValueChange(e.target.value)}
            placeholder="0"
            className="flex-1 py-2 pr-3 text-sm focus:outline-none"
          />
        </div>
      </div>

      {/* Live preview */}
      <div className={`rounded-lg px-4 py-3 flex items-center justify-between ${
        computed !== null ? 'bg-green-50 border border-green-200' : 'bg-gray-100 border border-gray-200'
      }`}>
        <span className="text-sm font-medium text-gray-600">Precio de venta calculado</span>
        <span className={`text-lg font-bold ${computed !== null ? 'text-green-700' : 'text-gray-400'}`}>
          {computed !== null ? `$${computed.toFixed(2)}` : '—'}
        </span>
      </div>
    </div>
  )
}
