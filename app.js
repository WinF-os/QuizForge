'use strict';

const APP_VERSION = 'QF_SYS_V.1.2.4';

// Diagnostic only: captures the first uncaught error/rejection anywhere in
// the app so it can be surfaced in the UI (Profile > Backup & Restore) --
// there's no remote devtools access to a user's native install, and an
// uncaught throw partway through this script's top-level init sequence has
// silently killed later, unrelated code before (see README/history for the
// version-popup regression incident). Lets a real error be screenshotted
// instead of guessed at blind.
window.__firstUncaughtError = null;
window.addEventListener('error', (e) => {
  if (!window.__firstUncaughtError) window.__firstUncaughtError = `${e.message} (${e.filename}:${e.lineno})`;
});
window.addEventListener('unhandledrejection', (e) => {
  if (!window.__firstUncaughtError) window.__firstUncaughtError = `Unhandled promise rejection: ${e.reason}`;
});

/* ============ State ============ */

const state = {
  tab: 'home',
  createStep: 'source', // source | configure | manualBuilder | generating | quiz | results
  generationMode: 'ai', // ai | manual | auto
  manualQuestions: [],
  examTitle: '',
  subject: '',
  sourceImages: [], // { dataUrl, mimeType }
  sourceText: '',
  config: {
    types: { multipleChoice: true, trueFalse: false, identification: false, calculation: false, essay: false },
    difficulty: 'medium',
    count: 10,
    timeLimitMinutes: 0, // 0 = no limit
  },
  quiz: null,
  answers: {},
  essayGrades: {},
  quizIndex: 0,
  libraryTab: 'completed',
  librarySearch: '',
  cameraStream: null,
  geminiApiKeys: loadGeminiKeys(),
  activeKeyIndex: 0,
  showCorrectAnswers: false,
  currentLibraryId: null, // library entry (if any) the in-progress quiz was resumed/reviewed from -- lets a re-save update it instead of always inserting a duplicate
  legibilityCheckPending: false, // true while an uploaded/captured image is being checked (or its warning modal is open) -- see checkAddedImagesLegibility()
  quizTimerStartedAt: null, // set the moment the first answer is given -- not persisted across a close/reopen, see startQuizTimerIfNeeded()
};

const QUESTION_TYPES = [
  { key: 'multipleChoice', title: 'Multiple Choice', sub: 'Standard 4-option selection.', icon: '☑' },
  { key: 'trueFalse', title: 'True / False', sub: 'Binary response format.', icon: '⇄' },
  { key: 'identification', title: 'Identification', sub: 'One or two word factual answers.', icon: '🔎' },
  { key: 'matching', title: 'Matching Type', sub: 'Match each item on the left to one on the right.', icon: '🔗' },
  { key: 'calculation', title: 'Calculation', sub: 'Numeric, worked-out answers.', icon: '∑' },
  { key: 'essay', title: 'Essay', sub: 'Short written responses, AI-graded.', icon: '✎' },
];

const DIFFICULTIES = [
  { key: 'easy', label: 'Easy', sub: 'Foundational' },
  { key: 'medium', label: 'Medium', sub: 'Standard' },
  { key: 'hard', label: 'Hard', sub: 'Advanced' },
];

const TYPE_LABELS = {
  multipleChoice: 'Multiple Choice',
  trueFalse: 'True / False',
  identification: 'Identification',
  matching: 'Matching Type',
  calculation: 'Calculation',
  essay: 'Essay',
};

const SUGGESTED_TOPICS = ['Big O Notation', 'Graph Theory Basics', 'Sorting Efficiencies'];

// Real, persisted exam library -- was previously 5 hardcoded fake entries
// (Biology/History/etc, dated 2023) that reappeared on every reload no
// matter what the user actually did, because nothing was ever saved to
// localStorage. Loaded once here, saved after every mutation below.
function loadLibraryExams() {
  try {
    return JSON.parse(localStorage.getItem('quizforge-library') || '[]');
  } catch (e) {
    return [];
  }
}
function saveLibraryExams() {
  try {
    localStorage.setItem('quizforge-library', JSON.stringify(LIBRARY_EXAMS));
  } catch (e) { /* storage unavailable/full -- exams still work in-memory this session */ }
}
const LIBRARY_EXAMS = loadLibraryExams();

/* ============ Helpers ============ */

const $ = (id) => document.getElementById(id);
const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ============ Theme ============ */

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Fisher-Yates shuffle algorithm
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function initTheme() {
  const stored = localStorage.getItem('quizforge-theme');
  if (stored) applyTheme(stored);
  const current = stored || getSystemTheme();
  $('themeToggle').checked = current === 'dark';
  updateThemeLabel(current);
}

function updateThemeLabel(theme) {
  $('themeIcon').textContent = theme === 'dark' ? '🌙' : '☀️';
  $('themeLabel').textContent = theme === 'dark' ? 'Dark mode' : 'Light mode';
}

$('themeToggle').addEventListener('change', (event) => {
  const next = event.target.checked ? 'dark' : 'light';
  localStorage.setItem('quizforge-theme', next);
  applyTheme(next);
  updateThemeLabel(next);
});

/* ============ Gemini API keys (BYOK, multi-key with quota rotation) ============ */

function loadGeminiKeys() {
  try {
    const stored = JSON.parse(localStorage.getItem('quizforge-gemini-keys') || '[]');
    if (Array.isArray(stored) && stored.length) return stored;
  } catch { /* ignore malformed storage */ }
  const legacy = localStorage.getItem('quizforge-gemini-key');
  if (legacy) {
    const migrated = [{ label: 'Key 1', key: legacy }];
    localStorage.setItem('quizforge-gemini-keys', JSON.stringify(migrated));
    localStorage.removeItem('quizforge-gemini-key');
    return migrated;
  }
  return [];
}

function saveGeminiKeys() {
  localStorage.setItem('quizforge-gemini-keys', JSON.stringify(state.geminiApiKeys));
}

function maskKey(key) {
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

function refreshGeminiKeyStatus() {
  const keys = state.geminiApiKeys;
  $('geminiKeyStatus').textContent = keys.length
    ? `${keys.length} key${keys.length > 1 ? 's' : ''} saved in this browser.`
    : 'No keys saved yet — AI Generate and essay grading are disabled until you add one.';

  $('geminiKeyList').innerHTML = keys.map((k, i) => `
    <div class="key-row">
      <input type="text" class="text-input js-key-label" data-index="${i}" value="${esc(k.label)}">
      <span class="key-row-masked">${esc(maskKey(k.key))}</span>
      <button type="button" class="link-btn js-remove-key" data-index="${i}">Remove</button>
    </div>
  `).join('');

  $('geminiKeyList').querySelectorAll('.js-key-label').forEach((input) => {
    input.addEventListener('change', () => {
      const idx = Number(input.dataset.index);
      state.geminiApiKeys[idx].label = input.value.trim() || `Key ${idx + 1}`;
      saveGeminiKeys();
    });
  });
  $('geminiKeyList').querySelectorAll('.js-remove-key').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.geminiApiKeys.splice(Number(btn.dataset.index), 1);
      if (state.activeKeyIndex >= state.geminiApiKeys.length) state.activeKeyIndex = 0;
      saveGeminiKeys();
      onGeminiKeyChanged();
    });
  });
}

function onGeminiKeyChanged() {
  refreshGeminiKeyStatus();
  updateContinueGating();
  if (state.createStep === 'configure') updateGenerateGating();
}

$('btnGetGeminiKey').addEventListener('click', () => {
  window.open('https://aistudio.google.com/apikey', '_blank', 'noopener');
});

$('btnPasteGeminiKey').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) $('geminiKeyInput').value = text.trim();
  } catch {
    $('geminiKeyStatus').textContent = 'Could not read clipboard — paste manually instead.';
  }
});

$('btnAddGeminiKey').addEventListener('click', () => {
  const key = $('geminiKeyInput').value.trim();
  if (!key) return;
  state.geminiApiKeys.push({ label: `Key ${state.geminiApiKeys.length + 1}`, key });
  saveGeminiKeys();
  $('geminiKeyInput').value = '';
  onGeminiKeyChanged();
});

function isQuotaError(message) {
  return /RESOURCE_EXHAUSTED|429|exceeded your current quota/i.test(message || '');
}

async function callWithKeyRotation(name, body) {
  const keys = state.geminiApiKeys;
  if (!keys.length) throw new Error('Add your Gemini API key in Profile first.');
  for (let i = 0; i < keys.length; i++) {
    const idx = (state.activeKeyIndex + i) % keys.length;
    try {
      const data = await callEdgeFunction(name, { ...body, geminiApiKey: keys[idx].key });
      state.activeKeyIndex = idx;
      return data;
    } catch (err) {
      if (!isQuotaError(err.message)) throw err;
    }
  }
  const quotaErr = new Error('All your saved Gemini keys have used up their free quota for now.');
  quotaErr.allKeysExhausted = true;
  throw quotaErr;
}

/* ============ Navigation ============ */

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.tab !== tab;
  });
  document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.target === tab);
  });
  $('btnHeaderBack').hidden = true;
  window.scrollTo(0, 0);
  if (tab === 'home') renderHome();
  if (tab === 'library') renderLibrary();
}

document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.target));
});

// Was just switchTab('create') -- showed whatever create-flow state was
// last active (including, after the Library fixes above, a stale
// currentLibraryId pointing at whatever exam was last resumed/reviewed,
// which would then silently overwrite that unrelated library entry the
// next time anything auto-saved). "Quick Create" should mean a genuinely
// fresh quiz.
$('btnQuickCreate').addEventListener('click', () => { resetCreateFlow(); switchTab('create'); });
$('btnViewAllRecent').addEventListener('click', () => switchTab('library'));
$('btnExploreBank').addEventListener('click', () => switchTab('library'));

/* ============ Home ============ */

function renderHome() {
  // Recent Exams -- derived from the real, persisted library (most recently
  // saved first, since every save unshift()s) instead of a separate static
  // demo array that never reflected anything the user actually did.
  const recent = LIBRARY_EXAMS.slice(0, 3);
  $('recentList').innerHTML = recent.length ? recent.map((exam) => `
    <li class="recent-item">
      <span class="recent-item-icon">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /></svg>
      </span>
      <span class="recent-item-body">
        <span class="recent-item-title">${esc(exam.title)}</span>
        <span class="recent-item-meta">${exam.status === 'draft' ? 'Draft' : 'Completed'} &bull; ${esc(exam.date)} &bull; ${exam.questionCount} Questions</span>
      </span>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </li>
  `).join('') : `<li class="empty-note">No exams yet — create your first one to see it here.</li>`;

  const completedCount = LIBRARY_EXAMS.filter((e) => e.status === 'completed').length;
  const draftCount = LIBRARY_EXAMS.filter((e) => e.status === 'draft').length;
  $('homeExamsSummary').textContent = !LIBRARY_EXAMS.length
    ? "You haven't created any exams yet — tap Quick Create to get started."
    : `You have ${completedCount} completed exam${completedCount === 1 ? '' : 's'} and ${draftCount} draft${draftCount === 1 ? '' : 's'} awaiting completion.`;

  $('topicList').innerHTML = SUGGESTED_TOPICS.map((topic) => `
    <li class="topic-item"><span>${esc(topic)}</span><button type="button" class="topic-add-btn" aria-label="Add ${esc(topic)}">+</button></li>
  `).join('');
}

/* ============ Library ============ */

$('btnLibCompleted').addEventListener('click', () => { state.libraryTab = 'completed'; renderLibrary(); });
$('btnLibDrafts').addEventListener('click', () => { state.libraryTab = 'draft'; renderLibrary(); });
$('librarySearchInput').addEventListener('input', (event) => { state.librarySearch = event.target.value; renderLibrary(); });

