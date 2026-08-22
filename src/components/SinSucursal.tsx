'use client'

/**
 * Aviso de perfil sin sucursal.
 *
 * Entradas, merma, pedido y corte operan SOBRE una sucursal: sin ella las
 * consultas fallaban en silencio (uuid vacío) y las pantallas quedaban vacías
 * sin explicación, o el guardado tronaba con un error críptico. Este banner
 * dice qué pasa y quién lo arregla.
 */

import { useAuth } from '@/context/AuthContext'

export default function SinSucursal() {
  const { profile } = useAuth()
  const esAdmin = profile?.rol === 'admin'

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
        <p className="text-3xl mb-2">🏪</p>
        <p className="font-semibold text-amber-800">Tu perfil no tiene sucursal asignada</p>
        <p className="text-sm text-amber-600 mt-1">
          {esAdmin
            ? 'Asígnate una en Admin → Usuarios para poder trabajar el inventario de una sucursal.'
            : 'Pídele al administrador que te asigne tu sucursal en Admin → Usuarios.'}
        </p>
      </div>
    </div>
  )
}
