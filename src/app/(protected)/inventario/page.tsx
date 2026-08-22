'use client'

/**
 * Hub de inventario — la pantalla de inicio del que reabastece.
 *
 * Antes eran tres tarjetas estáticas; ahora cada una trae el dato que decide
 * si hay que entrar o no: cuánto llegó hoy, cuánto se ha perdido en el mes y
 * cuántos productos están bajo mínimo. El encargado ve su sucursal; un admin
 * sin sucursal asignada ve el global.
 */

import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SinSucursal from '@/components/SinSucursal'

interface Resumen {
  entradasHoyKg: number
  mermaMesKg: number
  mermaMesPesos: number
  bajoMinimo: number
}

export default function InventarioPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const [resumen, setResumen] = useState<Resumen | null>(null)

  // Cajeros no tienen acceso al módulo de inventario
  useEffect(() => {
    if (!loading && profile?.rol === 'cajero') router.replace('/pos')
  }, [profile, loading, router])

  useEffect(() => {
    if (!profile || profile.rol === 'cajero') return
    const sucursalId = profile.sucursal_id

    async function cargar() {
      const hoy = new Date().toISOString().slice(0, 10)
      const inicioMes = new Date()
      inicioMes.setDate(1)
      inicioMes.setHours(0, 0, 0, 0)

      let entradasQ = supabase
        .from('lotes')
        .select('cantidad_inicial')
        .eq('fecha_entrada', hoy)
      let mermasQ = supabase
        .from('mermas')
        .select('cantidad, lote:lotes(costo_por_unidad)')
        .gte('created_at', inicioMes.toISOString())
      const prodsQ = supabase
        .from('products')
        .select('id, stock_minimo')
        .eq('activo', true)
        .not('stock_minimo', 'is', null)
      if (sucursalId) {
        entradasQ = entradasQ.eq('sucursal_id', sucursalId)
        mermasQ   = mermasQ.eq('sucursal_id', sucursalId)
      }

      const [{ data: entradas }, { data: mermas }, { data: prods }] =
        await Promise.all([entradasQ, mermasQ, prodsQ])

      // Bajo mínimo: suma de lotes disponibles por producto vs su mínimo
      let bajoMinimo = 0
      if (prods && prods.length > 0) {
        let lotesQ = supabase
          .from('lotes')
          .select('product_id, cantidad_disponible')
          .in('product_id', prods.map((p) => p.id))
        if (sucursalId) lotesQ = lotesQ.eq('sucursal_id', sucursalId)
        const { data: lotes } = await lotesQ
        const stock = new Map<string, number>()
        for (const l of lotes ?? []) {
          stock.set(l.product_id, (stock.get(l.product_id) ?? 0) + l.cantidad_disponible)
        }
        bajoMinimo = prods.filter(
          (p) => (stock.get(p.id) ?? 0) < (p.stock_minimo as number)
        ).length
      }

      setResumen({
        entradasHoyKg: (entradas ?? []).reduce((s, l) => s + l.cantidad_inicial, 0),
        mermaMesKg:    (mermas ?? []).reduce((s, m) => s + m.cantidad, 0),
        mermaMesPesos: (mermas ?? []).reduce((s, m) => {
          // supabase tipa el join como arreglo aunque la FK sea a-uno
          const rel = m.lote as unknown as
            | { costo_por_unidad: number | null }
            | { costo_por_unidad: number | null }[]
            | null
          const costo = Array.isArray(rel) ? rel[0]?.costo_por_unidad : rel?.costo_por_unidad
          return s + (costo != null ? m.cantidad * costo : 0)
        }, 0),
        bajoMinimo,
      })
    }
    cargar()
  }, [profile])

  if (loading || !profile) return null
  if (profile.rol !== 'admin' && !profile.sucursal_id) return <SinSucursal />

  const cards = [
    {
      href: '/inventario/lotes',
      icon: '📦',
      title: 'Entradas de mercancía',
      desc: 'Registra el stock que llegó cada día por producto',
      color: 'hover:border-green-300',
      dato: resumen && (
        resumen.entradasHoyKg > 0
          ? <span className="text-green-700 font-semibold">{resumen.entradasHoyKg.toFixed(1)} kg registrados hoy</span>
          : <span className="text-gray-400">Sin entradas hoy</span>
      ),
    },
    {
      href: '/inventario/merma',
      icon: '🗑️',
      title: 'Merma',
      desc: 'Registra pérdidas: podrido, dañado, caducado, robo...',
      color: 'hover:border-red-300',
      dato: resumen && (
        resumen.mermaMesKg > 0
          ? <span className="text-red-500 font-semibold">
              {resumen.mermaMesKg.toFixed(1)} kg este mes
              {resumen.mermaMesPesos > 0 && ` · ≈$${resumen.mermaMesPesos.toFixed(0)}`}
            </span>
          : <span className="text-gray-400">Sin merma este mes</span>
      ),
    },
    {
      href: '/inventario/pedido',
      icon: '🛒',
      title: 'Lista de pedido',
      desc: 'Productos bajo mínimo — qué hay que surtir hoy',
      color: 'hover:border-orange-300',
      dato: resumen && (
        resumen.bajoMinimo > 0
          ? <span className="text-orange-600 font-semibold">
              ⚠ {resumen.bajoMinimo} producto{resumen.bajoMinimo !== 1 ? 's' : ''} bajo mínimo
            </span>
          : <span className="text-green-600 font-medium">✓ Todo por encima del mínimo</span>
      ),
    },
  ]

  return (
    <div className="p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-800 mb-2">📦 Inventario</h1>
      <p className="text-sm text-gray-500 mb-6">
        {profile.sucursal?.nombre
          ? `Sucursal: ${profile.sucursal.nombre}`
          : 'Control de entradas y merma para productos a granel (kg)'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all group ${card.color}`}
          >
            <div className="text-3xl mb-3">{card.icon}</div>
            <h2 className="font-semibold text-gray-800 group-hover:text-green-700 transition-colors">
              {card.title}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{card.desc}</p>
            {/* El dato que decide si hay que entrar */}
            <p className="text-xs mt-3 min-h-[16px]">{card.dato}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
