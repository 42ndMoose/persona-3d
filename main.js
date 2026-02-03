/*
 * This file is based on the upstream Persona 3D main.js.  It wires up the
 * overall application UI and state management.  Several tweaks were made to
 * improve the user experience:
 *
 * 1. When clicking anywhere on the background of the visualization (outside
 *    of the question frame or persona cards), the question window is
 *    automatically hidden.  This allows users to see the plane clearly
 *    without manually closing the window each time.
 * 2. The existing behaviour for clicking on the canvas (#c) – which hides
 *    the question window and deselects the current card – is preserved.
 */

import { QUESTIONS } from "./questions.js";
import { buildPrimerPrompt, buildQuestionPrompt } from "./prompts.js";
import { loadSession, saveSession, clearSession } from "./store.js";
import {
  validateAndMigrateModelJson,
  stableHashForDuplicate,
  answersForTarget,
  computeAggregate,
  pickNextQuestion,
  newId
} from "./scoring.js";
import { makeViz } from "./three_viz.js";
import { mountPersonaCards } from "./persona_card.js";

const el = (id) => document.getElementById(id);

const ui = {
  leftPanel: el("leftPanel"),

  qMeta: el("qMeta"),
  qBody: el("qBody"),
  qPrintTitle: el("qPrintTitle"),
  qPrintBody: el("qPrintBody"),
  qImg: el("qImg"),
  qImgPlaceholder: el("qImgPlaceholder"),
  qFrame: el("qFrame"),

  modelLabel: el("modelLabel"),
  jsonIn: el("jsonIn"),
  parseMsg: el("parseMsg"),
  clarifyBox: el("clarifyBox"),

  pillStatus: el("pillStatus"),
  pillSaved: el("pillSaved"),
  pillMode: el("pillMode"),
  pillQuadrant: el("pillQuadrant"),

  progressPlaceholder: el("progressPlaceholder"),
  progressInner: el("progressInner"),
  progressFill: el("progressFill"),
  ptsNow: el("ptsNow"),
  ptsTotal: el("ptsTotal"),

  vPracticality: el("vPracticality"),
  vEmpathy: el("vEmpathy"),
  vKnowledge: el("vKnowledge"),
  vWisdom: el("vWisdom"),
  vCalibration: el("vCalibration"),
  vFrivolity: el("vFrivolity"),

  historyPlaceholder: el("historyPlaceholder"),
  history: el("history"),

  personaLayer: el("personaLayer"),
  vizRoot: el("vizRoot"),

  btnCopyPrimer: el("btnCopyPrimer"),
  btnCopyQuestion: el("btnCopyQuestion"),
  btnParse: el("btnParse"),
  btnNext: el("btnNext"),
  btnReset: el("btnReset"),

  btnExportCard: el("btnExportCard"),
  fileImportCard: el("fileImportCard")
};

let session = loadSession();
if(!session.ui.persona_positions) session.ui.persona_positions = {};

const viz = makeViz(el("c"));

const COLOR_POOL = [
  "#67d1ff", "#9bffa3", "#ffd36a", "#ff6b6b",
  "#b28dff", "#7ff6ff", "#ffa7d1", "#a8ff7f"
];

let selectedPersonaId = session.selected_persona_id || null;
let workingPersonaId = session.working_persona_id || null;

function currentTargetId(){
  // If selected, we score into selected.
  // If none selected, we score into working (created on first save).
  return selectedPersonaId || workingPersonaId || null;
}

function targetAnswers(){
  const tid = currentTargetId();
  return tid ? answersForTarget(session, tid) : [];
}

let currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);

renderAll();

/* ---------- UI actions ---------- */

ui.btnCopyPrimer.addEventListener("click", async () => {
  await copyText(buildPrimerPrompt());
  toastOk("Primer copied.");
});

ui.btnCopyQuestion.addEventListener("click", async () => {
  await copyText(buildQuestionPrompt(currentQuestion));
  toastOk(`Question ${currentQuestion.id} copied.`);
});

