import { QUESTIONS } from "./questions.js";
import { buildPrimerPrompt, buildQuestionPrompt } from "./prompts.js";
import { loadSession, saveSession, clearSession } from "./store.js";
import { loadPresets, pickNearestPreset } from "./presets.js";
import {
  normalizeBucket,
  validateAndMigrateModelJson,
  stableHashForDuplicate,
  computeAggregateForBucket,
  pickNextQuestion
} from "./scoring.js";
import { makeViz } from "./three_viz.js";
import { renderPersonaCard } from "./persona_card.js";

const el = (id) => document.getElementById(id);

const ui = {
  bucketSelect: el("bucketSelect"),
  bucketSelectInline: el("bucketSelectInline"),

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
  pillProgress: el("pillProgress"),
  pillQuadrant: el("pillQuadrant"),

  progressFill: el("progressFill"),
  ptsNow: el("ptsNow"),
  ptsTotal: el("ptsTotal"),

  vPracticality: el("vPracticality"),
  vEmpathy: el("vEmpathy"),
  vKnowledge: el("vKnowledge"),
  vWisdom: el("vWisdom"),
  vCalibration: el("vCalibration"),
  vPlayfulness: el("vPlayfulness"),

  history: el("history"),
  personaCardMount: el("personaCardMount"),

  btnCopyPrimer: el("btnCopyPrimer"),
  btnCopyQuestion: el("btnCopyQuestion"),
  btnParse: el("btnParse"),
  btnNext: el("btnNext"),
  btnReset: el("btnReset"),
  btnExport: el("btnExport"),
  fileImport: el("fileImport")
};

let session = loadSession();
let presets = await loadPresets();

let activeBucket = "general";
ensureBucketOptions();

let current = pickNextQuestion(QUESTIONS, session, activeBucket);

const viz = makeViz(el("c"));

renderAll();

ui.bucketSelect.addEventListener("change", () => {
  activeBucket = normalizeBucket(ui.bucketSelect.value);
  syncBucketSelectors();
  current = pickNextQuestion(QUESTIONS, session, activeBucket);
  renderAll();
});

ui.bucketSelectInline.addEventListener("change", () => {
  activeBucket = normalizeBucket(ui.bucketSelectInline.value);
  syncBucketSelectors();
  current = pickNextQuestion(QUESTIONS, session, activeBucket);
  renderAll();
});

ui.btnCopyPrimer.addEventListener("click", async () => {
  await copyText(buildPrimerPrompt());
  toastOk("Primer copied.");
});

ui.btnCopyQuestion.addEventListener("click", async () => {
  await copyText(buildQuestionPrompt(current));
  toastOk(`Question ${current.id} copied.`);
});

ui.btnParse.addEventListener("click", () => {
  ui.clarifyBox.textContent = "";

  const raw = ui.jsonIn.value.trim();
  if(!raw){
    toastBad("Paste JSON first.");
    return;
  }

  const bucket = normalizeBucket(ui.bucketSelectInline.value || activeBucket);
  const modelLabel = (ui.modelLabel.value || "").trim();

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

  // enforce qid alignment warning
  if(migrated.qid !== current.id){
    toastBad(`Warning: JSON qid=${migrated.qid} but current question is ${current.id}. Saving anyway.`);
  }

  // attach snapshot of question to make exports portable
  const qSnap = QUESTIONS.find(q => q.id === migrated.qid) || current;
  const record = {
    ...migrated,
    bucket,
    model_label: modelLabel,
    question: {
      id: qSnap.id,
      title: qSnap.title,
      role: qSnap.role,
      scenario: qSnap.scenario,
      image: qSnap.image || null
    },
    saved_at: new Date().toISOString()
  };

  // duplicate detection
  const dupHash = stableHashForDuplicate(migrated, bucket);
  record.dup_hash = dupHash;

  const existing = (session.answers || []).some(a => a.dup_hash === dupHash && normalizeBucket(a.bucket) === bucket);
  if(existing){
    toastBad(`Duplicate rejected. (hash ${dupHash})`);
    return;
  }

  // save
  session.answers.push(record);
  session.last_qid = record.qid;
  saveSession(session);

  // always clear on success to avoid duplicate confusion
  ui.jsonIn.value = "";

  // show clarification if needed
  if(record.needs_clarification?.is_needed){
    const re = record.needs_clarification;
    ui.clarifyBox.textContent =
      `Why: ${re.why}\n\nRe-explain:\n${re.re_explain}\n\nRe-ask prompt:\n${re.re_ask_prompt}`;
  }

  // next
  current = pickNextQuestion(QUESTIONS, session, activeBucket);
  renderAll();
  toastOk(`Saved. hash ${dupHash}`);
});

ui.btnNext.addEventListener("click", () => {
  current = pickNextQuestion(QUESTIONS, session, activeBucket);
  renderAll();
  toastOk("Skipped.");
});

ui.btnReset.addEventListener("click", () => {
  if(!confirm("Reset local session? This clears local data for this site.")) return;
  clearSession();
  session = loadSession();
  current = pickNextQuestion(QUESTIONS, session, activeBucket);
  ui.jsonIn.value = "";
  ui.modelLabel.value = "";
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

    // best-effort normalize + migrate answer records
    if(!Array.isArray(obj.answers)) obj.answers = [];
    obj.answers = obj.answers.map(a => migrateImportedRecord(a)).filter(Boolean);

    session = obj;
    saveSession(session);

    // refresh buckets and selection
    ensureBucketOptions(true);
    current = pickNextQuestion(QUESTIONS, session, activeBucket);
    renderAll();
    toastOk("Imported session.");
  }catch{
    toastBad("Import failed. Not valid session JSON.");
  }finally{
    ui.fileImport.value = "";
  }
});

