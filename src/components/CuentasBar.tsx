'use client'

/**
 * CuentasBar
 *
 * Barra de pestañas con las cuentas abiertas. Va arriba de todo en el POS para
 * que se vea igual en tablet y en celular: el cajero necesita ver de un vistazo
 * a cuántos clientes está atendiendo y saltar entre ellos con un toque.
 *
 * Cada pestaña muestra nombre, número de artículos y total. La activa además
 * deja renombrar (✎) y cerrar (✕).
 *
 * Cerrar una cuenta con artículos pide confirmación en la misma pestaña —sin
 * diálogo del navegador— porque en pantalla táctil es fácil darle a la ✕ sin
 * querer y perder el carrito de un cliente.
 */

import { useState, useRef, useEffect } from 'react'
import type { Cuenta } from '@/lib/types'
import { totalCuenta } from '@/lib/cuentasAbiertas'

interface Props {
  cuentas: Cuenta[]
  activaId: string
  puedeAbrirMas: boolean
  onSelect: (id: string) => void
  onNueva: () => void
  onCerrar: (id: string) => void
  onRenombrar: (id: string, nombre: string) => void
}

export default function CuentasBar({
  cuentas, activaId, puedeAbrirMas, onSelect, onNueva, onCerrar, onRenombrar,
}: Props) {
  const [editandoId, setEditandoId]   = useState<string | null>(null)
  const [borrador, setBorrador]       = useState('')
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editandoId) inputRef.current?.select()
  }, [editandoId])

  const empezarEdicion = (c: Cuenta) => {
    setConfirmandoId(null)
    setBorrador(c.nombre)
    setEditandoId(c.id)
  }

  const confirmarEdicion = () => {
    if (editandoId) onRenombrar(editandoId, borrador)
    setEditandoId(null)
  }

  const pedirCierre = (c: Cuenta) => {
    // Cuenta vacía: no hay nada que perder, se cierra directo.
    if (c.cart.length === 0) {
      onCerrar(c.id)
      return
    }
    setConfirmandoId(c.id)
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 bg-gray-50 overflow-x-auto flex-shrink-0">
      {cuentas.map((c) => {
        const activa    = c.id === activaId
        const total     = totalCuenta(c)
        const articulos = c.cart.length

        // ── Confirmación de cierre ──────────────────────────────────────────
        if (confirmandoId === c.id) {
          return (
            <div
              key={c.id}
              className="flex-shrink-0 flex items-center gap-1 pl-3 pr-1 py-1 rounded-lg border border-red-300 bg-red-50 text-xs"
            >
              <span className="text-red-700 font-medium whitespace-nowrap">
                ¿Descartar {c.nombre}?
              </span>
              <button
                onClick={() => { onCerrar(c.id); setConfirmandoId(null) }}
                className="font-bold text-red-600 hover:text-red-800 px-2 py-1"
              >
                Sí
              </button>
              <button
                onClick={() => setConfirmandoId(null)}
                className="text-gray-500 hover:text-gray-700 px-2 py-1"
              >
                No
              </button>
            </div>
          )
        }

        // ── Renombrar ───────────────────────────────────────────────────────
        if (editandoId === c.id) {
          return (
            <input
              key={c.id}
              ref={inputRef}
              value={borrador}
              maxLength={24}
              autoFocus
              onChange={(e) => setBorrador(e.target.value)}
              onBlur={confirmarEdicion}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmarEdicion()
                if (e.key === 'Escape') setEditandoId(null)
              }}
              className="flex-shrink-0 w-36 px-3 py-1.5 rounded-lg border border-green-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          )
        }

        // ── Pestaña normal ──────────────────────────────────────────────────
        return (
          <div
            key={c.id}
            className={`flex-shrink-0 flex items-center rounded-lg border transition-colors ${
              activa
                ? 'bg-white border-green-500 shadow-sm'
                : 'bg-white/60 border-gray-200 hover:border-gray-300'
            }`}
          >
            <button
              onClick={() => onSelect(c.id)}
              className="flex items-center gap-2 pl-3 pr-2 py-2"
            >
              <span className={`text-sm font-medium whitespace-nowrap ${
                activa ? 'text-gray-800' : 'text-gray-500'
              }`}>
                {c.nombre}
              </span>
              {articulos > 0 && (
                <>
                  <span className={`text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${
                    activa ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {articulos}
                  </span>
                  <span className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                    activa ? 'text-green-700' : 'text-gray-400'
                  }`}>
                    ${total.toFixed(2)}
                  </span>
                </>
              )}
            </button>

            {/* Renombrar y cerrar: sólo en la cuenta activa, para no llenar la
                barra de botones diminutos */}
            {activa && (
              <div className="flex items-center pr-1">
                <button
                  onClick={() => empezarEdicion(c)}
                  title="Renombrar cuenta"
                  className="text-gray-400 hover:text-gray-700 text-sm px-2 py-2 leading-none"
                >
                  ✎
                </button>
                <button
                  onClick={() => pedirCierre(c)}
                  title="Descartar cuenta"
                  className="text-gray-400 hover:text-red-500 text-sm px-2 py-2 leading-none"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )
      })}

      <button
        onClick={onNueva}
        disabled={!puedeAbrirMas}
        title={puedeAbrirMas ? 'Abrir otra cuenta' : 'Llegaste al máximo de cuentas abiertas'}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-green-500 hover:text-green-700 disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-500 transition-colors"
      >
        ＋ Cuenta
      </button>
    </div>
  )
}
