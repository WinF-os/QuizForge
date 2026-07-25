import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-3.1-flash-lite'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const { question, expectedAnswer = '', rubric = '', answer = '', geminiApiKey = '' } = await req.json()

    if (!geminiApiKey.trim()) {
      return jsonResponse({ message: 'Add your Gemini API key in Profile before grading essay answers.' }, 400)
    }
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
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
