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

// Backs the Class tab's "My Classes" list (app.js: renderClassTab).
// creatorId is whatever's in the caller's localStorage
// ('quizforge-creator-id') -- there's no login in this app, so possession of
// that id is the only "auth" here, same trust model as Share & Track's
// get-monitoring-data.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { creatorId } = await req.json()
    if (typeof creatorId !== 'string' || !creatorId.trim()) {
      return jsonResponse({ message: 'Missing creatorId.' }, 400)
    }

    const select = 'id,title,subject,room_name,created_at'
    const res = await fetch(
      `${supabaseUrl}/rest/v1/class_sessions?creator_id=eq.${encodeURIComponent(creatorId)}&select=${select}&order=created_at.desc`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
    )
    if (!res.ok) {
      const errText = await res.text()
      return jsonResponse({ message: `Could not load your classes: ${errText.slice(0, 300)}` }, 502)
    }
    const rows = await res.json()

    const sessions = (rows || []).map((s: any) => ({
      id: s.id,
      title: s.title,
      subject: s.subject,
      roomName: s.room_name,
      createdAt: s.created_at,
    }))

    return jsonResponse({ sessions })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error loading your classes.' }, 500)
  }
})
