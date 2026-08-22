# 🌿 POS Verde

Punto de venta para frutería/verdulería con varias sucursales. Pensado para
tablet y móvil: venta a granel (kg/g) y por pieza, inventario por lotes con
FIFO, promociones, corte de caja y devoluciones.

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4
- **Supabase** — Postgres + Auth + Storage + 1 Edge Function
- Deploy en **Vercel**

Todo el acceso a datos ocurre en el cliente con la anon key: **RLS es la única
barrera de seguridad real**. Cualquier tabla nueva necesita sus políticas.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # y rellenar con los valores de Supabase
npm run dev
```

Variables requeridas (Supabase → Project Settings → API):

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |

Las mismas dos van en Vercel → Project Settings → Environment Variables.

## Base de datos

El esquema vive en `supabase/migrations/` y **esa es la fuente de verdad**.
Nunca se edita el esquema a mano desde el dashboard: cada cambio es una
migración nueva, para poder reconstruir el proyecto desde cero.

```
20260822190000_init_schema.sql       14 tablas, índices, triggers
20260822190100_rls.sql               políticas por rol y sucursal
20260822190200_storage_merma_fotos.sql  bucket de evidencia de merma
20260822190300_private_helpers.sql   helpers de RLS fuera del esquema expuesto
```

Aplicarlas a un proyecto nuevo:

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy create-user
```

### Roles

| Rol | Alcance |
|---|---|
| `admin` | todas las sucursales; usuarios, sucursales, promociones, ventas |
| `encargado` | solo su sucursal; inventario, cortes, promos, devoluciones, descuentos |
| `cajero` | solo su sucursal; vende, registra merma y gastos de caja |

El primer admin se crea a mano en la BD; a partir de ahí se dan de alta desde
`/admin/usuarios`, que llama a la Edge Function `create-user` (necesita el
service role, por eso no se hace desde el navegador).

## Pantallas

| Ruta | Qué hace | Quién |
|---|---|---|
| `/pos` | carrito, báscula Bluetooth, escáner EAN, promos | todos |
| `/productos` | catálogo, precios, EAN, stock mínimo | todos (costo solo staff) |
| `/historial` | ventas del día, ticket, devoluciones | todos |
| `/inventario/merma` | merma con foto de evidencia | todos |
| `/dashboard` | métricas | staff |
| `/inventario`, `/inventario/lotes`, `/inventario/pedido` | lotes FIFO, alertas, pedido sugerido | staff |
| `/historial/corte` | corte de caja | staff |
| `/admin/*` | usuarios, sucursales, promociones | admin |

## Notas de hardware

- **Báscula Bluetooth** (`useBluetoothScale`): Femmto BWS12, Arboleaf QN-KS,
  Etekcity y Assistrus B03H (Nordic UART). Requiere Web Bluetooth → Chrome.
- **Escáner EAN**: `BarcodeDetector` nativo, con captura manual como respaldo.

## Modo offline

`productCache` guarda el catálogo y `offlineQueue` encola escrituras de
productos hasta que vuelve la conexión. **El cobro todavía no pasa por la cola**:
sin internet no se puede cerrar una venta.

## Pendientes conocidos

1. La venta no es atómica — 4 escrituras sueltas desde el navegador. Debería ser
   un RPC de Postgres en una sola transacción.
2. El descuento FIFO lee y escribe el valor absoluto de `cantidad_disponible`:
   dos cajas vendiendo el mismo producto a la vez se pisan.
3. El cobro no funciona offline (ver arriba).
4. Sin tests ni CI.