function renderLibrary() {
  $('btnLibCompleted').classList.toggle('is-active', state.libraryTab === 'completed');
  $('btnLibDrafts').classList.toggle('is-active', state.libraryTab === 'draft');

  const query = state.librarySearch.trim().toLowerCase();
  const filtered = LIBRARY_EXAMS.filter((exam) => {
    if (exam.status !== state.libraryTab) return false;
    if (!query) return true;
    return exam.title.toLowerCase().includes(query) || exam.subject.toLowerCase().includes(query);
  });

  if (!filtered.length) {
    const noneOfThisStatusAtAll = !LIBRARY_EXAMS.some((exam) => exam.status === state.libraryTab);
    const message = state.libraryTab === 'draft'
      ? 'No drafts yet — unfinished exams will appear here.'
      : (noneOfThisStatusAtAll ? 'No completed exams yet — finish a quiz to see it here.' : 'No exams match your search.');
    $('libraryList').innerHTML = `<p class="empty-note">${message}</p>`;
    return;
  }

  const cards = filtered.map((exam, index) => {
    const hasProgress = exam.status === 'draft' && exam.answers && Object.keys(exam.answers).length > 0;
    const primaryLabel = exam.status === 'completed' ? 'Review' : (hasProgress ? 'Continue' : 'Take Quiz');
    const showRetake = exam.status === 'completed' || hasProgress;
    const attempts = exam.history?.length || 0;
    return `
    <article class="exam-card exam-card--tag--${esc(exam.tag)}">
      <span class="exam-tag tag--${esc(exam.tag)}">${esc(exam.subject)}</span>
      <h3 class="exam-card-title">${esc(exam.title)}</h3>
      <p class="exam-card-meta">${exam.questionCount} Questions &bull; ${esc(exam.date)}${attempts ? ` &bull; ${attempts} attempt${attempts === 1 ? '' : 's'}` : ''}</p>
      <p class="exam-card-excerpt">&ldquo;${esc(exam.excerpt)}&rdquo;</p>
      ${attempts ? `<p class="exam-card-history">${exam.history.slice(-3).reverse().map((h) => `${esc(h.date)}: ${h.scorePercent}%`).join(' &middot; ')}</p>` : ''}
      <div class="exam-card-foot">
        <span class="exam-badge">${esc(exam.badge)}</span>
        <div class="exam-card-actions">
          <button type="button" class="link-btn js-open-exam">${primaryLabel}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          ${showRetake ? `<button type="button" class="link-btn js-retake-exam">Retake</button>` : ''}
          <button type="button" class="link-btn js-edit-exam">Edit</button>
          <button type="button" class="link-btn js-share-exam">Share</button>
        </div>
      </div>
    </article>
    ${index === 1 ? `
      <button type="button" class="library-create-card js-create-new">
        <span class="library-create-icon">+</span>
        <span class="library-create-title">Create New</span>
        <span class="screen-sub">Generate a new exam from your notes or photos.</span>
      </button>
    ` : ''}
  `;
  }).join('');

  $('libraryList').innerHTML = cards;
  // Was: every "Open Exam" button, on every card, blindly switched to the
  // Create tab regardless of which exam was clicked -- clicking any saved
  // exam did the same generic thing as clicking nothing at all. Now each
  // card has its own specific actions: a fresh draft opens straight into
  // the quiz, a partly-answered draft can Continue (resume) or Retake
  // (restart), a completed exam can Review (read-only) or Retake, and
  // every card can be Edited.
  const cardEls = $('libraryList').querySelectorAll('.exam-card');
  filtered.forEach((exam, i) => {
    const card = cardEls[i];
    card.querySelector('.js-open-exam')?.addEventListener('click', () => {
      if (exam.status === 'completed') viewCompletedExam(exam);
      else continueQuizFromLibrary(exam);
    });
    card.querySelector('.js-retake-exam')?.addEventListener('click', () => retakeQuizFromLibrary(exam));
    card.querySelector('.js-edit-exam')?.addEventListener('click', () => editQuizFromLibrary(exam));
    card.querySelector('.js-share-exam')?.addEventListener('click', () => shareQuizAsHtml(exam));
  });
  $('libraryList').querySelectorAll('.js-create-new').forEach((btn) => {
    btn.addEventListener('click', () => switchTab('create'));
  });
}

/* ============ Create: source step ============ */

function showCreateStep(step) {
  state.createStep = step;
  ['stepSource', 'stepConfigure', 'stepManualBuilder', 'stepGenerating', 'stepQuiz', 'stepResults'].forEach((id) => {
    $(id).hidden = id !== `step${step[0].toUpperCase()}${step.slice(1)}`;
  });
  $('btnHeaderBack').hidden = step === 'source';
  window.scrollTo(0, 0);
  if (step !== 'quiz') stopQuizTimer(); // covers every way of leaving the quiz screen (finish, back, tab switch) in one place
}

// Shared by the on-screen back button and the hardware/gesture Android
// back button (see handleAndroidBack below) -- one step back through the
// Create flow's own linear order. Returns whether it actually moved.
function goBackOneCreateStep() {
  if (state.tab !== 'create') return false;
  const order = state.generationMode === 'manual'
    ? ['source', 'manualBuilder', 'quiz', 'results']
    : ['source', 'configure', 'generating', 'quiz', 'results'];
  const idx = order.indexOf(state.createStep);
  if (idx > 0) { showCreateStep(order[idx - 1]); return true; }
  return false;
}

$('btnHeaderBack').addEventListener('click', goBackOneCreateStep);

// Handles the Android hardware/gesture back button -- called from native
// code (see MainActivity.java's onBackPressed), which hands back-navigation
// entirely to JS instead of Capacitor's default (WebView history back, else
// exit the app). This app is a single-page app with no real browser
// history, so that default would exit on almost every back press,
// including from the camera. Order of what "back" means here: close the
// camera if it's open, then step back through the Create flow, then
// return to the Home tab, then -- once there's nowhere left to go --
// minimize the app instead of exiting, so reopening it resumes exactly
// where it was (the OS already does this for free as long as the Activity
// is only ever backgrounded, never finished).
window.handleAndroidBack = function () {
  if (!$('cameraOverlay').hidden) { closeCamera(); return; }
  const versionPopup = document.getElementById('versionPopup');
  if (versionPopup && versionPopup.classList.contains('is-visible')) { versionPopup.classList.remove('is-visible'); return; }
  if (!$('legibilityModal').hidden) return; // mid-decision -- don't let back silently dismiss it
  if (goBackOneCreateStep()) return;
  if (state.tab !== 'home') { switchTab('home'); return; }
  if (window.AndroidBridge && window.AndroidBridge.minimizeApp) window.AndroidBridge.minimizeApp();
};

/* ============ Create: generation mode ============ */

document.querySelectorAll('#modeToggle .library-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => setGenerationMode(btn.dataset.mode));
});

function setGenerationMode(mode) {
  state.generationMode = mode;
  document.querySelectorAll('#modeToggle .library-toggle-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  });
  $('smartBlueprintCard').hidden = mode !== 'ai';
  if (mode === 'ai') {
    $('sourceScreenSub').textContent = 'Provide your source material and let AI draft the exam.';
    $('btnContinueToConfigure').textContent = 'Continue to Configuration';
  } else if (mode === 'manual') {
    $('sourceScreenSub').textContent = 'Skip the AI — build every question yourself, no source material required.';
    $('btnContinueToConfigure').textContent = 'Continue to Question Builder';
  } else {
    $('sourceScreenSub').textContent = 'Paste text and get fill-in-the-blank questions instantly, no AI required.';
    $('btnContinueToConfigure').textContent = 'Continue to Configuration';
  }
  updateContinueGating();
}

function resetCreateFlow() {
  state.examTitle = '';
  state.subject = '';
  state.sourceImages = [];
  state.sourceText = '';
  state.manualQuestions = [];
  state.config = { types: { multipleChoice: true, trueFalse: false, identification: false, calculation: false, essay: false }, difficulty: 'medium', count: 10, timeLimitMinutes: 0 };
  state.quiz = null;
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  state.currentLibraryId = null; // starting a genuinely new quiz -- not continuing whatever library entry (if any) was previously being resumed/reviewed
  $('examTitleInput').value = '';
  $('subjectSelect').value = '';
  $('pastedTextArea').value = '';
  $('pasteTextBlock').hidden = true;
  $('manualPromptInput').value = '';
  $('manualExplanationInput').value = '';
  $('timeLimitInput').value = '';
  $('manualTimeLimitInput').value = '';
  $('btnRegenerateQuiz').hidden = true; // both are edit-only actions -- nothing to regenerate from or copy over for a genuinely new quiz
  $('btnSaveAsNewCopy').hidden = true;
  renderSourcePreview();
  setGenerationMode('ai');
  renderManualBuilder();
  updateContinueGating();
  showCreateStep('source');
}

$('examTitleInput').addEventListener('input', (e) => { state.examTitle = e.target.value; updateContinueGating(); });
$('subjectSelect').addEventListener('change', (e) => { state.subject = e.target.value; updateContinueGating(); });

$('btnUploadDocument').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  const loaded = await Promise.all(files.map(async (file) => ({ dataUrl: await fileToDataUrl(file), mimeType: file.type || 'image/jpeg' })));
  state.sourceImages.push(...loaded);
  event.target.value = '';
  renderSourcePreview();
  updateContinueGating();
  checkAddedImagesLegibility(loaded);
});

$('btnPasteText').addEventListener('click', () => {
  $('pasteTextBlock').hidden = !$('pasteTextBlock').hidden;
});
$('pastedTextArea').addEventListener('input', (e) => { state.sourceText = e.target.value; updateContinueGating(); });

function renderSourcePreview() {
  const row = $('sourcePreviewRow');
  if (!state.sourceImages.length) { row.hidden = true; row.innerHTML = ''; return; }
  row.hidden = false;
  row.innerHTML = state.sourceImages.map((img, i) => `
    <div class="source-preview-thumb">
      <img src="${img.dataUrl}" alt="Source page ${i + 1}">
      <button type="button" class="source-preview-remove js-remove-image" data-index="${i}" aria-label="Remove image">✕</button>
    </div>
  `).join('');
  row.querySelectorAll('.js-remove-image').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sourceImages.splice(Number(btn.dataset.index), 1);
      renderSourcePreview();
      updateContinueGating();
    });
  });
}

function updateContinueGating() {
  const hasSource = state.sourceImages.length > 0 || state.sourceText.trim().length > 0;
  const missingKey = state.generationMode === 'ai' && !state.geminiApiKeys.length;
  const missingTitleOrSubject = !state.examTitle.trim() || !state.subject;
  const note = $('sourceEmptyNote');
  if (missingTitleOrSubject) {
    note.hidden = false;
    note.textContent = 'Enter an Exam Title and select a Subject before continuing.';
  } else if (missingKey) {
    note.hidden = false;
    note.textContent = 'Add your Gemini API key in Profile to use AI Generate.';
  } else {
    note.hidden = true;
  }
  const ok = !missingTitleOrSubject && (state.generationMode === 'manual' ? true : (hasSource && !missingKey));
  $('btnContinueToConfigure').disabled = !ok || state.legibilityCheckPending;
}

$('btnContinueToConfigure').addEventListener('click', () => {
  if (state.generationMode === 'manual') {
    renderManualBuilder();
    showCreateStep('manualBuilder');
  } else {
    renderConfigureScreen();
    showCreateStep('configure');
  }
});

/* ============ Camera capture ============ */

$('btnCameraCapture').addEventListener('click', openCamera);
$('btnCameraClose').addEventListener('click', closeCamera);

async function openCamera() {
  $('cameraOverlay').hidden = false;
  $('cameraError').hidden = true;
  $('btnCameraShutter').disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    state.cameraStream = stream;
    const video = $('cameraVideo');
    video.srcObject = stream;
    await video.play();
    $('btnCameraShutter').disabled = false;
  } catch {
    $('cameraError').hidden = false;
    $('cameraError').textContent = 'Could not access the camera. Check permissions, or use Upload Document instead.';
  }
}

function closeCamera() {
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  $('cameraOverlay').hidden = true;
}

