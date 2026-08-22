'use client'

/**
 * useCuentas
 *
 * Maneja las cuentas abiertas del POS: varios clientes atendidos a la vez, cada
 * uno con su propio carrito, y una sola activa en pantalla.
 *
 * Contrato con la página del POS:
 *   - `cart` y `setCart` se comportan igual que el useState de antes, pero
 *     apuntan siempre a la cuenta activa. Por eso el resto de la lógica del POS
 *     (addToCart, promos, checkout) no tuvo que cambiar.
 *   - `setCart` mantiene identidad estable entre renders, para no invalidar los
 *     useCallback que dependen de él.
 *
 * Este hook es sólo la parte de React: el estado y su persistencia. Toda la
 * lógica de qué pasa al abrir, cerrar o cambiar de cuenta vive como funciones
 * puras en lib/cuentasAbiertas.ts.
 *
 * Dos detalles que importan:
 *
 *   1. `cuentas` y `activaId` van en UN solo objeto de estado. Separados,
 *      cerrar una cuenta obligaría a llamar setActivaId dentro del updater de
 *      setCuentas —un updater con efectos, que React puede correr dos veces—.
 *
 *   2. El estado inicial se lee de localStorage en el inicializador perezoso, no
 *      en un efecto: así no hay parpadeo de carrito vacío al recargar. Es seguro
 *      para la hidratación porque el POS pinta el esqueleto en su primer render
 *      (mientras carga productos), tanto en el prerender como en el cliente.
 */

import { useState, useEffect, useCallback } from 'react'
import type { CartItem } from '@/lib/types'
import {
  crearCuenta,
  loadCuentas,
  saveCuentas,
  aplicarCart,
  abrir,
  cerrar,
  cambiarActiva,
  renombrar,
  MAX_CUENTAS,
  type CuentasState,
  type CartUpdater,
} from '@/lib/cuentasAbiertas'

function estadoInicial(): CuentasState {
  // Durante el prerender no hay localStorage: se devuelve vacío y el cliente lo
  // llena en su primer render.
  if (typeof window === 'undefined') return { cuentas: [], activaId: '' }

  const guardado = loadCuentas()
  if (guardado) return guardado

  const primera = crearCuenta('Cuenta 1')
  return { cuentas: [primera], activaId: primera.id }
}

export function useCuentas() {
  const [state, setState] = useState<CuentasState>(estadoInicial)

  // Persistir en cada cambio. Un efecto es el lugar correcto: sincroniza el
  // estado de React con un sistema externo, sin volver a llamar a setState.
  useEffect(() => {
    if (state.cuentas.length === 0) return
    saveCuentas(state)
  }, [state])

  const { cuentas, activaId } = state
  const cuentaActiva = cuentas.find((c) => c.id === activaId) ?? null
  const cart: CartItem[] = cuentaActiva?.cart ?? []

  const setCart = useCallback((updater: CartUpdater) => {
    setState((prev) => aplicarCart(prev, updater))
  }, [])

  // Los ids y timestamps se generan aquí, fuera del updater, para que el updater
  // siga siendo puro.
  const abrirCuenta = useCallback(() => {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    setState((prev) => abrir(prev, id, createdAt))
  }, [])

  const cerrarCuenta = useCallback((id: string) => {
    const idReemplazo = crypto.randomUUID()
    const createdAt = Date.now()
    setState((prev) => cerrar(prev, id, idReemplazo, createdAt))
  }, [])

  const cambiarACuenta = useCallback((id: string) => {
    setState((prev) => cambiarActiva(prev, id))
  }, [])

  const renombrarCuenta = useCallback((id: string, nombre: string) => {
    setState((prev) => renombrar(prev, id, nombre))
  }, [])

  const vaciarCuentaActiva = useCallback(() => setCart([]), [setCart])

  return {
    cuentas,
    activaId,
    cuentaActiva,
    cart,
    setCart,
    // En el prerender no hay cuentas todavía; el POS espera a que las haya
    // antes de pintar.
    hydrated: cuentas.length > 0,
    abrirCuenta,
    cerrarCuenta,
    cambiarACuenta,
    renombrarCuenta,
    vaciarCuentaActiva,
    puedeAbrirMas: cuentas.length < MAX_CUENTAS,
  }
}
