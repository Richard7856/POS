/**
 * usePromociones
 *
 * Loads all active promotions for the current sucursal and exposes two functions:
 *
 *  - applyDescuento(product, cantidad) → { precio_unitario, promo? }
 *    Checks time-window + scope. Returns the promotional price (or original if no match).
 *    Called inside addToCart() when creating a CartItem.
 *
 *  - getComboNotifications(cart) → ComboNotification[]
 *    Scans the cart for active combo triggers. Returns banners to show the cashier.
 *    Called as a useEffect watching cart changes.
 *
 * Why a hook (not a utility):
 *   Promos are fetched once per session and cached. Re-fetching every addToCart would
 *   be slow and cause race conditions. The hook memoizes the list and refreshes every
 *   5 minutes while the POS is open.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CartItem, Product, Promocion, PromoAplicada } from '@/lib/types'

export interface ComboNotification {
  promo_id: string
  mensaje: string         // "🎉 ¡Agrega cilantro y llévalo al 50%!"
  target_nombre: string
  target_product_id: string
  descuento_texto: string // "50% off" / "$5 off" / "a $8"
}

// ── Time-window check ─────────────────────────────────────────────────────────

function isPromoActiva(promo: Promocion): boolean {
  const now   = new Date()
  const hoy   = now.toISOString().slice(0, 10)      // YYYY-MM-DD
  const diaSemana = now.getDay()                     // 0=Dom...6=Sab

  // Date range
  if (promo.fecha_inicio && hoy < promo.fecha_inicio) return false
  if (promo.fecha_fin    && hoy > promo.fecha_fin)    return false

  // Day of week
  if (promo.dias_semana && promo.dias_semana.length > 0) {
    if (!promo.dias_semana.includes(diaSemana)) return false
  }

  // Hour range — compare HH:MM strings
  if (promo.hora_inicio || promo.hora_fin) {
    const horaActual = now.toTimeString().slice(0, 5)  // "HH:MM"
    const inicio = promo.hora_inicio?.slice(0, 5) ?? '00:00'
    const fin    = promo.hora_fin?.slice(0, 5)    ?? '23:59'
    if (horaActual < inicio || horaActual > fin) return false
  }

  return true
}

// ── Price calculation ─────────────────────────────────────────────────────────

/**
 * Compute the promotional price for a product given a matching promo.
 * Returns { nuevoPrecio, descuentoAmt } or null if the promo doesn't change the price.
 */
function calcularPrecioPromo(
  precioOriginal: number,
  promo: Promocion,
): { nuevoPrecio: number; descuentoAmt: number } | null {
  const val = promo.descuento_valor ?? 0
  if (val <= 0) return null

  switch (promo.descuento_tipo) {
    case 'porcentaje': {
      const desc = precioOriginal * (val / 100)
      const nuevo = Math.max(precioOriginal - desc, 0)
      return { nuevoPrecio: parseFloat(nuevo.toFixed(2)), descuentoAmt: parseFloat(desc.toFixed(2)) }
    }
    case 'monto': {
      const nuevo = Math.max(precioOriginal - val, 0)
      return { nuevoPrecio: parseFloat(nuevo.toFixed(2)), descuentoAmt: parseFloat(Math.min(val, precioOriginal).toFixed(2)) }
    }
    case 'precio_fijo': {
      const nuevo = Math.max(val, 0)
      const desc  = Math.max(precioOriginal - nuevo, 0)
      return { nuevoPrecio: nuevo, descuentoAmt: parseFloat(desc.toFixed(2)) }
    }
    default:
      return null
  }
}

