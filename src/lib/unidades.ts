// Unidades de venta e inventario — funciones puras.
//
// El sistema nació asumiendo que todo se pesa en kg. Con los productos por
// pieza (manojos de cilantro, lechugas, piñas) eso deja de ser cierto: su
// inventario se cuenta en piezas, no en kilos. Estos helpers evitan que "kg"
// siga escrito a mano por toda la interfaz.

import type { Product } from './types'

export type Unidad = Product['unidad']

/**
 * Unidad en la que se lleva el INVENTARIO del producto.
 * Los productos que se venden por gramo se inventarían en kg (así llega la
 * mercancía y así se factura); las piezas se cuentan como piezas.
 */
export function unidadInventario(unidad: string): 'kg' | 'pieza' {
  return unidad === 'pieza' ? 'pieza' : 'kg'
}

/** Lleva una cantidad de venta a la unidad de inventario (g → kg). */
export function aInventario(cantidad: number, unidad: string): number {
  return unidad === 'g' ? cantidad / 1000 : cantidad
}

/** Etiqueta corta para mostrar junto a un número de inventario. */
export function etiquetaInventario(unidad: string, cantidad = 2): string {
  if (unidadInventario(unidad) === 'kg') return 'kg'
  return Math.abs(cantidad) === 1 ? 'pza' : 'pzas'
}

/** Las piezas no se parten: se muestran enteras. Los kilos, con decimales. */
export function decimales(unidad: string, precisos = false): number {
  if (unidadInventario(unidad) === 'pieza') return 0
  return precisos ? 3 : 1
}

/** "5.0 kg" · "25 pzas" — el formato que se lee en toda la app. */
export function formatInventario(cantidad: number, unidad: string, precisos = false): string {
  return `${cantidad.toFixed(decimales(unidad, precisos))} ${etiquetaInventario(unidad, cantidad)}`
}

/** El paso de los inputs numéricos: las piezas van de uno en uno. */
export function pasoInput(unidad: string): string {
  return unidadInventario(unidad) === 'pieza' ? '1' : '0.001'
}
