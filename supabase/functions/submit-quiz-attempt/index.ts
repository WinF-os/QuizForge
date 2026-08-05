// Inlined rather than imported from ../_shared/cors.ts -- see the comment
// in create-tracked-quiz/index.ts.
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

// Called once from the recipient's completion path (app.js: renderResults'
// justFinished block, via submitTrackedQuizAttempt) when a quiz was opened
// from a Share & Track link. Deliberately called fire-and-forget from the
// client -- a failed sync must never block the recipient's own results
// screen, so this function has no client-visible retry story; it either
// lands or it doesn't.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { trackedQuizId, scorePercent, identity = {} } = await req.json()

    if (typeof trackedQuizId !== 'string' || !trackedQuizId.trim()) {
      return jsonResponse({ message: 'Missing trackedQuizId.' }, 400)
    }
    if (!Number.isInteger(scorePercent) || scorePercent < 0 || scorePercent > 100) {
      return jsonResponse({ message: 'scorePercent must be an integer between 0 and 100.' }, 400)
    }
    const surname = typeof identity.surname === 'string' ? identity.surname.trim() : ''
    const givenName = typeof identity.givenName === 'string' ? identity.givenName.trim() : ''
    if (!surname || !givenName) {
      return jsonResponse({ message: 'Missing recipient surname/givenName.' }, 400)
    }

    // Confirm the tracked quiz actually exists first, so a bad/expired id
    // returns a clean 404 instead of a raw foreign-key-violation error from
    // the insert below.
    const existsRes = await fetch(
      `${supabaseUrl}/rest/v1/tracked_quizzes?id=eq.${encodeURIComponent(trackedQuizId)}&select=id`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
    )
    if (!existsRes.ok) {
      return jsonResponse({ message: 'Could not verify this quiz link.' }, 502)
    }
    const existsRows = await existsRes.json()
    if (!existsRows?.[0]) {
      return jsonResponse({ message: 'This quiz link is no longer available.' }, 404)
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/quiz_attempts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        tracked_quiz_id: trackedQuizId,
        score_percent: scorePercent,
        recipient_surname: surname,
        recipient_given_name: givenName,
        recipient_middle_name: identity.middleName || null,
        recipient_school: identity.school || null,
        recipient_grade_level: identity.gradeLevel || null,
        recipient_adviser: identity.adviser || null,
        recipient_contact_number: identity.contactNumber || null,
        recipient_email: identity.email || null,
      }),
    })
    if (!insertRes.ok) {
      const errText = await insertRes.text()
      return jsonResponse({ message: `Could not save this attempt: ${errText.slice(0, 300)}` }, 502)
    }

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error saving this attempt.' }, 500)
  }
})