function migrateImportedRecord(a){
  if(!a || typeof a !== "object") return null;

  const bucket = normalizeBucket(a.bucket);
  const qid = String(a.qid || a.question?.id || "");
  if(!qid) return null;

  // if it's raw model json record, it might not have bucket/question fields
  if(a.schema_version){
    const v = validateAndMigrateModelJson(a);
    if(!v.ok) return null;

    const qSnap = QUESTIONS.find(q => q.id === v.migrated.qid) || QUESTIONS[0];
    const base = {
      ...v.migrated,
      bucket,
      model_label: (a.model_label || "").trim(),
      question: a.question || {
        id: qSnap.id, title: qSnap.title, role: qSnap.role, scenario: qSnap.scenario, image: qSnap.image || null
      },
      saved_at: a.saved_at || new Date().toISOString()
    };
    base.dup_hash = a.dup_hash || stableHashForDuplicate(base, bucket);
    return base;
  }

  // already a wrapped record
  a.bucket = bucket;
  a.dup_hash = a.dup_hash || stableHashForDuplicate(a, bucket);
  return a;
}

function ensureBucketOptions(fromImport=false){
  // buckets come from:
  // - explicit saved answers
  // - active selection
  const buckets = new Set(["general"]);
  for(const ans of (session.answers || [])){
    buckets.add(normalizeBucket(ans.bucket));
  }
  // also include current selection
  buckets.add(normalizeBucket(activeBucket));

  const list = [...buckets].sort((a,b)=>a.localeCompare(b));

  ui.bucketSelect.innerHTML = "";
  ui.bucketSelectInline.innerHTML = "";
  for(const b of list){
    const o1 = document.createElement("option");
    o1.value = b;
    o1.textContent = b;
    ui.bucketSelect.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = b;
    o2.textContent = b;
    ui.bucketSelectInline.appendChild(o2);
  }

  // keep activeBucket valid
  if(!buckets.has(activeBucket)) activeBucket = "general";
  syncBucketSelectors();

  if(fromImport){
    // if import introduced new buckets, stay on general unless current active exists
    // (no forced switch)
  }
}

function syncBucketSelectors(){
  ui.bucketSelect.value = activeBucket;
  ui.bucketSelectInline.value = activeBucket;
}

function renderAll(){
  ensureBucketOptions();
  renderQuestion();
  renderScoresAndProgress();
  renderPersonaCardUI();
  renderHistory();
  renderViz();
}

function renderQuestion(){
  ui.qMeta.textContent =
    `${current.id} • ${current.title}\nRole: ${current.role}\nTags: ${(current.tags || []).join(", ")}`;

  ui.qBody.textContent = current.scenario;

  ui.qPrintTitle.textContent = `${current.id} • ${current.title}`;
  ui.qPrintBody.textContent = current.scenario;

  // image
  const src = current.image || "";
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

  ui.pillStatus.textContent = "Waiting";
  ui.pillSaved.textContent = `Saved: ${(session.answers || []).filter(a => normalizeBucket(a.bucket) === activeBucket).length}`;
}

function renderScoresAndProgress(){
  const agg = computeAggregateForBucket(session, activeBucket);

  ui.vPracticality.textContent = String(agg.axes.practicality);
  ui.vEmpathy.textContent = String(agg.axes.empathy);
  ui.vKnowledge.textContent = String(agg.axes.knowledge);
  ui.vWisdom.textContent = String(agg.axes.wisdom);

  ui.vCalibration.textContent = String(agg.meta.calibration);
  ui.vPlayfulness.textContent = String(agg.meta.playfulness);

  ui.pillQuadrant.textContent = `Quadrant: ${agg.quadrant.label} (x=${agg.quadrant.x}, y=${agg.quadrant.y})`;

  ui.ptsNow.textContent = String(agg.points.now);
  ui.ptsTotal.textContent = String(agg.points.total);

  ui.pillProgress.textContent = `${agg.points.total} pts`;

  ui.progressFill.style.width = `${agg.points.now}%`;

  window.__agg = agg;
}

function renderPersonaCardUI(){
  const agg = window.__agg || computeAggregateForBucket(session, activeBucket);

  renderPersonaCard({
    mountEl: ui.personaCardMount,
    bucket: activeBucket,
    agg,
    points: agg.points,
    session,
    presets,
    pickPreset: (presetsArr, target) => pickNearestPreset(presetsArr, target),
    onSaveSession: (s) => { saveSession(s); },
    onCopyText: async (text) => {
      await copyText(text);
      toastOk("Copied overview prompt.");
    }
  });
}

function renderViz(){
  const agg = window.__agg || computeAggregateForBucket(session, activeBucket);
  viz.setQuadrantXY(agg.quadrant.x, agg.quadrant.y);
}

function renderHistory(){
  ui.history.innerHTML = "";
  const answers = (session.answers || []).filter(a => normalizeBucket(a.bucket) === activeBucket);

  if(answers.length === 0){
    ui.history.innerHTML = `<div class="smallnote">No answers saved in this bucket yet.</div>`;
    return;
  }

  const list = [...answers].reverse();
  for(const a of list){
    const div = document.createElement("div");
    div.className = "hitem";

    const title = a.question?.title || QUESTIONS.find(q => q.id === a.qid)?.title || "Unknown";
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
        pts: ${escapeHtml(String(pts))} • hash ${escapeHtml(a.dup_hash || "")}
        <br/>axes: P${a.axes?.practicality ?? "?"} E${a.axes?.empathy ?? "?"} K${a.axes?.knowledge ?? "?"} W${a.axes?.wisdom ?? "?"}
        • cal ${a.meta?.calibration ?? "?"}
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
