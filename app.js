'use strict';

const APP_VERSION = 'QF_SYS_V.1.0.62';

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

const RECENT_EXAMS = [
  { title: 'Introduction to Algorithms', meta: 'Created 2 days ago', questionCount: 45 },
  { title: 'System Design Patterns', meta: 'Edited 4 hours ago', questionCount: 20 },
  { title: 'Relational Databases Midterm', meta: 'Created 1 week ago', questionCount: 30 },
];

const SUGGESTED_TOPICS = ['Big O Notation', 'Graph Theory Basics', 'Sorting Efficiencies'];

const LIBRARY_EXAMS = [
  { subject: 'Biology', title: 'Cellular Respiration Final', questionCount: 45, date: 'Oct 12, 2023', excerpt: 'Compare and contrast aerobic and anaerobic pathways, identifying key ATP yields for...', status: 'completed', badge: '12', tag: 'biology' },
  { subject: 'History', title: 'Industrial Revolution Quiz', questionCount: 20, date: 'Oct 08, 2023', excerpt: 'Map the migration patterns of rural populations toward urban centers during the 1840s...', status: 'completed', badge: '9', tag: 'history' },
  { subject: 'Mathematics', title: 'Calculus AB: Integrals', questionCount: 32, date: 'Sep 28, 2023', excerpt: 'Solve for the area under the curve using Riemann sums and the Fundamental Theorem...', status: 'completed', badge: 'AP', tag: 'mathematics' },
  { subject: 'Literature', title: 'Modernism in Poetry', questionCount: 15, date: 'Sep 15, 2023', excerpt: "Analyze T.S. Eliot's use of fragmentation in 'The Waste Land' as a reflection of...", status: 'completed', badge: '12', tag: 'literature' },
  { subject: 'Chemistry', title: 'Organic Chemistry I: Basics', questionCount: 50, date: 'Aug 30, 2023', excerpt: 'Identify functional groups in complex carbon chains and predict IUPAC naming conventions...', status: 'completed', badge: 'U', tag: 'chemistry' },
];

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