ui.btnParse.addEventListener("click", () => {
  ui.clarifyBox.textContent = "";

  const raw = ui.jsonIn.value.trim();
  if(!raw){
    toastBad("Paste JSON first.");
    return;
  }

  let obj;
  try{
    obj = JSON.parse(raw);
  }catch{
    toastBad("Invalid JSON. Make sure the model output is JSON only.");
    return;
  }

  const v = validateAndMigrateModelJson(obj);
  if(!v.ok){
    toastBad("Schema errors:\n- " + v.errs.join("\n- "));
    return;
  }

  const migrated = v.migrated;

  const qSnap = QUESTIONS.find(q => q.id === migrated.qid) || currentQuestion;

  // Ensure a persona target exists
  const personaId = ensureActivePersonaTarget();

  const dupHash = stableHashForDuplicate(migrated, personaId);

  // Duplicates are rejected only within the SAME persona.
  const exists = (session.answers || []).some(a => a.dup_hash === dupHash && a.persona_id === personaId);
  if(exists){
    toastBad(`Duplicate rejected for this card. (hash ${dupHash})`);
    return;
  }

  const record = {
    ...migrated,
    persona_id: personaId,
    model_label: (ui.modelLabel.value || "").trim(),
    question: {
      id: qSnap.id,
      title: qSnap.title,
      role: qSnap.role,
      scenario: qSnap.scenario,
      image: qSnap.image || null
    },
    saved_at: new Date().toISOString(),
    dup_hash: dupHash
  };

  session.answers.push(record);
  session.last_qid = record.qid;

  // store axes xy snapshot onto persona for preset matching, etc.
  updatePersonaAxesXY(personaId);

  // clear input on success
  ui.jsonIn.value = "";

  if(record.needs_clarification?.is_needed){
    const re = record.needs_clarification;
    ui.clarifyBox.textContent =
      `Why: ${re.why}\n\nRe-explain:\n${re.re_explain}\n\nRe-ask prompt:\n${re.re_ask_prompt}`;
  }

  saveSession(session);

  currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
  renderAll();
  toastOk(`Saved. hash ${dupHash}`);
});

ui.btnNext.addEventListener("click", () => {
  currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
  renderQuestion();
  // question window reappears when question changes
  showQuestionFrame(true);
  toastOk("Skipped.");
});

ui.btnReset.addEventListener("click", () => {
  if(!confirm("Reset local data for this site?")) return;
  clearSession();
  session = loadSession();
  selectedPersonaId = null;
  workingPersonaId = null;
  ui.jsonIn.value = "";
  ui.modelLabel.value = "";
  currentQuestion = pickNextQuestion(QUESTIONS, [], session.last_qid);
  renderAll();
  toastOk("Reset done.");
});

/* per-card export/import */

ui.btnExportCard.addEventListener("click", () => {
  const pid = selectedPersonaId || workingPersonaId;
  if(!pid){
    toastBad("No card to export yet. Answer one question first.");
    return;
  }
  const pack = exportPersonaCard(pid);
  downloadJson(pack, `persona-card-${pid}.json`);
  toastOk("Exported card.");
});

ui.fileImportCard.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;

  try{
    const text = await file.text();
    const obj = JSON.parse(text);

    // Accept: persona_card export format, OR older full-session export and extract personas.
    if(obj && obj.schema_version === "persona3d.persona_export.v1"){
      importPersonaCard(obj);
      toastOk("Imported card.");
    }else if(obj && Array.isArray(obj.personas) && Array.isArray(obj.answers)){
      // Merge old session export (instead of overwriting)
      mergeOldSession(obj);
      toastOk("Imported from older session export.");
    }else{
      toastBad("Import failed. Not a recognized card/session JSON.");
      return;
    }

    saveSession(session);
    renderAll();
  }catch{
    toastBad("Import failed. Not valid JSON.");
  }finally{
    ui.fileImportCard.value = "";
  }
});

/* click behind question window hides it + deselects */
el("c").addEventListener("pointerdown", () => {
  // hide question window immediately when clicking the plane
  showQuestionFrame(false);

  // Clicking the plane background means you want to stop inspecting a card and start a new one.
  // This is the “deselect” you asked for.
  if(selectedPersonaId !== null){
    selectedPersonaId = null;
    session.selected_persona_id = null;
    // reset working so next save creates a new persona
    workingPersonaId = null;
    session.working_persona_id = null;
    saveSession(session);
    renderAll();
  }else{
    // if already none selected, this prepares a fresh new working persona
    workingPersonaId = null;
    session.working_persona_id = null;
    saveSession(session);
    renderAll();
  }
});

