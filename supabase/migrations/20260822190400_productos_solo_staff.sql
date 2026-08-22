-- ═══════════════════════════════════════════════════════════════════════════
-- El catálogo lo maneja solo el staff
--
-- Antes cualquier rol podía dar de alta y editar productos (solo se le ocultaba
-- el costo al cajero). El reparto de funciones acordado es:
--   admin / encargado → crean y modifican productos
--   cajero            → solo lo consulta desde el POS
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;

create policy products_insert on public.products
  for insert to authenticated
  with check (private.is_staff());

create policy products_update on public.products
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff());
