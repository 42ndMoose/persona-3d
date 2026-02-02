import { QUESTIONS } from "./questions.js";
import { buildPrimerPrompt, buildQuestionPrompt } from "./prompts.js";
import { loadSession, saveSession, clearSession } from "./store.js";
import {
  validateAndMigrateModelJson,
  stableHashForDuplicate,
  answersForTarget,
  computeAggregate,
  deriveQuadrant,
  pickNextQuestion,
  shouldAutoCreatePersonaFromDraft,
  newId
} from "./scoring.js";
import { makeViz } from "./three_viz.js";
import { mountPersonaCards } from "./persona_card.js";

const el = (id) => document.getElementById(id);

const ui = {
  qMeta: el("qMeta"),
  qBody: el("qBody"),
  qPrintTitle: el("qPrintTitle"),
  qPrintBody: el("qPrintBody"),
  qImg: el("qImg"),
  qImgPlaceholder: el("qImgPlaceholder"),

  modelLabel: el("modelLabel"),
  jsonIn: el("jsonIn"),
  parseMsg: el("parseMsg"),
  clarifyBox: el("clarifyBox"),

  pillStatus: el("pillStatus"),
  pillSaved: el("pillSaved"),
  pillMode: el("pillMode"),
  pillQuadrant: el("pillQuadrant"),

  progressCard: el("progressCard"),
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

  historyCard: el("historyCard"),
  historyPlaceholder: el("historyPlaceholder"),
  history: el("history"),

  personaLayer: el("personaLayer"),
  vizRoot: el("vizRoot"),

  btnCopyPrimer: el("btnCopyPrimer"),
  btnCopyQuestion: el("btnCopyQuestion"),
  btnParse: el("btnParse"),
  btnNext: el("btnNext"),
  btnReset: el("btnReset"),
  btnExport: el("btnExport"),
  fileImport: el("fileImport")
};

let session = loadSession();

// default persona positions store
if(!session.ui.persona_positions) session.ui.persona_positions = {};

const viz = makeViz(el("c"));

let selectedPersonaId = session.selected_persona_id || null;

// current target is selected persona, else draft (null)
function currentTargetId(){ return selectedPersonaId; }
function targetAnswers(){ return answersForTarget(session, currentTargetId()); }

let currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);

renderAll();

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

  if(migrated.qid !== currentQuestion.id){
    // warn but allow
    toastBad(`Warning: JSON qid=${migrated.qid} but current question is ${currentQuestion.id}. Saving anyway.`);
  }

  const qSnap = QUESTIONS.find(q => q.id === migrated.qid) || currentQuestion;

  const personaId = currentTargetId(); // null means draft
  const dupHash = stableHashForDuplicate(migrated, personaId);

  const exists = (session.answers || []).some(a => a.dup_hash === dupHash && (a.persona_id || null) === personaId);
  if(exists){
    toastBad(`Duplicate rejected. (hash ${dupHash})`);
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

  // clear input on success
  ui.jsonIn.value = "";

  // show clarification if needed
  if(record.needs_clarification?.is_needed){
    const re = record.needs_clarification;
    ui.clarifyBox.textContent =
      `Why: ${re.why}\n\nRe-explain:\n${re.re_explain}\n\nRe-ask prompt:\n${re.re_ask_prompt}`;
  }

  // if draft hit 100, auto-create persona from all draft answers
  if(personaId === null){
    const draftAgg = computeAggregate(answersForTarget(session, null));
    if(shouldAutoCreatePersonaFromDraft(draftAgg)){
      const pid = newId("persona");
      const newPersona = {
        id: pid,
        created_at: new Date().toISOString(),
        name: "Unnamed",
        avatar: null,
        overview: null,
        ui: { expanded: false }
      };
      session.personas.push(newPersona);

      // assign all draft answers to this new persona
      for(const a of session.answers){
        if((a.persona_id || null) === null){
          a.persona_id = pid;
        }
      }

      // auto select the new persona
      selectedPersonaId = pid;
      session.selected_persona_id = pid;

      // give it a default position on the right, stacked
      const idx = session.personas.length - 1;
      session.ui.persona_positions[pid] = { x: 24, y: 180 + idx * 30 };

      toastOk("Persona created from draft.");
    }
  }

  saveSession(session);

  currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
  renderAll();
  toastOk(`Saved. hash ${dupHash}`);
});

ui.btnNext.addEventListener("click", () => {
  currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
  renderAll();
  toastOk("Skipped.");
});

ui.btnReset.addEventListener("click", () => {
  if(!confirm("Reset local data for this site?")) return;
  clearSession();
  session = loadSession();
  selectedPersonaId = null;
  ui.jsonIn.value = "";
  ui.modelLabel.value = "";
  currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
  renderAll();
  toastOk("Reset done.");
});

ui.btnExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "persona3d-session.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toastOk("Exported session JSON.");
});

