import { createThreeViz } from "./three_viz.js";
import { PersonaCard } from "./persona_card.js";

const LS_KEY = "persona3d_v4";

const COLORS = [
  0x55a7ff, 0xff7a55, 0x5dff9a, 0xff55c8, 0xffd955,
  0xb455ff, 0x55fff7, 0xff5555, 0x86ff55, 0x5591ff
];

function nowIso() {
  return new Date().toISOString();
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function normalizePreset(p) {
  // Back-compat: playfulness -> frivolity
  const out = { ...p };
  if (out.frivolity == null && out.playfulness != null) out.frivolity = out.playfulness;
  return out;
}

async function loadPresets() {
  try {
    const res = await fetch("./assets/presets.json", { cache: "no-store" });
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr.map(normalizePreset) : [];
  } catch {
    return [];
  }
}

function pickPresetAvatar(presets, coords, meta) {
  if (!presets.length) return "./assets/presets/WP_0.png";

  const cx = coords.x;
  const cy = coords.y;
  const cal = meta.calibration ?? 60;
  const friv = meta.frivolity ?? 10;

  let best = presets[0];
  let bestD = Infinity;

  for (const pr of presets) {
    const dx = (pr.x ?? 0) - cx;
    const dy = (pr.y ?? 0) - cy;
    const dm = Math.abs((pr.calibration ?? cal) - cal) * 0.35 + Math.abs((pr.frivolity ?? friv) - friv) * 0.20;
    const d = Math.sqrt(dx * dx + dy * dy) + dm;
    if (d < bestD) { bestD = d; best = pr; }
  }
  return best.src || "./assets/presets/WP_0.png";
}

function computeCoordsFromAxes(axes) {
  // If you already provide quadrant_position.x/y, we use that.
  // Otherwise we derive:
  // x = wisdom - knowledge
  // y = practicality - empathy
  const w = axes.wisdom ?? 50;
  const k = axes.knowledge ?? 50;
  const p = axes.practicality ?? 50;
  const e = axes.empathy ?? 50;

  const x = clamp((w - k), -50, 50);
  const y = clamp((p - e), -50, 50);
  return { x, y };
}

function buildHistoryItem(a) {
  const title = a.question_title || a.question_id || "Answer";
  const meta = `${new Date(a.timestamp).toLocaleString()} • ${a.modelLabel || "Unspecified model"}`;
  const body = a.summary || a.raw_excerpt || "";
  return { title, meta, body };
}

function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  const parsed = raw ? safeParseJson(raw) : null;
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function newPersona({ id, color, modelLabel, presets }) {
  const coords = { x: 0, y: 0 };
  const meta = { calibration: 60, frivolity: 10 };
  const avatarSrc = pickPresetAvatar(presets, coords, meta);

  return {
    id,
    name: "Unnamed",
    modelLabel: modelLabel || "",
    color,
    coords,
    axes: { practicality: 50, empathy: 50, knowledge: 50, wisdom: 50 },
    meta,
    progress: { total: 0 }, // total points
    history: [],

    overviewPrimer: "",
    overviewText: "",

    ui: { x: 400, y: 120, z: 10 }
  };
}

function ensureAppState(presets) {
  const loaded = loadState();
  if (loaded && loaded.v === 4 && Array.isArray(loaded.personas)) return loaded;

  return {
    v: 4,
    nextId: 1,
    zTop: 20,
    selectedPersonaId: null,
    draft: {
      // draft answers when no persona is selected yet
      activePersonaId: null
    },
    personas: [],
    presetsCacheInfo: { count: presets.length, loadedAt: nowIso() }
  };
}

// DOM
const elJson = document.getElementById("jsonInput");
const elModelLabel = document.getElementById("modelLabel");
const elParseBtn = document.getElementById("btnParseSave");
const elClearBtn = document.getElementById("btnClearInput");
const elParseStatus = document.getElementById("parseStatus");

const elProgressPanel = document.getElementById("progressPanel");
const elHistoryPanel = document.getElementById("historyPanel");
const elProgressText = document.getElementById("progressText");
const elProgressFill = document.getElementById("progressFill");
const elHistoryList = document.getElementById("historyList");

const elPersonaLayer = document.getElementById("personaLayer");

const elQuestionWindow = document.getElementById("questionWindow");
const elQuestionText = document.getElementById("questionText");
const elQuestionImg = document.getElementById("questionImg");
const elNoImg = document.getElementById("noImg");
const elToggleQuestion = document.getElementById("btnToggleQuestion");

// Three
const canvas = document.getElementById("threeCanvas");

let presets = [];
let state = null;
let three = null;

const cards = new Map();

function bringToFront(personaId) {
  const p = state.personas.find(x => x.id === personaId);
  if (!p) return;
  state.zTop += 1;
  p.ui.z = state.zTop;
  const card = cards.get(personaId);
  if (card) card.setZ(p.ui.z);
  saveState(state);
}

function selectPersona(personaId) {
  state.selectedPersonaId = personaId;

  for (const [id, card] of cards.entries()) {
    card.setSelected(id === personaId);
  }

  renderSidebar();
  saveState(state);
}

function deselectPersona() {
  state.selectedPersonaId = null;
  for (const [, card] of cards.entries()) card.setSelected(false);
  renderSidebar();
  saveState(state);
}

function removePersona(personaId) {
  const idx = state.personas.findIndex(p => p.id === personaId);
  if (idx < 0) return;

  const card = cards.get(personaId);
  if (card) {
    card.destroy();
    cards.delete(personaId);
  }

  state.personas.splice(idx, 1);

  if (state.selectedPersonaId === personaId) state.selectedPersonaId = null;

  syncThreePins();
  renderSidebar();
  saveState(state);
}

function renamePersona(personaId, name) {
  const p = state.personas.find(x => x.id === personaId);
  if (!p) return;
  p.name = name;
  const card = cards.get(personaId);
  if (card) card.update(p);
  saveState(state);
}

function toggleExpandPersona(personaId) {
  const card = cards.get(personaId);
  if (!card) return;
  card.setExpanded(!card.expanded);
}

function ensurePersonaExistsForDraft(modelLabel) {
  // if no persona selected, we still want progress/history to show after first answer
  let activeId = state.draft.activePersonaId;
  let p = activeId ? state.personas.find(x => x.id === activeId) : null;

  if (!p) {
    const id = state.nextId++;
    const color = COLORS[(id - 1) % COLORS.length];
    p = newPersona({ id, color, modelLabel, presets });
    p.ui.x = 390 + (id * 16);
    p.ui.y = 120 + (id * 12);
    p.ui.z = (state.zTop += 1);

    state.personas.push(p);
    state.draft.activePersonaId = id;

    makeCard(p);
    syncThreePins();
  }

  return p;
}

function makeCard(p) {
  const card = new PersonaCard({
    parentEl: document.getElementById("personaLayer"),
    persona: p,
    onSelect: (id) => selectPersona(id),
    onDelete: (id) => removePersona(id),
    onRename: (id, name) => renamePersona(id, name),
    onToggleExpand: (id) => toggleExpandPersona(id),
    bringToFront: (id) => bringToFront(id)
  });

  cards.set(p.id, card);
}

function syncThreePins() {
  if (!three) return;
  const personas = state.personas.map(p => ({
    id: p.id,
    color: p.color,
    coords: p.coords
  }));
  three.setPins(personas);
}

function renderSidebar() {
  // if a persona is selected, show its progress/history
  // if none selected, show the draft persona (the one being built), if any answered exists
  let p = null;

  if (state.selectedPersonaId != null) {
    p = state.personas.find(x => x.id === state.selectedPersonaId) || null;
  } else if (state.draft.activePersonaId != null) {
    p = state.personas.find(x => x.id === state.draft.activePersonaId) || null;
  }

  const hasAnyAnswers = p && p.history.length > 0;

  if (!hasAnyAnswers) {
    elProgressPanel.classList.add("hidden");
    elHistoryPanel.classList.add("hidden");
    return;
  }

  elProgressPanel.classList.remove("hidden");
  elHistoryPanel.classList.remove("hidden");

  const total = p.progress.total;
  const cap = 100;
  const pct = clamp(total / cap, 0, 1) * 100;

  elProgressText.textContent = `${total}/100`;
  elProgressFill.style.width = `${pct}%`;

  elHistoryList.innerHTML = "";
  for (let i = p.history.length - 1; i >= 0; i--) {
    const h = buildHistoryItem(p.history[i]);
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div class="history-top">
        <div class="history-title">${escapeHtml(h.title)}</div>
        <div class="history-meta">${escapeHtml(h.meta)}</div>
      </div>
      <div class="history-body">${escapeHtml(h.body)}</div>
    `;
    elHistoryList.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setQuestionWindowVisible(visible) {
  elQuestionWindow.classList.toggle("hidden", !visible);
}

function showQuestion({ text, imgSrc }) {
  elQuestionText.textContent = text || "";
  if (imgSrc) {
    elQuestionImg.src = imgSrc;
    elQuestionImg.style.display = "block";
    elNoImg.style.display = "none";
  } else {
    elQuestionImg.removeAttribute("src");
    elQuestionImg.style.display = "none";
    elNoImg.style.display = "grid";
  }
  setQuestionWindowVisible(true);
}

function initQuestionWindowLogic() {
  elToggleQuestion.addEventListener("click", () => {
    const hidden = elQuestionWindow.classList.contains("hidden");
    setQuestionWindowVisible(hidden);
  });
}

function initDeselectOnBackground() {
  // click anywhere on main stage background (but not on cards/sidebar) deselects persona
  document.getElementById("stage").addEventListener("pointerdown", (e) => {
    const inSidebar = e.target.closest("#sidebar");
    const inCard = e.target.closest(".persona-card");
    const inQuestion = e.target.closest("#questionWindow");
    if (inSidebar || inCard || inQuestion) return;
    // if they click background but not the canvas, still deselect
    deselectPersona();
  });
}

function parseAndSave() {
  const text = elJson.value.trim();
  const modelLabel = elModelLabel.value.trim();

  if (!text) {
    elParseStatus.textContent = "Paste JSON first.";
    return;
  }

  const obj = safeParseJson(text);
  if (!obj) {
    elParseStatus.textContent = "Invalid JSON.";
    return;
  }

  // You can paste either:
  // - scoring JSON (with axes + effort.points_awarded)
  // - overview JSON (with overview_text / overview_primer)
  //
  // For now, we treat anything with axes or effort as a scoring entry.

  const hasAxes = !!obj.axes || !!obj.practicality || !!(obj.axis_scores && typeof obj.axis_scores === "object");
  const hasEffort = obj.effort?.points_awarded != null || obj.effort_points != null;

  // pick persona target:
  let p = null;
  if (state.selectedPersonaId != null) {
    p = state.personas.find(x => x.id === state.selectedPersonaId) || null;
  } else {
    // draft mode
    p = ensurePersonaExistsForDraft(modelLabel);
  }

  if (!p) {
    elParseStatus.textContent = "No persona target found.";
    return;
  }

  // update persona model label if provided
  if (modelLabel) p.modelLabel = modelLabel;

  if (hasAxes || hasEffort) {
    const entry = normalizeScoringEntry(obj, modelLabel);
    p.history.push(entry);

    // progress
    const pts = clamp(entry.effort_points || 0, 0, 50);
    p.progress.total += pts;

    // axes/meta
    if (entry.axes) p.axes = entry.axes;
    if (entry.meta) p.meta = entry.meta;

    // coords
    if (entry.quadrant_position && typeof entry.quadrant_position.x === "number" && typeof entry.quadrant_position.y === "number") {
      p.coords = {
        x: clamp(entry.quadrant_position.x, -50, 50),
        y: clamp(entry.quadrant_position.y, -50, 50)
      };
    } else if (p.axes) {
      p.coords = computeCoordsFromAxes(p.axes);
    }

    // avatar preset pick
    p.avatarSrc = pickPresetAvatar(presets, p.coords, p.meta);

    // unlock: keep expand button disabled until 100 (handled in card render)

    // update card and pins
    const card = cards.get(p.id);
    if (card) card.update(p);

    syncThreePins();
    renderSidebar();

    // clear input every time, no confusion, no dup panic
    elJson.value = "";

    elParseStatus.textContent = `Saved. +${pts} points. Total: ${p.progress.total}/100`;

    saveState(state);
    return;
  }

  // overview payload fallback
  const primer = obj.overview_primer || obj.primer || "";
  const overviewText = obj.overview_text || obj.overview || "";

  if (primer || overviewText) {
    if (primer) p.overviewPrimer = typeof primer === "string" ? primer : JSON.stringify(primer, null, 2);
    if (overviewText) p.overviewText = typeof overviewText === "string" ? overviewText : JSON.stringify(overviewText, null, 2);

    const card = cards.get(p.id);
    if (card) card.update(p);

    elJson.value = "";
    elParseStatus.textContent = "Saved overview info.";
    saveState(state);
    return;
  }

  elParseStatus.textContent = "JSON parsed, but it did not match scoring or overview fields.";
}

function normalizeScoringEntry(obj, modelLabel) {
  // Support multiple shapes, keep it forgiving.

  const axes =
    obj.axes ||
    obj.axis_scores ||
    (obj.practicality != null ? {
      practicality: obj.practicality,
      empathy: obj.empathy,
      knowledge: obj.knowledge,
      wisdom: obj.wisdom
    } : null);

  const meta =
    obj.meta ||
    obj.meta_axes ||
    (obj.calibration != null ? {
      calibration: obj.calibration,
      frivolity: obj.frivolity ?? obj.playfulness ?? 10
    } : null);

  const effort =
    obj.effort?.points_awarded ??
    obj.effort_points ??
    obj.effortPoints ??
    0;

  const entry = {
    timestamp: nowIso(),
    modelLabel: modelLabel || "",
    question_id: obj.question_id || "",
    question_title: obj.question_title || "",
    summary: obj.summary || "",
    raw_excerpt: obj.raw_excerpt || "",

    axes: axes ? {
      practicality: clamp(axes.practicality ?? 50, 0, 100),
      empathy: clamp(axes.empathy ?? 50, 0, 100),
      knowledge: clamp(axes.knowledge ?? 50, 0, 100),
      wisdom: clamp(axes.wisdom ?? 50, 0, 100)
    } : null,

    meta: meta ? {
      calibration: clamp(meta.calibration ?? 60, 0, 100),
      frivolity: clamp(meta.frivolity ?? meta.playfulness ?? 10, 0, 100)
    } : { calibration: 60, frivolity: 10 },

    effort_points: clamp(effort, 0, 50),
    quadrant_position: obj.quadrant_position || obj.quadrant || null
  };

  return entry;
}

function initInputButtons() {
  elParseBtn.addEventListener("click", parseAndSave);
  elClearBtn.addEventListener("click", () => {
    elJson.value = "";
    elParseStatus.textContent = "";
  });
}

async function boot() {
  presets = await loadPresets();
  state = ensureAppState(presets);

  // create existing cards
  for (const p of state.personas) {
    // ensure avatar with presets
    if (!p.avatarSrc) p.avatarSrc = pickPresetAvatar(presets, p.coords || { x: 0, y: 0 }, p.meta || { calibration: 60, frivolity: 10 });
    makeCard(p);
  }

  // three viz
  three = createThreeViz(canvas, () => {
    // hide question window when background is touched
    setQuestionWindowVisible(false);
  });

  syncThreePins();
  initInputButtons();
  initQuestionWindowLogic();
  initDeselectOnBackground();

  // click on canvas background should also deselect a persona and hide question
  canvas.addEventListener("pointerdown", () => {
    setQuestionWindowVisible(false);
    deselectPersona();
  });

  // start with question visible so user knows where to look
  showQuestion({ text: "Paste LLM JSON to start. Click the 3D plane to hide this window.", imgSrc: "" });

  // restore selected
  if (state.selectedPersonaId != null) selectPersona(state.selectedPersonaId);
  else renderSidebar();

  saveState(state);
}

boot();
