'use client'

import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const CARDS = [
  {
    href: '/admin/sucursales',
    icon: '🏪',
    title: 'Sucursales',
    desc: 'Agrega, edita o desactiva sucursales',
    roles: ['admin'],
  },
  {
    href: '/admin/usuarios',
    icon: '👥',
    title: 'Usuarios',
    desc: 'Crea y administra cuentas del equipo',
    roles: ['admin'],
  },
  {
    href: '/admin/promociones',
    icon: '🏷️',
    title: 'Promociones',
    desc: 'Descuentos por horario, precios especiales y combos automáticos',
    roles: ['admin', 'encargado'],
  },
]

export default function AdminPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()

  // Only admin and encargado can access admin section
  useEffect(() => {
    if (!loading && profile && profile.rol === 'cajero') {
      router.replace('/pos')
    }
  }, [profile, loading, router])

  if (loading || !profile) return null

  const visibleCards = CARDS.filter((c) => c.roles.includes(profile.rol))

  return (
    <div className="p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-800 mb-6">⚙️ Administración</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visibleCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md hover:border-green-300 transition-all group"
          >
            <div className="text-3xl mb-3">{card.icon}</div>
            <h2 className="font-semibold text-gray-800 group-hover:text-green-700 transition-colors">
              {card.title}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{card.desc}</p>
          </Link>
        ))}

        {visibleCards.length === 0 && (
          <p className="text-gray-400 text-sm col-span-2">
            No tienes acceso a herramientas de administración.
          </p>
        )}
      </div>
    </div>
  )
}