// Save quiz to library
function saveQuizToLibrary() {
  if (!state.quiz || !state.examTitle) return;
  
  // Create a library entry from the current quiz
  const newExam = {
    subject: state.subject || 'General',
    title: state.examTitle,
    questionCount: state.quiz.questions ? state.quiz.questions.length : 0,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    excerpt: state.quiz.questions && state.quiz.questions[0] ? 
      (state.quiz.questions[0].prompt || 'Exam generated from uploaded material') : 
      'Exam generated from uploaded material',
    status: 'completed',
    badge: state.quiz.questions ? state.quiz.questions.length.toString() : '0',
    tag: state.subject ? state.subject.toLowerCase().replace(/\s+/g, '-') : 'general'
  };
  
  // Add to the library exams list
  LIBRARY_EXAMS.unshift(newExam);
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

$('btnQuickCreate').addEventListener('click', () => switchTab('create'));
$('btnViewAllRecent').addEventListener('click', () => switchTab('library'));
$('btnExploreBank').addEventListener('click', () => switchTab('library'));

/* ============ Home ============ */

function renderHome() {
  $('recentList').innerHTML = RECENT_EXAMS.map((exam) => `
    <li class="recent-item">
      <span class="recent-item-icon">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /></svg>
      </span>
      <span class="recent-item-body">
        <span class="recent-item-title">${esc(exam.title)}</span>
        <span class="recent-item-meta">${esc(exam.meta)} &bull; ${exam.questionCount} Questions</span>
      </span>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </li>
  `).join('');

  $('topicList').innerHTML = SUGGESTED_TOPICS.map((topic) => `
    <li class="topic-item"><span>${esc(topic)}</span><button type="button" class="topic-add-btn" aria-label="Add ${esc(topic)}">+</button></li>
  `).join('');
}

/* ============ Library ============ */

$('btnLibCompleted').addEventListener('click', () => { state.libraryTab = 'completed'; renderLibrary(); });
$('btnLibDrafts').addEventListener('click', () => { state.libraryTab = 'drafts'; renderLibrary(); });
$('librarySearchInput').addEventListener('input', (event) => { state.librarySearch = event.target.value; renderLibrary(); });

function renderLibrary() {
  $('btnLibCompleted').classList.toggle('is-active', state.libraryTab === 'completed');
  $('btnLibDrafts').classList.toggle('is-active', state.libraryTab === 'drafts');

  const query = state.librarySearch.trim().toLowerCase();
  const filtered = LIBRARY_EXAMS.filter((exam) => {
    if (exam.status !== state.libraryTab) return false;
    if (!query) return true;
    return exam.title.toLowerCase().includes(query) || exam.subject.toLowerCase().includes(query);
  });

  if (!filtered.length) {
    $('libraryList').innerHTML = `<p class="empty-note">${state.libraryTab === 'drafts' ? 'No drafts yet — unfinished exams will appear here.' : 'No exams match your search.'}</p>`;
    return;
  }

  const cards = filtered.map((exam, index) => `
    <article class="exam-card exam-card--tag--${exam.tag}">
      <span class="exam-tag tag--${exam.tag}">${esc(exam.subject)}</span>
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
  $('libraryList').querySelectorAll('.js-open-exam, .js-create-new').forEach((btn) => {
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
}

$('btnQuizPrev').addEventListener('click', () => {
  if (state.quizIndex > 0) { state.quizIndex -= 1; renderQuizQuestion(); }
});
$('btnQuizNext').addEventListener('click', () => {
  if (state.quizIndex < state.quiz.questions.length - 1) {
    state.quizIndex += 1;
    renderQuizQuestion();
  } else {
    renderResults();
    showCreateStep('results');
  }
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

async function renderResults() {
  const questions = state.quiz.questions;
  const objectiveQuestions = questions.filter((q) => isObjectiveType(q.type));
  const essayQuestions = questions.filter((q) => q.type === 'essay');
  const objectiveCorrect = objectiveQuestions.filter((q) => gradeObjectiveQuestion(q, state.answers[q.id])).length;

  $('resultsExamTitle').textContent = `${state.examTitle || 'Exam'} • Results`;

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

  // Add repeat quiz button functionality
  $('btnRepeatQuiz').addEventListener('click', () => {
    if (state.quiz && state.quiz.questions) {
      // Shuffle the questions
      const shuffledQuestions = shuffleArray(state.quiz.questions);
      
      // Create a new quiz object with shuffled questions
      const newQuiz = {
        ...state.quiz,
        questions: shuffledQuestions
      };
      
      // Reset state for new quiz
      state.quiz = newQuiz;
      state.answers = {};
      state.essayGrades = {};
      state.quizIndex = 0;
      
      // Render the first question of the shuffled quiz
      renderQuizQuestion();
      showCreateStep('quiz');
    }
  });

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
}

$('btnCreateAnother').addEventListener('click', resetCreateFlow);

/* ============ Init ============ */

initTheme();
refreshGeminiKeyStatus();
renderHome();
resetCreateFlow();
document.querySelector('.app-header-version').textContent = APP_VERSION;

// Save quiz to library function (added at end)
function saveQuizToLibrary() {
  if (!state.quiz || !state.examTitle) return;
  
  // Create a library entry from the current quiz
  const newExam = {
    subject: state.subject || 'General',
    title: state.examTitle,
    questionCount: state.quiz.questions ? state.quiz.questions.length : 0,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    excerpt: state.quiz.questions && state.quiz.questions[0] ? 
      (state.quiz.questions[0].prompt || 'Exam generated from uploaded material') : 
      'Exam generated from uploaded material',
    status: 'completed',
    badge: state.quiz.questions ? state.quiz.questions.length.toString() : '0',
    tag: state.subject ? state.subject.toLowerCase().replace(/\s+/g, '-') : 'general'
  };
  
  // Add to the library exams list
  LIBRARY_EXAMS.unshift(newExam);
}

// Create a new quiz in draft mode
function saveAsDraft() {
  if (!state.quiz || !state.examTitle) return;
  
  const newExam = {
    subject: state.subject || 'General',
    title: state.examTitle,
    questionCount: state.quiz.questions ? state.quiz.questions.length : 0,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    excerpt: state.quiz.questions && state.quiz.questions[0] ? 
      (state.quiz.questions[0].prompt || 'Exam generated from uploaded material') : 
      'Exam generated from uploaded material',
    status: 'draft',
    badge: state.quiz.questions ? state.quiz.questions.length.toString() : '0',
    tag: state.subject ? state.subject.toLowerCase().replace(/\s+/g, '-') : 'general',
    history: [],
    isDraft: true,
    // Store the quiz data for drafts
    quizData: state.quiz,
    examTitle: state.examTitle,
    subject: state.subject
  };
  
  LIBRARY_EXAMS.unshift(newExam);
}

// Add a score to quiz history
function addScoreToHistory(examTitle, score, date) {
  const exam = LIBRARY_EXAMS.find(e => e.title === examTitle);
  if (exam && exam.history) {
    exam.history.push({
      score: score,
      date: date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    });
    // Keep only last 10 attempts
    exam.history = exam.history.slice(-10);
  }
}

// Show correct answer toggle functionality
function setupAnswerToggle() {
  // This will be called when quiz starts
  if (typeof state.showCorrectAnswers === 'undefined') {
    state.showCorrectAnswers = false;
  }
}

// Save quiz to library as draft
function saveAsDraft() {
  if (!state.quiz || !state.examTitle) return;
  
  const newExam = {
    subject: state.subject || 'General',
    title: state.examTitle,
    questionCount: state.quiz.questions ? state.quiz.questions.length : 0,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    excerpt: state.quiz.questions && state.quiz.questions[0] ? 
      (state.quiz.questions[0].prompt || 'Exam generated from uploaded material') : 
      'Exam generated from uploaded material',
    status: 'draft',
    badge: state.quiz.questions ? state.quiz.questions.length.toString() : '0',
    tag: state.subject ? state.subject.toLowerCase().replace(/\s+/g, '-') : 'general',
    history: [],
    isDraft: true,
    // Store the quiz data for drafts
    quizData: state.quiz,
    examTitle: state.examTitle,
    subject: state.subject
  };
  
  LIBRARY_EXAMS.unshift(newExam);
}

// Auto-save draft when user navigates away from quiz
function setupAutoSave() {
  // Prevent refresh during quiz
  window.addEventListener('beforeunload', function(e) {
    if (state.quiz && state.examTitle && !state.isQuizComplete) {
      saveAsDraft();
      // Show confirmation message
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
}

// Show version popup
function showVersionPopup() {
  // Create version popup if it doesn't exist
  let popup = document.getElementById('versionPopup');
  
  if (!popup) {
    const popupHTML = `
      <div class="version-popup" id="versionPopup">
        <div class="version-popup-content">
          <div class="version-popup-header">
            <h2 class="version-popup-title">QuizForge</h2>
            <span class="version-popup-version">v1.0.6</span>
          </div>
          <p>Version 1.0.6 is now available with enhanced features including repeat quiz, drafts, and history tracking.</p>
          <p>Automatic updates are currently <strong id="autoUpdateStatus">enabled</strong>.</p>
          <div class="version-popup-actions">
            <label class="toggle-switch">
              <input type="checkbox" id="autoUpdateToggle" checked>
              <span class="slider"></span>
            </label>
            <span class="toggle-label">Auto-update</span>
            <button class="update-btn" id="updateButton">Update Now</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', popupHTML);
    popup = document.getElementById('versionPopup');
    
    // Add event listeners
    const updateButton = document.getElementById('updateButton');
    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    
    if (updateButton) {
      updateButton.addEventListener('click', () => {
        alert('Update functionality would be implemented here in a real application');
        popup.classList.remove('is-visible');
      });
    }
    
    if (autoUpdateToggle) {
      autoUpdateToggle.addEventListener('change', function() {
        const statusElement = document.getElementById('autoUpdateStatus');
        if (statusElement) {
          statusElement.textContent = this.checked ? 'enabled' : 'disabled';
        }
      });
    }
  }
  
  // Show the popup
  popup.classList.add('is-visible');
  
  // Close when clicking outside
  popup.addEventListener('click', function(e) {
    if (e.target === popup) {
      popup.classList.remove('is-visible');
    }
  });
}

/* ============ Init ============ */

initTheme();
refreshGeminiKey();
renderHome();
resetCreateStep();
document.getElementById('appHeaderVersion').textContent = APP_VERSION;

// Add version button listener
const versionButton = document.getElementById('versionButton');
if (versionButton) {
  versionButton.addEventListener('click', showVersionPopup);
}

// Setup auto-save functionality
setupAutoSave();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Service worker registration failed:', error);
    });
  });
}