$('btnCameraShutter').addEventListener('click', () => {
  const video = $('cameraVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const capturedImage = { dataUrl, mimeType: 'image/jpeg' };
  state.sourceImages.push(capturedImage);
  closeCamera();
  renderSourcePreview();
  updateContinueGating();
  checkAddedImagesLegibility([capturedImage]);
});

/* ============ Image legibility check ============ */

async function checkImageLegibility(image) {
  return callWithKeyRotation('check-image-legibility', { dataUrl: image.dataUrl, mimeType: image.mimeType });
}

function showLegibilityModal(image, reason) {
  return new Promise((resolve) => {
    $('legibilityModalThumb').src = image.dataUrl;
    $('legibilityModalReason').textContent = reason || 'This image may be too unclear to generate accurate questions from.';
    $('legibilityModal').hidden = false;

    function onReupload() { cleanup('reupload'); }
    function onIgnore() { cleanup('ignore'); }
    function cleanup(result) {
      $('legibilityModal').hidden = true;
      $('btnLegibilityReupload').removeEventListener('click', onReupload);
      $('btnLegibilityIgnore').removeEventListener('click', onIgnore);
      resolve(result);
    }
    $('btnLegibilityReupload').addEventListener('click', onReupload);
    $('btnLegibilityIgnore').addEventListener('click', onIgnore);
  });
}

// Checks each newly-added source image in turn against Gemini, pausing
// (Continue to Configuration stays disabled -- see updateContinueGating)
// while a check is running or its warning modal is open, until the user
// removes the flagged image or explicitly ignores the warning. If the
// check itself can't run (no Gemini key yet, offline, API error), it fails
// open -- silently skips checking that image rather than blocking the user
// over a problem unrelated to the image's actual legibility.
async function checkAddedImagesLegibility(images) {
  if (!state.geminiApiKeys.length) return;
  for (const image of images) {
    if (!state.sourceImages.includes(image)) continue; // already removed by the user while an earlier check in this batch was running
    state.legibilityCheckPending = true;
    $('legibilityCheckingNote').hidden = false;
    updateContinueGating();

    let result = null;
    try {
      result = await checkImageLegibility(image);
    } catch (e) { /* couldn't verify -- not the image's fault, let it through */ }

    $('legibilityCheckingNote').hidden = true;
    if (result && !result.legible) {
      const choice = await showLegibilityModal(image, result.reason);
      if (choice === 'reupload') {
        const idx = state.sourceImages.indexOf(image);
        if (idx !== -1) state.sourceImages.splice(idx, 1);
        renderSourcePreview();
      }
    }
    state.legibilityCheckPending = false;
    updateContinueGating();
  }
}

/* ============ Create: configure step ============ */

function renderConfigureScreen() {
  $('typeCard').hidden = state.generationMode === 'auto';
  $('difficultyCard').hidden = state.generationMode === 'auto';
  $('btnGenerateExam').textContent = state.generationMode === 'auto' ? '⚡ Auto-Extract Exam (no AI)' : '✨ Generate Exam';

  $('typeList').innerHTML = QUESTION_TYPES.map((type) => {
    const active = state.config.types[type.key];
    return `
      <button type="button" class="type-option${active ? ' is-active' : ''}" data-key="${type.key}">
        <span class="type-option-icon" aria-hidden="true">${type.icon}</span>
        <span class="type-option-body">
          <span class="type-option-title">${type.title}</span>
          <span class="type-option-sub">${type.sub}</span>
        </span>
        <span class="type-checkbox${active ? ' is-checked' : ''}">${active ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>' : ''}</span>
      </button>
    `;
  }).join('');

  $('typeList').querySelectorAll('.type-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      state.config.types[key] = !state.config.types[key];
      renderConfigureScreen();
      updateGenerateGating();
    });
  });

  const difficultyIndex = DIFFICULTIES.findIndex((d) => d.key === state.config.difficulty);
  $('difficultySlider').value = difficultyIndex;
  $('difficultyLabels').innerHTML = DIFFICULTIES.map((d) => `
    <div class="difficulty-label${d.key === state.config.difficulty ? ' is-active' : ''}">
      <span class="difficulty-pill">${d.label.toUpperCase()}</span>
      <span class="difficulty-sub">${d.sub}</span>
    </div>
  `).join('');

  $('countValue').textContent = state.config.count;
  updateGenerateGating();
}

$('difficultySlider').addEventListener('input', (e) => {
  state.config.difficulty = DIFFICULTIES[Number(e.target.value)].key;
  renderConfigureScreen();
});

$('btnCountMinus').addEventListener('click', () => {
  state.config.count = Math.max(5, state.config.count - 1);
  $('countValue').textContent = state.config.count;
});
$('btnCountPlus').addEventListener('click', () => {
  state.config.count = Math.min(50, state.config.count + 1);
  $('countValue').textContent = state.config.count;
});

function updateGenerateGating() {
  const note = $('configureEmptyNote');
  if (state.generationMode === 'auto') {
    const hasText = state.sourceText.trim().length > 0;
    $('btnGenerateExam').disabled = !hasText;
    note.hidden = hasText;
    if (!hasText) note.textContent = 'Paste some text first — Auto-Extract only reads pasted text, not images.';
    return;
  }
  const selectedCount = Object.values(state.config.types).filter(Boolean).length;
  const hasSource = state.sourceImages.length > 0 || state.sourceText.trim().length > 0;
  const missingKey = !state.geminiApiKeys.length;
  const canGenerate = selectedCount > 0 && hasSource && !missingKey;
  $('btnGenerateExam').disabled = !canGenerate;
  if (canGenerate) {
    note.hidden = true;
  } else {
    note.hidden = false;
    note.textContent = missingKey
      ? 'Add your Gemini API key in Profile to use AI Generate.'
      : selectedCount === 0 ? 'Pick at least one question type.' : 'Add source material on the previous screen first.';
  }
}

$('btnGenerateExam').addEventListener('click', () => {
  if (state.generationMode === 'auto') runAutoExtract();
  else runGeneration();
});
$('btnBackToConfigure').addEventListener('click', () => showCreateStep('configure'));

/* ============ Generation ============ */

const GENERATING_MESSAGES = [
  'Reading your source material…',
  'Identifying key concepts…',
  'Drafting questions…',
  'Balancing difficulty…',
  'Finalizing your exam…',
];
let generatingMessageTimer = null;

function typesToList(types) {
  return Object.entries(types).filter(([, enabled]) => enabled).map(([key]) => key);
}

function parseDataUrlMime(dataUrl, fallback) {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  return match ? match[1] : fallback;
}

async function callEdgeFunction(name, body) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request to ${name} failed.`);
  return data;
}

async function runGeneration() {
  showCreateStep('generating');
  $('generatingErrorCard').hidden = true;
  $('btnBackToConfigure').hidden = true;
  $('generatingSpinner').hidden = false;

  let messageIndex = 0;
  $('generatingMessage').textContent = GENERATING_MESSAGES[0];
  generatingMessageTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % GENERATING_MESSAGES.length;
    $('generatingMessage').textContent = GENERATING_MESSAGES[messageIndex];
  }, 1600);

  try {
    const data = await callWithKeyRotation('generate-quiz', {
      examTitle: state.examTitle,
      subject: state.subject,
      images: state.sourceImages.map((img) => ({ dataUrl: img.dataUrl, mimeType: parseDataUrlMime(img.dataUrl, img.mimeType) })),
      text: state.sourceText,
      questionTypes: typesToList(state.config.types),
      difficulty: state.config.difficulty,
      count: state.config.count,
    });

    if (!data?.questions?.length) throw new Error('The AI did not return any questions. Try again with clearer source material.');

    data.timeLimitMinutes = Number($('timeLimitInput').value) || 0;
    state.quiz = data;
    clearInterval(generatingMessageTimer);
    saveGeneratedQuizAndReturnToLibrary();
  } catch (err) {
    clearInterval(generatingMessageTimer);
    $('generatingSpinner').hidden = true;
    $('generatingMessage').textContent = '';
    $('generatingErrorCard').hidden = false;
    if (err.allKeysExhausted) {
      $('generatingErrorText').innerHTML = `${esc(err.message)} <a href="#" class="js-goto-profile-link">Add another key</a> or <a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener">enable billing</a> on one of them.`;
      const link = $('generatingErrorText').querySelector('.js-goto-profile-link');
      link?.addEventListener('click', (e) => { e.preventDefault(); switchTab('profile'); });
    } else {
      $('generatingErrorText').textContent = err.message || 'Something went wrong generating the exam.';
    }
    $('btnBackToConfigure').hidden = false;
  }
}

/* ============ Auto-Extract (no AI) ============ */

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'by', 'from', 'into', 'than', 'then', 'which', 'who', 'whom', 'their', 'his', 'her', 'they', 'he', 'she', 'we', 'you', 'i']);

function extractSentences(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 25 && s.length < 240);
}

function pickKeyTerm(sentence) {
  const words = sentence.replace(/[.,!?;:'"()]/g, '').split(' ').filter(Boolean);
  const numberMatch = words.find((w) => /^\d[\d,.]*$/.test(w));
  if (numberMatch) return numberMatch;
  const capMatch = words.find((w, i) => i > 0 && /^[A-Z][a-z]{2,}/.test(w));
  if (capMatch) return capMatch;
  const candidates = words.filter((w) => w.length > 5 && !STOPWORDS.has(w.toLowerCase()));
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || null;
}

function runAutoExtract() {
  const sentences = extractSentences(state.sourceText);
  const seen = new Set();
  const questions = [];

  for (const sentence of sentences) {
    if (questions.length >= state.config.count) break;
    const term = pickKeyTerm(sentence);
    if (!term || seen.has(term.toLowerCase())) continue;
    const blanked = sentence.replace(term, '_____');
    if (blanked === sentence) continue;
    seen.add(term.toLowerCase());
    questions.push({
      id: `q${questions.length + 1}`,
      type: 'identification',
      prompt: `Fill in the blank: ${blanked}`,
      correctAnswer: term,
      acceptableAnswers: [term],
      explanation: sentence,
    });
  }

  if (!questions.length) {
    $('configureEmptyNote').hidden = false;
    $('configureEmptyNote').textContent = 'Could not find enough factual sentences to build questions. Try pasting more detailed text, or use Manual Build instead.';
    return;
  }

  state.quiz = { questions, examTitle: state.examTitle, subject: state.subject, difficulty: 'auto', timeLimitMinutes: Number($('timeLimitInput').value) || 0 };
  saveGeneratedQuizAndReturnToLibrary();
}

/* ============ Manual Build (no AI) ============ */

function renderManualTypeFields() {
  const type = $('manualTypeSelect').value;
  const box = $('manualTypeFields');
  if (type === 'multipleChoice') {
    box.innerHTML = `
      <div class="field-block">
        <span class="field-label">Choices (select the correct one)</span>
        ${[0, 1, 2, 3].map((i) => `
          <div class="manual-choice-row">
            <input type="radio" name="manualMcCorrect" value="${i}" id="manualMcCorrect${i}" ${i === 0 ? 'checked' : ''}>
            <input type="text" class="text-input" id="manualChoice${i}" placeholder="Choice ${i + 1}">
          </div>
        `).join('')}
      </div>`;
  } else if (type === 'trueFalse') {
    box.innerHTML = `
      <label class="field-block">
        <span class="field-label">Correct Answer</span>
        <select class="select-input" id="manualTfCorrect">
          <option value="True">True</option>
          <option value="False">False</option>
        </select>
      </label>`;
  } else if (type === 'identification') {
    box.innerHTML = `
      <label class="field-block">
        <span class="field-label">Correct Answer</span>
        <input type="text" class="text-input" id="manualIdCorrect" placeholder="e.g. Mitochondria">
      </label>
      <label class="field-block">
        <span class="field-label">Other Acceptable Answers (comma-separated, optional)</span>
        <input type="text" class="text-input" id="manualIdAlt" placeholder="e.g. mitochondrion">
      </label>`;
  } else if (type === 'matching') {
    box.innerHTML = `
      <div class="field-block">
        <span class="field-label">Matching Pairs (leave a row blank to skip it)</span>
        ${[0, 1, 2, 3].map((i) => `
          <div class="manual-choice-row">
            <input type="text" class="text-input" id="manualMatchLeft${i}" placeholder="Item ${i + 1}">
            <input type="text" class="text-input" id="manualMatchRight${i}" placeholder="Match ${i + 1}">
          </div>
        `).join('')}
      </div>`;
  } else {
    box.innerHTML = `
      <label class="field-block">
        <span class="field-label">Correct Numeric Answer</span>
        <input type="text" inputmode="decimal" class="text-input" id="manualCalcCorrect" placeholder="e.g. 42">
      </label>`;
  }
}

$('manualTypeSelect').addEventListener('change', renderManualTypeFields);

function renderManualBuilder() {
  renderManualTypeFields();
  renderManualQuestionList();
}

function renderManualQuestionList() {
  $('manualQuestionCount').textContent = state.manualQuestions.length;
  $('manualEmptyNote').hidden = state.manualQuestions.length > 0;
  $('manualQuestionList').innerHTML = state.manualQuestions.map((q, i) => `
    <div class="card result-item">
      <p class="result-item-index">${TYPE_LABELS[q.type]}</p>
      <p class="question-prompt">${esc(q.prompt)}</p>
      <button type="button" class="link-btn js-remove-manual" data-index="${i}">Remove</button>
    </div>
  `).join('');
  $('manualQuestionList').querySelectorAll('.js-remove-manual').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.manualQuestions.splice(Number(btn.dataset.index), 1);
      renderManualQuestionList();
    });
  });
  $('btnStartManualExam').disabled = state.manualQuestions.length === 0;
}

