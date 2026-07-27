'use strict';

const APP_VERSION = 'QF_SYS_V.1.1.1';

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
};

const QUESTION_TYPES = [
  { key: 'multipleChoice', title: 'Multiple Choice', sub: 'Standard 4-option selection.', icon: '☑' },
  { key: 'trueFalse', title: 'True / False', sub: 'Binary response format.', icon: '⇄' },
  { key: 'identification', title: 'Identification', sub: 'One or two word factual answers.', icon: '🔎' },
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

  const cards = filtered.map((exam, index) => `
    <article class="exam-card exam-card--tag--${esc(exam.tag)}">
      <span class="exam-tag tag--${esc(exam.tag)}">${esc(exam.subject)}</span>
      <h3 class="exam-card-title">${esc(exam.title)}</h3>
      <p class="exam-card-meta">${exam.questionCount} Questions &bull; ${esc(exam.date)}</p>
      <p class="exam-card-excerpt">&ldquo;${esc(exam.excerpt)}&rdquo;</p>
      <div class="exam-card-foot">
        <span class="exam-badge">${esc(exam.badge)}</span>
        <button type="button" class="link-btn js-open-exam">Open Exam
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </div>
    </article>
    ${index === 1 ? `
      <button type="button" class="library-create-card js-create-new">
        <span class="library-create-icon">+</span>
        <span class="library-create-title">Create New</span>
        <span class="screen-sub">Generate a new exam from your notes or photos.</span>
      </button>
    ` : ''}
  `).join('');

  $('libraryList').innerHTML = cards;
  // Was: every "Open Exam" button, on every card, blindly switched to the
  // Create tab regardless of which exam was clicked -- clicking any saved
  // exam did the same generic thing as clicking nothing at all. Now each
  // button is wired to its own specific exam: a draft resumes into the quiz
  // (via the now-fixed startQuizFromLibrary), a completed exam opens a
  // read-only results review.
  const openButtons = $('libraryList').querySelectorAll('.js-open-exam');
  filtered.forEach((exam, i) => {
    openButtons[i].addEventListener('click', () => {
      if (exam.status === 'draft') startQuizFromLibrary(exam);
      else viewCompletedExam(exam);
    });
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
  $('btnContinueToConfigure').disabled = !ok;
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
  state.sourceImages.push({ dataUrl, mimeType: 'image/jpeg' });
  closeCamera();
  renderSourcePreview();
  updateContinueGating();
});

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
    state.answers = {};
    state.essayGrades = {};
    state.quizIndex = 0;
    clearInterval(generatingMessageTimer);
    renderQuizQuestion();
    showCreateStep('quiz');
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
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  renderQuizQuestion();
  showCreateStep('quiz');
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
  if (type === 'calculation') { $('manualCalcCorrect').value = ''; }
  renderManualQuestionList();
});

$('btnStartManualExam').addEventListener('click', () => {
  state.quiz = { questions: state.manualQuestions, examTitle: state.examTitle, subject: state.subject, difficulty: 'manual' };
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  renderQuizQuestion();
  showCreateStep('quiz');
});

/* ============ Quiz runner ============ */

function renderQuizQuestion() {
  const question = state.quiz.questions[state.quizIndex];
  const total = state.quiz.questions.length;
  const progress = Math.round(((state.quizIndex + 1) / total) * 100);

  $('quizProgressFill').style.width = `${progress}%`;
  $('quizExamTitle').textContent = state.examTitle || 'Exam';
  $('quizProgressLabel').textContent = `Question ${state.quizIndex + 1} of ${total}`;
  $('questionTypeTag').textContent = TYPE_LABELS[question.type] || question.type;
  $('questionPrompt').textContent = question.prompt;

  const answer = state.answers[question.id];
  const area = $('questionAnswerArea');

  if (question.type === 'multipleChoice' || question.type === 'trueFalse') {
    const choices = question.choices?.length ? question.choices : ['True', 'False'];
    area.innerHTML = `<div class="choice-list">${choices.map((choice) => `
      <button type="button" class="choice-option${answer === choice ? ' is-selected' : ''}" data-choice="${esc(choice)}">
        <span class="choice-radio${answer === choice ? ' is-selected' : ''}"></span><span>${esc(choice)}</span>
      </button>`).join('')}</div>`;
    area.querySelectorAll('.choice-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.answers[question.id] = btn.dataset.choice;
        renderQuizQuestion();
      });
    });
  } else if (question.type === 'identification') {
    area.innerHTML = `<input type="text" class="text-input" id="answerInput" placeholder="Type your answer" value="${esc(answer || '')}">`;
    $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; });
  } else if (question.type === 'calculation') {
    area.innerHTML = `<input type="text" inputmode="decimal" class="text-input" id="answerInput" placeholder="Enter a numeric answer" value="${esc(answer || '')}">`;
    $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; });
  } else {
    area.innerHTML = `<textarea class="text-input" id="answerInput" rows="6" placeholder="Write your answer…">${esc(answer || '')}</textarea>`;
    $('answerInput').addEventListener('input', (e) => { state.answers[question.id] = e.target.value; });
  }

  $('btnQuizPrev').disabled = state.quizIndex === 0;
  $('btnQuizNext').textContent = state.quizIndex < total - 1 ? 'Next' : 'Finish exam';

  // "Show correct answer on wrong answers" -- the checkbox already existed
  // in index.html and the state flag was already initialized, but nothing
  // ever actually read either of them here. Keep the checkbox in sync with
  // state across question navigation, then show the correct answer inline
  // only for an objective question the user has actually answered wrong.
  const toggle = $('showCorrectAnswersToggle');
  toggle.checked = !!state.showCorrectAnswers;
  const existingNote = area.parentNode.querySelector('.correct-answer-note');
  if (existingNote) existingNote.remove();
  if (state.showCorrectAnswers && answer !== undefined && isObjectiveType(question.type) && !gradeObjectiveQuestion(question, answer)) {
    const note = document.createElement('p');
    note.className = 'result-answer correct-answer-note';
    note.innerHTML = `<strong>Correct answer:</strong> ${esc(question.correctAnswer)}`;
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
  return type === 'multipleChoice' || type === 'trueFalse' || type === 'identification' || type === 'calculation';
}