ui.fileImport.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();

  try{
    const obj = JSON.parse(text);
    if(!obj || typeof obj !== "object") throw new Error("bad");

    // normalize-ish
    if(!Array.isArray(obj.answers)) obj.answers = [];
    if(!Array.isArray(obj.personas)) obj.personas = [];
    if(!obj.ui || typeof obj.ui !== "object") obj.ui = {};
    if(!obj.ui.persona_positions || typeof obj.ui.persona_positions !== "object") obj.ui.persona_positions = {};

    // migrate answers to v3 if needed
    obj.answers = obj.answers.map(a => migrateImportedAnswer(a)).filter(Boolean);

    // ensure persona ids exist
    const pids = new Set(obj.personas.map(p => p.id));
    for(const a of obj.answers){
      const pid = a.persona_id || null;
      if(pid !== null && !pids.has(pid)){
        // orphaned, move to draft
        a.persona_id = null;
      }
    }

    session = obj;

    // keep selection if valid
    selectedPersonaId = (typeof session.selected_persona_id === "string") ? session.selected_persona_id : null;
    if(selectedPersonaId && !session.personas.some(p => p.id === selectedPersonaId)){
      selectedPersonaId = null;
      session.selected_persona_id = null;
    }

    saveSession(session);
    currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
    renderAll();
    toastOk("Imported session.");
  }catch{
    toastBad("Import failed. Not valid session JSON.");
  }finally{
    ui.fileImport.value = "";
  }
});

function migrateImportedAnswer(a){
  // Accept wrapped answers from earlier patch versions
  if(!a || typeof a !== "object") return null;

  // If it already has schema_version, migrate via validator
  if(a.schema_version){
    const v = validateAndMigrateModelJson(a);
    if(!v.ok) return null;

    const qid = v.migrated.qid;
    const qSnap = QUESTIONS.find(q => q.id === qid) || QUESTIONS[0];

    const personaId = (typeof a.persona_id === "string") ? a.persona_id : null;

    const wrapped = {
      ...v.migrated,
      persona_id: personaId,
      model_label: (a.model_label || "").trim(),
      question: a.question || {
        id: qSnap.id, title: qSnap.title, role: qSnap.role, scenario: qSnap.scenario, image: qSnap.image || null
      },
      saved_at: a.saved_at || new Date().toISOString()
    };
    wrapped.dup_hash = a.dup_hash || stableHashForDuplicate(v.migrated, personaId);
    return wrapped;
  }

  // Otherwise, it is probably already wrapped, keep best-effort
  a.persona_id = (typeof a.persona_id === "string") ? a.persona_id : null;
  a.dup_hash = a.dup_hash || stableHashForDuplicate(a, a.persona_id || null);
  return a;
}

function renderAll(){
  renderQuestion();
  renderViz();
  renderPersonaCards();
  renderLeftPanel();
}

function renderQuestion(){
  ui.qMeta.textContent =
    `${currentQuestion.id} • ${currentQuestion.title}\nRole: ${currentQuestion.role}\nTags: ${(currentQuestion.tags || []).join(", ")}`;

  ui.qBody.textContent = currentQuestion.scenario;
  ui.qPrintTitle.textContent = `${currentQuestion.id} • ${currentQuestion.title}`;
  ui.qPrintBody.textContent = currentQuestion.scenario;

  // image
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

  // mode pill
  ui.pillMode.textContent = selectedPersonaId ? "Persona selected" : "Draft";
}

function renderViz(){
  // pin should follow selected persona agg if selected, else draft agg
  const agg = computeAggregate(targetAnswers());
  viz.setQuadrantXY(agg.quadrant.x, agg.quadrant.y);
}

function renderPersonaCards(){
  mountPersonaCards({
    layerEl: ui.personaLayer,
    session,
    personas: session.personas || [],
    selectedId: selectedPersonaId,
    getAggForPersona: (pid) => computeAggregate(answersForTarget(session, pid)),
    getPointsForPersona: (pid) => computeAggregate(answersForTarget(session, pid)).points,
    getAnswersForPersona: (pid) => answersForTarget(session, pid),
    onSelect: (pid) => {
      selectedPersonaId = pid;
      session.selected_persona_id = pid;
      saveSession(session);
      currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
      renderAll();
    },
    onDeselect: () => {
      selectedPersonaId = null;
      session.selected_persona_id = null;
      saveSession(session);
      currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
      renderAll();
    },
    onUpdatePersona: (sess, persona, patch, silentPosOnly=false) => {
      const i = sess.personas.findIndex(x => x.id === persona.id);
      if(i < 0) return;

      const next = { ...sess.personas[i], ...patch };

      // name lock-in behavior: show display, hide edit
      // handled in persona_card.js via blur; we just store value here
      sess.personas[i] = next;

      if(!silentPosOnly){
        // nothing special
      }

      saveSession(sess);
      renderAll();
    },
    onRemovePersona: (pid) => {
      // remove persona and its answers
      session.answers = session.answers.filter(a => (a.persona_id || null) !== pid);
      session.personas = session.personas.filter(p => p.id !== pid);
      delete session.ui.persona_positions[pid];

      if(selectedPersonaId === pid){
        selectedPersonaId = null;
        session.selected_persona_id = null;
      }

      saveSession(session);
      currentQuestion = pickNextQuestion(QUESTIONS, targetAnswers(), session.last_qid);
      renderAll();
    },
    onCopyText: async (text) => {
      await copyText(text);
    }
  });
}

function renderLeftPanel(){
  if(!selectedPersonaId){
    ui.progressPlaceholder.style.display = "block";
    ui.progressInner.style.display = "none";
    ui.historyPlaceholder.style.display = "block";
    ui.history.style.display = "none";

    ui.pillQuadrant.textContent = "Quadrant: —";
    ui.pillSaved.textContent = "Saved: 0";
    return;
  }

  const answers = answersForTarget(session, selectedPersonaId);
  const agg = computeAggregate(answers);

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