$('btnAddManualQuestion').addEventListener('click', () => {
  const type = $('manualTypeSelect').value;
  const prompt = $('manualPromptInput').value.trim();
  const explanation = $('manualExplanationInput').value.trim();
  if (!prompt) { $('manualPromptInput').focus(); return; }

  const question = { id: `q${state.manualQuestions.length + 1}`, type, prompt, explanation };

  if (type === 'multipleChoice') {
    const choices = [0, 1, 2, 3].map((i) => $(`manualChoice${i}`).value.trim());
    if (choices.some((c) => !c)) return;
    const correctIndex = Number(document.querySelector('input[name="manualMcCorrect"]:checked').value);
    question.choices = choices;
    question.correctAnswer = choices[correctIndex];
  } else if (type === 'trueFalse') {
    question.choices = ['True', 'False'];
    question.correctAnswer = $('manualTfCorrect').value;
  } else if (type === 'identification') {
    const correct = $('manualIdCorrect').value.trim();
    if (!correct) return;
    const alt = $('manualIdAlt').value.split(',').map((s) => s.trim()).filter(Boolean);
    question.correctAnswer = correct;
    question.acceptableAnswers = [correct, ...alt];
  } else if (type === 'matching') {
    const pairs = [0, 1, 2, 3]
      .map((i) => ({ left: $(`manualMatchLeft${i}`).value.trim(), right: $(`manualMatchRight${i}`).value.trim() }))
      .filter((p) => p.left && p.right);
    if (pairs.length < 2) return; // a matching exercise needs at least 2 pairs to mean anything
    question.pairs = pairs;
  } else if (type === 'calculation') {
    const correct = $('manualCalcCorrect').value.trim();
    if (!correct || Number.isNaN(parseFloat(correct))) return;
    question.correctAnswer = correct;
  }

  state.manualQuestions.push(question);
  $('manualPromptInput').value = '';
  $('manualExplanationInput').value = '';
  if (type === 'multipleChoice') [0, 1, 2, 3].forEach((i) => { $(`manualChoice${i}`).value = ''; });
  if (type === 'identification') { $('manualIdCorrect').value = ''; $('manualIdAlt').value = ''; }
  if (type === 'matching') [0, 1, 2, 3].forEach((i) => { $(`manualMatchLeft${i}`).value = ''; $(`manualMatchRight${i}`).value = ''; });
  if (type === 'calculation') { $('manualCalcCorrect').value = ''; }
  renderManualQuestionList();
});

$('btnStartManualExam').addEventListener('click', () => {
  state.quiz = { questions: state.manualQuestions, examTitle: state.examTitle, subject: state.subject, difficulty: 'manual', timeLimitMinutes: Number($('manualTimeLimitInput').value) || 0 };
  saveGeneratedQuizAndReturnToLibrary();
});

// "(2)", "(3)", etc. -- same disambiguation convention as a file manager
// offering a name for a duplicated file, so a saved-as-new-copy exam is
// distinguishable from the original at a glance without forcing the user
// to type a new title themselves first.
function uniqueExamTitle(baseTitle, excludeId) {
  const taken = new Set(LIBRARY_EXAMS.filter((e) => e.id !== excludeId).map((e) => e.title));
  if (!taken.has(baseTitle)) return baseTitle;
  let n = 2;
  while (taken.has(`${baseTitle} (${n})`)) n++;
  return `${baseTitle} (${n})`;
}

// Edit-mode only: saves the current edits as a brand new library entry
// instead of overwriting the one being edited, so the original stays
// intact. Title auto-disambiguated ("(2)", "(3)"...) if it would otherwise
// collide with the original or any other existing exam.
$('btnSaveAsNewCopy').addEventListener('click', () => {
  const originalId = state.currentLibraryId;
  state.examTitle = uniqueExamTitle((state.examTitle || 'Untitled Exam').trim() || 'Untitled Exam', originalId);
  state.currentLibraryId = null; // force a fresh insert rather than upserting into the entry being edited
  state.quiz = { questions: state.manualQuestions, examTitle: state.examTitle, subject: state.subject, difficulty: 'manual', timeLimitMinutes: Number($('manualTimeLimitInput').value) || 0 };
  saveGeneratedQuizAndReturnToLibrary();
});

// Edit-mode only: asks Gemini for a fresh set of questions using the
// CURRENT questions' prompts as pseudo-source material (there's no saved
// original source text/images to regenerate from -- only the questions
// themselves ever get saved), landing back in the Manual Builder for
// review/editing rather than auto-saving, so a bad regeneration is never
// silently substituted for a good exam.
$('btnRegenerateQuiz').addEventListener('click', async () => {
  if (!state.manualQuestions.length) { alert('Add or load at least one question first -- regeneration needs something to work from.'); return; }
  if (!state.geminiApiKeys.length) { alert('Add your Gemini API key in Profile first.'); return; }

  const btn = $('btnRegenerateQuiz');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Regenerating…';

  try {
    const pseudoSourceText = state.manualQuestions
      .map((q) => [q.prompt, q.correctAnswer ? `(answer: ${q.correctAnswer})` : ''].filter(Boolean).join(' '))
      .join('\n');
    const typesPresent = [...new Set(state.manualQuestions.map((q) => q.type))];
    const data = await callWithKeyRotation('generate-quiz', {
      examTitle: state.examTitle,
      subject: state.subject,
      images: [],
      text: pseudoSourceText,
      questionTypes: typesPresent.length ? typesPresent : ['multipleChoice'],
      difficulty: 'medium',
      count: state.manualQuestions.length,
    });
    if (!data?.questions?.length) throw new Error('The AI did not return any questions.');
    state.manualQuestions = data.questions;
    renderManualQuestionList();
  } catch (err) {
    alert(`Could not regenerate: ${err.message || 'something went wrong.'}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

/* ============ Quiz runner ============ */

// Countdown timer, shown top-center during the quiz. Deliberately starts
// counting from the moment the FIRST answer is given, not the moment the
// quiz screen opens -- reading the first question shouldn't burn timed
// minutes. Not persisted across a close/reopen (state.quizTimerStartedAt
// lives only in memory): resuming a timed draft in a later session starts
// the countdown fresh rather than trying to track real-world elapsed time
// while the app was closed, which would need its own separate design
// (and arguably isn't what "time limit" means for a resumable draft).
let quizTimerInterval = null;

function stopQuizTimer() {
  if (quizTimerInterval) { clearInterval(quizTimerInterval); quizTimerInterval = null; }
}

function startQuizTimerIfNeeded() {
  if (state.quizTimerStartedAt || !state.quiz || !state.quiz.timeLimitMinutes) return;
  state.quizTimerStartedAt = Date.now();
  stopQuizTimer();
  quizTimerInterval = setInterval(tickQuizTimer, 1000);
  tickQuizTimer();
}

function tickQuizTimer() {
  if (!state.quiz || !state.quiz.timeLimitMinutes || !state.quizTimerStartedAt) return;
  const totalSeconds = state.quiz.timeLimitMinutes * 60;
  const remaining = totalSeconds - Math.floor((Date.now() - state.quizTimerStartedAt) / 1000);
  const timerEl = $('quizTimer');
  if (remaining <= 0) {
    stopQuizTimer();
    timerEl.textContent = "Time's up!";
    timerEl.classList.add('is-low');
    if (!state.isQuizComplete) {
      alert("Time's up! Submitting your answers now.");
      renderResults(true);
      showCreateStep('results');
    }
    return;
  }
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  timerEl.textContent = `⏱ ${mm}:${String(ss).padStart(2, '0')}`;
  timerEl.classList.toggle('is-low', remaining <= 60);
}

// Live "N/total correct" shown top-right during the quiz -- only objective
// (instantly-gradable) questions the user has actually answered contribute
// to the numerator; essay questions can't be scored without an AI call, so
// they're excluded rather than silently counted as wrong.
function updateLiveQuizScore() {
  const questions = state.quiz.questions;
  const correct = questions.filter((q) => {
    const a = state.answers[q.id];
    return isObjectiveType(q.type) && isAnswered(q, a) && gradeObjectiveQuestion(q, a);
  }).length;
  $('quizLiveScore').textContent = `${correct}/${questions.length}`;
}

// Scratchpad for calculation questions -- a real freehand drawing surface
// to work a problem out on before typing the final answer into the actual
// input below it, not fed into grading at all. Fresh/blank on every
// question render (drawings intentionally don't persist across
// navigation or save -- it's scratch work, not exam content).
const SCRATCHPAD_COLORS = ['#12172B', '#E0455C', '#1B2E8F', '#22B27D'];

function scratchpadHtml() {
  return `
    <div class="scratchpad-card">
      <div class="scratchpad-toolbar">
        <div class="scratchpad-colors">
          ${SCRATCHPAD_COLORS.map((c, i) => `<button type="button" class="scratchpad-swatch${i === 0 ? ' is-active' : ''}" data-color="${c}" style="background:${c}" aria-label="Color"></button>`).join('')}
          <button type="button" class="scratchpad-tool is-active" data-tool="pen" aria-label="Pen">✎</button>
          <button type="button" class="scratchpad-tool" data-tool="eraser" aria-label="Eraser">🧹</button>
        </div>
        <input type="range" min="1" max="16" value="3" class="scratchpad-thickness" id="scratchpadThickness" aria-label="Line thickness">
        <div class="scratchpad-actions">
          <button type="button" class="count-btn" id="btnScratchpadZoomOut" aria-label="Zoom out">−</button>
          <button type="button" class="count-btn" id="btnScratchpadZoomExtent" aria-label="Reset zoom">⤢</button>
          <button type="button" class="count-btn" id="btnScratchpadZoomIn" aria-label="Zoom in">+</button>
          <button type="button" class="count-btn" id="btnScratchpadExpand" aria-label="Expand">⤢H</button>
          <button type="button" class="count-btn" id="btnScratchpadClear" aria-label="Clear">🗑</button>
        </div>
      </div>
      <div class="scratchpad-viewport" id="scratchpadViewport">
        <canvas id="scratchpadCanvas" width="1000" height="600"></canvas>
      </div>
    </div>`;
}

function setupScratchpad() {
  const canvas = $('scratchpadCanvas');
  const viewport = $('scratchpadViewport');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let tool = 'pen';
  let color = SCRATCHPAD_COLORS[0];
  let zoom = 1;
  let drawing = false;

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * canvas.width, y: (e.clientY - rect.top) / rect.height * canvas.height };
  }

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = canvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = canvasPoint(e);
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = Number($('scratchpadThickness').value) * (tool === 'eraser' ? 3 : 1);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => canvas.addEventListener(evt, () => { drawing = false; }));

  $('scratchpadViewport').closest('.scratchpad-card').querySelectorAll('.scratchpad-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      color = btn.dataset.color;
      tool = 'pen';
      $('scratchpadViewport').closest('.scratchpad-card').querySelectorAll('.scratchpad-swatch, .scratchpad-tool').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      $('scratchpadViewport').closest('.scratchpad-card').querySelector('.scratchpad-tool[data-tool="pen"]').classList.add('is-active');
    });
  });
  $('scratchpadViewport').closest('.scratchpad-card').querySelectorAll('.scratchpad-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      $('scratchpadViewport').closest('.scratchpad-card').querySelectorAll('.scratchpad-tool').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  function applyZoom() {
    canvas.style.width = `${1000 * zoom}px`;
    canvas.style.height = `${600 * zoom}px`;
  }
  $('btnScratchpadZoomIn').addEventListener('click', () => { zoom = Math.min(3, zoom + 0.25); applyZoom(); });
  $('btnScratchpadZoomOut').addEventListener('click', () => { zoom = Math.max(0.5, zoom - 0.25); applyZoom(); });
  $('btnScratchpadZoomExtent').addEventListener('click', () => { zoom = 1; applyZoom(); viewport.scrollLeft = 0; viewport.scrollTop = 0; });
  $('btnScratchpadClear').addEventListener('click', () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
  $('btnScratchpadExpand').addEventListener('click', (e) => {
    viewport.classList.toggle('is-expanded');
    e.target.textContent = viewport.classList.contains('is-expanded') ? '⤡H' : '⤢H';
  });
}

// Tappable question-number pills -- lets the user skip a hard question and
// come back to it later without paging through every question in between
// via Previous/Next, and makes it obvious at a glance which ones still
// need an answer (filled = answered, outlined = not, solid = current).
function renderQuizNav(total) {
  const row = $('quizNavRow');
  row.innerHTML = state.quiz.questions.map((q, i) => {
    const answered = isAnswered(q, state.answers[q.id]);
    const cls = ['quiz-nav-pill', i === state.quizIndex ? 'is-current' : (answered ? 'is-answered' : '')].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-index="${i}">${i + 1}</button>`;
  }).join('');
  row.querySelectorAll('.quiz-nav-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.quizIndex = Number(btn.dataset.index);
      renderQuizQuestion();
    });
  });
}

