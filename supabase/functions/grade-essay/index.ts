import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (!GEMINI_API_KEY) {
    return jsonResponse({ message: 'GEMINI_API_KEY is not configured on the server.' }, 500)
  }

  try {
    const { question, expectedAnswer = '', rubric = '', answer = '' } = await req.json()

    if (!question || !answer.trim()) {
      return jsonResponse({ message: 'A question and an answer are required.' }, 400)
    }

    const promptText = [
      'You are grading a student\'s short-answer/essay exam response.',
      `Question: ${question}`,
      expectedAnswer ? `Model answer: ${expectedAnswer}` : null,
      rubric ? `Grading rubric: ${rubric}` : null,
      `Student answer: """${answer}"""`,
      'Score the answer from 0 to 100 based on accuracy and completeness relative to the model answer/rubric. Give brief, constructive written feedback (2-3 sentences) addressed to the student.',
    ].filter(Boolean).join('\n\n')

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            score: { type: 'INTEGER' },
            feedback: { type: 'STRING' },
          },
          required: ['score', 'feedback'],
        },
      },
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return jsonResponse({ message: `Gemini request failed: ${errText.slice(0, 300)}` }, 502)
    }

    const geminiJson = await geminiRes.json()
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      return jsonResponse({ message: 'Gemini returned an empty response.' }, 502)
    }

    const parsed = JSON.parse(rawText)
    return jsonResponse({ score: parsed.score, feedback: parsed.feedback })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error grading the answer.' }, 500)
  }
})
