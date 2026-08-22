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
20260822190400_productos_solo_staff.sql  el catálogo lo edita solo admin/encargado
20260822210000_venta_items_costo.sql     costo congelado por renglón de venta
```

Aplicarlas a un proyecto nuevo:

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy create-user
supabase functions deploy reset-password
```

### Roles

Tres roles, con el alcance limitado a la sucursal del perfil salvo `admin`:

| Rol | Qué hace |
|---|---|
| `admin` | Todo, en todas las sucursales: productos, usuarios, sucursales, promociones y reportes. |
| `encargado` | Registra la mercancía que entra (lotes), cierra la caja, hace devoluciones y descuentos, y también cobra. Alta y edición de productos. |
| `cajero` | Cobra en el POS e imprime el ticket. Registra merma y gastos de caja. **Consulta el catálogo pero no lo modifica, y no ve el precio de compra.** |

Las políticas RLS son las que hacen valer esto, no la UI: un cajero con el token
en la mano tampoco puede insertar productos, abrir un corte ni vender a nombre de
otra sucursal.

### Usuarios y contraseñas

El primer admin se crea a mano en la BD. A partir de ahí:

- **Alta**: `/admin/usuarios` → Edge Function `create-user`. El admin define una
  contraseña temporal.
- **Cambio propio**: cualquiera entra a `/perfil` (👤 en la barra) y cambia su
  contraseña. No requiere service role.
- **Reseteo por el admin**: `/admin/usuarios` → botón *Contraseña* → Edge
  Function `reset-password`. Para cuando alguien la olvidó.

Ambas Edge Functions validan que quien llama sea `admin` antes de usar el
service role.

## Pantallas

| Ruta | Qué hace | Quién |
|---|---|---|
| `/pos` | cuentas múltiples, báscula Bluetooth, escáner EAN, promos | todos |
| `/productos` | catálogo, precios, EAN, stock mínimo | todos (costo solo staff) |
| `/historial` | ventas del día, ticket, devoluciones | todos |
| `/inventario/merma` | merma con foto de evidencia | todos |
| `/dashboard` | métricas | staff |
| `/inventario`, `/inventario/lotes`, `/inventario/pedido` | lotes FIFO, alertas, pedido sugerido | staff |
| `/historial/corte` | corte de caja | staff |
| `/admin/*` | usuarios, sucursales, promociones | admin |
| `/perfil` | datos de la cuenta y cambio de contraseña | todos |

## Notas de hardware

- **Báscula Bluetooth** (`useBluetoothScale`): Femmto BWS12, Arboleaf QN-KS,
  Etekcity y Assistrus B03H (Nordic UART). Requiere Web Bluetooth → Chrome.
- **Escáner EAN**: `BarcodeDetector` nativo, con captura manual como respaldo.

## Cuentas múltiples

El POS atiende a varios clientes a la vez: cada cuenta abierta es una pestaña
con su propio carrito, y sólo una está en pantalla. Se pueden renombrar
("Doña Mari", "El de la camioneta"), descartar —con confirmación si ya tienen
artículos— y al cobrar una, se cierra y el POS salta a la siguiente.

Viven en `localStorage` (`pos_cuentas_v1`), no en la BD: sobreviven a un refresh
o a que se caiga la señal, que es cuando más duele perder un carrito a medias.
Son por dispositivo — hoy no se puede dejar una cuenta pendiente en una caja y
cobrarla en otra; eso sí necesitaría una tabla en Postgres.

La lógica de estado son funciones puras en `lib/cuentasAbiertas.ts`
(`abrir`, `cerrar`, `renombrar`, `aplicarCart`), separadas del hook de React
justamente para poder probarlas sin montar un componente.

## Ganancia automática

El flujo del dinero se calcula solo, sin capturas extra:

1. **Entrada de mercancía**: capturas el costo/kg de lo que llegó. Al guardar,
   el costo del producto en el catálogo se actualiza (checkbox activado por
   default) y el formulario te muestra en vivo el margen contra tu precio de
   venta — con advertencia si estás vendiendo abajo del costo.
2. **Venta**: cada renglón congela el costo al que salió (promedio ponderado de
   los lotes FIFO que lo surtieron; `precio_compra` para piezas) en
   `venta_items.costo_unitario`. Si el costo cambia mañana, la ganancia de hoy
   no se mueve.
3. **Dashboard**: KPI de ganancia y margen por día/semana/mes (descuentos ya
   restados) y columna de ganancia en el top de productos. Los renglones sin
   costo capturado se excluyen y se marcan con "≈" en lugar de inventar margen.
4. **Reabastecimiento**: la lista de pedido dice cuánto dinero llevar al
   mercado (faltante × último costo) y cada renglón tiene botón para registrar
   la entrada cuando llega.

La aritmética vive en `lib/ganancia.ts` (funciones puras con pruebas).

## El flujo del que reabastece (encargado)

`/inventario` es su pantalla de inicio: las tarjetas traen el dato que decide
si hay que entrar — kg registrados hoy, merma del mes en kg y pesos, y cuántos
productos están bajo mínimo. En merma, el lote más viejo (FIFO) se preselecciona
solo y cada registro muestra el dinero perdido al costo del lote.

Entradas, merma, pedido y corte operan por sucursal: un perfil sin sucursal
asignada ve un aviso claro (antes fallaban en silencio con pantallas vacías).

## Control de existencias al vender

El POS muestra en cada tarjeta los kg disponibles (descontando lo ya apartado
en las cuentas abiertas) y marca los agotados en rojo. Al pesar:

- **Cajero**: no puede agregar más de lo que hay — el botón se bloquea y se le
  pide avisar al encargado.
- **Admin/encargado**: puede continuar (a veces la mercancía llegó y no se ha
  capturado), pero se le advierte en cuánto quedará el inventario negativo.

El control aplica solo a productos **con entradas registradas**. Un producto sin
ninguna entrada capturada todavía no lleva inventario y se vende sin frenos; el
control arranca solo el día que se le registra su primera entrada. Los productos
por pieza no llevan lotes, así que tampoco se controlan.

Cuando se vende de más, el faltante **se registra**: el lote más reciente queda
en negativo (antes esos kilos simplemente desaparecían y el lote se quedaba en
0). Ese negativo se ve en el POS, en el catálogo y en Entradas con la etiqueta
⚠ Faltante — es la señal de "aquí falta capturar una entrada".

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
