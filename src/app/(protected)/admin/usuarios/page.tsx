'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import type { Profile, Sucursal } from '@/lib/types'

type Rol = 'admin' | 'encargado' | 'cajero'

const ROL_COLORS: Record<Rol, string> = {
  admin:   'bg-yellow-100 text-yellow-800',
  encargado: 'bg-blue-100 text-blue-800',
  cajero:  'bg-green-100 text-green-700',
}

const EMPTY_FORM = {
  email: '',
  password: '',
  nombre: '',
  rol: 'cajero' as Rol,
  sucursal_id: '',
}

export default function UsuariosPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()

  const [users, setUsers] = useState<Profile[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && profile?.rol !== 'admin') router.replace('/admin')
  }, [profile, loading, router])

  const load = async () => {
    const [{ data: profiles }, { data: suc }] = await Promise.all([
      supabase.from('profiles').select('*, sucursal:sucursales(id, nombre, direccion, activa, created_at)').order('created_at'),
      supabase.from('sucursales').select('*').eq('activa', true).order('nombre'),
    ])
    setUsers(profiles ?? [])
    setSucursales(suc ?? [])
    setLoadingData(false)
  }

  useEffect(() => { load() }, [])

  // Creating users requires the Supabase service role (can't be done from the browser).
  // This calls a Supabase Edge Function that validates the caller's role and creates
  // the auth user server-side. The Edge Function must be deployed separately.
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)

    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email:       form.email.trim(),
          password:    form.password,
          nombre:      form.nombre.trim(),
          rol:         form.rol,
          sucursal_id: form.sucursal_id || null,
        },
      })

      if (error || data?.error) {
        throw new Error(error?.message ?? data?.error ?? 'Error al crear usuario')
      }

      setForm(EMPTY_FORM)
      setShowForm(false)
      load()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateRol = async (userId: string, rol: Rol) => {
    await supabase.from('profiles').update({ rol }).eq('id', userId)
    load()
  }

  const handleToggleActive = async (u: Profile) => {
    await supabase.from('profiles').update({ activo: !u.activo }).eq('id', u.id)
    load()
  }

  if (loadingData) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <h1 className="text-xl font-bold text-gray-800">👥 Usuarios</h1>
        <div className="flex-1" />
        <button
          onClick={() => { setForm(EMPTY_FORM); setSaveError(null); setShowForm(true) }}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + Nuevo usuario
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-700">Nuevo usuario</h2>
          <p className="text-xs text-gray-400">
            Se crea una cuenta de acceso al POS. El usuario puede cambiar su contraseña desde la configuración de Supabase.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Nombre *</label>
              <input required type="text" value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Correo *</label>
              <input required type="email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Contraseña temporal *</label>
              <input required type="password" value={form.password} minLength={8}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Rol *</label>
              <select value={form.rol} onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value as Rol }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="cajero">Cajero</option>
                <option value="encargado">Encargado</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Sucursal</label>
              <select value={form.sucursal_id} onChange={(e) => setForm((f) => ({ ...f, sucursal_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Sin asignar</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {saveError}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 shadow-sm">
        {users.map((u) => (
          <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${u.activo ? '' : 'opacity-50'}`}>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 truncate">{u.nombre ?? '(sin nombre)'}</p>
              <p className="text-xs text-gray-400 truncate">{(u as Profile & { sucursal?: { nombre: string } }).sucursal?.nombre ?? 'Sin sucursal'}</p>
            </div>
            {/* Inline rol selector */}
            <select
              value={u.rol}
              onChange={(e) => handleUpdateRol(u.id, e.target.value as Rol)}
              className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${ROL_COLORS[u.rol]}`}
            >
              <option value="cajero">cajero</option>
              <option value="encargado">encargado</option>
              <option value="admin">admin</option>
            </select>
            <button onClick={() => handleToggleActive(u)} className="text-gray-400 hover:text-gray-600 text-xs">
              {u.activo ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
