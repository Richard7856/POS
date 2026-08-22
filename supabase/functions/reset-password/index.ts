/**
 * Edge Function: reset-password
 *
 * Sets a new password for an existing user. Must be called by an authenticated
 * admin — any other role is rejected.
 *
 * Request body: { user_id, password }
 * Response:     { ok: true } | { error: string }
 *
 * Why this exists: `auth.admin.updateUserById` requires the service role key,
 * which must never reach the browser. Same pattern as create-user.
 *
 * Users change their OWN password from /perfil, which needs no service role.
 * This is only for the case where someone forgot theirs and an admin has to
 * hand out a new temporary one.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MIN_PASSWORD = 8

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Parse request body ──────────────────────────────────────────────
    const { user_id, password } = await req.json()

    if (!user_id || !password) {
      return json({ error: 'Faltan campos requeridos: user_id, password' }, 400)
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres` }, 400)
    }

    // ── 2. Build clients ───────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

    // Client using caller's JWT — used to verify their role
    const callerJwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerJwt}` } },
    })

    // Admin client using service role — used to set the password
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
      return json({ error: 'Solo los administradores pueden resetear contraseñas' }, 403)
    }

    // ── 4. Set the new password ────────────────────────────────────────────
    const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, {
      password,
    })

    if (updateError) {
      return json({ error: updateError.message }, 400)
    }

    return json({ ok: true })

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