function gradeObjectiveQuestion(question, answer) {
  if (answer === undefined || answer === null || String(answer).trim() === '') return false;
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
  return false;
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
  // "Save as Draft" only makes sense right after a live finish -- it was
  // visible even when reviewing an already-completed exam via
  // viewCompletedExam(), and since saveCurrentQuizToLibrary() now updates
  // the matching entry in place (see currentLibraryId), clicking it during
  // a review would have silently downgraded that completed exam back to a
  // draft.
  $('btnSaveAsDraft').hidden = !justFinished;

  function paintScore() {
    const essayScores = essayQuestions.map((q) => state.essayGrades[q.id]?.score).filter((s) => typeof s === 'number');
    const essayAvg = essayScores.length ? essayScores.reduce((a, b) => a + b, 0) / essayScores.length : null;
    const totalPoints = objectiveCorrect + essayScores.reduce((sum, s) => sum + s / 100, 0);
    const overallPct = questions.length ? Math.round((totalPoints / questions.length) * 100) : 0;
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

      return `
        <div class="card result-item${objective ? (correct ? ' is-correct' : ' is-incorrect') : ''}">
          <p class="result-item-index">Question ${index + 1}</p>
          <p class="question-prompt">${esc(question.prompt)}</p>
          <p class="result-answer"><strong>Your answer:</strong> ${userAnswer ? esc(String(userAnswer)) : '<em>No answer</em>'}</p>
          ${objective && !correct ? `<p class="result-answer"><strong>Correct answer:</strong> ${esc(question.correctAnswer)}</p>` : ''}
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

  // Upsert, not always-insert: resuming a draft (startQuizFromLibrary sets
  // state.currentLibraryId) and then triggering another auto-save -- e.g.
  // closing the tab again before finishing -- previously created a second,
  // near-identical duplicate entry every single time, since the old code
  // always unshifted a brand new object. Found via an actual resume-then-
  // reload test, not just reading the code.
  const existing = state.currentLibraryId
    ? LIBRARY_EXAMS.find((e) => e.id === state.currentLibraryId)
    : null;

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
    answers: status === 'completed' ? { ...state.answers } : undefined,
    essayGrades: status === 'completed' ? { ...state.essayGrades } : undefined,
  };

  if (existing) {
    LIBRARY_EXAMS.splice(LIBRARY_EXAMS.indexOf(existing), 1);
  }
  LIBRARY_EXAMS.unshift(newExam);
  state.currentLibraryId = newExam.id;
  saveLibraryExams();
  return newExam;
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
}

// Background check on load (not just when the popup is opened), same
// convention as Winfinity's own "check ~5s after load" behavior -- lets
// auto-update actually apply without the user ever opening the popup.
setTimeout(() => { checkForUpdate().then((v) => { if (v && v !== APP_VERSION && isAutoUpdateEnabled()) applyUpdate(); }); }, 5000);

// Version button -> the real popup (checkForUpdate/applyUpdate above),
// replacing the old placeholder alert entirely. initTheme/renderHome/etc.
// already ran once in the single Init block near the top of this file --
// deliberately NOT repeated here.
const versionButton = document.getElementById('versionButton');
if (versionButton) versionButton.addEventListener('click', showVersionPopup);

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

// Add the save functionality to results screen
$('btnSaveAsDraft').addEventListener('click', () => {
  const savedExam = saveCurrentQuizToLibrary('draft');
  if (savedExam) {
    alert('Exam saved as draft! You can find it in your library.');
    switchTab('library');
  }
});

// Resume a draft from the library -- this previously called a
// `renderQuiz()` that didn't exist anywhere in the file (would have thrown
// ReferenceError the moment it ran) and `switchTab('quiz')`, but there is
// no top-level "quiz" tab (quiz-taking is a *step* inside the Create tab);
// it also read `item.quizData.subject`/`.examTitle`, but quizData only ever
// held `{questions}` -- the real subject/examTitle live on `item` itself.
// Never actually wired to a click handler before now, so none of this had
// ever run. Fixed all of it and reset answer state so resuming a different
// draft doesn't inherit whatever was left over from a previous quiz.
function startQuizFromLibrary(item) {
  if (!item || !item.quizData) return;

  state.quiz = { questions: item.quizData.questions || [] };
  state.subject = item.subject;
  state.examTitle = item.examTitle || item.title;
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  state.isQuizComplete = false;
  state.currentLibraryId = item.id || null; // lets a later auto-save update this same entry instead of inserting a duplicate

  switchTab('create');
  showCreateStep('quiz');
  renderQuizQuestion();
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
