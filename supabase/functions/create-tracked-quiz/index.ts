// Inlined rather than imported from ../_shared/cors.ts -- the Supabase
// dashboard's "New Function" single-file editor can't resolve a relative
// import to a file outside that function's own source (same reason
// share-quiz/check-image-legibility inline their own copy).
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

// Backs the Library screen's "Share & Track" button (see shareQuizAndTrack()
// in app.js). Creates the one durable row a quiz's tracked link points at --
// unlike share-quiz's Storage upload, this needs a real database row (not a
// file) so recipients' completed attempts (see submit-quiz-attempt) have
// something to reference back to, and so get-monitoring-data has something
// to list. Writing to Postgres needs the service role, not the public anon
// key the browser has, so the browser calls this function (with the anon
// key, same as every other function call in this app) and the function does
// the privileged write server-side.
const MAX_QUIZ_DATA_BYTES = 1 * 1024 * 1024 // generous -- a real quiz's questions JSON is a few KB to low hundreds of KB

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { creatorId, examTitle, subject = null, quizData } = await req.json()

    if (typeof creatorId !== 'string' || !creatorId.trim()) {
      return jsonResponse({ message: 'Missing creatorId.' }, 400)
    }
    if (typeof examTitle !== 'string' || !examTitle.trim()) {
      return jsonResponse({ message: 'Missing examTitle.' }, 400)
    }
    if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
      return jsonResponse({ message: 'quizData must include at least one question.' }, 400)
    }
    if (new TextEncoder().encode(JSON.stringify(quizData)).length > MAX_QUIZ_DATA_BYTES) {
      return jsonResponse({ message: 'This quiz is too large to share as a tracked link.' }, 400)
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/tracked_quizzes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        creator_id: creatorId,
        exam_title: examTitle,
        subject,
        quiz_data: quizData,
      }),
    })
    if (!insertRes.ok) {
      const errText = await insertRes.text()
      return jsonResponse({ message: `Could not create tracked quiz: ${errText.slice(0, 300)}` }, 502)
    }
    const rows = await insertRes.json()
    const id = rows?.[0]?.id
    if (!id) {
      return jsonResponse({ message: 'Database did not return the new quiz id.' }, 502)
    }

    return jsonResponse({ id })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error creating the tracked quiz.' }, 500)
  }
})