// Additional handler: hide the question frame when the user clicks anywhere on the
// visualization background (outside of the question window or persona cards).  This
// allows users to clear the overlay and view the plane without needing to click
// exactly on the canvas.  We don’t change card selection here, just hide the frame.
ui.vizRoot.addEventListener("pointerdown", (e) => {
  // Skip if clicking within the question frame or persona cards
  if(e.target.closest("#qFrame") || e.target.closest("#personaLayer") || e.target.closest(".pfloat")) return;
  showQuestionFrame(false);
});

/* ---------- core helpers ---------- */

function ensureActivePersonaTarget(){
  // If selected persona exists, use it.
  if(selectedPersonaId){
    return selectedPersonaId;
  }

  // If no selected persona but a working persona exists, use it.
  if(workingPersonaId && session.personas.some(p => p.id === workingPersonaId)){
    return workingPersonaId;
  }

  // Otherwise create a new working persona card right now (first answer case).
  const pid = newId("persona");
  const color = pickNextColor();

  const newPersona = {
    id: pid,
    created_at: new Date().toISOString(),
    name: "Unnamed",
    color,
    avatar: null,
    overview: null,
    axes_xy: { x: 0, y: 0 },
    ui: { expanded: false }
  };

  session.personas.push(newPersona);

  // default position stacks
  const idx = session.personas.length - 1;
  session.ui.persona_positions[pid] = session.ui.persona_positions[pid] || { x: 24, y: 160 + idx * 34 };

  workingPersonaId = pid;
  session.working_persona_id = pid;

  return pid;
}

function updatePersonaAxesXY(pid){
  const answers = answersForTarget(session, pid);
  const agg = computeAggregate(answers);
  const i = session.personas.findIndex(p => p.id === pid);
  if(i >= 0){
    session.personas[i] = {
      ...session.personas[i],
      axes_xy: { x: agg.quadrant.x, y: agg.quadrant.y }
    };
  }
}

function pickNextColor(){
  const used = new Set((session.personas || []).map(p => (p.color || "").toLowerCase()));
  for(const c of COLOR_POOL){
    if(!used.has(c.toLowerCase())) return c;
  }
  // fallback
  return COLOR_POOL[(session.personas.length || 0) % COLOR_POOL.length];
}

function exportPersonaCard(pid){
  const persona = session.personas.find(p => p.id === pid);
  const answers = session.answers.filter(a => a.persona_id === pid);

  return {
    schema_version: "persona3d.persona_export.v1",
    exported_at: new Date().toISOString(),
    persona,
    answers
  };
}

function importPersonaCard(pack){
  // Always create a new id so duplicates can coexist.
  const old = pack.persona;
  const oldId = old.id;
  const newPid = newId("persona");
  const color = old.color || pickNextColor();

  const persona = {
    ...old,
    id: newPid,
    color,
    ui: { ...(old.ui || {}), expanded: false }
  };

  // place imported cards in a neat stack
  const idx = session.personas.length;
  session.ui.persona_positions[newPid] = { x: 24, y: 160 + idx * 34 };

  session.personas.push(persona);

  // migrate + attach answers
  for(const a of (pack.answers || [])){
    const v = validateAndMigrateModelJson(a.schema_version ? a : a); // may already be migrated
    if(a.schema_version && !v.ok){
      continue;
    }
    const migrated = a.schema_version ? v.migrated : a;

    const record = {
      ...migrated,
      persona_id: newPid,
      saved_at: a.saved_at || new Date().toISOString(),
      model_label: (a.model_label || "").trim(),
      question: a.question || null
    };
    record.dup_hash = stableHashForDuplicate(record, newPid);
    session.answers.push(record);
  }

  updatePersonaAxesXY(newPid);
}

function mergeOldSession(obj){
  // Pull each persona out and import as separate card
  const personas = Array.isArray(obj.personas) ? obj.personas : [];
  const answers = Array.isArray(obj.answers) ? obj.answers : [];

  for(const p of personas){
    const pid = p.id;
    const pack = {
      schema_version: "persona3d.persona_export.v1",
      persona: p,
      answers: answers.filter(a => (a.persona_id || null) === pid)
    };
    importPersonaCard(pack);
  }
}

