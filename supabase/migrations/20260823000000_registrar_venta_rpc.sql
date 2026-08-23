-- ═══════════════════════════════════════════════════════════════════════════
-- registrar_venta — el cobro completo en UNA transacción
--
-- Antes el navegador hacía 4 escrituras seguidas (venta → pagos → items →
-- lotes): si la señal se caía a la mitad quedaba una venta sin renglones o
-- inventario sin descontar. Y dos cajas cobrando el mismo producto se pisaban
-- el FIFO (leían el mismo disponible y escribían valores absolutos).
--
-- Esta función lo hace todo en el servidor:
--   · una transacción: o entra la venta completa o no entra nada
--   · SELECT ... FOR UPDATE sobre los lotes: dos cajas se forman en fila en
--     lugar de pisarse — la segunda ve el inventario que dejó la primera
--   · el FIFO y el costo se calculan aquí (misma lógica que lib/stock.ts y
--     lib/ganancia.ts, que quedan como referencia probada): consume lotes
--     positivos del más viejo al más nuevo; si falta, el sobrante se carga al
--     lote MÁS RECIENTE dejándolo en negativo para que el hueco se vea
--   · producto sin lotes: no está bajo control de inventario, el costo sale
--     de products.precio_compra
--
-- SECURITY INVOKER a propósito: corre con los permisos del cajero y las
-- políticas RLS siguen mandando (su sucursal, sus permisos).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.registrar_venta(
  p_total     numeric,
  p_descuento numeric,
  p_metodo    text,
  p_items     jsonb,               -- [{product_id, nombre, cantidad, unidad, precio_unitario, subtotal}]
  p_pagos     jsonb default '[]'   -- [{metodo, monto}] sólo para pago mixto
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sucursal   uuid;
  v_venta_id   uuid;
  it           jsonb;
  pg           jsonb;
  l            record;

  v_cantidad   numeric;   -- en unidad de venta (kg, g o piezas)
  v_inv        numeric;   -- en unidad de inventario (kg o piezas)
  v_restante   numeric;
  v_tomado     numeric;
  v_lote_prim  uuid;      -- lote que se apunta en el renglón (el más viejo tocado)
  v_hay_lotes  boolean;
  v_ult_lote   uuid;      -- el más reciente: absorbe el faltante en negativo
  v_kg_cost    numeric;   -- kg consumidos que sí tienen costo
  v_pesos_cost numeric;   -- pesos de esos kg
  v_costo      numeric;   -- costo unitario final del renglón
begin
  select sucursal_id into v_sucursal from public.profiles where id = (select auth.uid());
  if v_sucursal is null then
    raise exception 'Tu perfil no tiene sucursal asignada';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene renglones';
  end if;
  if p_total < 0 or p_descuento < 0 then
    raise exception 'Total o descuento inválido';
  end if;

  insert into public.ventas (total, descuento, metodo_pago, sucursal_id, cajero_id)
  values (p_total, p_descuento, p_metodo, v_sucursal, (select auth.uid()))
  returning id into v_venta_id;

  for pg in select * from jsonb_array_elements(p_pagos) loop
    insert into public.venta_pagos (venta_id, metodo, monto)
    values (v_venta_id, pg->>'metodo', (pg->>'monto')::numeric);
  end loop;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cantidad := (it->>'cantidad')::numeric;
    if v_cantidad <= 0 then
      raise exception 'Cantidad inválida en %', it->>'nombre';
    end if;

    -- El inventario se lleva en kg para granel y en piezas para lo demás
    v_inv := case when it->>'unidad' = 'g' then v_cantidad / 1000 else v_cantidad end;

    v_lote_prim  := null;
    v_ult_lote   := null;
    v_hay_lotes  := false;
    v_restante   := v_inv;
    v_kg_cost    := 0;
    v_pesos_cost := 0;

    -- FIFO con lock: el orden de lock es determinista (fecha, created_at, id)
    -- para que dos cajas nunca se abracen en deadlock.
    for l in
      select id, cantidad_disponible, costo_por_unidad
        from public.lotes
       where product_id = (it->>'product_id')::uuid
         and sucursal_id = v_sucursal
       order by fecha_entrada, created_at, id
       for update
    loop
      v_hay_lotes := true;
      v_ult_lote  := l.id;   -- al final del loop queda el más reciente

      if v_restante > 0 and l.cantidad_disponible > 0 then
        if v_lote_prim is null then v_lote_prim := l.id; end if;
        v_tomado := least(l.cantidad_disponible, v_restante);

        update public.lotes
           set cantidad_disponible = round(cantidad_disponible - v_tomado, 6)
         where id = l.id;

        if l.costo_por_unidad is not null then
          v_kg_cost    := v_kg_cost + v_tomado;
          v_pesos_cost := v_pesos_cost + v_tomado * l.costo_por_unidad;
        end if;
        v_restante := round(v_restante - v_tomado, 6);
      end if;
    end loop;

    -- Faltante: se vendió más de lo capturado → el lote más reciente queda en
    -- negativo, que es la señal de "aquí falta registrar una entrada".
    if v_restante > 0 and v_hay_lotes then
      update public.lotes
         set cantidad_disponible = round(cantidad_disponible - v_restante, 6)
       where id = v_ult_lote;
      if v_lote_prim is null then v_lote_prim := v_ult_lote; end if;
    end if;

    -- Costo del renglón: ponderado de lo consumido con costo; si nada lo tuvo,
    -- el precio_compra del catálogo; si tampoco, NULL (desconocido honesto).
    if v_kg_cost > 0 then
      v_costo := v_pesos_cost / v_kg_cost;                     -- por kg (o pieza)
      if it->>'unidad' = 'g' then v_costo := v_costo / 1000; end if;
      v_costo := round(v_costo, 4);
    else
      select precio_compra into v_costo
        from public.products where id = (it->>'product_id')::uuid;
    end if;

    insert into public.venta_items
      (venta_id, product_id, nombre_producto, cantidad, unidad,
       precio_unitario, subtotal, costo_unitario, lote_id)
    values
      (v_venta_id, (it->>'product_id')::uuid, it->>'nombre', v_cantidad,
       it->>'unidad', (it->>'precio_unitario')::numeric,
       (it->>'subtotal')::numeric, v_costo, v_lote_prim);
  end loop;

  return v_venta_id;
end;
$$;

-- Sólo usuarios con sesión pueden cobrar; anon ni la ve.
revoke execute on function public.registrar_venta(numeric, numeric, text, jsonb, jsonb) from public, anon;
grant  execute on function public.registrar_venta(numeric, numeric, text, jsonb, jsonb) to authenticated;
