import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-3.1-flash-lite'

function parseDataUrl(dataUrl: string, fallbackMimeType: string) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return { mimeType: fallbackMimeType, data: dataUrl }
  return { mimeType: match[1], data: match[2] }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const { dataUrl = '', mimeType = 'image/jpeg', geminiApiKey = '' } = await req.json()

    if (!geminiApiKey.trim()) {
      return jsonResponse({ message: 'Add your Gemini API key in Profile first.' }, 400)
    }
    if (!dataUrl) {
      return jsonResponse({ message: 'No image provided.' }, 400)
    }

    const { mimeType: resolvedMime, data } = parseDataUrl(dataUrl, mimeType)

    const promptText = [
      'You are checking whether a photo/scan is usable as source material for writing exam questions from it.',
      'Look at the image and judge: is there clearly readable text or content in it (not blurry, not too dark, not cropped/cut off, not upside-down, not blank/irrelevant)?',
      'Respond with "legible": true only if a person could confidently read the material well enough to write accurate exam questions from it. Otherwise false.',
      'Give a short, specific, one-sentence "reason" either way (e.g. "The photo is too blurry to make out the text" or "The text is clear and well-lit").',
    ].join(' ')

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: promptText }, { inline_data: { mime_type: resolvedMime, data } }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            legible: { type: 'BOOLEAN' },
            reason: { type: 'STRING' },
          },
          required: ['legible', 'reason'],
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
    return jsonResponse({ legible: !!parsed.legible, reason: parsed.reason || '' })
  } catch (err) {
    return jsonResponse({ message: err instanceof Error ? err.message : 'Unexpected error checking the image.' }, 500)
  }
})
