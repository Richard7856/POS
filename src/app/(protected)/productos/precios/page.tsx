'use client'

/**
 * /productos/precios — cambiar los precios del día, todos de una vez
 *
 * En fruta y verdura el precio se mueve cada mañana. Editar producto por
 * producto (abrir form, guardar, abrir el siguiente) tomaba minutos; aquí es
 * una sola lista: tecleas los nuevos, ves el margen en vivo y guardas todo.
 *
 * Sólo staff. Únicamente se escriben los productos cuyo precio cambió.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { calcGanancia } from '@/lib/ganancia'
import type { Product } from '@/lib/types'

export default function PreciosPage() {
  const { profile, loading: authLoading } = useAuth()
  const router = useRouter()

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  // id → precio tecleado (string tal cual del input)
  const [borrador, setBorrador] = useState<Map<string, string>>(new Map())
  const [saving, setSaving]     = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  const esStaff = profile?.rol === 'admin' || profile?.rol === 'encargado'

  useEffect(() => {
    if (!authLoading && profile && !esStaff) router.replace('/pos')
  }, [authLoading, profile, esStaff, router])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('activo', true)
        .order('categoria', { ascending: true })
        .order('nombre', { ascending: true })
      setProducts(data ?? [])
      setLoading(false)
    }
    if (esStaff) load()
  }, [esStaff])

  // Cuántos renglones tienen un precio distinto al actual y válido
  const cambios = useMemo(() => {
    const lista: { id: string; precio: number }[] = []
    for (const p of products) {
      const raw = borrador.get(p.id)
      if (raw == null || raw.trim() === '') continue
      const nuevo = parseFloat(raw)
      if (!isFinite(nuevo) || nuevo <= 0) continue
      if (Math.abs(nuevo - p.precio_por_unidad) < 0.005) continue
      lista.push({ id: p.id, precio: nuevo })
    }
    return lista
  }, [products, borrador])

  const handleGuardar = async () => {
    if (cambios.length === 0) return
    setSaving(true)
    setResultado(null)

    // Un update por producto cambiado. Con un catálogo de decenas de productos
    // esto es instantáneo; si algún día son miles, se vuelve un RPC.
    const resultados = await Promise.all(
      cambios.map(({ id, precio }) =>
        supabase.from('products').update({ precio_por_unidad: precio }).eq('id', id)
      )
    )
    const fallidos = resultados.filter((r) => r.error).length

    // Refrescar la lista con lo guardado y limpiar el borrador
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('activo', true)
      .order('categoria', { ascending: true })
      .order('nombre', { ascending: true })
    setProducts(data ?? [])
    setBorrador(new Map())
    setSaving(false)
    setResultado(
      fallidos === 0
        ? `✓ ${cambios.length} precio${cambios.length !== 1 ? 's' : ''} actualizado${cambios.length !== 1 ? 's' : ''}`
        : `⚠ ${fallidos} de ${cambios.length} no se pudieron guardar`
    )
    setTimeout(() => setResultado(null), 4000)
  }

  if (authLoading || !profile || !esStaff) return null
  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  const filtrados = products.filter((p) =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto overflow-y-auto h-full pb-28">

      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <h1 className="text-xl font-bold text-gray-800">💲 Precios de hoy</h1>
      </div>
      <p className="text-sm text-gray-500 mb-4 ml-8">
        Teclea los nuevos precios y guarda todo de una vez. Lo que dejes en blanco no cambia.
      </p>

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar producto..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-500"
      />

      {/* Lista */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
        {filtrados.map((p) => {
          const raw = borrador.get(p.id) ?? ''
          const nuevo = raw.trim() !== '' ? parseFloat(raw) : null
          const efectivo = nuevo != null && isFinite(nuevo) && nuevo > 0 ? nuevo : p.precio_por_unidad
          const g = calcGanancia(efectivo, p.precio_compra)
          const cambiado = nuevo != null && isFinite(nuevo) && nuevo > 0 &&
            Math.abs(nuevo - p.precio_por_unidad) >= 0.005

          return (
            <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${cambiado ? 'bg-green-50/60' : ''}`}>
              {/* Nombre + costo */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm truncate">{p.nombre}</p>
                <p className="text-xs text-gray-400">
                  {p.precio_compra != null ? `costo $${p.precio_compra.toFixed(2)}` : 'sin costo'} · /{p.unidad}
                </p>
              </div>

              {/* Margen resultante en vivo */}
              <div className={`text-right text-xs font-medium tabular-nums w-20 flex-shrink-0 ${
                !g ? 'text-gray-300'
                  : g.monto < 0 ? 'text-red-600'
                  : g.pct < 10 ? 'text-amber-600'
                  : 'text-green-700'
              }`}>
                {g ? `${g.monto < 0 ? '−' : '+'}$${Math.abs(g.monto).toFixed(2)}` : '—'}
                {g && <div className="text-[10px] opacity-70">{g.pct}%</div>}
              </div>

              {/* Precio actual → nuevo */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm text-gray-400 tabular-nums w-16 text-right">
                  ${p.precio_por_unidad.toFixed(2)}
                </span>
                <span className="text-gray-300">→</span>
                <div className={`flex items-center border rounded-lg overflow-hidden bg-white w-24 ${
                  cambiado ? 'border-green-500' : 'border-gray-300'
                }`}>
                  <span className="pl-2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    placeholder={p.precio_por_unidad.toFixed(2)}
                    value={raw}
                    onChange={(e) => {
                      const v = e.target.value
                      setBorrador((prev) => {
                        const m = new Map(prev)
                        if (v === '') m.delete(p.id)
                        else m.set(p.id, v)
                        return m
                      })
                    }}
                    className="w-full py-2 pr-2 text-sm text-right font-semibold tabular-nums focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )
        })}
        {filtrados.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">Sin resultados</p>
        )}
      </div>

      {/* Barra de guardado — fija abajo, siempre a la vista */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <p className="flex-1 text-sm text-gray-500">
            {resultado ?? (
              cambios.length > 0
                ? `${cambios.length} precio${cambios.length !== 1 ? 's' : ''} por guardar`
                : 'Sin cambios'
            )}
          </p>
          {cambios.length > 0 && !saving && (
            <button
              onClick={() => setBorrador(new Map())}
              className="text-sm text-gray-400 hover:text-red-500 px-3 py-2"
            >
              Descartar
            </button>
          )}
          <button
            onClick={handleGuardar}
            disabled={cambios.length === 0 || saving}
            className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm disabled:opacity-40 transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar todo'}
          </button>
        </div>
      </div>
    </div>
  )
}
