# sQUIZit — Design

AI-powered exam/quiz generator: capture or upload photos of notes, textbook pages, or slides, and generate an interactive exam from them using Google Gemini.

## Stack

- **Frontend**: Vanilla JS PWA — no build step, no framework. Same pattern as [WinfinityFitnessTracker](../WinfinityFitnessTracker): a single `index.html`, one `style.css`, one `app.js`, a `config.js` for public keys, and a `sw.js` service worker for offline app-shell caching. Switched from an earlier React + Vite prototype early on to match that pattern.
- **Backend**: Supabase (same account as Winfinity Fitness Tracker) — used only for two Edge Functions, no database required for MVP.
- **AI**: Google Gemini (multimodal — reads the uploaded image directly, no separate OCR step). Free-tier API key.

## Why an Edge Function

This is a static client app with no server of its own. A raw Gemini API key can't be shipped to the browser safely (unlike a Supabase anon key, which is designed to be public). So the Gemini key lives as a Supabase Edge Function secret; the browser calls the Edge Function via `fetch`, the Edge Function calls Gemini. One shared key, bounded by the owner's free-tier quota — acceptable for personal/small-scale use.

## Flow

1. **Capture** — user uploads image file(s), takes a photo via `getUserMedia` (a full-screen camera overlay with a shutter button), or pastes text directly.
2. **Configure** — user picks: subject, which question types to include (Multiple Choice, True/False, Identification, Calculation, Essay), difficulty, and how many questions.
3. **Generate** — images (base64 data URLs) + config posted to Supabase Edge Function `generate-quiz` via `fetch`. The function prompts Gemini with the image(s) and a strict JSON schema (`responseSchema`) so it returns a structured quiz: array of questions, each with `type`, `prompt`, `choices` (MCQ/TF), `correctAnswer`, `acceptableAnswers` (identification, for fuzzy matching), `expectedAnswer`/`rubric` (essay, calculation), and `explanation`.
4. **Take the exam** — one question per screen, rendered by type:
   - Multiple Choice / True-False → tappable option list, graded client-side by exact match against `correctAnswer`.
   - Identification → short text input, graded client-side by normalized match against `acceptableAnswers`.
   - Calculation → numeric input, graded client-side within a numeric tolerance of `correctAnswer`.
   - Essay → textarea, graded by a second Edge Function `grade-essay` that sends the question, rubric, and the user's answer to Gemini and gets back a score + written feedback.
5. **Results** — score breakdown, correct answers/explanations shown, essay feedback shown once graded (fetched in parallel after landing on the results screen).

## Project layout

```
sQUIZit/
  index.html        # single page: header, 4 tab-panels (Home/Create/Library/Profile), camera overlay
  style.css          # design tokens (CSS vars, incl. light/dark via data-theme) + all component styles
  app.js             # state object + render functions for every screen, fetch calls to Edge Functions
  config.js          # SUPABASE_URL / SUPABASE_ANON_KEY (public, safe to commit)
  manifest.webmanifest
  sw.js              # offline app-shell cache, passes Supabase requests straight through
  icons/icon.svg
  supabase/
    functions/
      generate-quiz/index.ts # Gemini call, image+text -> structured quiz JSON
      grade-essay/index.ts   # Gemini call, grades a single essay answer
  DESIGN.md
  README.md          # setup: Supabase project, deploy functions, set GEMINI_API_KEY secret
```

No routing library — the four tabs and the five-step Create flow (source → configure → generating → quiz → results) are just `hidden` toggles on plain `<section>`/`<div>` elements, driven by `state.tab` / `state.createStep` in `app.js`.

## Open items / future extensions

- No persistence yet (quiz + results live only in `state` for the page's lifetime, lost on refresh). Could add a Supabase table for quiz history later.
- Home and Library screens render static placeholder data (`RECENT_EXAMS`, `LIBRARY_EXAMS` in `app.js`) — not wired to real generated exams yet.
- BYOK override (paste your own Gemini key to bypass the shared quota) was discussed as an option but deferred — shared Edge Function key only, for now.
- Camera capture via `getUserMedia` requires a secure context (HTTPS or `localhost`) — won't work over a plain `http://` LAN IP on mobile; Upload Document still works there via the native file picker.
