'use client'

/**
 * /perfil — datos de la cuenta y cambio de contraseña propia
 *
 * Cualquier rol entra aquí. Existe para que quien recibe una contraseña
 * temporal pueda cambiarla sin que un admin tenga que entrar al dashboard
 * de Supabase.
 *
 * El reseteo de la contraseña de OTRA persona lo hace el admin desde
 * /admin/usuarios (requiere service role → Edge Function reset-password).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const ROL_LABEL: Record<string, string> = {
  admin:     'Admin — todo el sistema',
  encargado: 'Encargado — entradas, corte de caja y devoluciones',
  cajero:    'Cajero — cobro y tickets',
}

const MIN_PASSWORD = 8

export default function PerfilPage() {
  const { user, profile } = useAuth()
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [done,     setDone]     = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(false)

    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    if (password !== confirm) {
      setError('Las dos contraseñas no coinciden.')
      return
    }

    setSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (err) {
      // El mensaje más común es cuando se reusa la contraseña actual
      setError(
        err.message.toLowerCase().includes('should be different')
          ? 'La nueva contraseña debe ser distinta a la actual.'
          : err.message
      )
      return
    }

    setPassword('')
    setConfirm('')
    setDone(true)
  }

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto overflow-y-auto h-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <h1 className="text-xl font-bold text-gray-800">👤 Mi cuenta</h1>
      </div>

      {/* Datos de la cuenta */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm space-y-3">
        <div>
          <p className="text-xs text-gray-400">Nombre</p>
          <p className="text-sm text-gray-800">{profile?.nombre ?? '(sin nombre)'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Correo</p>
          <p className="text-sm text-gray-800 break-all">{user?.email}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Rol</p>
          <p className="text-sm text-gray-800">
            {profile?.rol ? ROL_LABEL[profile.rol] ?? profile.rol : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Sucursal</p>
          <p className="text-sm text-gray-800">{profile?.sucursal?.nombre ?? 'Sin asignar'}</p>
        </div>
      </div>

      {/* Cambio de contraseña */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-700">Cambiar contraseña</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Si te dieron una contraseña temporal, cámbiala aquí.
          </p>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Nueva contraseña</label>
          <input
            required
            type="password"
            value={password}
            minLength={MIN_PASSWORD}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`Mínimo ${MIN_PASSWORD} caracteres`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Repetir contraseña</label>
          <input
            required
            type="password"
            value={confirm}
            minLength={MIN_PASSWORD}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {done && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
            ✓ Contraseña actualizada. Úsala la próxima vez que inicies sesión.
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  )
}