function renderQuizQuestion() {
  const question = state.quiz.questions[state.quizIndex];
  const total = state.quiz.questions.length;
  const progress = Math.round(((state.quizIndex + 1) / total) * 100);

  $('quizProgressFill').style.width = `${progress}%`;
  $('quizExamTitle').textContent = state.examTitle || 'Exam';
  $('quizProgressLabel').textContent = `Question ${state.quizIndex + 1} of ${total}`;
  $('questionTypeTag').textContent = TYPE_LABELS[question.type] || question.type;
  $('questionPrompt').textContent = question.prompt;
  updateLiveQuizScore();
  renderQuizNav(total);

  const timerEl = $('quizTimer');
  timerEl.hidden = !state.quiz.timeLimitMinutes;
  if (state.quiz.timeLimitMinutes && !state.quizTimerStartedAt) {
    // Not started yet -- show the full duration as a preview rather than
    // a blank/zeroed timer, so it's clear up front what the limit is.
    timerEl.textContent = `⏱ ${state.quiz.timeLimitMinutes}:00`;
    timerEl.classList.remove('is-low');
  }

  const answer = state.answers[question.id];
  const area = $('questionAnswerArea');
  const hasAnswer = isAnswered(question, answer);
  // "Show correct answer on wrong answers" -- locks the question the moment
  // it's answered wrong (not just displays a note off to the side): the
  // wrong choice can no longer be changed, only the correct one is made
  // clear, right on the question itself.
  const isWrong = hasAnswer && isObjectiveType(question.type) && !gradeObjectiveQuestion(question, answer);
  const locked = state.showCorrectAnswers && isWrong;

  if (question.type === 'multipleChoice' || question.type === 'trueFalse') {
    const options = (question.choices?.length ? question.choices : ['True', 'False']).map((c) => ({ value: c, label: c }));
    area.innerHTML = `<div class="choice-list">${options.map(({ value, label }) => {
      const isSelected = answer === value;
      const isCorrectChoice = locked && value === question.correctAnswer;
      const isWrongChoice = locked && isSelected && value !== question.correctAnswer;
      const cls = ['choice-option', isSelected ? 'is-selected' : '', isCorrectChoice ? 'is-correct' : '', isWrongChoice ? 'is-incorrect' : '', locked ? 'is-locked' : ''].filter(Boolean).join(' ');
      const radioCls = ['choice-radio', isSelected ? 'is-selected' : '', isCorrectChoice ? 'is-correct' : '', isWrongChoice ? 'is-incorrect' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-choice="${esc(value)}"${locked ? ' disabled' : ''}>
        <span class="${radioCls}"></span><span>${esc(label)}</span>
      </button>`;
    }).join('')}</div>`;
    if (!locked) {
      area.querySelectorAll('.choice-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.answers[question.id] = btn.dataset.choice;
          startQuizTimerIfNeeded();
          renderQuizQuestion();
        });
      });
    }
  } else if (question.type === 'identification' || question.type === 'calculation') {
    const inputMode = question.type === 'calculation' ? ' inputmode="decimal"' : '';
    const placeholder = question.type === 'calculation' ? 'Enter a numeric answer' : 'Type your answer';
    const scratchpad = question.type === 'calculation' ? scratchpadHtml() : '';
    area.innerHTML = `${scratchpad}<input type="text"${inputMode} class="text-input${locked ? ' answer-input-locked' : ''}" id="answerInput" placeholder="${placeholder}" value="${esc(answer || '')}"${locked ? ' readonly' : ''}>`;
    if (question.type === 'calculation') setupScratchpad();
    if (!locked) {
      $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; startQuizTimerIfNeeded(); updateLiveQuizScore(); });
      // Instant-choice types (above) lock the moment you click; a typed
      // answer can't grade until you're done typing -- blur (tabbing/
      // clicking away) is the natural "on the spot" moment for these.
      $('answerInput').addEventListener('blur', () => renderQuizQuestion());
    }
  } else if (question.type === 'matching') {
    const pairs = question.pairs || [];
    // Shuffled once per question (cached on the question object itself) so
    // the right-hand options don't visibly reorder themselves after every
    // dropdown change -- shuffled at all so the correct match isn't just
    // "whichever option is in the same row."
    if (!question._matchingOptions) question._matchingOptions = shuffleArray(pairs.map((p) => p.right));
    const rightOptions = question._matchingOptions;
    area.innerHTML = `<div class="matching-list">${pairs.map((pair, i) => {
      const selected = answer && answer[i];
      const pairCorrect = locked && selected === pair.right;
      const pairWrong = locked && selected && selected !== pair.right;
      const rowCls = ['matching-row', pairCorrect ? 'is-correct' : '', pairWrong ? 'is-incorrect' : ''].filter(Boolean).join(' ');
      return `<div class="${rowCls}">
        <span class="matching-left">${esc(pair.left)}</span>
        <select class="select-input matching-select" data-index="${i}"${locked ? ' disabled' : ''}>
          <option value="">Select match…</option>
          ${rightOptions.map((opt) => `<option value="${esc(opt)}"${selected === opt ? ' selected' : ''}>${esc(opt)}</option>`).join('')}
        </select>
      </div>`;
    }).join('')}</div>`;
    if (!locked) {
      area.querySelectorAll('.matching-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const current = state.answers[question.id] || {};
          state.answers[question.id] = { ...current, [Number(e.target.dataset.index)]: e.target.value };
          startQuizTimerIfNeeded();
          renderQuizQuestion();
        });
      });
    }
  } else {
    area.innerHTML = `<textarea class="text-input" id="answerInput" rows="6" placeholder="Write your answer…">${esc(answer || '')}</textarea>`;
    $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; startQuizTimerIfNeeded(); });
  }

  $('btnQuizPrev').disabled = state.quizIndex === 0;
  $('btnQuizNext').textContent = state.quizIndex < total - 1 ? 'Next' : 'Finish exam';

  const toggle = $('showCorrectAnswersToggle');
  toggle.checked = !!state.showCorrectAnswers;
  const existingNote = area.parentNode.querySelector('.correct-answer-note');
  if (existingNote) existingNote.remove();
  if (locked) {
    const note = document.createElement('div');
    note.className = 'result-answer correct-answer-note';
    const answerText = question.type === 'matching'
      ? `<strong>Correct matches:</strong><br>${(question.pairs || []).map((p) => `${esc(p.left)} &rarr; ${esc(p.right)}`).join('<br>')}`
      : `<strong>Correct answer:</strong> ${esc(question.correctAnswer)}`;
    note.innerHTML = answerText + (question.explanation ? `<p class="result-explanation" style="margin-top:6px;">${esc(question.explanation)}</p>` : '');
    area.parentNode.appendChild(note);
  }
}

$('btnQuizPrev').addEventListener('click', () => {
  if (state.quizIndex > 0) { state.quizIndex -= 1; renderQuizQuestion(); }
});
$('btnQuizNext').addEventListener('click', () => {
  if (state.quizIndex < state.quiz.questions.length - 1) {
    state.quizIndex += 1;
    renderQuizQuestion();
  } else {
    // Won't let the exam end with a blank question -- jumps to the first
    // unanswered one (via the same nav pills) instead of finishing, rather
    // than silently scoring skipped questions as wrong.
    const firstUnanswered = state.quiz.questions.findIndex((q) => !isAnswered(q, state.answers[q.id]));
    if (firstUnanswered !== -1) {
      alert(`Question ${firstUnanswered + 1} is still unanswered. Answer every question before finishing.`);
      state.quizIndex = firstUnanswered;
      renderQuizQuestion();
      return;
    }
    renderResults(true);
    showCreateStep('results');
  }
});

// Attached once here (not inside renderResults(), which runs every time the
// results screen is shown -- including after every repeat) so repeating a
// quiz multiple times in one session doesn't stack up duplicate listeners
// that each re-fire the shuffle-and-reset on a single click.
$('btnRepeatQuiz').addEventListener('click', () => {
  if (!state.quiz || !state.quiz.questions) return;
  state.quiz = { ...state.quiz, questions: shuffleArray(state.quiz.questions) };
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  state.isQuizComplete = false; // was never reset here, so a repeat attempt could never be saved as a new completion
  renderQuizQuestion();
  showCreateStep('quiz');
});

/* ============ Grading ============ */

function normalize(str) {
  return String(str ?? '').toLowerCase().trim().replace(/[.,!?;:'"()]/g, '').replace(/\s+/g, ' ');
}

function isObjectiveType(type) {
  return (
    type === 'multipleChoice' ||
    type === 'trueFalse' ||
    type === 'identification' ||
    type === 'matching' ||
    type === 'calculation'
  );
}

// Matching-type answers aren't a single value like every other type -- they're
// an object keyed by pair index (`{0: 'chosen right-side value', 1: ...}`),
// since the question itself holds multiple left/right pairs. "Answered"
// means every pair has a selection; a matching question only locks/grades
// once fully attempted, not after the first pair.
function isAnswered(question, answer) {
  if (question.type === 'matching') {
    const pairs = question.pairs || [];
    return pairs.length > 0 && pairs.every((_, i) => answer && answer[i] !== undefined && answer[i] !== '');
  }
  return answer !== undefined && answer !== null && String(answer).trim() !== '';
}

function gradeObjectiveQuestion(question, answer) {
  if (!isAnswered(question, answer)) return false;
  if (question.type === 'multipleChoice' || question.type === 'trueFalse') {
    return normalize(answer) === normalize(question.correctAnswer);
  }
  if (question.type === 'identification') {
    const accepted = (question.acceptableAnswers?.length ? question.acceptableAnswers : [question.correctAnswer]).map(normalize);
    return accepted.includes(normalize(answer));
  }
  if (question.type === 'calculation') {
    const given = parseFloat(String(answer).replace(/,/g, ''));
    const expected = parseFloat(String(question.correctAnswer).replace(/,/g, ''));
    if (Number.isNaN(given) || Number.isNaN(expected)) return false;
    const tolerance = Math.max(0.01, Math.abs(expected) * 0.01);
    return Math.abs(given - expected) <= tolerance;
  }
  if (question.type === 'matching') {
    // All-or-nothing: every pair has to be matched correctly for this
    // question to count as correct, same single correct/incorrect model
    // every other question type uses -- no partial credit per pair.
    return (question.pairs || []).every((pair, i) => answer[i] === pair.right);
  }
  return false;
}

// Shared by the quiz runner's lock note and the results screen -- matching
// answers are a {pairIndex: rightValue} object, not a plain string like
// every other type, so both display spots need this instead of just
// stringifying question.correctAnswer / the raw answer value.
function formatCorrectAnswerText(question) {
  if (question.type === 'matching') {
    return (question.pairs || []).map((p) => `${p.left} → ${p.right}`).join('; ');
  }
  return question.correctAnswer;
}
function formatUserAnswerText(question, answer) {
  if (question.type === 'matching') {
    if (!isAnswered(question, answer)) return '';
    return (question.pairs || []).map((p, i) => `${p.left} → ${answer[i] || '?'}`).join('; ');
  }
  return answer;
}

// Shared by the live results screen and the completion-save history log
// (see saveCurrentQuizToLibrary) so a saved attempt's score always matches
// what was actually shown on screen -- essay questions count via their
// AI-graded score/100 once available, same weighting as the results screen.
function computeQuizScorePercent(quiz, answers, essayGrades) {
  const questions = quiz.questions || [];
  if (!questions.length) return 0;
  const objectiveQuestions = questions.filter((q) => isObjectiveType(q.type));
  const objectiveCorrect = objectiveQuestions.filter((q) => gradeObjectiveQuestion(q, answers[q.id])).length;
  const essayScores = questions.filter((q) => q.type === 'essay').map((q) => essayGrades[q.id]?.score).filter((s) => typeof s === 'number');
  const totalPoints = objectiveCorrect + essayScores.reduce((sum, s) => sum + s / 100, 0);
  return Math.round((totalPoints / questions.length) * 100);
}

/* ============ Results ============ */

// justFinished=true only for a live "Finish exam" completion -- distinct
// from re-opening an already-saved completed exam via viewCompletedExam(),
// which also calls this function to reuse the same rendering but must NOT
// save a fresh duplicate library entry every time someone reviews it.
async function renderResults(justFinished) {
  const questions = state.quiz.questions;
  const objectiveQuestions = questions.filter((q) => isObjectiveType(q.type));
  const essayQuestions = questions.filter((q) => q.type === 'essay');
  const objectiveCorrect = objectiveQuestions.filter((q) => gradeObjectiveQuestion(q, state.answers[q.id])).length;

  $('resultsExamTitle').textContent = `${state.examTitle || 'Exam'} • Results`;

  function paintScore() {
    const essayScores = essayQuestions.map((q) => state.essayGrades[q.id]?.score).filter((s) => typeof s === 'number');
    const essayAvg = essayScores.length ? essayScores.reduce((a, b) => a + b, 0) / essayScores.length : null;
    const overallPct = computeQuizScorePercent(state.quiz, state.answers, state.essayGrades);
    $('resultsScoreValue').textContent = `${overallPct}%`;

    const ungraded = essayQuestions.some((q) => !state.essayGrades[q.id] && String(state.answers[q.id] || '').trim());
    let summary = `${objectiveCorrect} / ${objectiveQuestions.length} objective correct`;
    if (essayQuestions.length) summary += essayAvg !== null ? ` • essay avg ${Math.round(essayAvg)}%` : ungraded ? ' • grading essays…' : '';
    $('resultsSummary').textContent = summary;
  }

  function paintList() {
    $('resultsList').innerHTML = questions.map((question, index) => {
      const userAnswer = state.answers[question.id];
      const objective = isObjectiveType(question.type);
      const correct = objective ? gradeObjectiveQuestion(question, userAnswer) : null;
      const essayGrade = !objective ? state.essayGrades[question.id] : null;

      const userAnswerText = formatUserAnswerText(question, userAnswer);
      return `
        <div class="card result-item${objective ? (correct ? ' is-correct' : ' is-incorrect') : ''}">
          <p class="result-item-index">Question ${index + 1}</p>
          <p class="question-prompt">${esc(question.prompt)}</p>
          <p class="result-answer"><strong>Your answer:</strong> ${userAnswerText ? esc(String(userAnswerText)) : '<em>No answer</em>'}</p>
          ${objective && !correct ? `<p class="result-answer"><strong>Correct answer:</strong> ${esc(String(formatCorrectAnswerText(question)))}</p>` : ''}
          ${question.explanation ? `<p class="result-explanation">${esc(question.explanation)}</p>` : ''}
          ${!objective ? (essayGrade
            ? `<div class="essay-grade">${typeof essayGrade.score === 'number' ? `<span class="essay-score">${essayGrade.score}/100</span>` : ''}<p class="result-explanation">${esc(essayGrade.feedback)}</p></div>`
            : '<p class="result-explanation">Grading…</p>') : ''}
        </div>
      `;
    }).join('');
  }

  paintScore();
  paintList();

  const ungraded = essayQuestions.filter((q) => !state.essayGrades[q.id] && String(state.answers[q.id] || '').trim());
  if (ungraded.length) {
    await Promise.all(ungraded.map(async (q) => {
      try {
        const result = await callWithKeyRotation('grade-essay', {
          question: q.prompt,
          expectedAnswer: q.expectedAnswer,
          rubric: q.rubric,
          answer: state.answers[q.id],
        });
        state.essayGrades[q.id] = result;
      } catch (err) {
        state.essayGrades[q.id] = { score: null, feedback: `Could not grade automatically: ${err.message}` };
      }
    }));
    paintScore();
    paintList();
  }

  // Real completion save -- previously nothing ever called the old
  // saveQuizToLibrary()/similar at all, so finishing a quiz never actually
  // added anything to the library or Recent Exams no matter how many exams
  // were completed. Guarded by isQuizComplete so essay-grading's own
  // paintScore()/paintList() re-render above (and any future re-render of
  // this same screen) can't save a second duplicate entry.
  if (justFinished && !state.isQuizComplete) {
    state.isQuizComplete = true;
    saveCurrentQuizToLibrary('completed');
  }
}

$('btnCreateAnother').addEventListener('click', resetCreateFlow);

/* ============ Init ============ */

initTheme();
refreshGeminiKeyStatus();
renderHome();
resetCreateFlow();
document.querySelector('.app-header-version').textContent = APP_VERSION;

// Was two separate, near-duplicate functions (saveQuizToLibrary,
// saveAsDraft) that each built their own newExam object -- consolidated
// into one, since "completed" and "draft" only ever differed by status and
// a couple of extra draft-only fields. Also now persists (see
// saveLibraryExams above) and, for completed exams, captures the actual
// answers/grades so a finished exam can be reviewed later instead of just
// remembered as having existed.
function saveCurrentQuizToLibrary(status) {
  if (!state.quiz || !state.examTitle) return undefined;

  // Upsert, not always-insert: resuming a draft (continueQuizFromLibrary sets
  // state.currentLibraryId) and then triggering another auto-save -- e.g.
  // closing the tab again before finishing -- previously created a second,
  // near-identical duplicate entry every single time, since the old code
  // always unshifted a brand new object. Found via an actual resume-then-
  // reload test, not just reading the code.
  const existing = state.currentLibraryId
    ? LIBRARY_EXAMS.find((e) => e.id === state.currentLibraryId)
    : null;

  // Attempt history -- a real log of every completed attempt's date/score,
  // not just whatever the most recent attempt happened to be. Carried
  // forward from the existing entry (if any) so retaking an exam adds to
  // the log instead of erasing it.
  const priorHistory = existing?.history || [];
  const history = status === 'completed'
    ? [...priorHistory, { date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), scorePercent: computeQuizScorePercent(state.quiz, state.answers, state.essayGrades) }]
    : priorHistory;

  const newExam = {
    id: existing ? existing.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    subject: state.subject || 'General',
    title: state.examTitle,
    examTitle: state.examTitle,
    questionCount: state.quiz.questions ? state.quiz.questions.length : 0,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    excerpt: state.quiz.questions && state.quiz.questions[0]
      ? (state.quiz.questions[0].prompt || 'Exam generated from uploaded material')
      : 'Exam generated from uploaded material',
    status,
    badge: state.quiz.questions ? state.quiz.questions.length.toString() : '0',
    tag: state.subject ? state.subject.toLowerCase().replace(/\s+/g, '-') : 'general',
    quizData: state.quiz,
    // Saved regardless of status now (was completed-only) -- a draft needs
    // its in-progress answers/position saved too, or "Continue Quiz" has
    // nothing real to resume from.
    answers: { ...state.answers },
    essayGrades: { ...state.essayGrades },
    quizIndex: state.quizIndex,
    history,
  };

  if (existing) {
    LIBRARY_EXAMS.splice(LIBRARY_EXAMS.indexOf(existing), 1);
  }
  LIBRARY_EXAMS.unshift(newExam);
  state.currentLibraryId = newExam.id;
  saveLibraryExams();
  return newExam;
}

// Was: all three creation paths (AI Generate, Manual Build, Auto-Extract)
// jumped straight into live quiz-taking the instant a quiz was ready.
// Now a freshly created exam is only ever saved as a draft and the user
// lands back on the Library, where they choose when to actually take it --
// matches "create it now, take it later" rather than forcing an immediate
// attempt right after generation.
function saveGeneratedQuizAndReturnToLibrary() {
  if (!state.examTitle || !state.examTitle.trim()) state.examTitle = 'Untitled Exam';
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  state.isQuizComplete = false;
  state.currentLibraryId = null; // definitely a brand new quiz, not continuing an existing library entry
  saveCurrentQuizToLibrary('draft');
  state.libraryTab = 'draft';
  switchTab('library');
  renderLibrary();
  alert('Exam created! Find it in your Library (Drafts) whenever you\'re ready to take it.');
}

// Auto-save draft when user navigates away from quiz
function setupAutoSave() {
  // Was: fired for ANY unfinished quiz sitting in state.quiz, even long
  // after returning to Library/Home once it had been saved as a draft --
  // state.quiz doesn't get cleared just because the screen changed. Scoped
  // to actually being on the quiz-taking screen, which is what "warn during
  // quiz taking" means. Note: no browser lets a page set its own
  // beforeunload dialog text anymore (Chrome/Firefox/Safari all show a
  // fixed generic "Leave site?" message regardless of e.returnValue) --
  // that's a platform restriction, not something fixable here. What IS
  // real: the answer is already saved before the prompt even appears, so a
  // refresh the user goes through with anyway loses nothing.
  window.addEventListener('beforeunload', function(e) {
    if (state.createStep === 'quiz' && state.quiz && state.examTitle && !state.isQuizComplete) {
      saveCurrentQuizToLibrary('draft');
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
}

// Show version popup
// Real check-for-update: fetches the live deployed app.js and compares its
// APP_VERSION against this build's own -- same idea as Winfinity's own
// update system, simplified since QuizForge's service worker doesn't have
// a SKIP_WAITING message-based lifecycle to hook into (see sw.js). "Update
// Now" instead unregisters the current worker and clears every cache
// before reloading, which forces a fully fresh fetch of everything -- less
// nuanced than Winfinity's approach, but real and reliable rather than a
// placeholder alert.
//
// NONE of that applies inside the packaged Android app, though: the APK
// bundles a snapshot of these files at build time (see README's "Building
// the Android APK") -- there's no live app.js to re-fetch, and reloading
// just reloads the same bundled copy. isNativeApp() below detects that
// context and switches to a different real mechanism: check GitHub's
// latest Release via its API, and if newer, open that release's .apk
// directly. Because it's built with the SAME package ID
// (io.github.winfos.quizforge) and a higher version number, Android
// installs it as an UPDATE to the existing app in place -- not a second,
// separate app -- the same way any sideloaded APK update works outside
// the Play Store. The user still has to tap through Android's own
// install/update confirmation dialog; nothing can silently self-install
// without root or an MDM-managed device, Play Store or not.
// NOT verified on a real device -- this repo has no way to run/test an
// actual Android install flow. Confirm on-device before relying on it.
let latestKnownVersion = null;
let latestApkDownloadUrl = null;

function isNativeApp() {
  return typeof window.Capacitor !== 'undefined' && !!window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
}

function extractVersionNumber(str) {
  const m = String(str || '').match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

async function checkForUpdateNative() {
  try {
    const res = await fetch('https://api.github.com/repos/WinF-os/QuizForge/releases/latest');
    if (!res.ok) return null;
    const data = await res.json();
    const asset = (data.assets || []).find((a) => a.name.toLowerCase().endsWith('.apk'));
    const remoteVersion = extractVersionNumber(data.tag_name);
    if (!remoteVersion || !asset) return null;
    latestKnownVersion = remoteVersion;
    latestApkDownloadUrl = asset.browser_download_url;
    return remoteVersion;
  } catch (e) {
    return null;
  }
}

async function checkForUpdate() {
  if (isNativeApp()) return checkForUpdateNative();
  try {
    const res = await fetch('https://winf-os.github.io/QuizForge/app.js?nocache=' + Date.now());
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (match) latestKnownVersion = match[1];
    return match ? match[1] : null;
  } catch (e) {
    return null; // offline or unreachable -- silently no-op, same as Winfinity's own background check
  }
}

async function applyUpdate() {
  if (isNativeApp()) {
    // Can't silently self-update -- opens the .apk download, same proven
    // pattern already used for the "Get a Free Gemini API Key" link.
    // Android takes over from there (download -> install-as-update prompt).
    if (latestApkDownloadUrl) window.open(latestApkDownloadUrl, '_blank', 'noopener');
    return;
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    location.reload();
  }
}

function isAutoUpdateEnabled() {
  // Auto-apply never fires in the native app regardless of this toggle --
  // applyUpdate() there opens an external download, which should only ever
  // happen from an explicit tap, not silently switch the user out to a
  // browser in the background.
  if (isNativeApp()) return false;
  return localStorage.getItem('quizforge-auto-update') !== '0'; // on by default, matching the popup's own default-checked toggle
}

async function showVersionPopup() {
  let popup = document.getElementById('versionPopup');

  if (!popup) {
    const popupHTML = `
      <div class="version-popup" id="versionPopup">
        <div class="version-popup-content">
          <div class="version-popup-header">
            <h2 class="version-popup-title">QuizForge</h2>
            <span class="version-popup-version">${esc(APP_VERSION)}</span>
          </div>
          <p id="versionPopupStatus">Checking for updates…</p>
          <div class="version-popup-actions">
            <label class="toggle-switch">
              <input type="checkbox" id="autoUpdateToggle">
              <span class="slider"></span>
            </label>
            <span class="toggle-label">Auto-update</span>
            <button class="update-btn" id="updateButton" hidden>Update Now</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', popupHTML);
    popup = document.getElementById('versionPopup');

    document.getElementById('updateButton').addEventListener('click', applyUpdate);
    document.getElementById('autoUpdateToggle').addEventListener('change', function () {
      localStorage.setItem('quizforge-auto-update', this.checked ? '1' : '0');
    });
    popup.addEventListener('click', function (e) {
      if (e.target === popup) popup.classList.remove('is-visible');
    });
  }

  document.getElementById('autoUpdateToggle').checked = isAutoUpdateEnabled();
  popup.classList.add('is-visible');

  const statusEl = document.getElementById('versionPopupStatus');
  const updateBtn = document.getElementById('updateButton');
  statusEl.textContent = 'Checking for updates…';
  updateBtn.hidden = true;
  const remoteVersion = await checkForUpdate();
  const currentVersion = isNativeApp() ? extractVersionNumber(APP_VERSION) : APP_VERSION;
  if (!remoteVersion) {
    statusEl.textContent = "Could not check for updates -- you're offline, or GitHub is unreachable.";
  } else if (remoteVersion === currentVersion) {
    statusEl.textContent = "You're on the latest version.";
  } else {
    statusEl.textContent = isNativeApp()
      ? `A new version is available: ${esc(remoteVersion)}. Tap Update Now to download it -- Android will ask you to confirm installing it as an update.`
      : `A new version is available: ${esc(remoteVersion)}.`;
    updateBtn.hidden = false;
    if (isAutoUpdateEnabled()) applyUpdate();
  }
  refreshUpdateBadge();
}