/* ---------- render ---------- */

function renderAll(){
  renderQuestion();
  renderPersonaCards();
  renderLeftPanel();
  renderVizPins();
}

function renderQuestion(){
  ui.qMeta.textContent =
    `${currentQuestion.id} • ${currentQuestion.title}\nRole: ${currentQuestion.role}\nTags: ${(currentQuestion.tags || []).join(", ")}`;

  ui.qBody.textContent = currentQuestion.scenario;
  ui.qPrintTitle.textContent = `${currentQuestion.id} • ${currentQuestion.title}`;
  ui.qPrintBody.textContent = currentQuestion.scenario;

  const src = currentQuestion.image || "";
  if(src){
    ui.qImg.onload = () => {
      ui.qImg.style.display = "block";
      ui.qImgPlaceholder.style.display = "none";
    };
    ui.qImg.onerror = () => {
      ui.qImg.style.display = "none";
      ui.qImgPlaceholder.style.display = "flex";
    };
    ui.qImg.src = src;
  }else{
    ui.qImg.style.display = "none";
    ui.qImgPlaceholder.style.display = "flex";
  }

  // Update mode label
  if(selectedPersonaId){
    ui.pillMode.textContent = "Selected card";
  }else if(workingPersonaId){
    ui.pillMode.textContent = "Working card";
  }else{
    ui.pillMode.textContent = "Working";
  }

  // question window should show when question changes
  showQuestionFrame(true);
}

function renderPersonaCards(){
  mountPersonaCards({
    layerEl: ui.personaLayer,
    session,
    personas: session.personas || [],
    selectedId: selectedPersonaId,
    workingId: workingPersonaId,
    getAggForPersona: (pid) => computeAggregate(answersForTarget(session, pid)),
    getPointsForPersona: (pid) => computeAggregate(answersForTarget(session, pid)).points,
    getAnswersForPersona: (pid) => answersForTarget(session, pid),

    onSelect: (pid) => {
      selectedPersonaId = pid;
      session.selected_persona_id = pid;

      // selecting a card is “inspect mode”, does not change working id
      saveSession(session);

      currentQuestion = pickNextQuestion(QUESTIONS, answersForTarget(session, pid), session.last_qid);
      renderAll();
    },

    onUpdatePersona: (sess, persona, patch, silentPosOnly=false) => {
      const i = sess.personas.findIndex(x => x.id === persona.id);
      if(i < 0) return;
      const next = { ...sess.personas[i], ...patch };
      sess.personas[i] = next;
      saveSession(sess);
      if(!silentPosOnly) renderAll();
    },

    onRemovePersona: (pid) => {
      session.answers = session.answers.filter(a => a.persona_id !== pid);
      session.personas = session.personas.filter(p => p.id !== pid);
      delete session.ui.persona_positions[pid];

      if(selectedPersonaId === pid){
        selectedPersonaId = null;
        session.selected_persona_id = null;
      }
      if(workingPersonaId === pid){
        workingPersonaId = null;
        session.working_persona_id = null;
      }

      saveSession(session);
      renderAll();
    },

    onCopyText: async (text) => {
      await copyText(text);
    }
  });
}

function renderLeftPanel(){
  const pid = selectedPersonaId || workingPersonaId;
  if(!pid){
    // show placeholders only if nothing started
    ui.progressPlaceholder.style.display = "block";
    ui.progressInner.style.display = "none";
    ui.historyPlaceholder.style.display = "block";
    ui.history.style.display = "none";
    ui.pillQuadrant.textContent = "Quadrant: —";
    ui.pillSaved.textContent = "Saved: 0";
    return;
  }

  const answers = answersForTarget(session, pid);
  const agg = computeAggregate(answers);

  // show progress/history as soon as at least 1 answer exists
  if(answers.length === 0){
    ui.progressPlaceholder.style.display = "block";
    ui.progressInner.style.display = "none";
    ui.historyPlaceholder.style.display = "block";
    ui.history.style.display = "none";
    ui.pillQuadrant.textContent = "Quadrant: —";
    ui.pillSaved.textContent = "Saved: 0";
    return;
  }

  ui.progressPlaceholder.style.display = "none";
  ui.progressInner.style.display = "block";
  ui.historyPlaceholder.style.display = "none";
  ui.history.style.display = "flex";

  ui.pillQuadrant.textContent = `Quadrant: ${agg.quadrant.label}`;
  ui.progressFill.style.width = `${agg.points.now}%`;
  ui.ptsNow.textContent = String(agg.points.now);
  ui.ptsTotal.textContent = String(agg.points.total);

  ui.vPracticality.textContent = String(agg.axes.practicality);
  ui.vEmpathy.textContent = String(agg.axes.empathy);
  ui.vKnowledge.textContent = String(agg.axes.knowledge);
  ui.vWisdom.textContent = String(agg.axes.wisdom);
  ui.vCalibration.textContent = String(agg.meta.calibration);
  ui.vFrivolity.textContent = String(agg.meta.frivolity);

  ui.pillSaved.textContent = `Saved: ${answers.length}`;

  renderHistory(answers);
}

