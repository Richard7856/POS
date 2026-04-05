'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import type { Sucursal } from '@/lib/types'

const EMPTY_FORM = { nombre: '', direccion: '' }

export default function SucursalesPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!loading && profile?.rol !== 'admin') router.replace('/admin')
  }, [profile, loading, router])

  const load = async () => {
    const { data } = await supabase.from('sucursales').select('*').order('nombre')
    setSucursales(data ?? [])
    setLoadingData(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      direccion: form.direccion.trim() || null,
    }
    if (editingId) {
      await supabase.from('sucursales').update(payload).eq('id', editingId)
    } else {
      await supabase.from('sucursales').insert(payload)
    }
    setSaving(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(false)
    load()
  }

  const handleToggle = async (s: Sucursal) => {
    await supabase.from('sucursales').update({ activa: !s.activa }).eq('id', s.id)
    load()
  }

  if (loadingData) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <h1 className="text-xl font-bold text-gray-800">🏪 Sucursales</h1>
        <div className="flex-1" />
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true) }}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + Nueva
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-700">{editingId ? 'Editar sucursal' : 'Nueva sucursal'}</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Nombre *</label>
            <input
              required type="text" value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Dirección <span className="text-gray-400">(opcional)</span></label>
            <input
              type="text" value={form.direccion}
              onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Guardando...' : editingId ? 'Guardar' : 'Agregar'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 shadow-sm">
        {sucursales.map((s) => (
          <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.activa ? '' : 'opacity-50'}`}>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 truncate">{s.nombre}</p>
              {s.direccion && <p className="text-xs text-gray-400 truncate">{s.direccion}</p>}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.activa ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {s.activa ? 'Activa' : 'Inactiva'}
            </span>
            <button
              onClick={() => { setForm({ nombre: s.nombre, direccion: s.direccion ?? '' }); setEditingId(s.id); setShowForm(true) }}
              className="text-blue-500 hover:text-blue-700 text-xs"
            >Editar</button>
            <button onClick={() => handleToggle(s)} className="text-gray-400 hover:text-gray-600 text-xs">
              {s.activa ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
