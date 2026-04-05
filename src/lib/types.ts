export interface Sucursal {
  id: string
  nombre: string
  direccion: string | null
  activa: boolean
  created_at: string
}

// Profile extends auth.users 1-to-1
export interface Profile {
  id: string
  nombre: string | null
  rol: 'admin' | 'encargado' | 'cajero'
  sucursal_id: string | null
  sucursal?: Sucursal         // joined when needed
  activo: boolean
  created_at: string
}

export interface Product {
  id: string
  nombre: string
  precio_por_unidad: number
  unidad: 'kg' | 'g' | 'pieza'
  categoria: string | null
  activo: boolean
  // precio_compra is only visible to admin/encargado (hidden from cajero in UI)
  precio_compra: number | null
  // stock_minimo: kg threshold that triggers reorder alert. NULL = no minimum set.
  stock_minimo: number | null
  sucursal_id: string | null
  created_at: string
}

// An item in the active cart (client-side only, not persisted)
export interface CartItem {
  // Unique key per cart row — product.id + timestamp to allow same product twice
  id: string
  product: Product
  cantidad: number         // in the product's native unit (kg, g, or piezas)
  precio_unitario: number  // may be reduced by an active promo
  subtotal: number
  promo?: PromoAplicada    // set when a promo is active for this item
}

export interface Venta {
  id: string
  total: number
  descuento: number              // discount applied at checkout (0 = none)
  metodo_pago: string
  sucursal_id: string | null
  cajero_id: string | null
  created_at: string
}

export interface VentaItem {
  id: string
  venta_id: string
  product_id: string
  nombre_producto: string
  cantidad: number
  unidad: string
  precio_unitario: number
  subtotal: number
  lote_id: string | null      // null for 'pieza' products
  created_at: string
}

// Individual payment row for split (mixed) payments
export interface VentaPago {
  id: string
  venta_id: string
  metodo: 'efectivo' | 'tarjeta' | 'transferencia'
  monto: number
  created_at: string
}

// Venta with its items joined — used in historial page
export interface VentaWithItems extends Venta {
  venta_items: VentaItem[]
  venta_pagos?: VentaPago[]
  // Count of return records — fetched as devoluciones(count) in historial
  devoluciones?: { count: number }[]
}

// ── Promociones ───────────────────────────────────────────────────────────────

export type PromoTipo = 'descuento' | 'combo'
export type PromoAplicaA = 'producto' | 'categoria' | 'todos'
export type PromoDescuentoTipo = 'porcentaje' | 'monto' | 'precio_fijo'

export interface Promocion {
  id: string
  nombre: string
  descripcion: string | null
  tipo: PromoTipo
  activo: boolean
  sucursal_id: string

  // Descuento: scope
  aplica_a: PromoAplicaA | null
  product_id: string | null
  categoria: string | null

  // Discount amount (shared by descuento and combo)
  descuento_tipo: PromoDescuentoTipo | null
  descuento_valor: number | null

  // Combo
  trigger_product_id: string | null
  trigger_cantidad_min: number
  target_product_id: string | null

  // Time window
  hora_inicio: string | null    // 'HH:MM:SS'
  hora_fin: string | null
  dias_semana: number[] | null  // 0=Dom, 1=Lun, ..., 6=Sab
  fecha_inicio: string | null   // YYYY-MM-DD
  fecha_fin: string | null

  created_at: string
  updated_at: string

  // Joined (optional)
  product?: Pick<Product, 'id' | 'nombre' | 'unidad'>
  trigger_product?: Pick<Product, 'id' | 'nombre' | 'unidad'>
  target_product?: Pick<Product, 'id' | 'nombre' | 'unidad'>
}

// Applied to a CartItem when a promo is active
export interface PromoAplicada {
  promo_id: string
  nombre: string
  precio_original: number
  descuento_aplicado: number   // amount saved in pesos
}

// ── Corte de caja ─────────────────────────────────────────────────────────────

export interface Corte {
  id: string
  sucursal_id: string
  cajero_id: string | null
  fecha: string                       // YYYY-MM-DD
  efectivo_sistema: number
  tarjeta_sistema: number
  transferencia_sistema: number
  total_sistema: number               // generated
  efectivo_contado: number | null
  diferencia: number | null           // generated: contado - sistema
  notas: string | null
  // Cash movement snapshots (populated when corte is saved)
  fondo_inicial: number
  total_gastos: number
  total_retiros: number
  total_devoluciones: number
  created_at: string
  updated_at: string
}

// ── Movimientos de caja ───────────────────────────────────────────────────────

export type MovimientoTipo = 'fondo_inicial' | 'gasto' | 'retiro'

export interface MovimientoCaja {
  id: string
  sucursal_id: string
  tipo: MovimientoTipo
  monto: number
  descripcion: string | null
  registrado_por: string | null
  fecha: string                       // YYYY-MM-DD
  created_at: string
}

// ── Devoluciones (Returns) ────────────────────────────────────────────────────

export interface Devolucion {
  id: string
  venta_id: string
  sucursal_id: string
  procesado_por: string | null
  monto_devuelto: number
  motivo: string | null
  reintegrar_inventario: boolean
  metodo_devolucion: 'efectivo' | 'tarjeta' | 'transferencia'
  fecha: string                 // YYYY-MM-DD
  created_at: string
}

export interface DevolucionItem {
  id: string
  devolucion_id: string
  venta_item_id: string
  cantidad_devuelta: number
  monto_devuelto: number
  lote_id: string | null
}

// ── Inventory / Lotes & Mermas ────────────────────────────────────────────────

export interface Lote {
  id: string
  product_id: string
  sucursal_id: string
  fecha_entrada: string          // ISO date "YYYY-MM-DD"
  cantidad_inicial: number       // kg entered
  cantidad_disponible: number    // kg remaining (initial - sold - wasted)
  costo_por_unidad: number | null
  proveedor: string | null
  notas: string | null
  creado_por: string | null
  created_at: string
  // Joined
  product?: Pick<Product, 'id' | 'nombre' | 'unidad'>
}

export type MotivoMerma = 'Podrido' | 'Dañado' | 'Caducado' | 'Robo' | 'Otro'

export interface Merma {
  id: string
  lote_id: string
  product_id: string
  sucursal_id: string
  fecha: string
  cantidad: number               // kg wasted
  motivo: MotivoMerma | null
  notas: string | null
  foto_url: string | null        // evidence photo — required for cajero role
  registrado_por: string | null
  created_at: string
  // Joined
  lote?: Pick<Lote, 'id' | 'fecha_entrada' | 'cantidad_inicial'>
  product?: Pick<Product, 'id' | 'nombre' | 'unidad'>
}
