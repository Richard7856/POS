'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Product } from '@/lib/types'
import MarginCalculator, { computePrecioVenta } from '@/components/MarginCalculator'

type MarginMode = 'porcentaje' | 'monto'

// Predefined categories for a recaudería / fruit & vegetable / grocery store
const CATEGORIAS = [
  'Frutas',
  'Verduras',
  'Chiles',
  'Hierbas y especias',
  'Granos y legumbres',
  'Cereales',
  'Básicos',
  'Lácteos',
  'Bebidas',
  'Limpieza',
  'Botanas',
  'Otros',
]

const EMPTY_FORM = {
  nombre: '',
  precio_por_unidad: '',
  unidad: 'kg' as Product['unidad'],
  categoria: '',
  // Minimum stock in kg — triggers reorder alert when stock falls below this
  stock_minimo: '',
  // Margin calculator fields (admin/encargado only)
  precio_compra: '',
  margin_mode: 'porcentaje' as MarginMode,
  margin_value: '',
}

export default function ProductosPage() {
  const { profile } = useAuth()
  const canSeeCost = profile?.rol === 'admin' || profile?.rol === 'encargado'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const loadProducts = async () => {
    const { data } = await supabase
      .from('products')
      .select('*')
      .order('categoria', { ascending: true })
      .order('nombre', { ascending: true })
    setProducts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { loadProducts() }, [])

  // Determine the effective sell price:
  // - If cost + margin are filled → use computed price
  // - Otherwise → use the manually entered precio_por_unidad
  const computedPrecio = computePrecioVenta(form.precio_compra, form.margin_mode, form.margin_value)
  const effectivePrecio = computedPrecio !== null
    ? computedPrecio.toString()
    : form.precio_por_unidad

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const payload: Partial<Product> = {
      nombre: form.nombre.trim(),
      precio_por_unidad: parseFloat(effectivePrecio),
      unidad: form.unidad,
      categoria: form.categoria.trim() || null,
      precio_compra: form.precio_compra ? parseFloat(form.precio_compra) : null,
      stock_minimo: form.stock_minimo ? parseFloat(form.stock_minimo) : null,
    }

    if (editingId) {
      await supabase.from('products').update(payload).eq('id', editingId)
    } else {
      await supabase.from('products').insert({ ...payload, activo: true })
    }

    setSaving(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(false)
    loadProducts()
  }

  const handleEdit = (product: Product) => {
    setForm({
      nombre: product.nombre,
      precio_por_unidad: product.precio_por_unidad.toString(),
      unidad: product.unidad,
      categoria: product.categoria ?? '',
      stock_minimo: product.stock_minimo?.toString() ?? '',
      precio_compra: product.precio_compra?.toString() ?? '',
      margin_mode: 'porcentaje',
      margin_value: '',
    })
    setEditingId(product.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleToggleActive = async (product: Product) => {
    await supabase.from('products').update({ activo: !product.activo }).eq('id', product.id)
    loadProducts()
  }

  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto overflow-y-auto h-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold text-gray-800">📦 Productos</h1>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true) }}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
        >
          + Nuevo producto
        </button>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm space-y-4"
        >
          <h2 className="font-semibold text-gray-700">
            {editingId ? 'Editar producto' : 'Nuevo producto'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            {/* Nombre */}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Nombre *</label>
              <input
                required
                type="text"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Precio de venta — read-only when computed from margin */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Precio de venta *
                {computedPrecio !== null && (
                  <span className="ml-1 text-green-600 font-normal">(calculado)</span>
                )}
              </label>
              <input
                required
                type="number"
                step="0.01"
                min="0"
                value={computedPrecio !== null ? computedPrecio.toFixed(2) : form.precio_por_unidad}
                readOnly={computedPrecio !== null}
                onChange={(e) => setForm((f) => ({ ...f, precio_por_unidad: e.target.value }))}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                  computedPrecio !== null
                    ? 'border-green-300 bg-green-50 text-green-700 font-bold cursor-not-allowed'
                    : 'border-gray-300'
                }`}
              />
            </div>

            {/* Unidad */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Unidad *</label>
              <select
                value={form.unidad}
                onChange={(e) => setForm((f) => ({ ...f, unidad: e.target.value as Product['unidad'] }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="kg">kg — precio por kilo</option>
                <option value="g">g — precio por gramo</option>
                <option value="pieza">pieza — precio fijo</option>
              </select>
            </div>

            {/* Categoría */}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">
                Categoría <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <select
                value={form.categoria}
                onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="">— Sin categoría —</option>
                {CATEGORIAS.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Stock mínimo — solo para productos a granel (kg/g) */}
          {canSeeCost && (form.unidad === 'kg' || form.unidad === 'g') && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Stock mínimo (kg)
                <span className="ml-1 text-gray-400 font-normal">(opcional — dispara alerta de pedido)</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.stock_minimo}
                onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))}
                placeholder="Ej: 5"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          )}

          {/* Margin calculator — only admin/encargado can see cost data */}
          {canSeeCost && (
            <MarginCalculator
              precioCompra={form.precio_compra}
              marginMode={form.margin_mode}
              marginValue={form.margin_value}
              onPrecioCompraChange={(v) => setForm((f) => ({ ...f, precio_compra: v }))}
              onMarginModeChange={(v) => setForm((f) => ({ ...f, margin_mode: v }))}
              onMarginValueChange={(v) => setForm((f) => ({ ...f, margin_value: v }))}
            />
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}
            </button>
          </div>
        </form>
      )}

      {/* Products table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Precio venta</th>
              {canSeeCost && (
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Costo</th>
              )}
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Unidad</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Categoría</th>
              {canSeeCost && (
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Stock mín.</th>
              )}
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((product) => (
              <tr key={product.id} className={product.activo ? '' : 'opacity-50 bg-gray-50'}>
                <td className="px-4 py-3 font-medium text-gray-800">{product.nombre}</td>
                <td className="px-4 py-3 text-green-700 font-bold tabular-nums">
                  ${product.precio_por_unidad.toFixed(2)}
                </td>
                {canSeeCost && (
                  <td className="px-4 py-3 text-gray-400 tabular-nums text-xs">
                    {product.precio_compra != null ? `$${product.precio_compra.toFixed(2)}` : '—'}
                  </td>
                )}
                <td className="px-4 py-3 text-gray-500">{product.unidad}</td>
                <td className="px-4 py-3 text-gray-400 hidden sm:table-cell">{product.categoria ?? '—'}</td>
                {canSeeCost && (
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums hidden md:table-cell text-xs">
                    {product.stock_minimo != null ? `${product.stock_minimo} kg` : '—'}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    product.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {product.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => handleEdit(product)} className="text-blue-500 hover:text-blue-700 text-xs">
                      Editar
                    </button>
                    <button onClick={() => handleToggleActive(product)} className="text-gray-400 hover:text-gray-600 text-xs">
                      {product.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
