-- ═══════════════════════════════════════════════════════════════════════════
-- Ganancia automática: cada renglón de venta guarda a qué costo salió
--
-- El costo se congela al momento de cobrar (promedio ponderado de los lotes
-- FIFO que surtieron el renglón, o precio_compra del producto para piezas).
-- Congelarlo importa: si mañana cambia el costo del producto, la ganancia de
-- las ventas de hoy no debe moverse.
--
-- costo_unitario está en la unidad nativa del renglón (por kg, por g o por
-- pieza), igual que precio_unitario, así que:
--   ganancia del renglón = subtotal − costo_unitario × cantidad
-- NULL = costo desconocido (lote sin costo y producto sin precio_compra);
-- esos renglones se excluyen del cálculo de ganancia en lugar de inventarla.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.venta_items
  add column costo_unitario numeric(12,4);
