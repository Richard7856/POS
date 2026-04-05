'use client'

/**
 * MovimientoCajaModal
 *
 * Quick-entry modal for cash box movements that the corte de caja must account for.
 * Opened from the POS page (during the day) and from the corte page.
 *
 * Types by role:
 *   cajero    → gasto only
 *   encargado/admin → fondo_inicial | gasto | retiro
 *
 * The modal inserts one row into movimientos_caja and calls onSaved() so the
 * parent can refresh its local state if needed.
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { MovimientoTipo } from '@/lib/types'

interface Props {
  onSaved: () => void
  onClose: () => void
}

const TIPOS: { value: MovimientoTipo; label: string; icon: string; desc: string }[] = [
  { value: 'fondo_inicial', label: 'Fondo inicial',  icon: '💰', desc: 'Dinero puesto en caja al abrir' },
  { value: 'gasto',         label: 'Gasto',          icon: '🧾', desc: 'Pago de insumos, envíos, etc.' },
  { value: 'retiro',        label: 'Retiro',         icon: '💸', desc: 'Retiro del dueño o encargado' },
]

export default function MovimientoCajaModal({ onSaved, onClose }: Props) {
  const { profile, user } = useAuth()
  const isStaff = profile?.rol === 'admin' || profile?.rol === 'encargado'

  // Cajeros can only register gastos
  const availableTipos = isStaff ? TIPOS : TIPOS.filter((t) => t.value === 'gasto')

  const [tipo,        setTipo]        = useState<MovimientoTipo>(availableTipos[0].value)
  const [monto,       setMonto]       = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const handleGuardar = async () => {
    setError(null)
    const montoNum = parseFloat(monto)
    if (!monto || isNaN(montoNum) || montoNum <= 0) {
      return setError('El monto debe ser mayor a $0')
    }
    if (!profile?.sucursal_id) {
      return setError('Tu perfil no tiene sucursal asignada')
    }

    setSaving(true)
    const { error: dbError } = await supabase
      .from('movimientos_caja')
      .insert({
        sucursal_id:    profile.sucursal_id,
        tipo,
        monto:          montoNum,
        descripcion:    descripcion.trim() || null,
        registrado_por: user?.id ?? null,
        fecha:          new Date().toISOString().slice(0, 10),
      })

    if (dbError) {
      setError(dbError.message)
    } else {
      onSaved()
      onClose()
    }
    setSaving(false)
  }

  const selected = TIPOS.find((t) => t.value === tipo)!

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-5 space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-800">💸 Movimiento de caja</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>

          {/* Tipo selector */}
          <div className="space-y-1.5">
            {availableTipos.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTipo(t.value)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                  tipo === t.value
                    ? 'bg-green-50 border-2 border-green-500'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
              >
                <span className="text-xl flex-shrink-0">{t.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${tipo === t.value ? 'text-green-700' : 'text-gray-700'}`}>
                    {t.label}
                  </p>
                  <p className="text-xs text-gray-400">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Monto */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Monto *
            </label>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-green-500">
              <span className="px-3 text-gray-400 text-sm">$</span>
              <input
                type="number"
                min="0.01"
                step="0.50"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                autoFocus
                className="flex-1 py-2.5 pr-3 text-sm focus:outline-none tabular-nums"
              />
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Descripción <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={
                tipo === 'gasto'         ? 'ej. Bolsas de plástico' :
                tipo === 'fondo_inicial' ? 'ej. Fondo de apertura' :
                'ej. Retiro del dueño'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Color hint */}
          <div className={`rounded-xl px-3 py-2 text-xs ${
            tipo === 'fondo_inicial' ? 'bg-blue-50 text-blue-700' :
            tipo === 'gasto'         ? 'bg-amber-50 text-amber-700' :
                                       'bg-red-50 text-red-700'
          }`}>
            {tipo === 'fondo_inicial' && '💡 Se sumará al efectivo esperado en el corte'}
            {tipo === 'gasto'         && '💡 Se restará del efectivo esperado en el corte'}
            {tipo === 'retiro'        && '💡 Se restará del efectivo esperado en el corte'}
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGuardar}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 active:scale-95 transition-all text-sm"
            >
              {saving ? 'Guardando...' : `${selected.icon} Registrar`}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
