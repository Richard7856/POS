'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Product, CartItem } from '@/lib/types'
import { useAuth } from '@/context/AuthContext'
import { useBluetoothScale } from '@/hooks/useBluetoothScale'
import { usePromociones, ComboNotification } from '@/hooks/usePromociones'
import WeightModal from '@/components/WeightModal'
import CheckoutModal from '@/components/CheckoutModal'
import MovimientoCajaModal from '@/components/MovimientoCajaModal'

export default function POSPage() {
  const { profile } = useAuth()

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('Todos')
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showMobileCart, setShowMobileCart] = useState(false)
  const [showMovimiento, setShowMovimiento] = useState(false)

  // Combo notifications to display as banners
  const [comboNotifs, setComboNotifs] = useState<ComboNotification[]>([])
  const [dismissedCombos, setDismissedCombos] = useState<Set<string>>(new Set())

  const scale = useBluetoothScale()

  // Load active promotions for this branch
  const { applyDescuento, getComboNotifications, getComboDescuentoForProduct, getPromoBadge } =
    usePromociones(profile?.sucursal_id)

  useEffect(() => {
    async function loadProducts() {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('activo', true)
        .order('categoria', { ascending: true })
        .order('nombre', { ascending: true })

      if (error) console.error('Error cargando productos:', error.message)
      setProducts(data ?? [])
      setLoading(false)
    }
    loadProducts()
  }, [])

  // Re-evaluate combo notifications every time the cart changes
  useEffect(() => {
    const notifs = getComboNotifications(cart).filter(
      (n) => !dismissedCombos.has(n.promo_id)
    )
    setComboNotifs(notifs)
  }, [cart, getComboNotifications, dismissedCombos])

  // Category list
  const categories = [
    'Todos',
    ...Array.from(new Set(products.map((p) => p.categoria ?? 'Sin categoría'))),
  ]

  const filtered = products.filter((p) => {
    const matchSearch = p.nombre.toLowerCase().includes(search.toLowerCase())
    const matchCat = activeCategory === 'Todos' || p.categoria === activeCategory
    return matchSearch && matchCat
  })

  // ── addToCart ──────────────────────────────────────────────────────────────
  // 1. Check for active descuento promos → reduces precio_unitario
  // 2. Check for active combo promos where this product is the target
  // 3. Build CartItem with (possibly reduced) price
  const addToCart = useCallback((product: Product, cantidad: number) => {
    setCart((prev) => {
      // Determine the best promo price: descuento first, then combo
      let promoResult = applyDescuento(product)
      if (!promoResult.promo) {
        promoResult = getComboDescuentoForProduct(product, prev)
      }

      const { precio_unitario, promo } = promoResult
      const subtotal = parseFloat((precio_unitario * cantidad).toFixed(2))

      const existingIdx = prev.findIndex((i) => i.product.id === product.id)

      if (existingIdx >= 0) {
        const updated = [...prev]
        if (product.unidad === 'pieza') {
          const newCantidad = updated[existingIdx].cantidad + cantidad
          updated[existingIdx] = {
            ...updated[existingIdx],
            cantidad: newCantidad,
            precio_unitario,
            promo,
            subtotal: parseFloat((precio_unitario * newCantidad).toFixed(2)),
          }
        } else {
          // Weight: replace with fresh reading
          updated[existingIdx] = { ...updated[existingIdx], cantidad, precio_unitario, promo, subtotal }
        }
        return updated
      }

      return [
        ...prev,
        {
          id: `${product.id}-${Date.now()}`,
          product,
          cantidad,
          precio_unitario,
          promo,
          subtotal,
        },
      ]
    })
  }, [applyDescuento, getComboDescuentoForProduct])

  const removeFromCart = useCallback((itemId: string) => {
    setCart((prev) => prev.filter((i) => i.id !== itemId))
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  const cartTotal = cart.reduce((sum, i) => sum + i.subtotal, 0)

  const handleProductTap = (product: Product) => {
    if (product.unidad === 'pieza') {
      addToCart(product, 1)
    } else {
      setSelectedProduct(product)
    }
  }

  // ── CartItems ──────────────────────────────────────────────────────────────
  const CartItems = () => (
    <>
      {cart.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-300 text-sm">
          Toca un producto
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {cart.map((item) => (
            <li key={item.id} className="flex items-start gap-2 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">
                  {item.product.nombre}
                </div>
                <div className="text-xs text-gray-400 tabular-nums">
                  {item.cantidad} {item.product.unidad} ×{' '}
                  {item.promo ? (
                    <>
                      <span className="line-through text-gray-300">
                        ${item.promo.precio_original.toFixed(2)}
                      </span>{' '}
                      <span className="text-orange-600 font-semibold">
                        ${item.precio_unitario.toFixed(2)}
                      </span>
                    </>
                  ) : (
                    `$${item.precio_unitario.toFixed(2)}`
                  )}
                </div>
                {/* Promo badge on cart item */}
                {item.promo && (
                  <div className="text-[10px] text-orange-600 font-medium mt-0.5">
                    🏷️ {item.promo.nombre} · ahorras ${item.promo.descuento_aplicado.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="text-sm font-bold text-green-700 whitespace-nowrap">
                ${item.subtotal.toFixed(2)}
              </div>
              <button
                onClick={() => removeFromCart(item.id)}
                className="text-gray-300 hover:text-red-400 transition-colors text-xs mt-0.5"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  // ── CartFooter ─────────────────────────────────────────────────────────────
  const CartFooter = ({ onCheckout }: { onCheckout: () => void }) => {
    const totalAhorrado = cart.reduce((s, i) => s + (i.promo?.descuento_aplicado ?? 0) * i.cantidad, 0)
    return (
      <div className="border-t border-gray-200 p-4 space-y-3">
        {totalAhorrado > 0 && (
          <div className="flex justify-between items-center text-xs">
            <span className="text-orange-600 font-medium">🏷️ Promos aplicadas</span>
            <span className="text-orange-600 font-bold">−${totalAhorrado.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="font-bold text-gray-700">Total</span>
          <span className="text-2xl font-bold text-green-700">
            ${cartTotal.toFixed(2)}
          </span>
        </div>
        {cart.length > 0 && (
          <>
            <button
              onClick={clearCart}
              className="w-full text-xs text-gray-400 hover:text-red-400 transition-colors py-1"
            >
              🗑 Vaciar carrito
            </button>
            <button
              onClick={onCheckout}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-base hover:bg-green-700 active:scale-95 transition-all shadow-sm"
            >
              Cobrar ${cartTotal.toFixed(2)}
            </button>
          </>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Cargando productos...
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">

      {/* ── Products panel ── */}
      <div className="flex-1 flex flex-col md:border-r border-gray-200 overflow-hidden bg-white">

        {/* Scale status bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 text-sm">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            scale.status === 'connected'  ? 'bg-green-500' :
            scale.status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
            scale.status === 'error'      ? 'bg-red-500' : 'bg-gray-300'
          }`} />
          <span className="text-gray-600 truncate">
            {scale.status === 'connected' ? (
              <>⚖️ {scale.deviceName} —{' '}
                <span className="font-mono font-bold text-gray-800">
                  {scale.reading ? `${scale.reading.value} ${scale.reading.unit}` : '0.000 kg'}
                </span>
              </>
            ) : scale.status === 'connecting' ? 'Buscando báscula...'
              : scale.status === 'error' ? <span className="text-red-500">{scale.error}</span>
              : 'Báscula desconectada'}
          </span>
          {scale.status === 'connected' ? (
            <button onClick={scale.disconnect} className="ml-auto text-xs text-red-400 hover:text-red-600 flex-shrink-0">
              Desconectar
            </button>
          ) : (
            <button onClick={scale.connect} disabled={scale.status === 'connecting'}
              className="ml-auto flex-shrink-0 text-xs bg-blue-500 text-white px-3 py-1 rounded-full hover:bg-blue-600 disabled:opacity-50 transition-colors">
              {scale.status === 'connecting' ? 'Buscando...' : 'Conectar báscula'}
            </button>
          )}
          {/* Cash movement quick-access — visible to all roles during the day */}
          <button
            onClick={() => setShowMovimiento(true)}
            title="Registrar movimiento de caja"
            className="flex-shrink-0 text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-full transition-colors"
          >
            💸
          </button>
        </div>

        {/* ── Combo notification banners ── */}
        {comboNotifs.map((notif) => (
          <div key={notif.promo_id}
            className="mx-4 mt-2 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 text-sm shadow-sm">
            <span className="text-base flex-shrink-0">🎉</span>
            <span className="flex-1 text-orange-800 font-medium">{notif.mensaje}</span>
            <button
              onClick={() => setDismissedCombos((s) => new Set([...s, notif.promo_id]))}
              className="text-orange-300 hover:text-orange-500 text-xs flex-shrink-0"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Search */}
        <div className="px-4 py-2 border-b border-gray-100">
          <input
            type="text" placeholder="Buscar producto..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-gray-100 flex-shrink-0">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {cat}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No hay productos
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map((product) => {
                const badge = getPromoBadge(product)
                return (
                  <button key={product.id} onClick={() => handleProductTap(product)}
                    className="relative bg-white rounded-xl p-4 shadow-sm border border-gray-200 hover:border-green-400 hover:shadow-md active:scale-95 transition-all text-left">
                    {/* Promo badge */}
                    {badge && (
                      <span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        {badge}
                      </span>
                    )}
                    <div className="text-sm font-semibold text-gray-800 leading-tight mb-2 pr-8">
                      {product.nombre}
                    </div>
                    <div className="text-green-700 font-bold">
                      ${product.precio_por_unidad.toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">/{product.unidad}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop cart panel ── */}
      <div className="hidden md:flex md:w-64 lg:w-80 flex-col bg-white flex-shrink-0">
        <div className="px-4 py-3 border-b border-gray-200 font-bold text-gray-800">
          🛒 Carrito{' '}
          {cart.length > 0 && <span className="text-sm font-normal text-gray-400">({cart.length})</span>}
        </div>
        <div className="flex-1 overflow-y-auto">
          <CartItems />
        </div>
        <CartFooter onCheckout={() => setShowCheckout(true)} />
      </div>

      {/* ── Mobile floating cart bar ── */}
      {cart.length > 0 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
          <button onClick={() => setShowMobileCart(true)}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-between px-5 active:scale-95 transition-all">
            <span className="flex items-center gap-2">
              🛒
              <span className="bg-white text-green-700 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {cart.length}
              </span>
            </span>
            <span>Ver carrito</span>
            <span>${cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* ── Mobile cart sheet ── */}
      {showMobileCart && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="flex-1 bg-black/40" onClick={() => setShowMobileCart(false)} />
          <div className="bg-white rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-bold text-gray-800 text-base">🛒 Carrito ({cart.length})</span>
              <button onClick={() => setShowMobileCart(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CartItems />
            </div>
            <CartFooter onCheckout={() => { setShowMobileCart(false); setShowCheckout(true) }} />
          </div>
        </div>
      )}

      {/* Weight modal */}
      {selectedProduct && (
        <WeightModal product={selectedProduct} scale={scale}
          onConfirm={(cantidad) => { addToCart(selectedProduct, cantidad); setSelectedProduct(null) }}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* Checkout modal */}
      {showCheckout && (
        <CheckoutModal cart={cart} total={cartTotal}
          onConfirm={() => { clearCart(); setShowCheckout(false) }}
          onClose={() => setShowCheckout(false)}
        />
      )}

      {/* Cash movement modal — quick access during the day */}
      {showMovimiento && (
        <MovimientoCajaModal
          onSaved={() => {}}
          onClose={() => setShowMovimiento(false)}
        />
      )}
    </div>
  )
}
