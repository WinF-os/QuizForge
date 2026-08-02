// Inlined rather than imported from ../_shared/cors.ts -- the Supabase
// dashboard's "New Function" single-file editor can't resolve a relative
// import to a file outside that function's own source (confirmed on
// check-image-legibility already; this function stays self-contained for
// the same reason, so the dashboard paste-and-deploy flow this project
// actually uses always works for it).
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

// Backs the Library > Share Link button (see shareQuizAsLink() in app.js).
// Unlike generate-quiz/grade-essay, this doesn't need the caller's own
// Gemini key -- it just needs to write to Storage, which requires the
// service role, not the public anon key the browser has. So the browser
// calls this function (with the anon key, same as every other function
// call in this app) and the function does the privileged write server-side.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically in
// every Edge Function's environment -- nothing to configure.
const BUCKET = 'shared-quizzes'
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 7 // 7 days
const MAX_HTML_BYTES = 3 * 1024 * 1024 // generous -- a real exported quiz is a few KB to a few hundred KB

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ message: 'Server misconfigured: missing Supabase service credentials.' }, 500)
    }

    const { html = '' } = await req.json()
    if (typeof html !== 'string' || !html.trim()) {
      return jsonResponse({ message: 'No quiz HTML provided.' }, 400)
    }
    if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) {
      return jsonResponse({ message: 'This quiz is too large to share as a link.' }, 400)
    }

    // Random path, not derived from the exam title -- avoids leaking the
    // quiz subject/title into a guessable/enumerable URL and sidesteps any
    // filename-escaping concerns entirely.
    const path = `${crypto.randomUUID()}.html`

    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    })
    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      return jsonResponse({ message: `Upload failed: ${errText.slice(0, 300)}` }, 502)
    }

    const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRY_SECONDS }),
    })
    if (!signRes.ok) {
      const errText = await signRes.text()
      return jsonResponse({ message: `Could not create a share link: ${errText.slice(0, 300)}` }, 502)
    }

    const signed = await signRes.json()
    if (!signed.signedURL) {
      return jsonResponse({ message: 'Storage did not return a signed URL.' }, 502)
    }

    return jsonResponse({ url: `${supabaseUrl}/storage/v1${signed.signedURL}`, expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error creating the share link.' }, 500)
  }
})
