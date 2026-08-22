-- ═══════════════════════════════════════════════════════════════════════════
-- Bucket de fotos de merma
--
-- La app sube la evidencia a `merma-fotos` y guarda la URL pública en
-- mermas.foto_url (ver src/app/(protected)/inventario/merma/page.tsx).
-- Ruta: {sucursal_id}/{YYYY-MM-DD}/{timestamp}.{ext}
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('merma-fotos', 'merma-fotos', true)
on conflict (id) do nothing;

-- Lectura pública: getPublicUrl() se usa directo en <img> del historial de merma.
create policy merma_fotos_public_read on storage.objects
  for select to public
  using (bucket_id = 'merma-fotos');

-- Cualquier usuario autenticado puede subir evidencia (el cajero está obligado).
create policy merma_fotos_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'merma-fotos');

-- Borrar/reemplazar evidencia: solo staff.
create policy merma_fotos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'merma-fotos' and public.is_staff())
  with check (bucket_id = 'merma-fotos' and public.is_staff());

create policy merma_fotos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'merma-fotos' and public.is_staff());
