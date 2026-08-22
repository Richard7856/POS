-- ═══════════════════════════════════════════════════════════════════════════
-- Compra por bulto: comprar en una unidad y vender en otra
--
-- Caso real: el cilantro llega en manojo grande a $35 y de ahí salen entre 20
-- y 30 manojos chicos que se venden por pieza. El costo por manojo chico no es
-- un dato que el encargado deba calcular a mano cada vez — y menos cuando el
-- rendimiento varía de un bulto a otro.
--
-- Se guarda cómo se compró (bultos × costo) y cuánto rindió (cantidad_inicial).
-- De ahí sale costo_por_unidad = (bultos × costo_por_bulto) / cantidad_inicial,
-- que es el costo real de lo que se vende. Guardarlo —y no sólo el resultado—
-- deja ver después a qué precio venía el bulto y cuánto rindió de verdad.
--
-- NULL en las tres = entrada capturada directo en la unidad de venta.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.lotes
  add column bultos          numeric(12,3),
  add column costo_por_bulto numeric(12,2),
  add column unidad_bulto    text;

comment on column public.lotes.bultos is
  'Cuántos bultos se compraron (cajas, manojos grandes, arpillas). NULL si se capturó por unidad de venta.';
comment on column public.lotes.costo_por_bulto is
  'Lo que costó cada bulto. El costo unitario se deriva del rendimiento.';
comment on column public.lotes.unidad_bulto is
  'Cómo se le llama al bulto: "manojo grande", "caja", "arpilla"...';
