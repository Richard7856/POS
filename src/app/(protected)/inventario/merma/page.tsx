'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { Merma, Lote, Product, MotivoMerma } from '@/lib/types'

const MOTIVOS: MotivoMerma[] = ['Podrido', 'Dañado', 'Caducado', 'Robo', 'Otro']

const MOTIVO_COLOR: Record<MotivoMerma, string> = {
  Podrido:  'bg-orange-100 text-orange-700',
  Dañado:   'bg-yellow-100 text-yellow-700',
  Caducado: 'bg-red-100 text-red-700',
  Robo:     'bg-purple-100 text-purple-700',
  Otro:     'bg-gray-100 text-gray-600',
}

const EMPTY_FORM = {
  product_id: '',
  lote_id: '',
  cantidad: '',
  motivo: 'Podrido' as MotivoMerma,
  notas: '',
}

function formatFecha(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

export default function MermaPage() {
  const { profile, user } = useAuth()

  // Cajero must provide a photo — admin/encargado it's optional
  const fotoRequerida = profile?.rol === 'cajero'

  const [mermas, setMermas]     = useState<Merma[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [lotesByProduct, setLotesByProduct] = useState<Lote[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Photo state
  const [fotoFile, setFotoFile]       = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const [{ data: mermasData }, { data: productsData }] = await Promise.all([
      supabase
        .from('mermas')
        .select('*, product:products(id, nombre, unidad), lote:lotes(id, fecha_entrada, cantidad_inicial)')
        .eq('sucursal_id', profile?.sucursal_id ?? '')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('products')
        .select('id, nombre, unidad, activo, precio_por_unidad, categoria, precio_compra, stock_minimo, sucursal_id, created_at')
        .eq('activo', true)
        .in('unidad', ['kg', 'g'])
        .order('nombre'),
    ])
    setMermas(mermasData ?? [])
    setProducts(productsData ?? [])
    setLoading(false)
  }

  useEffect(() => { if (profile) load() }, [profile])

  // When product changes, load its active lotes (oldest first for FIFO awareness)
  useEffect(() => {
    if (!form.product_id || !profile?.sucursal_id) {
      setLotesByProduct([])
      return
    }
    supabase
      .from('lotes')
      .select('id, fecha_entrada, cantidad_inicial, cantidad_disponible, proveedor')
      .eq('product_id', form.product_id)
      .eq('sucursal_id', profile.sucursal_id)
      .gt('cantidad_disponible', 0)
      .order('fecha_entrada', { ascending: true })
      .then(({ data }) => setLotesByProduct(data ?? []))
  }, [form.product_id, profile?.sucursal_id])

  // ── Photo handling ──────────────────────────────────────────────────────────

  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFotoFile(file)
    // Generate a local preview URL so the user can confirm the photo
    const url = URL.createObjectURL(file)
    setFotoPreview(url)
  }

  const handleRemoveFoto = () => {
    setFotoFile(null)
    if (fotoPreview) URL.revokeObjectURL(fotoPreview)
    setFotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /**
   * Upload the evidence photo to Supabase Storage.
   * Path: {sucursal_id}/{YYYY-MM-DD}/{timestamp}.{ext}
   * Returns the public URL, or throws on error.
   */
  const uploadFoto = async (file: File): Promise<string> => {
    const ext   = file.name.split('.').pop() ?? 'jpg'
    const fecha = new Date().toISOString().slice(0, 10)
    const path  = `${profile!.sucursal_id}/${fecha}/${Date.now()}.${ext}`

    const { error } = await supabase.storage
      .from('merma-fotos')
      .upload(path, file, { contentType: file.type, upsert: false })

    if (error) throw new Error(`Error al subir foto: ${error.message}`)

    const { data: { publicUrl } } = supabase.storage
      .from('merma-fotos')
      .getPublicUrl(path)

    return publicUrl
  }

  // ── Form submit ─────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)

    // Cajeros must attach a photo before submitting
    if (fotoRequerida && !fotoFile) {
      setSaveError('Debes tomar una foto de evidencia antes de registrar la merma.')
      setSaving(false)
      return
    }

    const cantidad = parseFloat(form.cantidad)

    // Validate: can't waste more than what's available in the lote
    const lote = lotesByProduct.find((l) => l.id === form.lote_id)
    if (lote && cantidad > lote.cantidad_disponible) {
      setSaveError(`Solo hay ${lote.cantidad_disponible.toFixed(3)} kg disponibles en ese lote.`)
      setSaving(false)
      return
    }

    // Upload photo first (if attached)
    let foto_url: string | null = null
    if (fotoFile) {
      try {
        foto_url = await uploadFoto(fotoFile)
      } catch (err: unknown) {
        setSaveError(err instanceof Error ? err.message : 'Error al subir la foto')
        setSaving(false)
        return
      }
    }

    const { error: mermaError } = await supabase.from('mermas').insert({
      lote_id:         form.lote_id,
      product_id:      form.product_id,
      sucursal_id:     profile!.sucursal_id,
      fecha:           new Date().toISOString().slice(0, 10),
      cantidad,
      motivo:          form.motivo,
      notas:           form.notas.trim() || null,
      foto_url,
      registrado_por:  user?.id ?? null,
    })

    if (mermaError) { setSaveError(mermaError.message); setSaving(false); return }

    // Deduct from lote.cantidad_disponible
    const { error: loteError } = await supabase
      .from('lotes')
      .update({ cantidad_disponible: (lote!.cantidad_disponible - cantidad) })
      .eq('id', form.lote_id)

    if (loteError) { setSaveError(loteError.message); setSaving(false); return }

    // Reset form and photo
    setForm(EMPTY_FORM)
    handleRemoveFoto()
    setShowForm(false)
    load()
    setSaving(false)
  }

  // Summary: total kg wasted today and this week
  const today  = new Date().toISOString().slice(0, 10)
  const kgHoy  = mermas.filter((m) => m.fecha === today).reduce((s, m) => s + m.cantidad, 0)
  const kgTotal = mermas.reduce((s, m) => s + m.cantidad, 0)

  if (loading) return <div className="p-8 text-gray-400">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto overflow-y-auto h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🗑️ Merma</h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro de pérdidas por producto y lote</p>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); handleRemoveFoto(); setSaveError(null); setShowForm(true) }}
          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Registrar merma
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
          <p className="text-xs text-gray-500">Merma hoy</p>
          <p className="text-xl font-bold text-red-600 tabular-nums">{kgHoy.toFixed(2)} kg</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
          <p className="text-xs text-gray-500">Últimos 100 registros</p>
          <p className="text-xl font-bold text-gray-700 tabular-nums">{kgTotal.toFixed(2)} kg</p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-red-200 p-5 mb-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-700">Registrar merma</h2>

          <div className="grid grid-cols-2 gap-4">
            {/* Product */}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Producto *</label>
              <select
                required value={form.product_id}
                onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value, lote_id: '' }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
              >
                <option value="">— Selecciona un producto —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>

            {/* Lote selector */}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">
                Lote (fecha de entrada) *
                {form.product_id && lotesByProduct.length === 0 && (
                  <span className="ml-2 text-orange-500">— Sin lotes con existencia</span>
                )}
              </label>
              <select
                required value={form.lote_id}
                onChange={(e) => setForm((f) => ({ ...f, lote_id: e.target.value }))}
                disabled={!form.product_id || lotesByProduct.length === 0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white disabled:opacity-50"
              >
                <option value="">— Selecciona el lote —</option>
                {lotesByProduct.map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatFecha(l.fecha_entrada)} — {l.cantidad_disponible.toFixed(3)} kg disponibles
                  </option>
                ))}
              </select>
            </div>

            {/* Cantidad */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Cantidad (kg) *</label>
              <input
                required type="number" min="0.001" step="0.001" value={form.cantidad}
                onChange={(e) => setForm((f) => ({ ...f, cantidad: e.target.value }))}
                placeholder="0.000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>

            {/* Motivo */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Motivo *</label>
              <select
                value={form.motivo}
                onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value as MotivoMerma }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
              >
                {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Notas */}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">
                Notas <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="text" value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                placeholder="Descripción adicional..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
          </div>

          {/* ── Photo evidence ──────────────────────────────────────────────── */}
          <div>
            <label className="block text-sm text-gray-600 mb-2">
              Foto de evidencia
              {fotoRequerida
                ? <span className="ml-1 text-red-500 font-medium">* (obligatoria)</span>
                : <span className="ml-1 text-gray-400">(opcional)</span>
              }
            </label>

            {/* Show preview if photo is selected */}
            {fotoPreview ? (
              <div className="relative w-full rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fotoPreview}
                  alt="Vista previa de la evidencia"
                  className="w-full max-h-56 object-cover"
                />
                <button
                  type="button"
                  onClick={handleRemoveFoto}
                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm transition-colors"
                  title="Eliminar foto"
                >
                  ✕
                </button>
                <p className="text-xs text-gray-400 text-center py-1.5">
                  {fotoFile?.name}
                </p>
              </div>
            ) : (
              /* Tap-to-capture button — on mobile opens the camera directly */
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`w-full border-2 border-dashed rounded-xl py-6 flex flex-col items-center gap-2 transition-colors ${
                  fotoRequerida
                    ? 'border-red-300 hover:border-red-400 hover:bg-red-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="text-3xl">📷</span>
                <span className="text-sm font-medium text-gray-600">
                  {fotoRequerida ? 'Tomar foto de evidencia' : 'Agregar foto (opcional)'}
                </span>
                <span className="text-xs text-gray-400">
                  Toca para abrir la cámara o elegir archivo
                </span>
              </button>
            )}

            {/* Hidden file input — capture="environment" opens rear camera on mobile */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFotoChange}
            />
          </div>

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {saveError}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => { setShowForm(false); handleRemoveFoto() }}
              className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Registrar merma'}
            </button>
          </div>
        </form>
      )}

      {/* Merma log */}
      <div className="space-y-2">
        {mermas.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm">Sin merma registrada</p>
          </div>
        ) : mermas.map((m) => (
          <div key={m.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 truncate">{m.product?.nombre ?? '—'}</span>
                  {m.motivo && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MOTIVO_COLOR[m.motivo]}`}>
                      {m.motivo}
                    </span>
                  )}
                  {/* Camera icon if photo evidence was attached */}
                  {m.foto_url && (
                    <span className="text-gray-400 text-xs" title="Con foto de evidencia">📷</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Lote: {m.lote ? formatFecha(m.lote.fecha_entrada) : '—'}
                  {m.notas && ` · ${m.notas}`}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-red-600 tabular-nums">{m.cantidad.toFixed(3)} kg</p>
                <p className="text-xs text-gray-400">{formatFecha(m.fecha)}</p>
              </div>
            </div>

            {/* Evidence photo — expandable thumbnail */}
            {m.foto_url && (
              <a
                href={m.foto_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block border-t border-gray-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.foto_url}
                  alt="Evidencia de merma"
                  className="w-full max-h-40 object-cover hover:max-h-[400px] transition-all duration-300"
                />
                <p className="text-center text-xs text-gray-300 py-1">
                  Toca para ver en tamaño completo
                </p>
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
