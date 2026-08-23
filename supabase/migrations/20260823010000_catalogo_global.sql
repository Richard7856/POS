-- ═══════════════════════════════════════════════════════════════════════════
-- El catálogo de productos es GLOBAL; el inventario y la caja son por sucursal
--
-- Modelo para crecer a varias tiendas:
--   · products     → una sola lista para todas las sucursales (mismo nombre,
--                    mismo EAN, mismo precio hoy; un override de precio por
--                    sucursal sería una tabla aparte el día que haga falta)
--   · lotes/mermas/ajustes → SIEMPRE de una sucursal
--   · ventas/cortes/movimientos_caja → SIEMPRE de una sucursal (una caja por
--                    tienda: cortes ya es único por sucursal_id + fecha)
--
-- products.sucursal_id existía pero nada lo leía y se escribía inconsistente
-- (null desde el alta online, la sucursal del perfil desde el alta offline).
-- Se normaliza a NULL y queda reservado para un futuro "producto exclusivo de
-- una tienda"; NULL = visible en todas.
-- ═══════════════════════════════════════════════════════════════════════════

update public.products set sucursal_id = null;

comment on column public.products.sucursal_id is
  'NULL = producto del catálogo global (todas las sucursales). Reservado para productos exclusivos de una tienda; hoy nada lo filtra.';
