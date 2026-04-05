'use client'

import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const CARDS = [
  {
    href: '/inventario/lotes',
    icon: '📦',
    title: 'Entradas de mercancía',
    desc: 'Registra el stock que llegó cada día por producto',
    color: 'hover:border-green-300',
  },
  {
    href: '/inventario/merma',
    icon: '🗑️',
    title: 'Merma',
    desc: 'Registra pérdidas: podrido, dañado, caducado, robo...',
    color: 'hover:border-red-300',
  },
  {
    href: '/inventario/pedido',
    icon: '🛒',
    title: 'Lista de pedido',
    desc: 'Productos bajo mínimo — qué hay que surtir hoy',
    color: 'hover:border-orange-300',
  },
]

export default function InventarioPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()

  // Cajeros no tienen acceso al módulo de inventario
  useEffect(() => {
    if (!loading && profile?.rol === 'cajero') router.replace('/pos')
  }, [profile, loading, router])

  if (loading || !profile) return null

  return (
    <div className="p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-800 mb-2">📦 Inventario</h1>
      <p className="text-sm text-gray-500 mb-6">
        Control de entradas y merma para productos a granel (kg)
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CARDS.map((card) => (
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
          </Link>
        ))}
      </div>
    </div>
  )
}
