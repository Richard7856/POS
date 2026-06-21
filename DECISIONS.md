# DECISIONS — POS Verde

Registro de decisiones de arquitectura y diseño del proyecto. Sirve como memoria
entre sesiones: **antes de construir algo nuevo, lee este archivo.**

> Convención del repo (ver `AGENTS.md`): esta versión de Next.js tiene *breaking
> changes*. Lee la guía relevante en `node_modules/next/dist/docs/` antes de
> escribir código — no asumas APIs de memoria.

---

## 1. Resumen

POS Verde es un punto de venta para una verdulería/frutería con productos vendidos
por peso (`kg`/`g`) y por `pieza`. Soporta múltiples sucursales, roles de usuario,
inventario por lotes, mermas, promociones, corte de caja y operación **offline**.

## 2. Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.2.1 |
| UI | React | 19.2.4 |
| Lenguaje | TypeScript (strict) | 5.x |
| Estilos | Tailwind CSS | 4 |
| Backend | Supabase (Auth + Postgres 17 + Storage + Edge Functions) | js 2.x |
| Hardware | Web Bluetooth (báscula) · `BarcodeDetector` API (escáner) | — |
| Deploy | Vercel (Node 22.x, pinned vía `engines`) | — |

- **Proyecto Supabase:** `POS Verde` (`phwgollktjbxmtoifeps`, región `sa-east-1`).
- **Proyecto Vercel:** `pos-verde` (team `Richard's projects`). Despliega desde `main`.

## 3. Decisiones de arquitectura

### 3.1 Data fetching 100% del lado del cliente
Todas las páginas se prerenderizan estáticas (`○ Static`); los datos se cargan en
`useEffect` con el cliente de Supabase. `src/lib/supabase.ts` usa URL/key
*placeholder* como fallback para que `createClient` no truene durante el
prerender estático. **No hay Server Components que consulten la BD ni Route
Handlers.** Implicación: las variables `NEXT_PUBLIC_SUPABASE_*` deben existir en
el entorno (Vercel) y, para correr local, en un `.env.local` (no versionado).

### 3.2 Cliente Supabase singleton
Un único cliente exportado (`src/lib/supabase.ts`) con `persistSession`,
`autoRefreshToken` y `detectSessionInUrl`. La sesión vive en `localStorage`.

### 3.3 Auth, roles y caché de perfil
- `AuthContext` (`src/context/AuthContext.tsx`) expone `user`, `profile`, `signIn`, `signOut`.
- El **perfil se cachea en `localStorage`** (`pos_profile_v1`) y se sirve al instante;
  se refresca en segundo plano. Esto elimina el spinner del `RouteGuard`.
- **Roles:** `admin`, `encargado`, `cajero` (columna `profiles.rol`).
- El control de acceso por rol es **a nivel UI** (ej.: `precio_compra` se oculta al
  cajero en la interfaz, no en la query). Ver §5 sobre RLS.

### 3.4 Multi-sucursal
`sucursal_id` en `profiles`, `products`, `ventas`, `lotes`, `promociones`, etc.
admin ve todas las sucursales; encargado/cajero se acotan a la suya.

### 3.5 Offline-first (POS y Productos)
- `productCache` (`src/lib/productCache.ts`): cachea productos en `localStorage`
  (`pos_products_v1`) y los sirve de inmediato sin importar la red.
- `offlineQueue` (`src/lib/offlineQueue.ts`): encola `insert`/`update` pendientes
  (`pos_offline_queue_v1`). **UUIDs generados en el cliente** para los inserts (la
  fila tiene su ID final antes de llegar al server, sin swap de temp-id). Cada op
  se procesa independiente: las exitosas se borran, las fallidas se reintentan.
- `SyncProvider` (`src/components/SyncProvider.tsx`): banner "Sin conexión",
  contador de pendientes, y al volver `online` llama `syncQueue()` + toast.

### 3.6 Tipos manuales + convención `.select('*')`
- Los tipos del dominio están **escritos a mano** en `src/lib/types.ts` (NO se usa
  `generate_typescript_types`). Riesgo: pueden desincronizarse del esquema real.
- **Aprendizaje (ver §8):** las queries que llenan un estado `Product[]` deben usar
  `.select('*')`, **no** listas de columnas explícitas. Las listas explícitas
  rompían el build cada vez que se agregaba una columna al tipo `Product`.

### 3.7 Motor de promociones
Tipos `descuento` y `combo`; alcance por producto/categoría/todos; ventanas por
hora, día de semana y rango de fechas. Hook `src/hooks/usePromociones.ts`.

### 3.8 Inventario
- `lotes`: entradas por lote con conciencia FIFO (`cantidad_disponible`). Solo
  productos por peso (`kg`/`g`).
- `mermas`: desperdicio con motivo; **foto de evidencia obligatoria para cajero**
  (bucket `merma-fotos`).
- `pedido`: sugerencia de reorden según `stock_minimo`.