function renderHistory(answers){
  ui.history.innerHTML = "";
  const list = [...answers].reverse();

  for(const a of list){
    const div = document.createElement("div");
    div.className = "hitem";

    const title = a.question?.title || "Unknown";
    const prof = a.notes?.one_sentence_profile ?? "";
    const flags = a.risk_flags || {};
    const flagStr = [
      flags.missed_point ? "missed_point" : null,
      flags.likely_trolling ? "likely_trolling" : null,
      flags.delusion_risk ? "delusion_risk" : null,
      flags.cruelty_risk ? "cruelty_risk" : null
    ].filter(Boolean).join(", ");

    const modelLine = a.model_label ? `Model: ${escapeHtml(a.model_label)}` : "Model: (unspecified)";
    const pts = a.effort?.points_awarded ?? "?";

    div.innerHTML = `
      <div class="hrow">
        <div class="htitle">${escapeHtml(a.qid)} • ${escapeHtml(title)}</div>
        <div class="hmeta">
          ${new Date(a.saved_at || Date.now()).toLocaleString()}
          <br/>${modelLine}
        </div>
      </div>
      <div class="hmini">
        points: ${escapeHtml(String(pts))} • hash ${escapeHtml(a.dup_hash || "")}
        <br/>Practicality ${a.axes?.practicality ?? "?"}, Empathy ${a.axes?.empathy ?? "?"}, Knowledge ${a.axes?.knowledge ?? "?"}, Wisdom ${a.axes?.wisdom ?? "?"}
        <br/>Calibration ${a.meta?.calibration ?? "?"}, Frivolity ${a.meta?.frivolity ?? "?"}
        ${flagStr ? `<br/>flags: ${escapeHtml(flagStr)}` : ""}
        ${prof ? `<br/>${escapeHtml(prof)}` : ""}
      </div>
    `;
    ui.history.appendChild(div);
  }
}

function renderVizPins(){
  const pins = [];
  for(const p of (session.personas || [])){
    const answers = answersForTarget(session, p.id);
    if(answers.length === 0) continue;
    const agg = computeAggregate(answers);
    pins.push({
      id: p.id,
      x: agg.quadrant.x,
      y: agg.quadrant.y,
      color: hexToInt(p.color || "#67d1ff"),
      selected: (p.id === selectedPersonaId) || (selectedPersonaId === null && p.id === workingPersonaId)
    });

    // keep axes snapshot updated
    p.axes_xy = { x: agg.quadrant.x, y: agg.quadrant.y };
  }
  viz.setPins(pins);
}

/* question frame visibility */
function showQuestionFrame(show){
  if(show){
    ui.qFrame.classList.remove("hidden");
  }else{
    ui.qFrame.classList.add("hidden");
  }
}

/* ---------- misc ---------- */

function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function toastOk(msg){
  ui.pillStatus.textContent = "OK";
  ui.pillStatus.className = "pill";
  ui.parseMsg.className = "msg ok";
  ui.parseMsg.textContent = msg;
}

function toastBad(msg){
  ui.pillStatus.textContent = "Check";
  ui.pillStatus.className = "pill pill-warn";
  ui.parseMsg.className = "msg bad";
  ui.parseMsg.textContent = msg;
}

function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function hexToInt(hex){
  const h = String(hex || "#67d1ff").replace("#","");
  return parseInt(h.length === 3 ? h.split("").map(c=>c+c).join("") : h, 16);
}
