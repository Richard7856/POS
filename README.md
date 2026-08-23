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

## La venta es atómica

El cobro completo corre en el RPC `registrar_venta` (Postgres): venta, pagos,
renglones y descuento FIFO en **una transacción con lock sobre los lotes**. O
entra la venta completa o no entra nada, y dos cajas cobrando el mismo producto
se forman en fila en lugar de pisarse el inventario. El FIFO canónico vive ahí;
`lib/stock.ts` sólo conserva lo que la UI necesita para mostrar existencias.

## Compra por bulto (caja, manojo grande, arpilla)

Cuando se compra en una unidad y se vende en otra —el cilantro llega en manojo
grande a $35 y de ahí salen 20-30 manojos chicos de $1— la entrada se registra
en modo **Por bulto**:

```
1 manojo grande × $35            = $35.00
Rinde 25 pzas                    → $1.40 por pza
```

El rendimiento se captura en cada compra, no como factor fijo del producto: un
manojo grande rinde 20 unas veces y 30 otras, y eso mueve el costo real. La
siguiente vez el formulario sugiere el rendimiento de la compra anterior,
proporcional a los bultos que se capturen.

El costo unitario resultante se guarda en el lote y actualiza el catálogo, así
que el margen de ese producto queda correcto en automático. Si el precio de
venta no cubre el costo, el desglose lo dice y sugiere el precio mínimo.

`lotes` guarda `bultos`, `costo_por_bulto` y `unidad_bulto` para poder ver
después a qué precio venía el bulto y cuánto rindió de verdad.

**Los productos por pieza también llevan inventario.** Antes sólo kg/g tenían
lotes, así que los manojos y las lechugas eran invisibles para el control de
existencias, el pedido y la merma. La unidad de inventario es kg para granel y
piezas para lo demás (`lib/unidades.ts`).

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

`productCache` guarda el catálogo y `offlineQueue` encola escrituras hasta que
vuelve la conexión — **incluido el cobro**: sin señal la venta se encola, el
ticket sale igual (folio "por asignar" y aviso de pendiente) y al reconectar
SyncProvider la registra con el RPC atómico. El FIFO y el costo se calculan al
sincronizar, con el inventario real de ese momento — que es el correcto, porque
la mercancía ya salió del mostrador.

## Pendientes conocidos

1. La merma aún descuenta el lote con lectura+escritura desde el navegador
   (mismo patrón que tenía el cobro); moverla a un RPC como registrar_venta.
2. Sin CI (las pruebas de lógica corren a mano).
3. Ventas offline: si dos dispositivos venden el mismo producto sin señal, el
   aviso de stock de cada uno no ve lo del otro hasta sincronizar.
