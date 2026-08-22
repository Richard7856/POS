-- ═══════════════════════════════════════════════════════════════════════════
-- POS Verde — Row Level Security
--
-- Modelo: la app es interna y accede al Postgres directo desde el navegador con
-- la anon key, así que RLS es la ÚNICA barrera real. Reglas:
--
--   admin      → todas las sucursales, todo
--   encargado  → solo su sucursal; puede inventario, cortes, promos, devoluciones
--   cajero     → solo su sucursal; vende, registra merma y gastos
--   anon       → nada (la app exige login)
--
-- El alcance por sucursal refleja lo que la UI ya hace (todas las queries de
-- roles no-admin filtran por sucursal_id), así que no cambia el comportamiento.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helpers ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER para leer profiles sin disparar recursión de políticas.

create or replace function public.current_rol()
returns text language sql stable security definer
set search_path = public, pg_temp
as $$ select rol from public.profiles where id = (select auth.uid()) $$;

create or replace function public.current_sucursal()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select sucursal_id from public.profiles where id = (select auth.uid()) $$;

create or replace function public.is_admin()
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select coalesce(public.current_rol() = 'admin', false) $$;

create or replace function public.is_staff()
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select coalesce(public.current_rol() in ('admin','encargado'), false) $$;

-- true si el usuario puede ver/tocar filas de esa sucursal
create or replace function public.can_see_sucursal(target uuid)
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select public.is_admin() or target is null or target = public.current_sucursal() $$;

-- Tablas hijas sin sucursal_id propia: se resuelve por el padre.
create or replace function public.venta_sucursal(v_id uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select sucursal_id from public.ventas where id = v_id $$;

create or replace function public.devolucion_sucursal(d_id uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select sucursal_id from public.devoluciones where id = d_id $$;

-- ── Habilitar RLS en todo ─────────────────────────────────────────────────
alter table public.sucursales        enable row level security;
alter table public.profiles          enable row level security;
alter table public.products          enable row level security;
alter table public.lotes             enable row level security;
alter table public.mermas            enable row level security;
alter table public.ajustes_inventario enable row level security;
alter table public.ventas            enable row level security;
alter table public.venta_items       enable row level security;
alter table public.venta_pagos       enable row level security;
alter table public.devoluciones      enable row level security;
alter table public.devolucion_items  enable row level security;
alter table public.movimientos_caja  enable row level security;
alter table public.cortes            enable row level security;
alter table public.promociones       enable row level security;

-- ── Sucursales ────────────────────────────────────────────────────────────
-- Lectura para todos: el Navbar y los selectores las necesitan.
create policy sucursales_select on public.sucursales
  for select to authenticated using (true);
create policy sucursales_write on public.sucursales
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Profiles ──────────────────────────────────────────────────────────────
-- Cada quien ve el suyo; el admin ve todos (pantalla de usuarios).
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_write on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Products ──────────────────────────────────────────────────────────────
-- Catálogo global: cualquier rol puede leer y capturar (la UI solo oculta el
-- costo al cajero). Solo staff puede borrar.
create policy products_select on public.products
  for select to authenticated using (true);
create policy products_insert on public.products
  for insert to authenticated with check (true);
create policy products_update on public.products
  for update to authenticated using (true) with check (true);
create policy products_delete on public.products
  for delete to authenticated using (public.is_staff());

-- ── Lotes ─────────────────────────────────────────────────────────────────
-- OJO: el UPDATE lo necesita cualquier rol — el descuento FIFO del POS y la
-- reintegración por devolución escriben cantidad_disponible.
create policy lotes_select on public.lotes
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy lotes_insert on public.lotes
  for insert to authenticated
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
create policy lotes_update on public.lotes
  for update to authenticated
  using (public.can_see_sucursal(sucursal_id))
  with check (public.can_see_sucursal(sucursal_id));
create policy lotes_delete on public.lotes
  for delete to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id));

-- ── Mermas ────────────────────────────────────────────────────────────────
create policy mermas_select on public.mermas
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy mermas_insert on public.mermas
  for insert to authenticated with check (public.can_see_sucursal(sucursal_id));
create policy mermas_modify on public.mermas
  for update to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id))
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
create policy mermas_delete on public.mermas
  for delete to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id));

-- ── Ajustes de inventario (auditoría: solo alta y lectura) ────────────────
create policy ajustes_select on public.ajustes_inventario
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy ajustes_insert on public.ajustes_inventario
  for insert to authenticated
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));

-- ── Ventas ────────────────────────────────────────────────────────────────
create policy ventas_select on public.ventas
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy ventas_insert on public.ventas
  for insert to authenticated with check (public.can_see_sucursal(sucursal_id));
create policy ventas_update on public.ventas
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ventas_delete on public.ventas
  for delete to authenticated using (public.is_admin());

create policy venta_items_select on public.venta_items
  for select to authenticated
  using (public.can_see_sucursal(public.venta_sucursal(venta_id)));
create policy venta_items_insert on public.venta_items
  for insert to authenticated
  with check (public.can_see_sucursal(public.venta_sucursal(venta_id)));
create policy venta_items_admin on public.venta_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy venta_pagos_select on public.venta_pagos
  for select to authenticated
  using (public.can_see_sucursal(public.venta_sucursal(venta_id)));
create policy venta_pagos_insert on public.venta_pagos
  for insert to authenticated
  with check (public.can_see_sucursal(public.venta_sucursal(venta_id)));
create policy venta_pagos_admin on public.venta_pagos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Devoluciones (solo staff las procesa) ─────────────────────────────────
create policy devoluciones_select on public.devoluciones
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy devoluciones_insert on public.devoluciones
  for insert to authenticated
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
create policy devoluciones_admin on public.devoluciones
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy devolucion_items_select on public.devolucion_items
  for select to authenticated
  using (public.can_see_sucursal(public.devolucion_sucursal(devolucion_id)));
create policy devolucion_items_insert on public.devolucion_items
  for insert to authenticated
  with check (public.is_staff()
              and public.can_see_sucursal(public.devolucion_sucursal(devolucion_id)));
create policy devolucion_items_admin on public.devolucion_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Movimientos de caja (el cajero registra gastos) ───────────────────────
create policy movimientos_select on public.movimientos_caja
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy movimientos_insert on public.movimientos_caja
  for insert to authenticated with check (public.can_see_sucursal(sucursal_id));
create policy movimientos_modify on public.movimientos_caja
  for update to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id))
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
create policy movimientos_delete on public.movimientos_caja
  for delete to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id));

-- ── Cortes (upsert de staff: necesita insert Y update) ────────────────────
create policy cortes_select on public.cortes
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy cortes_insert on public.cortes
  for insert to authenticated
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
create policy cortes_update on public.cortes
  for update to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id))
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
create policy cortes_delete on public.cortes
  for delete to authenticated using (public.is_admin());

-- ── Promociones (el POS las lee; solo staff las edita) ────────────────────
create policy promociones_select on public.promociones
  for select to authenticated using (public.can_see_sucursal(sucursal_id));
create policy promociones_write on public.promociones
  for all to authenticated
  using (public.is_staff() and public.can_see_sucursal(sucursal_id))
  with check (public.is_staff() and public.can_see_sucursal(sucursal_id));