// Background check on load (not just when the popup is opened), same
// convention as Winfinity's own "check ~5s after load" behavior -- lets
// auto-update actually apply without the user ever opening the popup.
setTimeout(() => { checkForUpdate().then((v) => { refreshUpdateBadge(); if (v && v !== currentComparableVersion() && isAutoUpdateEnabled()) applyUpdate(); }); }, 5000);

// Version button -> the real popup (checkForUpdate/applyUpdate above),
// replacing the old placeholder alert entirely. initTheme/renderHome/etc.
// already ran once in the single Init block near the top of this file --
// deliberately NOT repeated here.
const versionButton = document.getElementById('versionButton');
if (versionButton) versionButton.addEventListener('click', showVersionPopup);

// Profile-tab update control -- same real checkForUpdate()/applyUpdate()
// as the header popup above (not a separate implementation), just a second
// place to reach it plus a small notification badge that lights up
// whenever a background or manual check has found a newer version, same
// idea as Winfinity's own Profile-tab update button/badge.
// Native compares bare "1.2.3"-style numbers (extracted from a GitHub
// release tag); web compares the raw APP_VERSION string against itself as
// served live -- these are two different formats, comparing the wrong
// pair silently made the app think an update was always/never available.
function currentComparableVersion() {
  return isNativeApp() ? extractVersionNumber(APP_VERSION) : APP_VERSION;
}

