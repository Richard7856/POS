/**
 * Edge Function: create-user
 *
 * Creates a new Supabase auth user and their profile row.
 * Must be called by an authenticated admin — any other role is rejected.
 *
 * Request body: { email, password, nombre, rol, sucursal_id? }
 * Response:     { ok: true, user_id: string } | { error: string }
 *
 * Why this exists: Supabase `auth.admin.createUser` requires the service role key,
 * which must never be exposed to the browser. This function runs server-side
 * and validates the caller's role before performing the operation.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Parse request body ──────────────────────────────────────────────
    const { email, password, nombre, rol, sucursal_id } = await req.json()

    if (!email || !password || !nombre || !rol) {
      return json({ error: 'Faltan campos requeridos: email, password, nombre, rol' }, 400)
    }

    const validRoles = ['admin', 'encargado', 'cajero']
    if (!validRoles.includes(rol)) {
      return json({ error: `Rol inválido: ${rol}` }, 400)
    }

    // ── 2. Build clients ───────────────────────────────────────────────────
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY')!

    // Client using caller's JWT — used to verify their role
    const callerJwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerJwt}` } },
    })

    // Admin client using service role — used to create users
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── 3. Verify caller is admin ──────────────────────────────────────────
    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser()
    if (authError || !callerUser) {
      return json({ error: 'No autenticado' }, 401)
    }

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('rol')
      .eq('id', callerUser.id)
      .single()

    if (profileError || !callerProfile) {
      return json({ error: 'No se pudo verificar el perfil del solicitante' }, 403)
    }

    if (callerProfile.rol !== 'admin') {
      return json({ error: 'Solo los administradores pueden crear usuarios' }, 403)
    }

    // ── 4. Create the auth user ────────────────────────────────────────────
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,   // auto-confirm so user can log in immediately
    })

    if (createError || !newUser.user) {
      return json({ error: createError?.message ?? 'Error al crear el usuario' }, 400)
    }

    // ── 5. Upsert the profile row ──────────────────────────────────────────
    // The DB trigger handle_new_user may create a minimal profile row.
    // We upsert to ensure nombre, rol and sucursal_id are always set correctly.
    const { error: upsertError } = await adminClient
      .from('profiles')
      .upsert({
        id:          newUser.user.id,
        nombre:      nombre.trim(),
        rol,
        sucursal_id: sucursal_id || null,
        activo:      true,
      })

    if (upsertError) {
      // Auth user was created but profile failed — return partial error so admin knows
      return json({
        error: `Usuario creado en auth pero el perfil falló: ${upsertError.message}. ID: ${newUser.user.id}`,
      }, 500)
    }

    return json({ ok: true, user_id: newUser.user.id })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return json({ error: msg }, 500)
  }
})

// ── Helper ─────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
