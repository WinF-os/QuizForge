import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-3.1-flash-lite'

const TYPE_GUIDE: Record<string, string> = {
  multipleChoice: 'multipleChoice: provide exactly 4 plausible "choices" and set "correctAnswer" to the text of the correct choice (must match one entry in "choices" exactly).',
  trueFalse: 'trueFalse: set "choices" to ["True","False"] and "correctAnswer" to either "True" or "False".',
  identification: 'identification: a short factual answer (a word, term, name, or number). Set "correctAnswer" to the primary accepted answer and "acceptableAnswers" to an array of accepted spelling/phrasing variants (include the primary answer in that array too).',
  matching: 'matching: a set of related left/right item pairs to match (e.g. terms with definitions, causes with effects). Provide 4-6 "pairs", each an object with a "left" and "right" string field. Do not set "correctAnswer" or "choices" for this type.',
  calculation: 'calculation: a numeric word problem solvable from the source material or general subject knowledge. Set "correctAnswer" to the final numeric answer as a plain string (no units unless essential), and "expectedAnswer" to a brief worked solution.',
  essay: 'essay: an open-ended short-answer/essay prompt. Set "expectedAnswer" to a model answer and "rubric" to 2-4 short bullet criteria used to grade a student\'s response. Do not set "correctAnswer" or "choices" for this type.',
}

function parseDataUrl(dataUrl: string, fallbackMimeType: string) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return { mimeType: fallbackMimeType, data: dataUrl }
  return { mimeType: match[1], data: match[2] }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const body = await req.json()
    const {
      examTitle = '',
      subject = '',
      images = [],
      text = '',
      topicMode = false,
      questionTypes = [],
      difficulty = 'medium',
      count = 10,
      geminiApiKey = '',
    } = body

    if (!geminiApiKey.trim()) {
      return jsonResponse({ message: 'Add your Gemini API key in Profile before generating a quiz.' }, 400)
    }
    if (!Array.isArray(questionTypes) || questionTypes.length === 0) {
      return jsonResponse({ message: 'Select at least one question type.' }, 400)
    }
    if ((!Array.isArray(images) || images.length === 0) && !text.trim()) {
      return jsonResponse({ message: 'Provide source images or pasted text.' }, 400)
    }

    const validTypes = questionTypes.filter((t: string) => TYPE_GUIDE[t])
    if (validTypes.length === 0) {
      return jsonResponse({ message: 'Select at least one question type.' }, 400)
    }
    const typeInstructions = validTypes.map((t: string) => `- ${TYPE_GUIDE[t]}`).join('\n')

    const promptText = topicMode
      ? [
          `You are an expert exam writer. Create a ${count}-question exam about the following topic/subject idea, drawing on your own general knowledge -- no source material was provided, so do not ask for any:`,
          `"""\n${text.trim()}\n"""`,
          examTitle ? `Exam title: ${examTitle}` : null,
          subject ? `Subject: ${subject}` : null,
          `Difficulty: ${difficulty}.`,
          `Only use these question types, distributing the ${count} questions roughly evenly across them:`,
          typeInstructions,
          'Every question object must include a short "explanation" of the correct answer. Return only the structured data — no commentary.',
        ].filter(Boolean).join('\n\n')
      : [
          `You are an expert exam writer. Create a ${count}-question exam from the provided source material.`,
          examTitle ? `Exam title: ${examTitle}` : null,
          subject ? `Subject: ${subject}` : null,
          `Difficulty: ${difficulty}.`,
          `Only use these question types, distributing the ${count} questions roughly evenly across them:`,
          typeInstructions,
          text.trim() ? `Additional source text:\n"""\n${text.trim()}\n"""` : null,
          'Base every question strictly on the provided source material (images and/or text). Every question object must include a short "explanation" of the correct answer. Return only the structured data — no commentary.',
        ].filter(Boolean).join('\n\n')

    const parts: Record<string, unknown>[] = [{ text: promptText }]
    for (const image of images) {
      const { mimeType, data } = parseDataUrl(image.dataUrl, image.mimeType || 'image/jpeg')
      parts.push({ inline_data: { mime_type: mimeType, data } })
    }

    const requestBody = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            questions: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  // Constrained to exactly what the user checked in Configure
                  // (validTypes), not every type sQUIZit knows about -- was
                  // previously the full fixed list here regardless of
                  // selection, so the schema itself never actually stopped
                  // Gemini from picking an unchecked type; only the prompt's
                  // plain-English "only use these types" line did, which the
                  // model didn't reliably follow. responseSchema enums are a
                  // hard constraint Gemini's structured output actually
                  // respects, unlike prompt wording.
                  type: { type: 'STRING', enum: validTypes },
                  prompt: { type: 'STRING' },
                  choices: { type: 'ARRAY', items: { type: 'STRING' } },
                  correctAnswer: { type: 'STRING' },
                  acceptableAnswers: { type: 'ARRAY', items: { type: 'STRING' } },
                  pairs: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: { left: { type: 'STRING' }, right: { type: 'STRING' } },
                      required: ['left', 'right'],
                    },
                  },
                  expectedAnswer: { type: 'STRING' },
                  rubric: { type: 'STRING' },
                  explanation: { type: 'STRING' },
                },
                required: ['type', 'prompt', 'explanation'],
              },
            },
          },
          required: ['questions'],
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
    const questions = (parsed.questions || []).map((q: Record<string, unknown>, index: number) => ({
      id: `q${index + 1}`,
      ...q,
    }))

    return jsonResponse({ questions, examTitle, subject, difficulty })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error generating the exam.' }, 500)
  }
})
