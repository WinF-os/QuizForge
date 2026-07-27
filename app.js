'use strict';

const APP_VERSION = 'QF_SYS_V.1.1.2';

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
};

const QUESTION_TYPES = [
  { key: 'multipleChoice', title: 'Multiple Choice', sub: 'Standard 4-option selection.', icon: '☑' },
  { key: 'trueFalse', title: 'True / False', sub: 'Binary response format.', icon: '⇄' },
  { key: 'checkCross', title: 'Check / Cross', sub: 'True/False shown as ✓ or ✗.', icon: '✓' },
  { key: 'identification', title: 'Identification', sub: 'One or two word factual answers.', icon: '🔎' },
  { key: 'identificationChoices', title: 'Identification (with Choices)', sub: 'Fill in the blank from a word bank.', icon: '🗂' },
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
  checkCross: 'Check / Cross',
  identification: 'Identification',
  identificationChoices: 'Identification (with Choices)',
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
}

$('btnHeaderBack').addEventListener('click', () => {
  if (state.tab !== 'create') return;
  const order = state.generationMode === 'manual'
    ? ['source', 'manualBuilder', 'quiz', 'results']
    : ['source', 'configure', 'generating', 'quiz', 'results'];
  const idx = order.indexOf(state.createStep);
  if (idx > 0) showCreateStep(order[idx - 1]);
});

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
  state.config = { types: { multipleChoice: true, trueFalse: false, identification: false, calculation: false, essay: false }, difficulty: 'medium', count: 10 };
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
  renderSourcePreview();
  setGenerationMode('ai');
  renderManualBuilder();
  updateContinueGating();
  showCreateStep('source');
}

