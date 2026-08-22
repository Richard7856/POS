// Control de existencias — funciones puras usadas por el POS y el cobro.
//
// Regla de oro: el inventario debe reflejar lo que realmente pasó. Antes, al
// vender más de lo que había, el FIFO descontaba lo disponible y el resto
// simplemente se perdía: el lote quedaba en 0 y nadie se enteraba de que se
// habían vendido kilos que nunca entraron. Ahora ese faltante se registra
// dejando un lote en negativo, que es la señal de "aquí falta capturar una
// entrada".

export interface LoteStock {
  id: string
  cantidad_disponible: number
  costo_por_unidad?: number | null
  fecha_entrada?: string
}

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

export interface PlanFifo {
  /** Lotes a actualizar con su nueva cantidad disponible */
  updates: { lote_id: string; nueva: number }[]
  /** Lote que se apunta en el renglón de venta (el más viejo consumido) */
  primaryLoteId: string | null
  /** [kg tomados, costo/kg] por lote — alimenta el costo ponderado */
  porciones: [number, number | null][]
  /** kg que no alcanzó a cubrir el stock positivo (0 si alcanzó) */
  faltante: number
}

/**
 * Reparte una venta entre los lotes por FIFO (entrada más vieja primero).
 *
 * Los lotes deben venir ordenados por fecha_entrada ascendente. Sólo se
 * consumen los que tienen existencia positiva; si aun así falta, el sobrante se
 * carga al lote MÁS RECIENTE dejándolo en negativo. Se elige el más reciente a
 * propósito: el encargado revisa las entradas por día, y ver "hoy: −3 kg" le
 * dice exactamente lo que pasó — se vendieron 3 kg que no se capturaron.
 *
 * Sin ningún lote no hay dónde registrar el faltante: se devuelve completo y
 * quien llama decide (bloquear al cajero, avisar al encargado).
 */
export function planFifo(lotes: LoteStock[], cantidadKg: number): PlanFifo {
  const updates: { lote_id: string; nueva: number }[] = []
  const porciones: [number, number | null][] = []
  let primaryLoteId: string | null = null
  let restante = cantidadKg

  if (cantidadKg <= 0) return { updates, primaryLoteId, porciones, faltante: 0 }

  for (const lote of lotes) {
    if (restante <= 0) break
    if (lote.cantidad_disponible <= 0) continue          // agotado o en negativo
    if (!primaryLoteId) primaryLoteId = lote.id

    const tomado = Math.min(lote.cantidad_disponible, restante)
    updates.push({
      lote_id: lote.id,
      nueva: parseFloat((lote.cantidad_disponible - tomado).toFixed(6)),
    })
    porciones.push([tomado, lote.costo_por_unidad ?? null])
    restante = parseFloat((restante - tomado).toFixed(6))
  }

  const faltante = restante > 0 ? restante : 0

  // Registrar el faltante en el lote más reciente, para que el hueco se vea.
  if (faltante > 0 && lotes.length > 0) {
    const reciente = lotes[lotes.length - 1]
    const yaTocado = updates.find((u) => u.lote_id === reciente.id)
    const base = yaTocado ? yaTocado.nueva : reciente.cantidad_disponible
    const nueva = parseFloat((base - faltante).toFixed(6))

    if (yaTocado) yaTocado.nueva = nueva
    else updates.push({ lote_id: reciente.id, nueva })

    if (!primaryLoteId) primaryLoteId = reciente.id
  }

  return { updates, primaryLoteId, porciones, faltante }
}

// La conversión a unidad de inventario vive en unidades.ts (aInventario).
// Todos los productos pueden llevar lotes, incluidos los que se venden por
// pieza: un manojo de cilantro también es inventario que se acaba.