// Auto-save draft when user navigates away from quiz
function setupAutoSave() {
  // Prevent refresh during quiz
  window.addEventListener('beforeunload', function(e) {
    if (state.quiz && state.examTitle && !state.isQuizComplete) {
      saveAsDraft();
    }
  });
}

// Add version popup functionality
document.addEventListener('DOMContentLoaded', function() {
  const versionButton = document.getElementById('versionButton');
  if (versionButton) {
    versionButton.addEventListener('click', function() {
      // Create a simple alert with version info
      alert(`QuizForge Version: ${APP_VERSION}\n\nFeatures included:\n- Repeat Quiz (Shuffled)\n- Save as Draft\n- Correct Answer Toggle\n- Library History Tracking`);
    });
  }
});

// Show correct answer on wrong answers functionality
function showCorrectAnswerOnWrong() {
  // This function is integrated into renderQuizQuestion now
}

// Add the save functionality to results screen
$('btnSaveAsDraft').addEventListener('click', () => {
  const savedExam = saveAsDraft();
  if (savedExam) {
    alert('Exam saved as draft! You can find it in your library.');
    switchTab('library');
  }
});

// Start a quiz from library item
function startQuizFromLibrary(item) {
  if (!item || !item.quizData) return;
  
  // Set the state to use this quiz data
  state.quiz = {
    questions: item.quizData.questions || []
  };
  state.subject = item.quizData.subject;
  state.examTitle = item.quizData.examTitle;
  state.isQuizComplete = false;
  
  // Show the quiz interface
  switchTab('quiz');
  renderQuiz();
}
