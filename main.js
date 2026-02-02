import { QUESTIONS } from "./questions.js";
import { buildPrimerPrompt, buildQuestionPrompt } from "./prompts.js";
import { loadSession, saveSession, clearSession } from "./store.js";
import { validateModelJson, computeAggregate, pickNextQuestion } from "./scoring.js";
import { makeViz } from "./three_viz.js";

const el = (id) => document.getElementById(id);

const ui = {
  qMeta: el("qMeta"),
  qBody: el("qBody"),
  jsonIn: el("jsonIn"),
  parseMsg: el("parseMsg"),
  history: el("history"),
  pillStatus: el("pillStatus"),
  pillSaved: el("pillSaved"),
  pillProgress: el("pillProgress"),
  pillQuadrant: el("pillQuadrant"),
  vPracticality: el("vPracticality"),
  vEmpathy: el("vEmpathy"),
  vKnowledge: el("vKnowledge"),
  vWisdom: el("vWisdom"),
  vCalibration: el("vCalibration"),
  vPlayfulness: el("vPlayfulness"),
  btnCopyPrimer: el("btnCopyPrimer"),
  btnCopyQuestion: el("btnCopyQuestion"),
  btnParse: el("btnParse"),
  btnNext: el("btnNext"),
  btnReset: el("btnReset"),
  btnExport: el("btnExport"),
  fileImport: el("fileImport")
};

let session = loadSession();
let current = pickNextQuestion(QUESTIONS, session);

const viz = makeViz(el("c"));

renderAll();

ui.btnCopyPrimer.addEventListener("click", async () => {
  await copyText(buildPrimerPrompt());
  toastOk("Primer copied. Paste once per session into your LLM chat.");
});

ui.btnCopyQuestion.addEventListener("click", async () => {
  await copyText(buildQuestionPrompt(current));
  toastOk(`Question ${current.id} copied (includes schema + strict JSON rules).`);
});

ui.btnParse.addEventListener("click", () => {
  const raw = ui.jsonIn.value.trim();
  if(!raw){
    toastBad("Paste JSON first.");
    return;
  }

  let obj;
  try{
    obj = JSON.parse(raw);
  }catch(e){
    toastBad("Invalid JSON. Make sure the model output is JSON only.");
    return;
  }

  const v = validateModelJson(obj);
  if(!v.ok){
    toastBad("Schema errors:\n- " + v.errs.join("\n- "));
    return;
  }

  // Enforce qid alignment: accept if matches current or if user pasted different qid
  if(obj.qid !== current.id){
    // still store, but warn
    toastBad(`Warning: JSON qid=${obj.qid} but current question is ${current.id}. Storing anyway.`);
  }

  // Store answer
  const stamp = new Date().toISOString();
  session.answers.push({
    ...obj,
    saved_at: stamp
  });
  session.last_qid = obj.qid;
  saveSession(session);

  // Show clarification if needed
  if(obj.needs_clarification?.is_needed){
    const re = obj.needs_clarification;
    ui.jsonIn.value =
      `{\n  "NOTE": "Model says clarification is needed.",\n  "why": ${JSON.stringify(re.why)},\n  "re_explain": ${JSON.stringify(re.re_explain)},\n  "re_ask_prompt": ${JSON.stringify(re.re_ask_prompt)}\n}\n\n` +
      ui.jsonIn.value;
  }else{
    ui.jsonIn.value = "";
  }

  // pick next
  current = pickNextQuestion(QUESTIONS, session);
  renderAll();
  toastOk("Saved. Next question selected.");
});

ui.btnNext.addEventListener("click", () => {
  // skip without saving
  current = pickNextQuestion(QUESTIONS, session);
  renderAll();
  toastOk("Skipped. Next question selected.");
});

ui.btnReset.addEventListener("click", () => {
  if(!confirm("Reset local session? This clears localStorage for this site.")) return;
  clearSession();
  session = loadSession();
  current = pickNextQuestion(QUESTIONS, session);
  ui.jsonIn.value = "";
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
    if(!obj || typeof obj !== "object" || !Array.isArray(obj.answers)) throw new Error("bad");
    session = obj;
    saveSession(session);
    current = pickNextQuestion(QUESTIONS, session);
    renderAll();
    toastOk("Imported session.");
  }catch{
    toastBad("Import failed. Not valid session JSON.");
  }finally{
    ui.fileImport.value = "";
  }
});

function renderAll(){
  renderQuestion();
  renderScores();
  renderHistory();
  renderViz();
}

function renderQuestion(){
  ui.qMeta.textContent =
    `${current.id} • ${current.title}\nRole: ${current.role}\nTags: ${(current.tags || []).join(", ")}`;

  ui.qBody.textContent = current.scenario;

  const answered = (session.answers || []).length;
  ui.pillProgress.textContent = `${answered} answered`;
  ui.pillSaved.textContent = `Saved: ${answered}`;
  ui.pillStatus.textContent = "Waiting";
}

function renderScores(){
  const agg = computeAggregate(session);

  ui.vPracticality.textContent = fmt(agg.axes.practicality);
  ui.vEmpathy.textContent = fmt(agg.axes.empathy);
  ui.vKnowledge.textContent = fmt(agg.axes.knowledge);
  ui.vWisdom.textContent = fmt(agg.axes.wisdom);

  ui.vCalibration.textContent = fmt(agg.meta.calibration);
  ui.vPlayfulness.textContent = fmt(agg.meta.playfulness);

  ui.pillQuadrant.textContent = `Quadrant: ${agg.quadrant.label} (x=${agg.quadrant.x}, y=${agg.quadrant.y})`;

  // store last aggregate for viz
  window.__agg = agg;
}

function renderViz(){
  const agg = window.__agg || computeAggregate(session);
  viz.setQuadrantXY(agg.quadrant.x, agg.quadrant.y);
}

function renderHistory(){
  ui.history.innerHTML = "";
  const answers = session.answers || [];
  if(answers.length === 0){
    ui.history.innerHTML = `<div class="smallnote">No answers saved yet.</div>`;
    return;
  }

  // latest first
  const list = [...answers].reverse();
  for(const a of list){
    const div = document.createElement("div");
    div.className = "hitem";

    const title = QUESTIONS.find(q => q.id === a.qid)?.title ?? "Unknown";
    const prof = a.notes?.one_sentence_profile ?? "";
    const flags = a.risk_flags || {};
    const flagStr = [
      flags.missed_point ? "missed_point" : null,
      flags.likely_trolling ? "likely_trolling" : null,
      flags.delusion_risk ? "delusion_risk" : null,
      flags.cruelty_risk ? "cruelty_risk" : null
    ].filter(Boolean).join(", ");

    div.innerHTML = `
      <div class="hrow">
        <div class="htitle">${a.qid} • ${escapeHtml(title)}</div>
        <div class="hmeta">${new Date(a.saved_at || Date.now()).toLocaleString()}</div>
      </div>
      <div class="hmini">
        axes: P${a.axes?.practicality ?? "?"} E${a.axes?.empathy ?? "?"} K${a.axes?.knowledge ?? "?"} W${a.axes?.wisdom ?? "?"}
        • cal ${a.meta?.calibration ?? "?"}
        ${flagStr ? `<br/>flags: ${escapeHtml(flagStr)}` : ""}
        ${prof ? `<br/>${escapeHtml(prof)}` : ""}
      </div>
    `;
    ui.history.appendChild(div);
  }
}

function fmt(n){
  if(n === null || n === undefined) return "—";
  return String(n);
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    // fallback
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
