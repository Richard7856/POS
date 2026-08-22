// Cuentas abiertas del POS — persistencia en localStorage.
//
// Por qué en el dispositivo y no en la BD: una cuenta abierta es el cliente que
// el cajero tiene enfrente. No hace falta que otra caja la vea, y guardarla
// local hace que sobreviva a un refresh o a que se caiga la señal — que es
// justo cuando más duele perder un carrito a medio armar.
//
// Si algún día se quiere "dejar pendiente aquí y cobrar en la otra caja", eso sí
// necesita una tabla en Postgres; hoy no.

import type { CartItem, Cuenta } from './types'

const STORAGE_KEY = 'pos_cuentas_v1'

// Tope para que la barra de pestañas siga siendo usable y localStorage no crezca
// sin control. Doce clientes simultáneos en un mostrador ya es muchísimo.
export const MAX_CUENTAS = 12

export interface CuentasState {
  cuentas: Cuenta[]
  activaId: string
}

export function crearCuenta(nombre: string): Cuenta {
  return {
    id: crypto.randomUUID(),
    nombre,
    cart: [],
    createdAt: Date.now(),
  }
}

// Devuelve el primer número libre: si están abiertas "Cuenta 1" y "Cuenta 3",
// la siguiente es "Cuenta 2". Evita que los números crezcan sin parar durante
// el día.
export function siguienteNombre(cuentas: Cuenta[]): string {
  const usados = new Set(
    cuentas
      .map((c) => /^Cuenta (\d+)$/.exec(c.nombre)?.[1])
      .filter(Boolean)
      .map(Number)
  )
  let n = 1
  while (usados.has(n)) n++
  return `Cuenta ${n}`
}

export function totalCuenta(cuenta: Cuenta): number {
  return cuenta.cart.reduce((s, i) => s + i.subtotal, 0)
}

export function loadCuentas(): CuentasState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as CuentasState
    if (!Array.isArray(parsed?.cuentas) || parsed.cuentas.length === 0) return null

    // Descarta cualquier fila corrupta antes de devolverla: un carrito a medias
    // no debe tumbar el POS al arrancar.
    const cuentas = parsed.cuentas.filter(
      (c): c is Cuenta =>
        !!c && typeof c.id === 'string' && typeof c.nombre === 'string' && Array.isArray(c.cart)
    )
    if (cuentas.length === 0) return null

    const activaId = cuentas.some((c) => c.id === parsed.activaId)
      ? parsed.activaId
      : cuentas[0].id

    return { cuentas, activaId }
  } catch {
    return null
  }
}

export function saveCuentas(state: CuentasState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* cuota llena o modo privado — se sigue trabajando en memoria */ }
}

// Helper de tipos para el updater estilo setState del carrito activo.
export type CartUpdater = CartItem[] | ((prev: CartItem[]) => CartItem[])

// ── Transiciones de estado ──────────────────────────────────────────────────
//
// Puras a propósito: reciben el estado y devuelven el siguiente, sin generar
// ids ni leer relojes. Los valores "nuevos" (id, createdAt) se pasan desde
// fuera para que React pueda ejecutar el updater dos veces sin efectos raros —
// y para poder probar esta lógica sin montar un componente.

export function aplicarCart(state: CuentasState, updater: CartUpdater): CuentasState {
  return {
    ...state,
    cuentas: state.cuentas.map((c) =>
      c.id === state.activaId
        ? { ...c, cart: typeof updater === 'function' ? updater(c.cart) : updater }
        : c
    ),
  }
}

export function abrir(state: CuentasState, id: string, createdAt: number): CuentasState {
  if (state.cuentas.length >= MAX_CUENTAS) return state
  const nueva: Cuenta = { id, nombre: siguienteNombre(state.cuentas), cart: [], createdAt }
  return { cuentas: [...state.cuentas, nueva], activaId: id }
}

export function cambiarActiva(state: CuentasState, id: string): CuentasState {
  return state.activaId === id ? state : { ...state, activaId: id }
}

export function renombrar(state: CuentasState, id: string, nombre: string): CuentasState {
  const limpio = nombre.trim().slice(0, 24)
  if (!limpio) return state
  return {
    ...state,
    cuentas: state.cuentas.map((c) => (c.id === id ? { ...c, nombre: limpio } : c)),
  }
}

/**
 * Cierra una cuenta — al cobrarla o al descartarla.
 *
 * Siempre queda al menos una abierta: si se cierra la última entra una vacía
 * (usando idReemplazo), para que el cajero siga vendiendo sin tocar nada más.
 * Si la cerrada era la que estaba en pantalla, pasa a la vecina de la derecha,
 * o a la última si era la última.
 */
export function cerrar(
  state: CuentasState,
  id: string,
  idReemplazo: string,
  createdAt: number,
): CuentasState {
  const idx = state.cuentas.findIndex((c) => c.id === id)
  if (idx === -1) return state

  const restantes = state.cuentas.filter((c) => c.id !== id)

  if (restantes.length === 0) {
    const nueva: Cuenta = { id: idReemplazo, nombre: 'Cuenta 1', cart: [], createdAt }
    return { cuentas: [nueva], activaId: idReemplazo }
  }

  const activaId =
    id === state.activaId
      ? restantes[Math.min(idx, restantes.length - 1)].id
      : state.activaId

  return { cuentas: restantes, activaId }
}
