// Control de existencias — funciones puras que usa la interfaz del POS.
//
// El descuento FIFO real (con su regla de "el faltante se carga al lote más
// reciente en negativo") vive en el RPC registrar_venta: ahí corre en una
// transacción con lock y no puede haber dos versiones de la verdad. Aquí sólo
// queda lo que la UI necesita para MOSTRAR: cuánto hay y si alcanza.

export type EstadoStock = 'ok' | 'insuficiente' | 'sin_stock'

/**
 * Stock real de un producto: suma TODOS los lotes, incluidos los negativos.
 * Ignorar los negativos escondería justo el descuadre que queremos ver.
 */
export function stockDeLotes(lotes: { cantidad_disponible: number }[]): number {
  const total = lotes.reduce((s, l) => s + l.cantidad_disponible, 0)
  // Evita -0 y arrastres binarios tipo 4.999999999
  return parseFloat(total.toFixed(6)) + 0
}

/**
 * ¿Se puede surtir esta cantidad?
 *   ok           → alcanza
 *   insuficiente → hay algo, pero no lo suficiente
 *   sin_stock    → no hay nada (o ya está en negativo)
 *
 * `disponible === null` significa que el producto NO está bajo control de
 * inventario: nunca se le ha registrado una entrada. Se vende libremente en vez
 * de frenar el mostrador — el control empieza el día que se captura su primera
 * entrada. Lo mismo aplica a los productos por pieza, que no llevan lotes.
 */
export function evaluarStock(disponible: number | null, pedido: number): EstadoStock {
  if (disponible === null) return 'ok'
  if (pedido <= disponible) return 'ok'
  return disponible <= 0 ? 'sin_stock' : 'insuficiente'
}

// La conversión a unidad de inventario vive en unidades.ts (aInventario).
// Todos los productos pueden llevar lotes, incluidos los que se venden por
// pieza: un manojo de cilantro también es inventario que se acaba.
