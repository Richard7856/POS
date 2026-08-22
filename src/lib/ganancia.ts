// Cálculo de ganancia — funciones puras compartidas por productos, entradas,
// checkout y dashboard. Sin React ni Supabase para poder probarlas solas.

import type { Product } from './types'

export interface Ganancia {
  monto: number   // ganancia por unidad, en pesos
  pct: number     // margen sobre el precio de venta (lo que de cada peso vendido es ganancia)
}

/**
 * Ganancia por unidad dado un precio de venta y un costo, ambos en la MISMA
 * unidad. Devuelve null si falta alguno de los dos (sin costo no hay margen
 * que presumir — mejor no mostrar nada que mostrar un número inventado).
 *
 * pct es margen sobre venta (monto/precio), no markup sobre costo: responde
 * "de cada peso que cobro, cuánto es mío", que es como se piensa el negocio.
 */
export function calcGanancia(precio: number | null, costo: number | null): Ganancia | null {
  if (precio == null || costo == null) return null
  if (!isFinite(precio) || !isFinite(costo) || precio <= 0 || costo < 0) return null
  const monto = precio - costo
  return {
    monto: Math.round(monto * 100) / 100,
    pct: Math.round((monto / precio) * 1000) / 10,   // 1 decimal
  }
}

/**
 * El costo de los lotes se captura SIEMPRE por kg (así llega la factura del
 * proveedor), pero los productos vendidos en gramos manejan precio por gramo.
 * Esta conversión lleva un costo/kg a la unidad nativa del producto.
 */
export function costoKgAUnidad(costoPorKg: number, unidad: Product['unidad']): number {
  return unidad === 'g' ? costoPorKg / 1000 : costoPorKg
}

/**
 * Costo unitario ponderado de lo que se descontó de varios lotes FIFO.
 * `porciones` = [cantidad tomada del lote (kg), costo/kg de ese lote | null].
 *
 * Los lotes sin costo no participan del promedio (promediar con ceros
 * inventaría una ganancia mayor a la real). Si ningún lote consumido tiene
 * costo, devuelve null y el que llama decide el fallback (precio_compra).
 */
export function costoPonderadoKg(porciones: [number, number | null][]): number | null {
  let kg = 0
  let pesos = 0
  for (const [cantidad, costo] of porciones) {
    if (costo == null || cantidad <= 0) continue
    kg += cantidad
    pesos += cantidad * costo
  }
  if (kg <= 0) return null
  return pesos / kg
}

/** Suma ganancia sobre renglones vendidos, ignorando los de costo desconocido. */
export function gananciaDeItems(
  items: { subtotal: number; cantidad: number; costo_unitario: number | null }[]
): { ganancia: number; ventaConCosto: number; ventaTotal: number } {
  let ganancia = 0
  let ventaConCosto = 0
  let ventaTotal = 0
  for (const it of items) {
    ventaTotal += it.subtotal
    if (it.costo_unitario == null) continue
    ventaConCosto += it.subtotal
    ganancia += it.subtotal - it.costo_unitario * it.cantidad
  }
  return { ganancia, ventaConCosto, ventaTotal }
}
