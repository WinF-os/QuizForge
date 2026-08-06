// Inlined rather than imported from ../_shared/cors.ts -- see the comment
// in save-digital-id-backup/index.ts.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

import bcrypt from 'npm:bcryptjs@2.4.3'

const MAX_FAILED_ATTEMPTS = 8
const LOCKOUT_MINUTES = 15
// Deliberately identical for every failure mode (missing id, wrong pin,
// locked out) so a failed attempt never leaks which part was wrong.
const GENERIC_AUTH_ERROR = 'That Digital ID or PIN is incorrect, or this Digital ID is temporarily locked. Please wait and try again.'

// Backs both the Profile > Backup & Restore "Restore via Digital ID" flow
// and the mandatory Student Identity modal's "Have a Digital ID? Restore it
// instead" path (app.js). Returns the exact same payload shape
// buildBackupPayload() produces, so the caller just feeds the response
// straight into the existing applyBackupPayload() -- no new restore logic
// anywhere in the client.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { digitalId, pin } = await req.json()
    const headers = {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    }

    if (typeof digitalId !== 'string' || !digitalId.trim() || typeof pin !== 'string' || !pin) {
      return jsonResponse({ message: GENERIC_AUTH_ERROR }, 401)
    }

    const selectRes = await fetch(
      `${supabaseUrl}/rest/v1/digital_identities?digital_id=eq.${encodeURIComponent(digitalId)}&select=pin_hash,payload,failed_attempts,locked_until`,
      { headers },
    )
    if (!selectRes.ok) {
      return jsonResponse({ message: 'Could not look up this Digital ID.' }, 502)
    }
    const rows = await selectRes.json()
    const row = rows?.[0]
    if (!row) {
      return jsonResponse({ message: GENERIC_AUTH_ERROR }, 401)
    }
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return jsonResponse({ message: GENERIC_AUTH_ERROR }, 401)
    }

    const matches = await bcrypt.compare(pin, row.pin_hash)
    if (!matches) {
      const newFailedAttempts = (row.failed_attempts || 0) + 1
      const lockedUntil = newFailedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null
      await fetch(`${supabaseUrl}/rest/v1/digital_identities?digital_id=eq.${encodeURIComponent(digitalId)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ failed_attempts: newFailedAttempts, locked_until: lockedUntil }),
      })
      return jsonResponse({ message: GENERIC_AUTH_ERROR }, 401)
    }

    // Success -- reset the failure counter so a genuine typo streak doesn't
    // carry over into a future legitimate attempt.
    await fetch(`${supabaseUrl}/rest/v1/digital_identities?digital_id=eq.${encodeURIComponent(digitalId)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ failed_attempts: 0, locked_until: null }),
    })

    return jsonResponse({ payload: row.payload })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error restoring this backup.' }, 500)
  }
})
