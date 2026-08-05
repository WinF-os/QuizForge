// Inlined rather than imported from ../_shared/cors.ts -- see the comment
// in create-class-session/index.ts.
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

// Called when someone opens a Share & Track-style ?class=<id> deep link
// (app.js: loadClassSessionFromDeepLink) or rejoins from "My Classes". No
// ownership/auth check here by design -- the session's random uuid IS the
// access token, same posture as get-tracked-quiz. Read-only, but still
// routed through a service-role function since class_sessions has zero RLS
// policies (default-deny for the anon key).
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { id } = await req.json()
    if (typeof id !== 'string' || !id.trim()) {
      return jsonResponse({ message: 'Missing id.' }, 400)
    }

    const selectRes = await fetch(
      `${supabaseUrl}/rest/v1/class_sessions?id=eq.${encodeURIComponent(id)}&select=title,subject,room_name`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
    )
    if (!selectRes.ok) {
      const errText = await selectRes.text()
      return jsonResponse({ message: `Could not look up this class: ${errText.slice(0, 300)}` }, 502)
    }
    const rows = await selectRes.json()
    const row = rows?.[0]
    if (!row) {
      return jsonResponse({ message: 'This class link is no longer available.' }, 404)
    }

    return jsonResponse({ title: row.title, subject: row.subject, roomName: row.room_name })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error loading this class.' }, 500)
  }
})
