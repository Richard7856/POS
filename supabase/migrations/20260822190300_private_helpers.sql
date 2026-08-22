-- ═══════════════════════════════════════════════════════════════════════════
-- Mover los helpers de RLS a un esquema privado
--
-- Motivo: PostgREST expone TODA función del esquema `public` como endpoint
-- /rest/v1/rpc/<fn>. Los helpers son SECURITY DEFINER, así que dejarlos ahí
-- los volvía invocables desde el navegador (advisors 0028 y 0029).
-- `private` no está en los esquemas expuestos, así que dejan de ser alcanzables
-- por la API pero siguen sirviendo dentro de las políticas.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;   -- requerido para evaluar las políticas

-- ── Helpers (mismos cuerpos, ahora en private) ────────────────────────────
create or replace function private.current_rol()
returns text language sql stable security definer
set search_path = public, pg_temp
as $$ select rol from public.profiles where id = (select auth.uid()) $$;

create or replace function private.current_sucursal()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select sucursal_id from public.profiles where id = (select auth.uid()) $$;

create or replace function private.is_admin()
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select coalesce(private.current_rol() = 'admin', false) $$;

create or replace function private.is_staff()
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select coalesce(private.current_rol() in ('admin','encargado'), false) $$;

create or replace function private.can_see_sucursal(target uuid)
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select private.is_admin() or target is null or target = private.current_sucursal() $$;

create or replace function private.venta_sucursal(v_id uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select sucursal_id from public.ventas where id = v_id $$;

create or replace function private.devolucion_sucursal(d_id uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select sucursal_id from public.devoluciones where id = d_id $$;

-- ── Funciones de trigger (tampoco tienen por qué ser invocables) ──────────
create or replace function private.touch_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    'cajero'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created      on auth.users;
drop trigger if exists cortes_touch_updated_at   on public.cortes;
drop trigger if exists promociones_touch_updated_at on public.promociones;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger cortes_touch_updated_at
  before update on public.cortes
  for each row execute function private.touch_updated_at();
create trigger promociones_touch_updated_at
  before update on public.promociones
  for each row execute function private.touch_updated_at();

-- ── Recrear las políticas apuntando a private.* ───────────────────────────
drop policy if exists sucursales_write on public.sucursales;
create policy sucursales_write on public.sucursales
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_write  on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()) or private.is_admin());
create policy profiles_write on public.profiles
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists products_delete on public.products;
create policy products_delete on public.products
  for delete to authenticated using (private.is_staff());

drop policy if exists lotes_select on public.lotes;
drop policy if exists lotes_insert on public.lotes;
drop policy if exists lotes_update on public.lotes;
drop policy if exists lotes_delete on public.lotes;
create policy lotes_select on public.lotes
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy lotes_insert on public.lotes
  for insert to authenticated
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));
create policy lotes_update on public.lotes
  for update to authenticated
  using (private.can_see_sucursal(sucursal_id))
  with check (private.can_see_sucursal(sucursal_id));
create policy lotes_delete on public.lotes
  for delete to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id));

drop policy if exists mermas_select on public.mermas;
drop policy if exists mermas_insert on public.mermas;
drop policy if exists mermas_modify on public.mermas;
drop policy if exists mermas_delete on public.mermas;
create policy mermas_select on public.mermas
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy mermas_insert on public.mermas
  for insert to authenticated with check (private.can_see_sucursal(sucursal_id));
create policy mermas_modify on public.mermas
  for update to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id))
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));
create policy mermas_delete on public.mermas
  for delete to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id));

drop policy if exists ajustes_select on public.ajustes_inventario;
drop policy if exists ajustes_insert on public.ajustes_inventario;
create policy ajustes_select on public.ajustes_inventario
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy ajustes_insert on public.ajustes_inventario
  for insert to authenticated
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));

drop policy if exists ventas_select on public.ventas;
drop policy if exists ventas_insert on public.ventas;
drop policy if exists ventas_update on public.ventas;
drop policy if exists ventas_delete on public.ventas;
create policy ventas_select on public.ventas
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy ventas_insert on public.ventas
  for insert to authenticated with check (private.can_see_sucursal(sucursal_id));
create policy ventas_update on public.ventas
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy ventas_delete on public.ventas
  for delete to authenticated using (private.is_admin());

