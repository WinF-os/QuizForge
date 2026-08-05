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

// Backs the Monitoring tab (app.js: renderMonitoring). One PostgREST
// embedded-resource request pulls every tracked quiz for this creator plus
// its attempts in a single round trip, instead of an N+1 fetch per quiz.
// creatorId is just whatever's in the caller's localStorage
// ('quizforge-creator-id') -- there's no login in this app, so possession
// of that id is the only "auth" here, same trust model as the unguessable
// tracked-quiz-id link itself.
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

    const select = [
      'id', 'exam_title', 'subject', 'created_at',
      'quiz_attempts(id,recipient_surname,recipient_given_name,recipient_middle_name,recipient_school,recipient_grade_level,score_percent,submitted_at)',
    ].join(',')
    const res = await fetch(
      `${supabaseUrl}/rest/v1/tracked_quizzes?creator_id=eq.${encodeURIComponent(creatorId)}&select=${encodeURIComponent(select)}&order=created_at.desc`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
    )
    if (!res.ok) {
      const errText = await res.text()
      return jsonResponse({ message: `Could not load monitoring data: ${errText.slice(0, 300)}` }, 502)
    }
    const rows = await res.json()

    const quizzes = (rows || []).map((q: any) => ({
      id: q.id,
      examTitle: q.exam_title,
      subject: q.subject,
      createdAt: q.created_at,
      attempts: (q.quiz_attempts || [])
        .map((a: any) => ({
          id: a.id,
          recipientSurname: a.recipient_surname,
          recipientGivenName: a.recipient_given_name,
          recipientMiddleName: a.recipient_middle_name,
          recipientSchool: a.recipient_school,
          recipientGradeLevel: a.recipient_grade_level,
          scorePercent: a.score_percent,
          submittedAt: a.submitted_at,
        }))
        .sort((a: any, b: any) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()),
    }))

    return jsonResponse({ quizzes })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error loading monitoring data.' }, 500)
  }
})