function refreshUpdateBadge() {
  const hasUpdate = !!(latestKnownVersion && latestKnownVersion !== currentComparableVersion());
  const badge = document.getElementById('profileUpdateBadge');
  if (badge) badge.hidden = !hasUpdate;
  const btn = document.getElementById('btnProfileCheckUpdate');
  if (btn) btn.textContent = hasUpdate ? 'Update Now' : 'Check for Updates';
}

document.getElementById('profileVersionText').textContent = APP_VERSION;

document.getElementById('btnProfileCheckUpdate').addEventListener('click', async () => {
  const btn = document.getElementById('btnProfileCheckUpdate');
  const status = document.getElementById('profileUpdateStatus');

  if (latestKnownVersion && latestKnownVersion !== currentComparableVersion()) {
    applyUpdate();
    return;
  }

  btn.disabled = true;
  status.textContent = 'Checking for updates…';
  const remoteVersion = await checkForUpdate();
  btn.disabled = false;
  refreshUpdateBadge();

  if (!remoteVersion) {
    status.textContent = "Could not check for updates -- you're offline, or GitHub is unreachable.";
  } else if (remoteVersion === currentComparableVersion()) {
    status.textContent = "You're on the latest version.";
  } else {
    status.textContent = isNativeApp()
      ? `A new version is available: ${esc(remoteVersion)}. Tap Update Now to download it -- Android will ask you to confirm installing it as an update.`
      : `A new version is available: ${esc(remoteVersion)}. Tap Update Now to install it.`;
    if (isAutoUpdateEnabled()) applyUpdate();
  }
});

setupAutoSave();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Service worker registration failed:', error);
    });
  });
}

// "Show correct answer on wrong answers" toggle -- the actual display
// logic lives in renderQuizQuestion(), which re-renders on every answer/
// navigation; this listener just needs to update the flag and re-render
// once so the current question reflects the new setting immediately.
$('showCorrectAnswersToggle').addEventListener('change', (e) => {
  state.showCorrectAnswers = e.target.checked;
  if (state.quiz) renderQuizQuestion();
});

// "Save as Draft" was removed -- completion is always auto-saved now (see
// the completion hook in renderResults), so a separate manual save button
// after finishing didn't do anything a completed exam wasn't already doing.
// "Edit Quiz" from the results screen edits whichever library entry this
// completed attempt was just saved into.
$('btnEditQuizFromResults').addEventListener('click', () => {
  const item = LIBRARY_EXAMS.find((e) => e.id === state.currentLibraryId);
  if (item) editQuizFromLibrary(item);
});

// Continue a draft exactly where it was left -- restores the saved
// answers/position instead of resetting them. (Originally this called a
// `renderQuiz()` that didn't exist anywhere in the file and reset all
// progress unconditionally; fixed alongside adding a real distinction
// between "continue" and "retake" below, once saveCurrentQuizToLibrary
// started actually persisting in-progress answers for drafts too.)
function continueQuizFromLibrary(item) {
  if (!item || !item.quizData) return;

  // Spread the whole quizData object, not just .questions -- was dropping
  // every other quiz-level property (timeLimitMinutes, difficulty) on
  // every resume, found via an actual test: a saved time limit silently
  // vanished the moment a draft was reopened.
  state.quiz = { ...item.quizData, questions: item.quizData.questions || [] };
  state.subject = item.subject;
  state.examTitle = item.examTitle || item.title;
  state.answers = item.answers ? { ...item.answers } : {};
  state.essayGrades = item.essayGrades ? { ...item.essayGrades } : {};
  state.quizIndex = Math.min(item.quizIndex || 0, (item.quizData.questions || []).length - 1);
  state.isQuizComplete = false;
  state.quizTimerStartedAt = null; // fresh countdown for this session, see comment on that field
  state.currentLibraryId = item.id || null; // lets a later auto-save update this same entry instead of inserting a duplicate

  switchTab('create');
  showCreateStep('quiz');
  renderQuizQuestion();
}

// Retake -- a genuinely fresh attempt: clears answers/position and
// reshuffles, same as the in-quiz "Repeat Quiz" button, but reachable
// directly from the Library for a draft or a completed exam without first
// opening it. Still upserts into the SAME library entry (via
// currentLibraryId) so retaking doesn't create a duplicate, and still adds
// a new row to that entry's attempt history once finished.
function retakeQuizFromLibrary(item) {
  if (!item || !item.quizData) return;

  state.quiz = { ...item.quizData, questions: shuffleArray(item.quizData.questions || []) };
  state.subject = item.subject;
  state.examTitle = item.examTitle || item.title;
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  state.isQuizComplete = false;
  state.quizTimerStartedAt = null;
  state.currentLibraryId = item.id || null;

  switchTab('create');
  showCreateStep('quiz');
  renderQuizQuestion();
}

// Edit an existing saved exam's questions -- reuses the Manual Builder
// screen (which already has full add/remove support for every question
// type, including the three added this session) rather than building a
// separate inline-edit UI. There's no per-question "modify in place" --
// editing means removing a question and re-adding a corrected version,
// same as building a manual exam from scratch, just pre-loaded with the
// existing questions instead of starting empty. Saving (btnStartManualExam,
// labelled "Save Exam") upserts back into this same library entry via
// currentLibraryId rather than creating a duplicate.
function editQuizFromLibrary(item) {
  if (!item || !item.quizData) return;

  state.manualQuestions = (item.quizData.questions || []).map((q) => ({ ...q }));
  state.examTitle = item.examTitle || item.title;
  state.subject = item.subject;
  state.generationMode = 'manual';
  state.currentLibraryId = item.id || null;

  switchTab('create');
  $('examTitleInput').value = state.examTitle;
  $('subjectSelect').value = state.subject || '';
  $('manualTimeLimitInput').value = item.quizData.timeLimitMinutes || '';
  setGenerationMode('manual');
  $('btnRegenerateQuiz').hidden = false;
  $('btnSaveAsNewCopy').hidden = false;
  renderManualBuilder();
  showCreateStep('manualBuilder');
}