drop policy if exists venta_items_select on public.venta_items;
drop policy if exists venta_items_insert on public.venta_items;
drop policy if exists venta_items_admin  on public.venta_items;
create policy venta_items_select on public.venta_items
  for select to authenticated
  using (private.can_see_sucursal(private.venta_sucursal(venta_id)));
create policy venta_items_insert on public.venta_items
  for insert to authenticated
  with check (private.can_see_sucursal(private.venta_sucursal(venta_id)));
create policy venta_items_admin on public.venta_items
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists venta_pagos_select on public.venta_pagos;
drop policy if exists venta_pagos_insert on public.venta_pagos;
drop policy if exists venta_pagos_admin  on public.venta_pagos;
create policy venta_pagos_select on public.venta_pagos
  for select to authenticated
  using (private.can_see_sucursal(private.venta_sucursal(venta_id)));
create policy venta_pagos_insert on public.venta_pagos
  for insert to authenticated
  with check (private.can_see_sucursal(private.venta_sucursal(venta_id)));
create policy venta_pagos_admin on public.venta_pagos
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists devoluciones_select on public.devoluciones;
drop policy if exists devoluciones_insert on public.devoluciones;
drop policy if exists devoluciones_admin  on public.devoluciones;
create policy devoluciones_select on public.devoluciones
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy devoluciones_insert on public.devoluciones
  for insert to authenticated
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));
create policy devoluciones_admin on public.devoluciones
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists devolucion_items_select on public.devolucion_items;
drop policy if exists devolucion_items_insert on public.devolucion_items;
drop policy if exists devolucion_items_admin  on public.devolucion_items;
create policy devolucion_items_select on public.devolucion_items
  for select to authenticated
  using (private.can_see_sucursal(private.devolucion_sucursal(devolucion_id)));
create policy devolucion_items_insert on public.devolucion_items
  for insert to authenticated
  with check (private.is_staff()
              and private.can_see_sucursal(private.devolucion_sucursal(devolucion_id)));
create policy devolucion_items_admin on public.devolucion_items
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists movimientos_select on public.movimientos_caja;
drop policy if exists movimientos_insert on public.movimientos_caja;
drop policy if exists movimientos_modify on public.movimientos_caja;
drop policy if exists movimientos_delete on public.movimientos_caja;
create policy movimientos_select on public.movimientos_caja
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy movimientos_insert on public.movimientos_caja
  for insert to authenticated with check (private.can_see_sucursal(sucursal_id));
create policy movimientos_modify on public.movimientos_caja
  for update to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id))
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));
create policy movimientos_delete on public.movimientos_caja
  for delete to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id));

drop policy if exists cortes_select on public.cortes;
drop policy if exists cortes_insert on public.cortes;
drop policy if exists cortes_update on public.cortes;
drop policy if exists cortes_delete on public.cortes;
create policy cortes_select on public.cortes
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy cortes_insert on public.cortes
  for insert to authenticated
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));
create policy cortes_update on public.cortes
  for update to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id))
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));
create policy cortes_delete on public.cortes
  for delete to authenticated using (private.is_admin());

drop policy if exists promociones_select on public.promociones;
drop policy if exists promociones_write  on public.promociones;
create policy promociones_select on public.promociones
  for select to authenticated using (private.can_see_sucursal(sucursal_id));
create policy promociones_write on public.promociones
  for all to authenticated
  using (private.is_staff() and private.can_see_sucursal(sucursal_id))
  with check (private.is_staff() and private.can_see_sucursal(sucursal_id));

-- Storage
drop policy if exists merma_fotos_update on storage.objects;
drop policy if exists merma_fotos_delete on storage.objects;
create policy merma_fotos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'merma-fotos' and private.is_staff())
  with check (bucket_id = 'merma-fotos' and private.is_staff());
create policy merma_fotos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'merma-fotos' and private.is_staff());

-- ── Retirar los helpers del esquema expuesto ──────────────────────────────
drop function if exists public.current_rol();
drop function if exists public.current_sucursal();
drop function if exists public.is_admin();
drop function if exists public.is_staff();
drop function if exists public.can_see_sucursal(uuid);
drop function if exists public.venta_sucursal(uuid);
drop function if exists public.devolucion_sucursal(uuid);
drop function if exists public.handle_new_user();
drop function if exists public.touch_updated_at();
