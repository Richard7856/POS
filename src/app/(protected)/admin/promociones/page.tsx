'use client'

/**
 * /admin/promociones — CRUD de promociones
 *
 * Acceso: admin (todas las sucursales) y encargado (solo su sucursal).
 * Cajeros son redirigidos al POS.
 *
 * Soporta dos tipos:
 *  - descuento: aplica a producto / categoría / todos, con ventana de tiempo
 *  - combo:     trigger_product → target_product descuento, con ventana de tiempo
 *
 * Diseño: lista de promos existentes + slide-in de formulario en la misma página.
 * No se usan modales para que el formulario sea cómodo en móvil.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { Promocion, Product, PromoTipo, PromoDescuentoTipo, PromoAplicaA } from '@/lib/types'

// ── Tipos locales del formulario ──────────────────────────────────────────────

interface FormState {
  nombre: string
  descripcion: string
  tipo: PromoTipo
  activo: boolean

  // Descuento scope
  aplica_a: PromoAplicaA | ''
  product_id: string
  categoria: string

  // Descuento amount (shared with combo target)
  descuento_tipo: PromoDescuentoTipo | ''
  descuento_valor: string

  // Combo
  trigger_product_id: string
  trigger_cantidad_min: string
  target_product_id: string

  // Time window
  hora_inicio: string
  hora_fin: string
  dias_semana: number[]   // 0=Dom…6=Sab
  fecha_inicio: string
  fecha_fin: string
}

const EMPTY_FORM: FormState = {
  nombre: '',
  descripcion: '',
  tipo: 'descuento',
  activo: true,
  aplica_a: 'todos',
  product_id: '',
  categoria: '',
  descuento_tipo: 'porcentaje',
  descuento_valor: '',
  trigger_product_id: '',
  trigger_cantidad_min: '1',
  target_product_id: '',
  hora_inicio: '',
  hora_fin: '',
  dias_semana: [],
  fecha_inicio: '',
  fecha_fin: '',
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ── Helper: Supabase payload from form ────────────────────────────────────────

function formToPayload(form: FormState, sucursalId: string) {
  return {
    nombre:             form.nombre.trim(),
    descripcion:        form.descripcion.trim() || null,
    tipo:               form.tipo,
    activo:             form.activo,
    sucursal_id:        sucursalId,

    // Descuento
    aplica_a:           form.tipo === 'descuento' ? (form.aplica_a || null) : null,
    product_id:         form.tipo === 'descuento' && form.aplica_a === 'producto'  ? form.product_id || null : null,
    categoria:          form.tipo === 'descuento' && form.aplica_a === 'categoria' ? form.categoria.trim() || null : null,

    descuento_tipo:     form.descuento_tipo  || null,
    descuento_valor:    form.descuento_valor ? parseFloat(form.descuento_valor) : null,

    // Combo
    trigger_product_id: form.tipo === 'combo' ? form.trigger_product_id || null : null,
    trigger_cantidad_min: form.tipo === 'combo' ? parseFloat(form.trigger_cantidad_min || '1') : 1,
    target_product_id:  form.tipo === 'combo' ? form.target_product_id  || null : null,

    // Time window
    hora_inicio:  form.hora_inicio  || null,
    hora_fin:     form.hora_fin     || null,
    dias_semana:  form.dias_semana.length > 0 ? form.dias_semana : null,
    fecha_inicio: form.fecha_inicio || null,
    fecha_fin:    form.fecha_fin    || null,
  }
}

// ── Helper: Promo → FormState (for editing) ───────────────────────────────────

function promoToForm(p: Promocion): FormState {
  return {
    nombre:              p.nombre,
    descripcion:         p.descripcion ?? '',
    tipo:                p.tipo,
    activo:              p.activo,
    aplica_a:            p.aplica_a ?? 'todos',
    product_id:          p.product_id ?? '',
    categoria:           p.categoria ?? '',
    descuento_tipo:      p.descuento_tipo ?? 'porcentaje',
    descuento_valor:     p.descuento_valor?.toString() ?? '',
    trigger_product_id:  p.trigger_product_id ?? '',
    trigger_cantidad_min: p.trigger_cantidad_min?.toString() ?? '1',
    target_product_id:   p.target_product_id ?? '',
    hora_inicio:         p.hora_inicio?.slice(0, 5) ?? '',
    hora_fin:            p.hora_fin?.slice(0, 5)    ?? '',
    dias_semana:         p.dias_semana ?? [],
    fecha_inicio:        p.fecha_inicio ?? '',
    fecha_fin:           p.fecha_fin    ?? '',
  }
}

// ── Badge helper (mirrors usePromociones for display) ─────────────────────────

function promoBadge(p: Promocion): string {
  if (p.tipo === 'combo') return 'COMBO'
  const val = p.descuento_valor ?? 0
  if (p.descuento_tipo === 'porcentaje')  return `−${val}%`
  if (p.descuento_tipo === 'monto')       return `−$${val}`
  if (p.descuento_tipo === 'precio_fijo') return `$${val}`
  return ''
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PromocionesPage() {
  const { profile, loading: authLoading } = useAuth()
  const router = useRouter()

  const [promos,    setPromos]    = useState<Promocion[]>([])
  const [products,  setProducts]  = useState<Product[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Form state — null means "closed"
  const [editingId, setEditingId] = useState<string | null>(null)   // null = new
  const [showForm,  setShowForm]  = useState(false)
  const [form,      setForm]      = useState<FormState>(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && profile?.rol === 'cajero') router.replace('/pos')
  }, [authLoading, profile, router])

  // ── Load data ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!profile?.sucursal_id && profile?.rol !== 'admin') return
    setLoadingData(true)

    // Both calls run in parallel
    const [promosRes, productsRes] = await Promise.all([
      // Admin sees all promos; encargado sees only their branch
      (() => {
        let q = supabase
          .from('promociones')
          .select(`
            *,
            product:products!product_id(id, nombre, unidad),
            trigger_product:products!trigger_product_id(id, nombre, unidad),
            target_product:products!target_product_id(id, nombre, unidad)
          `)
          .order('created_at', { ascending: false })
        if (profile.rol !== 'admin' && profile.sucursal_id) {
          q = q.eq('sucursal_id', profile.sucursal_id)
        }
        return q
      })(),
      supabase
        .from('products')
        .select('id, nombre, unidad, categoria, precio_por_unidad, activo, precio_compra, stock_minimo, sucursal_id, created_at')
        .eq('activo', true)
        .order('nombre'),
    ])

    setPromos(promosRes.data ?? [])
    setProducts(productsRes.data ?? [])
    setLoadingData(false)
  }, [profile])

  useEffect(() => { loadData() }, [loadData])

  // ── Categories list (from products) ─────────────────────────────────────────
  const categories = Array.from(
    new Set(products.map((p) => p.categoria).filter(Boolean) as string[])
  ).sort()

  // ── Form helpers ─────────────────────────────────────────────────────────────

  const openNew = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (promo: Promocion) => {
    setEditingId(promo.id)
    setForm(promoToForm(promo))
    setFormError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const toggleDia = (dia: number) => {
    setForm((f) => ({
      ...f,
      dias_semana: f.dias_semana.includes(dia)
        ? f.dias_semana.filter((d) => d !== dia)
        : [...f.dias_semana, dia].sort(),
    }))
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setFormError(null)

    // Basic validation
    if (!form.nombre.trim()) return setFormError('El nombre es requerido.')
    if (!form.descuento_tipo) return setFormError('Selecciona el tipo de descuento.')
    if (!form.descuento_valor || parseFloat(form.descuento_valor) <= 0)
      return setFormError('El valor del descuento debe ser mayor a 0.')
    if (form.tipo === 'descuento' && !form.aplica_a)
      return setFormError('Selecciona a qué aplica el descuento.')
    if (form.tipo === 'descuento' && form.aplica_a === 'producto' && !form.product_id)
      return setFormError('Selecciona el producto al que aplica.')
    if (form.tipo === 'descuento' && form.aplica_a === 'categoria' && !form.categoria.trim())
      return setFormError('Escribe la categoría.')
    if (form.tipo === 'combo' && (!form.trigger_product_id || !form.target_product_id))
      return setFormError('Selecciona el producto disparador y el producto objetivo.')

    // Encargado must have a sucursal
    const sucursalId = profile?.sucursal_id
    if (!sucursalId) return setFormError('Tu perfil no tiene sucursal asignada.')

    setSaving(true)
    const payload = formToPayload(form, sucursalId)

    try {
      if (editingId) {
        const { error } = await supabase
          .from('promociones')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('promociones').insert(payload)
        if (error) throw error
      }
      await loadData()
      closeForm()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle activo ────────────────────────────────────────────────────────────

  const handleToggle = async (promo: Promocion) => {
    const { error } = await supabase
      .from('promociones')
      .update({ activo: !promo.activo, updated_at: new Date().toISOString() })
      .eq('id', promo.id)
    if (!error) setPromos((prev) =>
      prev.map((p) => p.id === promo.id ? { ...p, activo: !p.activo } : p)
    )
  }

  // ── Delete (admin only) ──────────────────────────────────────────────────────

  const handleDelete = async (promo: Promocion) => {
    if (!confirm(`¿Eliminar la promoción "${promo.nombre}"? Esta acción no se puede deshacer.`)) return
    const { error } = await supabase.from('promociones').delete().eq('id', promo.id)
    if (!error) setPromos((prev) => prev.filter((p) => p.id !== promo.id))
  }

  // ── Render guard ─────────────────────────────────────────────────────────────

  if (authLoading || !profile) return null
  if (profile.rol === 'cajero') return null

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: promo list ── */}
      <div className={`flex flex-col ${showForm ? 'hidden md:flex md:w-1/2 lg:w-3/5' : 'flex-1'} overflow-hidden`}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-lg font-bold text-gray-800">🏷️ Promociones</h1>
            <p className="text-xs text-gray-400 mt-0.5">Descuentos automáticos y combos para el POS</p>
          </div>
          <button
            onClick={openNew}
            className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors"
          >
            + Nueva
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loadingData ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Cargando promociones...
            </div>
          ) : promos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <div className="text-4xl">🏷️</div>
              <p className="text-gray-500 font-medium">Sin promociones aún</p>
              <p className="text-gray-400 text-sm">Crea tu primera promo para activar descuentos automáticos en el POS</p>
              <button onClick={openNew} className="mt-2 text-green-600 text-sm font-medium hover:underline">
                Crear promoción →
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {promos.map((promo) => (
                <li key={promo.id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">

                    {/* Active toggle */}
                    <button
                      onClick={() => handleToggle(promo)}
                      title={promo.activo ? 'Desactivar' : 'Activar'}
                      className={`mt-0.5 w-9 h-5 rounded-full transition-colors flex-shrink-0 relative ${
                        promo.activo ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        promo.activo ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-800 text-sm">{promo.nombre}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          promo.activo ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-400'
                        }`}>
                          {promoBadge(promo)}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          promo.tipo === 'combo'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {promo.tipo}
                        </span>
                      </div>

                      {/* Scope summary */}
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {promo.tipo === 'descuento' ? (
                          promo.aplica_a === 'todos'     ? 'Aplica a todos los productos' :
                          promo.aplica_a === 'categoria' ? `Categoría: ${promo.categoria}` :
                          `Producto: ${promo.product?.nombre ?? promo.product_id}`
                        ) : (
                          `${promo.trigger_product?.nombre ?? '?'} → ${promo.target_product?.nombre ?? '?'}`
                        )}
                      </p>

                      {/* Time window */}
                      {(promo.hora_inicio || promo.fecha_inicio || (promo.dias_semana?.length ?? 0) > 0) && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {promo.hora_inicio ? `🕐 ${promo.hora_inicio.slice(0,5)}–${(promo.hora_fin ?? '23:59').slice(0,5)}` : ''}
                          {promo.dias_semana?.length ? ` · ${promo.dias_semana.map((d) => DIAS[d]).join(', ')}` : ''}
                          {promo.fecha_inicio ? ` · desde ${promo.fecha_inicio}` : ''}
                          {promo.fecha_fin   ? ` hasta ${promo.fecha_fin}` : ''}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEdit(promo)}
                        className="text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        Editar
                      </button>
                      {profile.rol === 'admin' && (
                        <button
                          onClick={() => handleDelete(promo)}
                          className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>

                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Right: form panel ── */}
      {showForm && (
        <div className="flex-1 md:border-l border-gray-200 flex flex-col overflow-hidden bg-white">

          {/* Form header */}
          <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
            <button onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
              ←
            </button>
            <h2 className="font-bold text-gray-800">
              {editingId ? 'Editar promoción' : 'Nueva promoción'}
            </h2>
          </div>

          {/* Scrollable form body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* Nombre + descripción */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input
                  type="text"
                  placeholder="ej. Happy hour frutas"
                  value={form.nombre}
                  onChange={(e) => set('nombre', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descripción (opcional)</label>
                <input
                  type="text"
                  placeholder="Nota interna para el cajero"
                  value={form.descripcion}
                  onChange={(e) => set('descripcion', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            {/* Tipo */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de promoción *</label>
              <div className="flex gap-2">
                {(['descuento', 'combo'] as PromoTipo[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set('tipo', t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      form.tipo === t
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t === 'descuento' ? '🏷️ Descuento' : '🎁 Combo'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {form.tipo === 'descuento'
                  ? 'Reduce el precio de un producto, categoría o todos al agregarlo al carrito.'
                  : 'Al comprar el producto A, el producto B se descontará automáticamente.'}
              </p>
            </div>

            {/* ── Descuento fields ── */}
            {form.tipo === 'descuento' && (
              <div className="space-y-3 bg-blue-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">¿A qué aplica?</p>

                {/* aplica_a selector */}
                <div className="flex gap-2 flex-wrap">
                  {([
                    ['todos', 'Todos los productos'],
                    ['categoria', 'Categoría'],
                    ['producto', 'Producto específico'],
                  ] as [PromoAplicaA, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => set('aplica_a', val)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        form.aplica_a === val
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Conditional: product or category picker */}
                {form.aplica_a === 'producto' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Producto *</label>
                    <select
                      value={form.product_id}
                      onChange={(e) => set('product_id', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Selecciona un producto…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} (${p.precio_por_unidad.toFixed(2)}/{p.unidad})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {form.aplica_a === 'categoria' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Categoría *</label>
                    <input
                      list="cat-list"
                      type="text"
                      placeholder="ej. Frutas"
                      value={form.categoria}
                      onChange={(e) => set('categoria', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <datalist id="cat-list">
                      {categories.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                )}
              </div>
            )}

            {/* ── Combo fields ── */}
            {form.tipo === 'combo' && (
              <div className="space-y-3 bg-purple-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Configuración del combo</p>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Producto disparador (A) *
                    <span className="font-normal text-gray-400 ml-1">— el que el cliente debe comprar</span>
                  </label>
                  <select
                    value={form.trigger_product_id}
                    onChange={(e) => set('trigger_product_id', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Selecciona producto A…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} ({p.unidad})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Cantidad mínima de A *
                  </label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.5"
                    value={form.trigger_cantidad_min}
                    onChange={(e) => set('trigger_cantidad_min', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Producto objetivo (B) *
                    <span className="font-normal text-gray-400 ml-1">— el que recibe el descuento</span>
                  </label>
                  <select
                    value={form.target_product_id}
                    onChange={(e) => set('target_product_id', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Selecciona producto B…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} (${p.precio_por_unidad.toFixed(2)}/{p.unidad})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* ── Descuento amount (shared) ── */}
            <div className="space-y-3 bg-orange-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                {form.tipo === 'combo' ? 'Descuento en producto B' : 'Valor del descuento'}
              </p>

              <div className="flex gap-2">
                {([
                  ['porcentaje', '% Porcentaje'],
                  ['monto',      '$ Monto fijo'],
                  ['precio_fijo','$ Precio fijo'],
                ] as [PromoDescuentoTipo, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => set('descuento_tipo', val)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      form.descuento_tipo === val
                        ? 'bg-orange-500 text-white'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-orange-400">
                <span className="px-3 text-gray-400 text-sm">
                  {form.descuento_tipo === 'porcentaje' ? '%' : '$'}
                </span>
                <input
                  type="number"
                  min="0"
                  step={form.descuento_tipo === 'porcentaje' ? '1' : '0.50'}
                  max={form.descuento_tipo === 'porcentaje' ? '100' : undefined}
                  value={form.descuento_valor}
                  onChange={(e) => set('descuento_valor', e.target.value)}
                  placeholder={
                    form.descuento_tipo === 'porcentaje' ? '20' :
                    form.descuento_tipo === 'monto' ? '5.00' : '15.00'
                  }
                  className="flex-1 py-2 pr-3 text-sm focus:outline-none tabular-nums"
                />
              </div>

              <p className="text-[11px] text-gray-400">
                {form.descuento_tipo === 'porcentaje'  ? 'Ej: 20 → reduce el precio un 20%' :
                 form.descuento_tipo === 'monto'       ? 'Ej: 5 → descuenta $5 del precio' :
                 'Ej: 15 → el precio queda en $15 fijo sin importar el precio original'}
              </p>
            </div>

            {/* ── Time window ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Ventana de tiempo (opcional)
              </p>

              {/* Hour range */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
                  <input type="time" value={form.hora_inicio}
                    onChange={(e) => set('hora_inicio', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
                  <input type="time" value={form.hora_fin}
                    onChange={(e) => set('hora_fin', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              {/* Days of week */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Días de la semana (vacío = todos los días)</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DIAS.map((dia, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDia(idx)}
                      className={`w-10 h-10 rounded-full text-xs font-medium transition-colors ${
                        form.dias_semana.includes(idx)
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {dia}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Fecha inicio</label>
                  <input type="date" value={form.fecha_inicio}
                    onChange={(e) => set('fecha_inicio', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Fecha fin</label>
                  <input type="date" value={form.fecha_fin}
                    onChange={(e) => set('fecha_fin', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

            </div>

            {/* Active toggle in form */}
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Activa</p>
                <p className="text-xs text-gray-400">Las promos inactivas no se aplican en el POS</p>
              </div>
              <button
                type="button"
                onClick={() => set('activo', !form.activo)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  form.activo ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  form.activo ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {/* Error */}
            {formError && (
              <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}

            {/* Bottom padding so last field isn't behind the save bar */}
            <div className="h-2" />
          </div>

          {/* Sticky save bar */}
          <div className="border-t border-gray-200 px-5 py-4 flex gap-3 flex-shrink-0 bg-white">
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 active:scale-95 transition-all"
            >
              {saving ? 'Guardando...' : editingId ? '✓ Actualizar' : '✓ Crear promoción'}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