// Builds a single, fully self-contained HTML file that can take this exam
// completely offline -- no dependency on QuizForge itself, no network call,
// no external CSS/JS/fonts (everything inlined). Objective question types
// grade themselves client-side with the same logic as the real app
// (deliberately re-implemented inline, not shared code, since this file
// has to stand entirely on its own once it leaves the app); essay
// questions show the model answer instead of an AI grade, since there's no
// Gemini key or network assumed once shared out.
function buildStandaloneQuizHtml(quiz, examTitle, subject) {
  const questions = quiz.questions || [];
  const dataJson = JSON.stringify({ examTitle, subject, questions });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(examTitle)} — QuizForge Exam</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px 16px 60px; line-height: 1.5; color: #12172B; background: #F5F7FC; }
  h1 { font-size: 1.3rem; margin-bottom: 4px; }
  .sub { color: #6b7280; font-size: 0.85rem; margin-bottom: 20px; }
  .q { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 14px; background: #fff; }
  .q-prompt { font-weight: 600; margin-bottom: 10px; }
  .choice { display: block; width: 100%; text-align: left; padding: 10px 14px; margin-bottom: 6px; border: 1.5px solid #e5e7eb; border-radius: 8px; background: none; font-size: 0.92rem; cursor: pointer; font-family: inherit; }
  .choice.sel { border-color: #1B2E8F; background: #E7EAFB; font-weight: 700; }
  .choice.correct { border-color: #22B27D; background: #e8f8f1; }
  .choice.incorrect { border-color: #E0455C; background: #fdecee; }
  input[type=text], textarea { width: 100%; padding: 10px 12px; border: 1.5px solid #e5e7eb; border-radius: 8px; font-size: 0.92rem; box-sizing: border-box; font-family: inherit; }
  select { width: 100%; padding: 8px; border: 1.5px solid #e5e7eb; border-radius: 8px; font-size: 0.9rem; font-family: inherit; }
  .match-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .match-row span { flex: 1; font-weight: 600; font-size: 0.88rem; }
  .match-row select { flex: 1; }
  .ans-note { margin-top: 10px; padding: 10px; background: #f3f4f6; border-radius: 8px; font-size: 0.85rem; }
  #btnSubmit { width: 100%; padding: 14px; background: #1B2E8F; color: #fff; border: none; border-radius: 999px; font-size: 1rem; font-weight: 700; cursor: pointer; margin-top: 10px; font-family: inherit; }
  #btnSubmit:disabled { opacity: 0.6; }
  #score { text-align: center; padding: 20px; background: #1B2E8F; color: #fff; border-radius: 16px; margin-bottom: 20px; display: none; }
  #score .pct { font-size: 2.2rem; font-weight: 800; }
  @media (prefers-color-scheme: dark) {
    body { background: #12172B; color: #E5E7EB; }
    .q { background: #1a1f36; border-color: #2A2F45; }
    .choice { border-color: #2A2F45; color: #E5E7EB; }
    input, textarea, select { background: #1a1f36; border-color: #2A2F45; color: #E5E7EB; }
    .ans-note { background: #232a47; }
  }
</style>
</head>
<body>
<h1>${esc(examTitle)}</h1>
<p class="sub">${esc(subject || 'General')} &bull; ${questions.length} Questions &bull; Shared from QuizForge (offline copy, not synced back)</p>
<div id="score"><div class="pct" id="scorePct"></div><div id="scoreSummary"></div></div>
<div id="questions"></div>
<button id="btnSubmit" type="button">Submit Answers</button>
<script>
(function(){
  var DATA = ${dataJson};
  var questions = DATA.questions;
  var answers = {};
  var submitted = false;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function normalize(s){ return String(s==null?'':s).toLowerCase().trim().replace(/[.,!?;:'"()]/g,'').replace(/\\s+/g,' '); }
  function isObjective(t){ return ['multipleChoice','trueFalse','identification','matching','calculation'].indexOf(t) !== -1; }
  function isAnswered(q, a){
    if (q.type === 'matching') { var p = q.pairs||[]; return p.length>0 && p.every(function(_,i){ return a && a[i]!==undefined && a[i]!==''; }); }
    return a !== undefined && a !== null && String(a).trim() !== '';
  }
  function grade(q, a){
    if (!isAnswered(q,a)) return false;
    if (q.type==='multipleChoice'||q.type==='trueFalse') return normalize(a)===normalize(q.correctAnswer);
    if (q.type==='identification') {
      var accepted = (q.acceptableAnswers&&q.acceptableAnswers.length?q.acceptableAnswers:[q.correctAnswer]).map(normalize);
      return accepted.indexOf(normalize(a)) !== -1;
    }
    if (q.type==='calculation') {
      var given = parseFloat(String(a).replace(/,/g,'')), expected = parseFloat(String(q.correctAnswer).replace(/,/g,''));
      if (isNaN(given)||isNaN(expected)) return false;
      var tol = Math.max(0.01, Math.abs(expected)*0.01);
      return Math.abs(given-expected) <= tol;
    }
    if (q.type==='matching') return (q.pairs||[]).every(function(p,i){ return a[i]===p.right; });
    return false;
  }

  var el = document.getElementById('questions');
  el.innerHTML = questions.map(function(q, qi){
    var opts = '';
    if (q.type==='multipleChoice') {
      var choices = (q.choices&&q.choices.length)?q.choices:[];
      opts = '<div class="choices" data-qi="'+qi+'">' + choices.map(function(c){
        return '<button type="button" class="choice" data-choice="'+esc(c)+'">'+esc(c)+'</button>';
      }).join('') + '</div>';
    } else if (q.type==='trueFalse') {
      opts = '<div class="choices" data-qi="'+qi+'">'
        + '<button type="button" class="choice" data-choice="True">True</button>'
        + '<button type="button" class="choice" data-choice="False">False</button></div>';
    } else if (q.type==='matching') {
      opts = '<div class="matching" data-qi="'+qi+'">' + (q.pairs||[]).map(function(p, pi){
        var rightOpts = (q.pairs||[]).map(function(x){return x.right;});
        return '<div class="match-row"><span>'+esc(p.left)+'</span><select data-pi="'+pi+'"><option value="">Select…</option>'
          + rightOpts.map(function(r){ return '<option value="'+esc(r)+'">'+esc(r)+'</option>'; }).join('')
          + '</select></div>';
      }).join('') + '</div>';
    } else if (q.type==='essay') {
      opts = '<textarea rows="4" data-qi="'+qi+'" placeholder="Write your answer…"></textarea>';
    } else {
      opts = '<input type="text" data-qi="'+qi+'" placeholder="'+(q.type==='calculation'?'Enter a numeric answer':'Type your answer')+'">';
    }
    return '<div class="q" id="q'+qi+'"><div class="q-prompt">'+(qi+1)+'. '+esc(q.prompt)+'</div>'+opts+'<div class="ans-note" id="note'+qi+'" style="display:none;"></div></div>';
  }).join('');

  el.querySelectorAll('.choices').forEach(function(box){
    var qi = Number(box.dataset.qi);
    box.querySelectorAll('.choice').forEach(function(btn){
      btn.addEventListener('click', function(){
        if (submitted) return;
        answers[qi] = btn.dataset.choice;
        box.querySelectorAll('.choice').forEach(function(b){ b.classList.toggle('sel', b===btn); });
      });
    });
  });
  el.querySelectorAll('input[type=text], textarea').forEach(function(inp){
    inp.addEventListener('input', function(){ answers[Number(inp.dataset.qi)] = inp.value; });
  });
  el.querySelectorAll('.matching select').forEach(function(sel){
    sel.addEventListener('change', function(){
      var qi = Number(sel.closest('.matching').dataset.qi), pi = Number(sel.dataset.pi);
      answers[qi] = answers[qi] || {};
      answers[qi][pi] = sel.value;
    });
  });

  document.getElementById('btnSubmit').addEventListener('click', function(){
    submitted = true;
    var correctCount = 0, objectiveTotal = 0;
    questions.forEach(function(q, qi){
      var a = answers[qi];
      var note = document.getElementById('note'+qi);
      if (isObjective(q.type)) {
        objectiveTotal++;
        var ok = grade(q, a);
        if (ok) correctCount++;
        note.style.display = 'block';
        note.innerHTML = (ok ? '✅ Correct' : '❌ Correct answer: ' + esc(q.type==='matching' ? (q.pairs||[]).map(function(p){return p.left+' → '+p.right;}).join('; ') : q.correctAnswer))
          + (q.explanation ? '<br>' + esc(q.explanation) : '');
        var box = document.getElementById('q'+qi).querySelector('.choices');
        if (box) box.querySelectorAll('.choice').forEach(function(b){
          if (b.dataset.choice === q.correctAnswer) b.classList.add('correct');
          else if (b.classList.contains('sel')) b.classList.add('incorrect');
          b.disabled = true;
        });
      } else {
        note.style.display = 'block';
        note.innerHTML = 'Essay question — not auto-graded offline.' + (q.expectedAnswer ? '<br><strong>Model answer:</strong> ' + esc(q.expectedAnswer) : '');
      }
    });
    var pct = objectiveTotal ? Math.round((correctCount/objectiveTotal)*100) : 0;
    document.getElementById('score').style.display = 'block';
    document.getElementById('scorePct').textContent = pct + '%';
    document.getElementById('scoreSummary').textContent = correctCount + ' / ' + objectiveTotal + ' objective correct';
    document.getElementById('btnSubmit').disabled = true;
    document.getElementById('btnSubmit').textContent = 'Submitted';
    window.scrollTo(0,0);
  });
})();
</script>
</body>
</html>`;
}

// Native share sheet (Messenger, etc.) when the browser/OS supports sharing
// files; falls back to a plain download (desktop browsers, or wherever the
// Web Share API with files isn't available) so the feature still works
// everywhere, just less directly.
async function shareQuizAsHtml(item) {
  if (!item || !item.quizData) return;
  const title = item.examTitle || item.title || 'Quiz';
  const html = buildStandaloneQuizHtml(item.quizData, title, item.subject);
  const filename = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'quiz'}.html`;
  const file = new File([html], filename, { type: 'text/html' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title} — open this file in a browser to take the quiz.` });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user backed out of the share sheet -- not a failure
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Open a completed exam read-only, reusing the same results renderer a
// live "Finish exam" uses -- restores the saved answers/grades instead of
// the live in-progress state.
function viewCompletedExam(item) {
  if (!item || !item.quizData) return;

  state.quiz = { ...item.quizData, questions: item.quizData.questions || [] };
  state.subject = item.subject;
  state.examTitle = item.examTitle || item.title;
  state.answers = item.answers ? { ...item.answers } : {};
  state.essayGrades = item.essayGrades ? { ...item.essayGrades } : {};
  state.isQuizComplete = true; // reviewing, not taking -- also stops beforeunload from re-saving this as a fresh draft
  state.currentLibraryId = item.id || null;

  switchTab('create');
  showCreateStep('results');
  renderResults();
}

/* ============ Backup & Restore ============ */
// Local (phone) backup/restore always works, no account needed. Google
// Drive backup follows the exact same Google Identity Services token-flow
// pattern as Winfinity's own Drive backup (raw fetch to the Drive REST API,
// no gapi client library) -- but needs its OWN OAuth client, since a
// client ID is tied to one app's identity/consent screen. Disabled
// entirely (buttons hidden) until config.js's GOOGLE_CLIENT_ID is filled
// in -- see README.md for how to create one.

function driveConfigured() {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 0;
}

function buildBackupPayload() {
  return {
    app: 'QuizForge',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    library: LIBRARY_EXAMS,
  };
}

function applyBackupPayload(payload) {
  if (!payload || !Array.isArray(payload.library)) throw new Error('This file doesn\'t look like a QuizForge backup.');
  LIBRARY_EXAMS.length = 0;
  LIBRARY_EXAMS.push(...payload.library);
  saveLibraryExams();
  renderLibrary();
  renderHome();
}

function downloadBackupJSON() {
  const payload = buildBackupPayload();
  const filename = `quizforge-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(payload, null, 2)], filename, { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  $('backupStatusText').textContent = `Backed up ${payload.library.length} exam(s) to your device.`;
}

$('btnBackupPhone').addEventListener('click', downloadBackupJSON);

$('btnRestorePhone').addEventListener('click', () => $('restoreFileInput').click());
$('restoreFileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!confirm(`Restore ${payload.library?.length ?? '?'} exam(s) from this backup? This replaces your current library on this device.`)) return;
    applyBackupPayload(payload);
    $('backupStatusText').textContent = `Restored ${payload.library.length} exam(s) from ${esc(file.name)}.`;
  } catch (e) {
    $('backupStatusText').textContent = `Could not restore that file: ${e.message}`;
  }
});

/* ---- Google Drive ---- */

let driveTokenClient = null;
let driveAccessToken = null;
const DRIVE_FILE_ID_KEY = 'quizforge-drive-file-id';

function refreshDriveUi() {
  const configured = driveConfigured();
  $('btnConnectDrive').hidden = !configured;
  if (!configured) {
    $('driveStatus').textContent = 'Not set up yet -- see README.md for how to enable Google Drive backup.';
    $('driveActionsRow').hidden = true;
    return;
  }
  const connected = !!driveAccessToken;
  $('driveActionsRow').hidden = !connected;
  $('btnConnectDrive').hidden = connected;
  $('driveStatus').textContent = connected ? 'Connected.' : 'Not connected.';
}

let driveInitError = null;

function initDrive() {
  if (!driveConfigured() || typeof google === 'undefined' || !google.accounts?.oauth2) return;
  try {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
      callback: (resp) => {
        if (resp.error) { $('backupStatusText').textContent = `Google sign-in failed: ${resp.error}`; return; }
        driveAccessToken = resp.access_token;
        refreshDriveUi();
        $('backupStatusText').textContent = 'Connected to Google Drive.';
      },
    });
  } catch (e) {
    driveInitError = e.message || String(e);
  }
}

$('btnConnectDrive').addEventListener('click', () => {
  if (!driveTokenClient) {
    let diag = driveInitError || window.__firstUncaughtError;
    if (!diag) {
      diag = typeof google === 'undefined'
        ? 'the accounts.google.com/gsi/client script never loaded (window.google is undefined)'
        : (!google.accounts ? 'google.accounts is undefined' : 'google.accounts.oauth2 is undefined');
    }
    $('backupStatusText').textContent = `Google sign-in is still loading -- try again in a moment. (diag: ${diag})`;
    return;
  }
  driveTokenClient.requestAccessToken({ prompt: 'consent' });
});

async function saveToDrive() {
  if (!driveAccessToken) return;
  $('backupStatusText').textContent = 'Backing up to Drive…';
  const payload = buildBackupPayload();
  const existingId = localStorage.getItem(DRIVE_FILE_ID_KEY);
  const boundary = 'quizforge-backup-boundary';
  const metadata = { name: 'quizforge-backup.json', mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;

  try {
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${driveAccessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive returned HTTP ${res.status}`);
    const data = await res.json();
    if (data.id) localStorage.setItem(DRIVE_FILE_ID_KEY, data.id);
    $('backupStatusText').textContent = `Backed up ${payload.library.length} exam(s) to Google Drive.`;
  } catch (e) {
    $('backupStatusText').textContent = `Drive backup failed: ${e.message}`;
  }
}
$('btnBackupDrive').addEventListener('click', saveToDrive);

async function restoreFromDrive() {
  if (!driveAccessToken) return;
  const fileId = localStorage.getItem(DRIVE_FILE_ID_KEY);
  if (!fileId) { $('backupStatusText').textContent = 'No Drive backup found yet -- back up first.'; return; }
  $('backupStatusText').textContent = 'Checking Drive backup…';
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    if (!res.ok) throw new Error(`Drive returned HTTP ${res.status}`);
    const payload = await res.json();
    if (!confirm(`Restore ${payload.library?.length ?? '?'} exam(s) from your Google Drive backup? This replaces your current library on this device.`)) return;
    applyBackupPayload(payload);
    $('backupStatusText').textContent = `Restored ${payload.library.length} exam(s) from Google Drive.`;
  } catch (e) {
    $('backupStatusText').textContent = `Drive restore failed: ${e.message}`;
  }
}
$('btnRestoreDrive').addEventListener('click', restoreFromDrive);

refreshDriveUi();
// The GIS script tag was previously static in index.html -- but a static
// <script src> only fetches ONCE at page load. In the native app that
// single fetch was found to fail outright (confirmed via an on-device diag:
// "window.google is undefined" even after 20s of polling) -- no amount of
// polling for google.accounts.oauth2 to appear can ever help if the one
// network request behind it already failed, since nothing was re-asking
// the browser to actually fetch it again. This loads it dynamically instead
// so a failed attempt can be retried for real, with its own onload/onerror.
const GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GSI_MAX_ATTEMPTS = 5;
function loadGsiScript(attempt) {
  attempt = attempt || 0;
  if (typeof google !== 'undefined' && google.accounts?.oauth2) { initDrive(); return; }
  if (attempt >= GSI_MAX_ATTEMPTS) {
    driveInitError = `accounts.google.com/gsi/client failed to load after ${GSI_MAX_ATTEMPTS} attempts`;
    return;
  }
  const script = document.createElement('script');
  script.src = attempt === 0 ? GSI_SCRIPT_URL : `${GSI_SCRIPT_URL}?retry=${attempt}-${Date.now()}`;
  script.async = true;
  script.onload = () => {
    // onload fires once the script executes, but google.accounts.oauth2 can
    // take a beat longer to actually be assigned -- give it a short poll
    // window before treating this attempt itself as failed and retrying.
    let pollTries = 0;
    const poll = setInterval(() => {
      pollTries++;
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        clearInterval(poll);
        initDrive();
      } else if (pollTries >= 10) {
        clearInterval(poll);
        loadGsiScript(attempt + 1);
      }
    }, 300);
  };
  script.onerror = () => {
    driveInitError = `accounts.google.com/gsi/client failed to load (network error), attempt ${attempt + 1}/${GSI_MAX_ATTEMPTS}`;
    setTimeout(() => loadGsiScript(attempt + 1), 1000 * (attempt + 1));
  };
  document.head.appendChild(script);
}
if (driveConfigured()) loadGsiScript();
