// Inlined rather than imported from ../_shared/cors.ts -- see the comment
// in create-tracked-quiz/index.ts (same reason share-quiz/
// check-image-legibility inline their own copy).
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

// Called when a recipient opens a Share & Track link (app.js:
// loadTrackedQuizFromDeepLink, ?quiz=<id>). No ownership/auth check here by
// design -- the tracked quiz's random uuid IS the access token, same
// posture as the signed Storage URL share-quiz hands out for the older
// untracked Share Link. Read-only, but still routed through a service-role
// function rather than direct PostgREST-from-the-browser, since
// tracked_quizzes has zero RLS policies (default-deny for the anon key) --
// every table access in this feature goes through an edge function.
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
      `${supabaseUrl}/rest/v1/tracked_quizzes?id=eq.${encodeURIComponent(id)}&select=exam_title,subject,quiz_data`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
    )
    if (!selectRes.ok) {
      const errText = await selectRes.text()
      return jsonResponse({ message: `Could not look up this quiz: ${errText.slice(0, 300)}` }, 502)
    }
    const rows = await selectRes.json()
    const row = rows?.[0]
    if (!row) {
      return jsonResponse({ message: 'This quiz link is no longer available.' }, 404)
    }

    return jsonResponse({ examTitle: row.exam_title, subject: row.subject, quizData: row.quiz_data })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error loading this quiz.' }, 500)
  }
})
