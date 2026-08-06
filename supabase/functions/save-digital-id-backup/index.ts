// Inlined rather than imported from ../_shared/cors.ts -- the Supabase
// dashboard's "New Function" single-file editor can't resolve a relative
// import to a file outside that function's own source (same reason every
// other function in this project inlines its own copy).
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
const MIN_PIN_LENGTH = 6
// Deliberately identical for every auth failure (wrong pin, locked out) so
// a failed attempt never leaks which part was wrong -- same reasoning as
// restore-digital-id-backup.
const GENERIC_AUTH_ERROR = 'That Digital ID or PIN is incorrect, or this Digital ID is temporarily locked. Please wait and try again.'

const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I -- avoids look-alike typos
const ID_PREFIX = 'SQ-'

function generateDigitalId(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
  return ID_PREFIX + s
}

// Backs the Profile > Backup & Restore "Back Up via Digital ID" /
// "Update Digital ID Backup" buttons (app.js: openDigitalIdModal). Handles
// both first-time creation (no digitalId in the request -- generates one,
// retrying on the astronomically unlikely collision) and updating an
// existing backup (digitalId given -- re-verifies the PIN first, same as
// restore, before overwriting the stored payload) in one endpoint, so the
// client never needs to track which case it's in beyond "do I already have
// a Digital ID saved locally."
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { digitalId, pin, payload } = await req.json()

    if (typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH) {
      return jsonResponse({ message: `PIN must be at least ${MIN_PIN_LENGTH} characters.` }, 400)
    }
    if (!payload || !Array.isArray(payload.library)) {
      return jsonResponse({ message: "That doesn't look like a valid backup." }, 400)
    }

    const headers = {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    }

    // ---- Create path: no digitalId supplied ----
    if (typeof digitalId !== 'string' || !digitalId.trim()) {
      const pinHash = await bcrypt.hash(pin, 10)
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateDigitalId()
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/digital_identities`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ digital_id: candidate, pin_hash: pinHash, payload }),
        })
        if (insertRes.status === 201) {
          return jsonResponse({ digitalId: candidate })
        }
        if (insertRes.status === 409) continue // duplicate key -- try another candidate
        const errText = await insertRes.text()
        return jsonResponse({ message: `Could not create your Digital ID: ${errText.slice(0, 300)}` }, 502)
      }
      return jsonResponse({ message: 'Could not generate a unique Digital ID -- please try again.' }, 500)
    }

    // ---- Update path: digitalId supplied, re-verify PIN first ----
    const selectRes = await fetch(
      `${supabaseUrl}/rest/v1/digital_identities?digital_id=eq.${encodeURIComponent(digitalId)}&select=pin_hash,failed_attempts,locked_until`,
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

    const updateRes = await fetch(`${supabaseUrl}/rest/v1/digital_identities?digital_id=eq.${encodeURIComponent(digitalId)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ payload, updated_at: new Date().toISOString(), failed_attempts: 0, locked_until: null }),
    })
    if (!updateRes.ok) {
      const errText = await updateRes.text()
      return jsonResponse({ message: `Could not update your backup: ${errText.slice(0, 300)}` }, 502)
    }

    return jsonResponse({ digitalId })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error saving this backup.' }, 500)
  }
})
