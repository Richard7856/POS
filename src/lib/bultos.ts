// Compra por bulto — cuando se compra en una unidad y se vende en otra.
//
// El caso que lo motivó: el cilantro llega en manojo grande a $35 y de ahí
// salen entre 20 y 30 manojos chicos que se venden a $1 cada uno. El costo real
// de cada manojo chico depende de cuánto rindió ESE bulto, así que no sirve un
// factor fijo por producto: el rendimiento se captura en cada entrada.
//
// Aplica igual a cajas de jitomate, arpillas de papa o rejas de limón: se paga
// por bulto y se vende por kilo o por pieza.

export interface CompraPorBulto {
  /** Cuántos bultos se compraron (2 cajas, 3 manojos grandes...) */
  bultos: number
  /** Lo que costó cada bulto */
  costoPorBulto: number
  /** Cuánto salió en la unidad de venta: kg o piezas */
  rendimiento: number
}

export interface ResultadoBulto {
  /** Lo que se pagó en total */
  costoTotal: number
  /** Costo de cada kg o cada pieza — el que se guarda en el lote */
  costoUnitario: number
}

/**
 * Costo unitario real de lo que se va a vender.
 * Devuelve null si falta algún dato o si el rendimiento es cero: sin saber
 * cuánto salió del bulto no hay costo que calcular.
 */
export function calcularBulto(c: Partial<CompraPorBulto>): ResultadoBulto | null {
  const { bultos, costoPorBulto, rendimiento } = c
  if (bultos == null || costoPorBulto == null || rendimiento == null) return null
  if (!isFinite(bultos) || !isFinite(costoPorBulto) || !isFinite(rendimiento)) return null
  if (bultos <= 0 || costoPorBulto < 0 || rendimiento <= 0) return null

  const costoTotal = bultos * costoPorBulto
  return {
    costoTotal: Math.round(costoTotal * 100) / 100,
    // 4 decimales: con manojos de ~$1 la tercera cifra sí mueve el margen
    costoUnitario: Math.round((costoTotal / rendimiento) * 10000) / 10000,
  }
}

/**
 * Rendimiento sugerido a partir de una compra anterior del mismo producto.
 * Si la vez pasada 3 manojos grandes dieron 75 piezas, para 2 manojos se
 * sugieren 50. Es sólo una sugerencia editable: el encargado corrige con lo
 * que realmente salió.
 */
export function rendimientoSugerido(
  bultosAhora: number,
  bultosAntes: number | null,
  rendimientoAntes: number | null,
): number | null {
  if (!bultosAntes || !rendimientoAntes) return null
  if (bultosAntes <= 0 || rendimientoAntes <= 0 || bultosAhora <= 0) return null
  return Math.round((rendimientoAntes / bultosAntes) * bultosAhora)
}
