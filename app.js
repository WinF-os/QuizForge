'use strict';

/* ============ State ============ */

const state = {
  tab: 'home',
  createStep: 'source', // source | configure | generating | quiz | results
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
  ['stepSource', 'stepConfigure', 'stepGenerating', 'stepQuiz', 'stepResults'].forEach((id) => {
    $(id).hidden = id !== `step${step[0].toUpperCase()}${step.slice(1)}`;
  });
  $('btnHeaderBack').hidden = step === 'source';
  window.scrollTo(0, 0);
}

$('btnHeaderBack').addEventListener('click', () => {
  if (state.tab !== 'create') return;
  const order = ['source', 'configure', 'generating', 'quiz', 'results'];
  const idx = order.indexOf(state.createStep);
  if (idx > 0) showCreateStep(order[idx - 1]);
});

function resetCreateFlow() {
  state.examTitle = '';
  state.subject = '';
  state.sourceImages = [];
  state.sourceText = '';
  state.config = { types: { multipleChoice: true, trueFalse: false, identification: false, calculation: false, essay: false }, difficulty: 'medium', count: 10 };
  state.quiz = null;
  state.answers = {};
  state.essayGrades = {};
  state.quizIndex = 0;
  $('examTitleInput').value = '';
  $('subjectSelect').value = '';
  $('pastedTextArea').value = '';
  $('pasteTextBlock').hidden = true;
  renderSourcePreview();
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
  $('btnContinueToConfigure').disabled = !hasSource;
}

$('btnContinueToConfigure').addEventListener('click', () => {
  renderConfigureScreen();
  showCreateStep('configure');
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
  const selectedCount = Object.values(state.config.types).filter(Boolean).length;
  const hasSource = state.sourceImages.length > 0 || state.sourceText.trim().length > 0;
  const canGenerate = selectedCount > 0 && hasSource;
  $('btnGenerateExam').disabled = !canGenerate;
  const note = $('configureEmptyNote');
  if (canGenerate) {
    note.hidden = true;
  } else {
    note.hidden = false;
    note.textContent = selectedCount === 0 ? 'Pick at least one question type.' : 'Add source material on the previous screen first.';
  }
}

$('btnGenerateExam').addEventListener('click', runGeneration);
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
    const data = await callEdgeFunction('generate-quiz', {
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
    $('generatingErrorText').textContent = err.message || 'Something went wrong generating the exam.';
    $('btnBackToConfigure').hidden = false;
  }
}

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

  const ungraded = essayQuestions.filter((q) => !state.essayGrades[q.id] && String(state.answers[q.id] || '').trim());
  if (ungraded.length) {
    await Promise.all(ungraded.map(async (q) => {
      try {
        const result = await callEdgeFunction('grade-essay', {
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
renderHome();
resetCreateFlow();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