function descuentoTexto(promo: Promocion): string {
  const val = promo.descuento_valor ?? 0
  switch (promo.descuento_tipo) {
    case 'porcentaje':  return `${val}% off`
    case 'monto':       return `$${val} off`
    case 'precio_fijo': return `a $${val}`
    default:            return ''
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePromociones(sucursalId: string | null | undefined) {
  const [promociones, setPromociones] = useState<Promocion[]>([])

  const load = useCallback(async () => {
    if (!sucursalId) return
    const { data } = await supabase
      .from('promociones')
      .select(`
        *,
        product:products!product_id(id, nombre, unidad),
        trigger_product:products!trigger_product_id(id, nombre, unidad),
        target_product:products!target_product_id(id, nombre, unidad)
      `)
      .eq('sucursal_id', sucursalId)
      .eq('activo', true)
    setPromociones(data ?? [])
  }, [sucursalId])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60 * 1000)  // refresh every 5 min
    return () => clearInterval(interval)
  }, [load])

  // ── applyDescuento ─────────────────────────────────────────────────────────
  /**
   * Find the best active promo for a product at the time of adding to cart.
   * Returns the (possibly discounted) precio_unitario and promo metadata.
   * If multiple promos match, applies the one with the biggest discount.
   */
  const applyDescuento = useCallback((
    product: Product,
  ): { precio_unitario: number; promo?: PromoAplicada } => {
    const active = promociones.filter(
      (p) => p.tipo === 'descuento' && isPromoActiva(p)
    )

    let bestResult: { precio_unitario: number; promo?: PromoAplicada } = {
      precio_unitario: product.precio_por_unidad,
    }
    let bestDesc = 0

    for (const promo of active) {
      // Check if this promo applies to this product
      const applies =
        promo.aplica_a === 'todos' ||
        (promo.aplica_a === 'producto' && promo.product_id === product.id) ||
        (promo.aplica_a === 'categoria' && promo.categoria === product.categoria)

      if (!applies) continue

      const result = calcularPrecioPromo(product.precio_por_unidad, promo)
      if (!result) continue

      // Keep the promo that saves the most
      if (result.descuentoAmt > bestDesc) {
        bestDesc = result.descuentoAmt
        bestResult = {
          precio_unitario: result.nuevoPrecio,
          promo: {
            promo_id: promo.id,
            nombre: promo.nombre,
            precio_original: product.precio_por_unidad,
            descuento_aplicado: result.descuentoAmt,
          },
        }
      }
    }

    return bestResult
  }, [promociones])

  // ── getComboNotifications ──────────────────────────────────────────────────
  /**
   * Scan the cart for combo triggers. Returns a banner for each combo that:
   *   - Is active right now (time window)
   *   - Has its trigger product in the cart at the required qty
   *   - Target product is NOT yet in the cart (only show if the customer could benefit)
   */
  const getComboNotifications = useCallback((cart: CartItem[]): ComboNotification[] => {
    const activeCombos = promociones.filter(
      (p) => p.tipo === 'combo' && isPromoActiva(p)
    )

    const notifications: ComboNotification[] = []

    for (const promo of activeCombos) {
      if (!promo.trigger_product_id || !promo.target_product_id) continue

      // Check trigger is in cart with sufficient qty
      const triggerInCart = cart.filter(
        (item) => item.product.id === promo.trigger_product_id
      )
      const totalTriggerQty = triggerInCart.reduce((s, i) => s + i.cantidad, 0)
      if (totalTriggerQty < promo.trigger_cantidad_min) continue

      // Show notification whether or not target is already in cart
      // (if target is already in cart with discount applied, don't re-notify)
      const targetAlreadyDiscounted = cart.some(
        (item) => item.product.id === promo.target_product_id && item.promo?.promo_id === promo.id
      )
      if (targetAlreadyDiscounted) continue

      const targetNombre = promo.target_product?.nombre ?? 'producto'
      const dTexto = descuentoTexto(promo)

      notifications.push({
        promo_id: promo.id,
        mensaje: `🎉 ¡Agrega ${targetNombre} y llévalo ${dTexto}!`,
        target_nombre: targetNombre,
        target_product_id: promo.target_product_id,
        descuento_texto: dTexto,
      })
    }

    return notifications
  }, [promociones])

  // ── applyComboToTarget ─────────────────────────────────────────────────────
  /**
   * When the cashier adds the target product of an active combo,
   * apply the combo discount to it.
   * Called in addToCart() after checking getComboNotifications.
   */
  const getComboDescuentoForProduct = useCallback((
    product: Product,
    cart: CartItem[],
  ): { precio_unitario: number; promo?: PromoAplicada } => {
    const activeCombos = promociones.filter(
      (p) => p.tipo === 'combo' && isPromoActiva(p)
    )

    for (const promo of activeCombos) {
      if (promo.target_product_id !== product.id) continue
      if (!promo.trigger_product_id) continue

      // Check trigger qty in current cart
      const triggerQty = cart
        .filter((i) => i.product.id === promo.trigger_product_id)
        .reduce((s, i) => s + i.cantidad, 0)

      if (triggerQty < promo.trigger_cantidad_min) continue

      const result = calcularPrecioPromo(product.precio_por_unidad, promo)
      if (!result) continue

      return {
        precio_unitario: result.nuevoPrecio,
        promo: {
          promo_id: promo.id,
          nombre: promo.nombre,
          precio_original: product.precio_por_unidad,
          descuento_aplicado: result.descuentoAmt,
        },
      }
    }

    return { precio_unitario: product.precio_por_unidad }
  }, [promociones])

  // ── getPromosBadge ─────────────────────────────────────────────────────────
  /**
   * Returns a short label for displaying on a product card in the POS grid.
   * e.g., "−20%", "$15/kg", "COMBO"
   * Returns null if no active promo applies to this product.
   */
  const getPromoBadge = useCallback((product: Product): string | null => {
    // Check descuento promos
    for (const promo of promociones) {
      if (promo.tipo !== 'descuento' || !isPromoActiva(promo)) continue
      const applies =
        promo.aplica_a === 'todos' ||
        (promo.aplica_a === 'producto' && promo.product_id === product.id) ||
        (promo.aplica_a === 'categoria' && promo.categoria === product.categoria)
      if (!applies) continue

      const val = promo.descuento_valor ?? 0
      if (promo.descuento_tipo === 'porcentaje')  return `−${val}%`
      if (promo.descuento_tipo === 'monto')       return `−$${val}`
      if (promo.descuento_tipo === 'precio_fijo') return `$${val}`
    }
    // Check if this product is a combo trigger
    for (const promo of promociones) {
      if (promo.tipo !== 'combo' || !isPromoActiva(promo)) continue
      if (promo.trigger_product_id === product.id) return 'COMBO'
      if (promo.target_product_id  === product.id) return 'COMBO'
    }
    return null
  }, [promociones])

  return { promociones, applyDescuento, getComboNotifications, getComboDescuentoForProduct, getPromoBadge, reload: load }
}