### 3.9 Caja
- `cortes`: arqueo/conciliación (sistema vs contado).
- `movimientos_caja`: `fondo_inicial`, `gasto`, `retiro`.
- `venta_pagos`: pagos divididos (efectivo/tarjeta/transferencia).
- `devoluciones` + `devolucion_items`: reembolsos con reintegro opcional de inventario.

### 3.10 Hardware
- Báscula vía **Web Bluetooth** (`useBluetoothScale.ts`). Soporta GATT y Nordic
  UART Service (B03H), y báscula por *advertisement* (Etekcity, company ID `0x06D0`).
  Histórico de muchos *fixes* por inconsistencias del Chrome de Android.
- Escáner de código de barras con la API nativa `BarcodeDetector` (cámara trasera),
  con *fallback* si el navegador no la soporta.

## 4. Base de datos

- **Esquema gestionado por migraciones de Supabase (16 aplicadas)**, p. ej.
  `initial_schema`, `add_sucursales_and_profiles`, `enable_rls_and_policies`,
  `add_lotes_mermas`, `add_promociones`, `add_devoluciones`,
  `add_performance_indexes`, `add_ean_to_products`.
- ⚠️ **Las migraciones NO están versionadas en el repo.** En git solo vive la edge
  function `supabase/functions/create-user`. El esquema vive únicamente en el
  proyecto remoto. (Riesgo — ver §9.)
- **Funciones helper** (todas `SECURITY DEFINER`): `handle_new_user()` (trigger que
  crea el `profile` al registrarse), `my_rol()`, `my_sucursal_id()`.

## 5. Seguridad / RLS — estado actual

RLS está **habilitado en las 14 tablas**, pero el modelo actual es permisivo:

- ⚠️ Políticas **`allow_all` (USING true / WITH CHECK true)** en `products`,
  `ventas` y `venta_items` → cualquiera con el anon key puede leer/escribir. Hoy la
  seguridad recae en la capa de app/auth, **no en la BD**. Aceptable para MVP;
  endurecer antes de producción real.
- Advisors pendientes (Supabase linter), todos nivel WARN:
  - `merma-fotos`: bucket público permite *listing* de archivos.
  - `search_path` mutable en `handle_new_user`, `my_rol`, `my_sucursal_id`.
  - Funciones `SECURITY DEFINER` ejecutables por `anon`/`authenticated`.
  - Tablas expuestas en el esquema GraphQL a `anon`/`authenticated`.
  - Protección de contraseñas filtradas (HaveIBeenPwned) **desactivada** en Auth.

## 6. Deploy

- `main` → Vercel despliega a producción automáticamente.
- El build corre **type-check estricto** (no hay `ignoreBuildErrors`): **un error de
  TypeScript bloquea el deploy.**
- `tsconfig.json` excluye `supabase/functions` del type-check de Next.
- Node fijado a `22.x` vía `engines`. `turbopack.root` fijado en `next.config.ts`.

## 7. Convenciones

- Mensajes de commit en español, estilo `tipo(scope): descripción` (ej.
  `fix(scale): ...`, `feat(offline): ...`).
- Trabajo de features en ramas `claude/*`; merge a `main` solo con autorización.
- Para lecturas de productos que llenan `Product[]`: usar `.select('*')` (§3.6).

## 8. Aprendizajes / *post-mortems*

- **Build roto por `ean` (2026-06-21):** al agregar `ean` (requerido) al tipo
  `Product`, tres queries con `.select()` explícito (`promociones`, `lotes`,
  `merma`) dejaron de cumplir `Product[]` y rompieron el `next build`. Los **dos
  últimos deploys de producción quedaron en ERROR** sin que se notara. Fix: cambiar
  esas queries a `.select('*')`. Esta clase de bug ya había ocurrido varias veces
  (commits `becb717`, `6947a2d`, `cb2165d`). **Regla:** no usar listas de columnas
  explícitas para reads de `Product` completo.

## 9. Pendientes / riesgos conocidos

- [ ] **Esquema no versionado en git** — considerar exportar las migraciones de
      Supabase al repo (`supabase/migrations/`) para que el esquema viaje con el código.
- [ ] **RLS permisiva** — reemplazar las políticas `allow_all` por políticas reales
      por rol/sucursal antes de producción real.
- [ ] Resolver advisors de seguridad de §5 (search_path, bucket listing, anon EXECUTE,
      leaked-password protection).
- [ ] **Ventas offline en el POS** — verificar el flujo de venta completo sin red
      (la cola soporta insert/update; falta validar checkout end-to-end).
- [ ] Considerar generar `types.ts` desde el esquema en vez de mantenerlo a mano.
- [ ] No hay tests automatizados ni CI de type-check previo al deploy (el primer
      lugar donde se detecta un error de tipos es Vercel).

## 10. Registro de sesiones

### 2026-06-21
- Verificada la conexión a la BD: `ACTIVE_HEALTHY`, 16 migraciones, datos semilla
  (1 admin `prueba@gmail.com`, sucursal "Principal", 14 productos).
- Detectados y corregidos los deploys de producción en ERROR (fix de `ean`, §8).
  Merge a `main` → re-deploy. Creado este `DECISIONS.md`.
