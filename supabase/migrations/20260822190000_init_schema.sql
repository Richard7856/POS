-- ═══════════════════════════════════════════════════════════════════════════
-- POS Verde — esquema inicial
--
-- Reconstruido a partir de las queries de la app (src/**). Este archivo es la
-- fuente de verdad del esquema: cualquier cambio futuro va en una migración
-- nueva, nunca editando el dashboard a mano.
--
-- Convenciones de tipos:
--   cantidades (kg/g/piezas) → numeric(14,6)   (el FIFO redondea a 6 decimales)
--   precios unitarios        → numeric(12,4)   (permite precio por gramo)
--   montos de dinero         → numeric(12,2)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Sucursales ────────────────────────────────────────────────────────────
create table public.sucursales (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  direccion  text,
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Profiles (1-a-1 con auth.users) ───────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text,
  rol         text not null default 'cajero' check (rol in ('admin','encargado','cajero')),
  sucursal_id uuid references public.sucursales(id) on delete set null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index profiles_sucursal_idx on public.profiles (sucursal_id);

-- ── Productos ─────────────────────────────────────────────────────────────
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  precio_por_unidad numeric(12,4) not null default 0,
  unidad            text not null default 'kg' check (unidad in ('kg','g','pieza')),
  categoria         text,
  activo            boolean not null default true,
  ean               text,
  precio_compra     numeric(12,4),
  stock_minimo      numeric(14,6),
  sucursal_id       uuid references public.sucursales(id) on delete set null,
  created_at        timestamptz not null default now()
);
-- El escáner busca por EAN: índice no único a propósito, para no romper la
-- captura si dos filas comparten código (p.ej. mismo producto en 2 sucursales).
create index products_ean_idx      on public.products (ean) where ean is not null;
create index products_activo_idx   on public.products (activo) where activo;
create index products_minimo_idx   on public.products (stock_minimo) where stock_minimo is not null;

-- ── Lotes (inventario a granel, FIFO) ─────────────────────────────────────
create table public.lotes (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products(id) on delete cascade,
  sucursal_id         uuid references public.sucursales(id) on delete cascade,
  fecha_entrada       date not null default current_date,
  cantidad_inicial    numeric(14,6) not null default 0,
  cantidad_disponible numeric(14,6) not null default 0,
  costo_por_unidad    numeric(12,4),
  proveedor           text,
  notas               text,
  creado_por          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  -- La página de lotes hace upsert con onConflict sobre estas 3 columnas
  constraint lotes_producto_sucursal_fecha_key unique (product_id, sucursal_id, fecha_entrada)
);
create index lotes_disponibles_idx on public.lotes (sucursal_id, product_id, fecha_entrada)
  where cantidad_disponible > 0;

-- ── Mermas ────────────────────────────────────────────────────────────────
create table public.mermas (
  id             uuid primary key default gen_random_uuid(),
  lote_id        uuid not null references public.lotes(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  sucursal_id    uuid references public.sucursales(id) on delete cascade,
  fecha          date not null default current_date,
  cantidad       numeric(14,6) not null,
  motivo         text check (motivo in ('Podrido','Dañado','Caducado','Robo','Otro')),
  notas          text,
  foto_url       text,
  registrado_por uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index mermas_sucursal_fecha_idx on public.mermas (sucursal_id, created_at desc);

-- ── Ajustes manuales de inventario (auditoría) ────────────────────────────
create table public.ajustes_inventario (
  id                uuid primary key default gen_random_uuid(),
  lote_id           uuid not null references public.lotes(id) on delete cascade,
  sucursal_id       uuid references public.sucursales(id) on delete cascade,
  cantidad_anterior numeric(14,6) not null,
  cantidad_nueva    numeric(14,6) not null,
  motivo            text,
  ajustado_por      uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index ajustes_lote_idx on public.ajustes_inventario (lote_id, created_at desc);

-- ── Ventas ────────────────────────────────────────────────────────────────
create table public.ventas (
  id          uuid primary key default gen_random_uuid(),
  total       numeric(12,2) not null default 0,
  descuento   numeric(12,2) not null default 0,
  metodo_pago text not null default 'efectivo'
              check (metodo_pago in ('efectivo','tarjeta','transferencia','mixto')),
  sucursal_id uuid references public.sucursales(id) on delete set null,
  cajero_id   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index ventas_sucursal_fecha_idx on public.ventas (sucursal_id, created_at desc);
create index ventas_fecha_idx          on public.ventas (created_at desc);

create table public.venta_items (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  nombre_producto text not null,
  cantidad        numeric(14,6) not null,
  unidad          text not null,
  precio_unitario numeric(12,4) not null,
  subtotal        numeric(12,2) not null,
  lote_id         uuid references public.lotes(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index venta_items_venta_idx    on public.venta_items (venta_id);
create index venta_items_producto_idx on public.venta_items (product_id);

-- Pagos individuales cuando metodo_pago = 'mixto'
create table public.venta_pagos (
  id         uuid primary key default gen_random_uuid(),
  venta_id   uuid not null references public.ventas(id) on delete cascade,
  metodo     text not null check (metodo in ('efectivo','tarjeta','transferencia')),
  monto      numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index venta_pagos_venta_idx on public.venta_pagos (venta_id);
create index venta_pagos_fecha_idx on public.venta_pagos (created_at);

-- ── Devoluciones ──────────────────────────────────────────────────────────
create table public.devoluciones (
  id                    uuid primary key default gen_random_uuid(),
  venta_id              uuid not null references public.ventas(id) on delete cascade,
  sucursal_id           uuid references public.sucursales(id) on delete set null,
  procesado_por         uuid references auth.users(id) on delete set null,
  monto_devuelto        numeric(12,2) not null,
  motivo                text,
  reintegrar_inventario boolean not null default false,
  metodo_devolucion     text not null default 'efectivo'
                        check (metodo_devolucion in ('efectivo','tarjeta','transferencia')),
  fecha                 date not null default current_date,
  created_at            timestamptz not null default now()
);
create index devoluciones_venta_idx    on public.devoluciones (venta_id);
create index devoluciones_sucursal_idx on public.devoluciones (sucursal_id, fecha);

create table public.devolucion_items (
  id                uuid primary key default gen_random_uuid(),
  devolucion_id     uuid not null references public.devoluciones(id) on delete cascade,
  venta_item_id     uuid references public.venta_items(id) on delete set null,
  cantidad_devuelta numeric(14,6) not null,
  monto_devuelto    numeric(12,2) not null,
  lote_id           uuid references public.lotes(id) on delete set null
);
create index devolucion_items_dev_idx on public.devolucion_items (devolucion_id);

-- ── Movimientos de caja ───────────────────────────────────────────────────
create table public.movimientos_caja (
  id             uuid primary key default gen_random_uuid(),
  sucursal_id    uuid references public.sucursales(id) on delete cascade,
  tipo           text not null check (tipo in ('fondo_inicial','gasto','retiro')),
  monto          numeric(12,2) not null,
  descripcion    text,
  registrado_por uuid references auth.users(id) on delete set null,
  fecha          date not null default current_date,
  created_at     timestamptz not null default now()
);
create index movimientos_sucursal_fecha_idx on public.movimientos_caja (sucursal_id, fecha);

-- ── Corte de caja ─────────────────────────────────────────────────────────
create table public.cortes (
  id                    uuid primary key default gen_random_uuid(),
  sucursal_id           uuid not null references public.sucursales(id) on delete cascade,
  cajero_id             uuid references auth.users(id) on delete set null,
  fecha                 date not null default current_date,
  efectivo_sistema      numeric(12,2) not null default 0,
  tarjeta_sistema       numeric(12,2) not null default 0,
  transferencia_sistema numeric(12,2) not null default 0,
  total_sistema         numeric(12,2)
                        generated always as
                        (efectivo_sistema + tarjeta_sistema + transferencia_sistema) stored,
  efectivo_contado      numeric(12,2),
  notas                 text,
  -- Snapshot de los movimientos del día (se congelan al guardar el corte)
  fondo_inicial         numeric(12,2) not null default 0,
  total_gastos          numeric(12,2) not null default 0,
  total_retiros         numeric(12,2) not null default 0,
  total_devoluciones    numeric(12,2) not null default 0,
  -- Misma fórmula que la app: contado − (ventas efectivo + fondo − gastos − retiros − devoluciones)
  -- Debe declararse después de las columnas que referencia.
  diferencia            numeric(12,2)
                        generated always as
                        (efectivo_contado - (efectivo_sistema + fondo_inicial
                          - total_gastos - total_retiros - total_devoluciones)) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- La página de corte hace upsert con onConflict sobre estas 2 columnas
  constraint cortes_sucursal_fecha_key unique (sucursal_id, fecha)
);

-- ── Promociones ───────────────────────────────────────────────────────────
create table public.promociones (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  descripcion          text,
  tipo                 text not null check (tipo in ('descuento','combo')),
  activo               boolean not null default true,
  sucursal_id          uuid not null references public.sucursales(id) on delete cascade,

  -- Alcance del descuento
  aplica_a             text check (aplica_a in ('producto','categoria','todos')),
  product_id           uuid references public.products(id) on delete cascade,
  categoria            text,

  descuento_tipo       text check (descuento_tipo in ('porcentaje','monto','precio_fijo')),
  descuento_valor      numeric(12,4),

  -- Combo: comprar trigger → descuento en target
  trigger_product_id   uuid references public.products(id) on delete cascade,
  trigger_cantidad_min numeric(14,6) not null default 1,
  target_product_id    uuid references public.products(id) on delete cascade,

  -- Ventana de vigencia
  hora_inicio          time,
  hora_fin             time,
  dias_semana          smallint[],   -- 0=Dom … 6=Sáb
  fecha_inicio         date,
  fecha_fin            date,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index promociones_sucursal_activo_idx on public.promociones (sucursal_id, activo);

-- ── updated_at automático ─────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cortes_touch_updated_at
  before update on public.cortes
  for each row execute function public.touch_updated_at();

create trigger promociones_touch_updated_at
  before update on public.promociones
  for each row execute function public.touch_updated_at();

-- ── Alta automática de profile al crear un usuario en auth ────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    'cajero'   -- rol mínimo por defecto; la Edge Function lo eleva si aplica
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