$('examTitleInput').addEventListener('input', (e) => { state.examTitle = e.target.value; });
$('subjectSelect').addEventListener('change', (e) => { state.subject = e.target.value; });

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
  const note = $('sourceEmptyNote');
  note.hidden = !missingKey;
  if (missingKey) note.textContent = 'Add your Gemini API key in Profile to use AI Generate.';
  const ok = state.generationMode === 'manual' ? true : (hasSource && !missingKey);
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

  state.quiz = { questions, examTitle: state.examTitle, subject: state.subject, difficulty: 'auto' };
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
  } else if (type === 'trueFalse' || type === 'checkCross') {
    const labels = type === 'checkCross' ? ['✓ Check', '✗ Cross'] : ['True', 'False'];
    box.innerHTML = `
      <label class="field-block">
        <span class="field-label">Correct Answer</span>
        <select class="select-input" id="manualTfCorrect">
          <option value="True">${labels[0]}</option>
          <option value="False">${labels[1]}</option>
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
  } else if (type === 'identificationChoices') {
    box.innerHTML = `
      <label class="field-block">
        <span class="field-label">Correct Answer</span>
        <input type="text" class="text-input" id="manualIcCorrect" placeholder="e.g. Mitochondria">
      </label>
      <div class="field-block">
        <span class="field-label">Word Bank — other choices shown alongside the correct one</span>
        ${[0, 1, 2].map((i) => `<input type="text" class="text-input" id="manualIcChoice${i}" placeholder="Distractor ${i + 1}" style="margin-bottom:8px;">`).join('')}
      </div>`;
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
  } else if (type === 'trueFalse' || type === 'checkCross') {
    question.choices = ['True', 'False'];
    question.correctAnswer = $('manualTfCorrect').value;
  } else if (type === 'identification') {
    const correct = $('manualIdCorrect').value.trim();
    if (!correct) return;
    const alt = $('manualIdAlt').value.split(',').map((s) => s.trim()).filter(Boolean);
    question.correctAnswer = correct;
    question.acceptableAnswers = [correct, ...alt];
  } else if (type === 'identificationChoices') {
    const correct = $('manualIcCorrect').value.trim();
    if (!correct) return;
    const distractors = [0, 1, 2].map((i) => $(`manualIcChoice${i}`).value.trim()).filter(Boolean);
    question.correctAnswer = correct;
    question.acceptableAnswers = [correct];
    question.choices = shuffleArray([correct, ...distractors]);
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
  if (type === 'identificationChoices') { $('manualIcCorrect').value = ''; [0, 1, 2].forEach((i) => { $(`manualIcChoice${i}`).value = ''; }); }
  if (type === 'matching') [0, 1, 2, 3].forEach((i) => { $(`manualMatchLeft${i}`).value = ''; $(`manualMatchRight${i}`).value = ''; });
  if (type === 'calculation') { $('manualCalcCorrect').value = ''; }
  renderManualQuestionList();
});

$('btnStartManualExam').addEventListener('click', () => {
  state.quiz = { questions: state.manualQuestions, examTitle: state.examTitle, subject: state.subject, difficulty: 'manual' };
  saveGeneratedQuizAndReturnToLibrary();
});

/* ============ Quiz runner ============ */

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

// checkCross is a trueFalse question underneath (correctAnswer/grading is
// identical, see gradeObjectiveQuestion) -- only the button labels differ.
const CHOICE_TYPE_DISPLAY = {
  checkCross: [{ value: 'True', label: '✓ Check' }, { value: 'False', label: '✗ Cross' }],
};

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

  const answer = state.answers[question.id];
  const area = $('questionAnswerArea');
  const hasAnswer = isAnswered(question, answer);
  // "Show correct answer on wrong answers" -- locks the question the moment
  // it's answered wrong (not just displays a note off to the side): the
  // wrong choice can no longer be changed, only the correct one is made
  // clear, right on the question itself.
  const isWrong = hasAnswer && isObjectiveType(question.type) && !gradeObjectiveQuestion(question, answer);
  const locked = state.showCorrectAnswers && isWrong;

  if (question.type === 'multipleChoice' || question.type === 'trueFalse' || question.type === 'checkCross' || question.type === 'identificationChoices') {
    const options = CHOICE_TYPE_DISPLAY[question.type]
      || (question.choices?.length ? question.choices : ['True', 'False']).map((c) => ({ value: c, label: c }));
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
          renderQuizQuestion();
        });
      });
    }
  } else if (question.type === 'identification' || question.type === 'calculation') {
    const inputMode = question.type === 'calculation' ? ' inputmode="decimal"' : '';
    const placeholder = question.type === 'calculation' ? 'Enter a numeric answer' : 'Type your answer';
    area.innerHTML = `<input type="text"${inputMode} class="text-input${locked ? ' answer-input-locked' : ''}" id="answerInput" placeholder="${placeholder}" value="${esc(answer || '')}"${locked ? ' readonly' : ''}>`;
    if (!locked) {
      $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; updateLiveQuizScore(); });
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
          renderQuizQuestion();
        });
      });
    }
  } else {
    area.innerHTML = `<textarea class="text-input" id="answerInput" rows="6" placeholder="Write your answer…">${esc(answer || '')}</textarea>`;
    $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; });
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
    type === 'checkCross' ||
    type === 'identification' ||
    type === 'identificationChoices' ||
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
  if (question.type === 'multipleChoice' || question.type === 'trueFalse' || question.type === 'checkCross') {
    return normalize(answer) === normalize(question.correctAnswer);
  }
  if (question.type === 'identification' || question.type === 'identificationChoices') {
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
  // Prevent refresh during quiz
  window.addEventListener('beforeunload', function(e) {
    if (state.quiz && state.examTitle && !state.isQuizComplete) {
      saveCurrentQuizToLibrary('draft');
      // Show confirmation message
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
let latestKnownVersion = null;

async function checkForUpdate() {
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
  if (!remoteVersion) {
    statusEl.textContent = "Could not check for updates -- you're offline, or the live site is unreachable.";
  } else if (remoteVersion === APP_VERSION) {
    statusEl.textContent = "You're on the latest version.";
  } else {
    statusEl.textContent = `A new version is available: ${esc(remoteVersion)}.`;
    updateBtn.hidden = false;
    if (isAutoUpdateEnabled()) applyUpdate();
  }
  refreshUpdateBadge();
}

// Background check on load (not just when the popup is opened), same
// convention as Winfinity's own "check ~5s after load" behavior -- lets
// auto-update actually apply without the user ever opening the popup.
setTimeout(() => { checkForUpdate().then((v) => { refreshUpdateBadge(); if (v && v !== APP_VERSION && isAutoUpdateEnabled()) applyUpdate(); }); }, 5000);

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
function refreshUpdateBadge() {
  const hasUpdate = !!(latestKnownVersion && latestKnownVersion !== APP_VERSION);
  const badge = document.getElementById('profileUpdateBadge');
  if (badge) badge.hidden = !hasUpdate;
  const btn = document.getElementById('btnProfileCheckUpdate');
  if (btn) btn.textContent = hasUpdate ? 'Update Now' : 'Check for Updates';
}

document.getElementById('profileVersionText').textContent = APP_VERSION;

document.getElementById('btnProfileCheckUpdate').addEventListener('click', async () => {
  const btn = document.getElementById('btnProfileCheckUpdate');
  const status = document.getElementById('profileUpdateStatus');

  if (latestKnownVersion && latestKnownVersion !== APP_VERSION) {
    applyUpdate();
    return;
  }

  btn.disabled = true;
  status.textContent = 'Checking for updates…';
  const remoteVersion = await checkForUpdate();
  btn.disabled = false;
  refreshUpdateBadge();

  if (!remoteVersion) {
    status.textContent = "Could not check for updates -- you're offline, or the live site is unreachable.";
  } else if (remoteVersion === APP_VERSION) {
    status.textContent = "You're on the latest version.";
  } else {
    status.textContent = `A new version is available: ${esc(remoteVersion)}. Tap Update Now to install it.`;
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

  state.quiz = { questions: item.quizData.questions || [] };
  state.subject = item.subject;
  state.examTitle = item.examTitle || item.title;
  state.answers = item.answers ? { ...item.answers } : {};
  state.essayGrades = item.essayGrades ? { ...item.essayGrades } : {};
  state.quizIndex = Math.min(item.quizIndex || 0, (item.quizData.questions || []).length - 1);
  state.isQuizComplete = false;
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

  state.quiz = { questions: shuffleArray(item.quizData.questions || []) };
  state.subject = item.subject;
  state.examTitle = item.examTitle || item.title;
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  state.isQuizComplete = false;
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
  setGenerationMode('manual');
  renderManualBuilder();
  showCreateStep('manualBuilder');
}

// Open a completed exam read-only, reusing the same results renderer a
// live "Finish exam" uses -- restores the saved answers/grades instead of
// the live in-progress state.
function viewCompletedExam(item) {
  if (!item || !item.quizData) return;

  state.quiz = { questions: item.quizData.questions || [] };
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
