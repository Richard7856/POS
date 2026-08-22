'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Product } from '@/lib/types'
import MarginCalculator, { computePrecioVenta } from '@/components/MarginCalculator'
import { calcGanancia } from '@/lib/ganancia'
import BarcodeScanner from '@/components/BarcodeScanner'
import { getProductsCache, saveProductsCache, upsertProductCache } from '@/lib/productCache'
import { enqueue, getPendingCount } from '@/lib/offlineQueue'

type MarginMode = 'porcentaje' | 'monto'

// Only three categories for now — expand later if needed
const CATEGORIAS = ['Frutas', 'Verduras', 'Abarrotes']

const EMPTY_FORM = {
  nombre: '',
  precio_por_unidad: '',
  unidad: 'kg' as Product['unidad'],
  categoria: '',
  ean: '',
  // Minimum stock in kg — triggers reorder alert when stock falls below this
  stock_minimo: '',
  // Margin calculator fields (admin/encargado only)
  precio_compra: '',
  margin_mode: 'porcentaje' as MarginMode,
  margin_value: '',
}

export default function ProductosPage() {
  const { profile } = useAuth()
  // admin y encargado son "staff": son los únicos que ven el costo de compra y
  // los únicos que dan de alta o modifican productos. El cajero ve el catálogo
  // en modo lectura — la barrera real está en las políticas RLS de la tabla.
  const isStaff    = profile?.rol === 'admin' || profile?.rol === 'encargado'
  const canSeeCost = isStaff
  const canEdit    = isStaff

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [isOnline, setIsOnline]       = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  // Stock disponible por producto (suma de lotes de la sucursal). Vacío offline.
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map())
  // Producto recién creado a granel → CTA para registrarle su primera entrada
  const [recienCreado, setRecienCreado] = useState<{ id: string; nombre: string } | null>(null)

  const refreshPending = () => setPendingCount(getPendingCount())

  const loadProducts = async () => {
    // Show cached data immediately so the page is usable even without network
    const cached = getProductsCache()
    if (cached.length > 0) {
      setProducts(cached)
      setLoading(false)
    }

    if (!navigator.onLine) {
      setIsOnline(false)
      setLoading(false)
      return
    }

    // Fetch fresh data in background (or foreground on first load).
    // El stock por producto sale de los lotes con disponible > 0 (RLS ya
    // limita a la sucursal del perfil para roles no-admin).
    const [{ data }, { data: lotesData }] = await Promise.all([
      supabase
        .from('products')
        .select('*')
        .order('categoria', { ascending: true })
        .order('nombre', { ascending: true }),
      supabase
        .from('lotes')
        .select('product_id, cantidad_disponible')
        .gt('cantidad_disponible', 0),
    ])

    if (data) {
      setProducts(data)
      saveProductsCache(data)  // keep cache warm for next offline session
    }
    const sm = new Map<string, number>()
    for (const l of lotesData ?? []) {
      sm.set(l.product_id, (sm.get(l.product_id) ?? 0) + l.cantidad_disponible)
    }
    setStockMap(sm)
    setLoading(false)
  }

  useEffect(() => {
    loadProducts()
    setIsOnline(navigator.onLine)
    refreshPending()

    const onOnline  = () => { setIsOnline(true);  loadProducts(); refreshPending() }
    const onOffline = () => { setIsOnline(false); refreshPending() }
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Determine the effective sell price:
  // - If cost + margin are filled → use computed price
  // - Otherwise → use the manually entered precio_por_unidad
  const computedPrecio = computePrecioVenta(form.precio_compra, form.margin_mode, form.margin_value)
  const effectivePrecio = computedPrecio !== null
    ? computedPrecio.toString()
    : form.precio_por_unidad

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return   // el cajero no captura catálogo; RLS lo rechazaría igual
    setSaving(true)

    const payload: Partial<Product> = {
      nombre: form.nombre.trim(),
      precio_por_unidad: parseFloat(effectivePrecio),
      unidad: form.unidad,
      categoria: form.categoria.trim() || null,
      ean: form.ean.trim() || null,
      precio_compra: form.precio_compra ? parseFloat(form.precio_compra) : null,
      stock_minimo: form.stock_minimo ? parseFloat(form.stock_minimo) : null,
    }

    if (navigator.onLine) {
      // Online path: write directly to Supabase then reload
      if (editingId) {
        await supabase.from('products').update(payload).eq('id', editingId)
      } else {
        const { data: nuevo } = await supabase
          .from('products')
          .insert({ ...payload, activo: true })
          .select('id, nombre, unidad')
          .single()
        // Un producto a granel sin lotes no aparece en el POS con stock: el
        // siguiente paso natural es darle su primera entrada. Se lo sugerimos.
        if (nuevo && (nuevo.unidad === 'kg' || nuevo.unidad === 'g')) {
          setRecienCreado({ id: nuevo.id, nombre: nuevo.nombre })
        }
      }
      loadProducts()
    } else {
      // Offline path: queue the op + update local state immediately
      const now = new Date().toISOString()
      if (editingId) {
        enqueue({
          table: 'products',
          action: 'update',
          payload: payload as Record<string, unknown>,
          filter: [{ key: 'id', val: editingId }],
        })
        const updated: Product = {
          ...(products.find((p) => p.id === editingId) as Product),
          ...payload,
        }
        setProducts((prev) => prev.map((p) => p.id === editingId ? updated : p))
        upsertProductCache(updated)
      } else {
        // Generate UUID client-side so the row has its final ID before hitting the server
        const newId = crypto.randomUUID()
        const newProduct: Product = {
          id: newId,
          activo: true,
          sucursal_id: profile?.sucursal_id ?? null,
          created_at: now,
          ...(payload as Omit<Product, 'id' | 'activo' | 'sucursal_id' | 'created_at'>),
        }
        enqueue({
          table: 'products',
          action: 'insert',
          payload: { ...newProduct } as Record<string, unknown>,
        })
        setProducts((prev) => [...prev, newProduct])
        upsertProductCache(newProduct)
      }
      refreshPending()
      // Notify SyncProvider to refresh its count
      ;(window as Window & { __posRefreshPending?: () => void }).__posRefreshPending?.()
    }

    setSaving(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(false)
  }

  const handleEdit = (product: Product) => {
    setForm({
      nombre: product.nombre,
      precio_por_unidad: product.precio_por_unidad.toString(),
      unidad: product.unidad,
      categoria: product.categoria ?? '',
      ean: product.ean ?? '',
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
    if (!canEdit) return
    const newActivo = !product.activo
    if (navigator.onLine) {
      await supabase.from('products').update({ activo: newActivo }).eq('id', product.id)
      loadProducts()
    } else {
      enqueue({
        table: 'products',
        action: 'update',
        payload: { activo: newActivo },
        filter: [{ key: 'id', val: product.id }],
      })
      const updated = { ...product, activo: newActivo }
      setProducts((prev) => prev.map((p) => p.id === product.id ? updated : p))
      upsertProductCache(updated)
      refreshPending()
      ;(window as Window & { __posRefreshPending?: () => void }).__posRefreshPending?.()
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto overflow-y-auto h-full">
      {/* Full-screen barcode scanner overlay */}
      {showScanner && (
        <BarcodeScanner
          onScan={(ean) => { setForm((f) => ({ ...f, ean })); setShowScanner(false) }}
          onClose={() => setShowScanner(false)}
        />
      )}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">📦 Productos</h1>
          {!isOnline && (
            <p className="text-xs text-amber-600 mt-0.5">
              Sin conexión — los cambios se guardarán al reconectarte
            </p>
          )}
          {isOnline && pendingCount > 0 && (
            <p className="text-xs text-green-600 mt-0.5">
              ⟳ Sincronizando {pendingCount} cambio{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}...
            </p>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true) }}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            + Nuevo producto
          </button>
        )}
      </div>

      {/* Producto a granel recién creado → siguiente paso: darle stock */}
      {recienCreado && !showForm && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
          <span className="text-xl">✅</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800 truncate">
              {recienCreado.nombre} creado
            </p>
            <p className="text-xs text-green-600">
              Aún no tiene inventario — registra su primera entrada para verlo con stock
            </p>
          </div>
          <Link
            href={`/inventario/lotes?producto=${recienCreado.id}`}
            className="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
          >
            Registrar entrada →
          </Link>
          <button
            onClick={() => setRecienCreado(null)}
            className="flex-shrink-0 text-green-300 hover:text-green-600 text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && canEdit && (
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
              {/* Ganancia en vivo: con precio y costo capturados, el margen se
                  calcula solo — sin pasar por la calculadora */}
              {canSeeCost && (() => {
                const g = calcGanancia(
                  parseFloat(effectivePrecio) || null,
                  form.precio_compra ? parseFloat(form.precio_compra) : null,
                )
                if (!g) return null
                return (
                  <p className={`text-xs mt-1 font-medium ${
                    g.monto < 0 ? 'text-red-600' : g.pct < 10 ? 'text-amber-600' : 'text-green-700'
                  }`}>
                    {g.monto < 0
                      ? `⚠ Pierdes $${Math.abs(g.monto).toFixed(2)} por ${form.unidad}`
                      : `Ganancia: $${g.monto.toFixed(2)} por ${form.unidad} (${g.pct}%)`}
                  </p>
                )
              })()}
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
              <label className="block text-sm text-gray-600 mb-1">Categoría</label>
              <select
                value={form.categoria}
                onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="">— Sin categoría —</option>
                {CATEGORIAS.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                {/* Preserve legacy category when editing an older product */}
                {form.categoria && !CATEGORIAS.includes(form.categoria) && (
                  <option value={form.categoria}>{form.categoria} (anterior)</option>
                )}
              </select>
            </div>

            {/* EAN barcode — optional, used for quick lookup */}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">
                Código EAN <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.ean}
                  onChange={(e) => setForm((f) => ({ ...f, ean: e.target.value }))}
                  placeholder="Ej: 7501234567890"
                  maxLength={20}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
                />
                {/* Camera scan button — uses BarcodeDetector API on Chrome Android */}
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-lg hover:bg-gray-200 transition-colors"
                  title="Escanear con cámara"
                >
                  📷
                </button>
              </div>
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
              {canSeeCost && (
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Ganancia</th>
              )}
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Stock</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Unidad</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Categoría</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">EAN</th>
              {canSeeCost && (
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Stock mín.</th>
              )}
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Estado</th>
              {canEdit && <th className="px-4 py-3" />}
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
                {canSeeCost && (() => {
                  const g = calcGanancia(product.precio_por_unidad, product.precio_compra)
                  return (
                    <td className={`px-4 py-3 text-right tabular-nums text-xs font-medium ${
                      !g ? 'text-gray-300'
                        : g.monto < 0 ? 'text-red-600'
                        : g.pct < 10 ? 'text-amber-600'
                        : 'text-green-700'
                    }`}>
                      {g ? `$${g.monto.toFixed(2)} · ${g.pct}%` : '—'}
                    </td>
                  )
                })()}
                <td className="px-4 py-3 text-right tabular-nums text-xs">
                  {product.unidad === 'pieza' ? (
                    <span className="text-gray-300">—</span>
                  ) : (() => {
                    const stock = stockMap.get(product.id) ?? 0
                    const bajo = product.stock_minimo != null && stock < product.stock_minimo
                    return (
                      <span className={
                        stock <= 0 ? 'text-red-600 font-bold'
                          : bajo ? 'text-amber-600 font-semibold'
                          : 'text-gray-600'
                      }>
                        {stock.toFixed(1)} kg{bajo && stock > 0 ? ' ⚠' : stock <= 0 ? ' ∅' : ''}
                      </span>
                    )
                  })()}
                </td>
                <td className="px-4 py-3 text-gray-500">{product.unidad}</td>
                <td className="px-4 py-3 text-gray-400 hidden sm:table-cell">{product.categoria ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden lg:table-cell">{product.ean ?? '—'}</td>
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
                {canEdit && (
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
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
