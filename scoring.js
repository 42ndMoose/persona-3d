import { AXES, META, clamp01to100, clampInt, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from "./schema.js";

export function validateAndMigrateModelJson(obj){
  const errs = [];
  if(!obj || typeof obj !== "object") return { ok:false, errs:["Not an object."], migrated:null };

  const sv = obj.schema_version;

  if(sv !== SCHEMA_V3 && sv !== SCHEMA_V2 && sv !== SCHEMA_V1){
    return { ok:false, errs:[`schema_version must be ${SCHEMA_V3} (or legacy ${SCHEMA_V2}/${SCHEMA_V1})`], migrated:null };
  }

  let m = obj;
  if(sv === SCHEMA_V1) m = migrateV1toV3(obj);
  if(sv === SCHEMA_V2) m = migrateV2toV3(obj);

  if(typeof m.qid !== "string") errs.push("qid missing.");
  if(!m.axes || typeof m.axes !== "object") errs.push("axes missing.");
  if(!m.meta || typeof m.meta !== "object") errs.push("meta missing.");
  if(!m.confidence || typeof m.confidence !== "object") errs.push("confidence missing.");
  if(!m.effort || typeof m.effort !== "object") errs.push("effort missing.");
  if(!m.signals || typeof m.signals !== "object") errs.push("signals missing.");
  if(!m.risk_flags || typeof m.risk_flags !== "object") errs.push("risk_flags missing.");
  if(!m.needs_clarification || typeof m.needs_clarification !== "object") errs.push("needs_clarification missing.");
  if(!m.notes || typeof m.notes !== "object") errs.push("notes missing.");

  for(const k of AXES){
    const v = clamp01to100(m.axes[k]);
    if(v === null) errs.push(`axes.${k} must be 0..100`);
  }
  for(const k of META){
    const v = clamp01to100(m.meta[k]);
    if(v === null) errs.push(`meta.${k} must be 0..100`);
  }

  for(const k of [...AXES, "calibration"]){
    const v = clamp01to100(m.confidence[k]);
    if(v === null) errs.push(`confidence.${k} must be 0..100`);
  }

  const pts = clampInt(m.effort.points_awarded, 0, 50);
  if(pts === null) errs.push("effort.points_awarded must be an int 0..50");
  if(typeof m.effort.why !== "string") errs.push("effort.why must be a string");

  return { ok: errs.length === 0, errs, migrated: m };
}

function migrateV2toV3(v2){
  return {
    schema_version: SCHEMA_V3,
    qid: v2.qid,
    axes: v2.axes,
    meta: {
      calibration: v2.meta?.calibration ?? 50,
      frivolity: v2.meta?.playfulness ?? v2.meta?.frivolity ?? 0
    },
    confidence: {
      practicality: v2.confidence?.practicality ?? 60,
      empathy: v2.confidence?.empathy ?? 60,
      knowledge: v2.confidence?.knowledge ?? 60,
      wisdom: v2.confidence?.wisdom ?? 60,
      calibration: v2.confidence?.calibration ?? 60
    },
    effort: v2.effort || { points_awarded: 20, why: "Migrated (default effort)." },
    signals: v2.signals || { key_quotes: [], observations: [] },
    risk_flags: v2.risk_flags || defaultFlags(),
    needs_clarification: v2.needs_clarification || defaultClarify(),
    notes: v2.notes || { one_sentence_profile:"", what_shifted_this_score:"" }
  };
}

function migrateV1toV3(v1){
  // V1 is older and may not have effort/confidence structure. Best-effort.
  const avgConf = avg([
    v1.confidence?.practicality, v1.confidence?.empathy, v1.confidence?.knowledge, v1.confidence?.wisdom, v1.confidence?.calibration
  ].map(x => (Number.isFinite(Number(x)) ? Number(x) : 50)));

  const approxPts = Math.max(10, Math.min(35, Math.round(avgConf / 3)));

  return {
    schema_version: SCHEMA_V3,
    qid: v1.qid,
    axes: v1.axes,
    meta: {
      calibration: v1.meta?.calibration ?? 50,
      frivolity: v1.meta?.playfulness ?? v1.meta?.frivolity ?? 0
    },
    confidence: {
      practicality: v1.confidence?.practicality ?? 60,
      empathy: v1.confidence?.empathy ?? 60,
      knowledge: v1.confidence?.knowledge ?? 60,
      wisdom: v1.confidence?.wisdom ?? 60,
      calibration: v1.confidence?.calibration ?? 60
    },
    effort: { points_awarded: approxPts, why: "Migrated from v1 record (approx points)." },
    signals: v1.signals || { key_quotes: [], observations: [] },
    risk_flags: v1.risk_flags || defaultFlags(),
    needs_clarification: v1.needs_clarification || defaultClarify(),
    notes: v1.notes || { one_sentence_profile:"", what_shifted_this_score:"" }
  };
}

function defaultFlags(){
  return { missed_point:false, incoherent:false, likely_trolling:false, delusion_risk:false, cruelty_risk:false };
}
function defaultClarify(){
  return { is_needed:false, why:"", re_explain:"", re_ask_prompt:"" };
}

function avg(arr){
  if(!arr.length) return 50;
  const s = arr.reduce((a,b)=>a+b,0);
  return s / arr.length;
}

export function stableHashForDuplicate(obj, personaId){
  const stable = stableStringify(obj);
  const text = `${personaId || "draft"}::${stable}`;
  return fnv1a(text);
}

function stableStringify(value){
  if(value === null) return "null";
  const t = typeof value;
  if(t === "number" || t === "boolean") return String(value);
  if(t === "string") return JSON.stringify(value);
  if(Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if(t === "object"){
    const keys = Object.keys(value).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(String(value));
}

function fnv1a(str){
  let h = 0x811c9dc5;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

export function answersForTarget(session, personaId){
  return (session.answers || []).filter(a => (a.persona_id || null) === (personaId || null));
}

export function computeAggregate(answers){
  const axes = { practicality:50, empathy:50, knowledge:50, wisdom:50 };
  const meta = { calibration:50, frivolity:0 };
  const points = computePoints(answers);

  if(!answers.length){
    return { axes, meta, confidence: emptyConfidence(), quadrant: {x:0,y:0,label:"—"}, points };
  }

  const sum = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0, frivolity:0 };
  const wsum = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0, frivolity:0 };

  for(const a of answers){
    const ax = a.axes || {};
    const m = a.meta || {};
    const c = a.confidence || {};
    const effort = clampInt(a.effort?.points_awarded, 0, 50) ?? 10;

    for(const k of AXES){
      const v = clamp01to100(ax[k]);
      const conf = clamp01to100(c[k]) ?? 60;
      const w = (effort / 50) * (conf / 100);
      if(v === null) continue;
      sum[k] += v * w;
      wsum[k] += w;
    }

    // calibration
    {
      const v = clamp01to100(m.calibration);
      const conf = clamp01to100(c.calibration) ?? 60;
      const w = (effort / 50) * (conf / 100);
      if(v !== null){
        sum.calibration += v * w;
        wsum.calibration += w;
      }
    }

    // frivolity (effort-weighted only)
    {
      const v = clamp01to100(m.frivolity);
      const w = (effort / 50);
      if(v !== null){
        sum.frivolity += v * w;
        wsum.frivolity += w;
      }
    }
  }

  for(const k of AXES){
    axes[k] = Math.round(sum[k] / Math.max(0.0001, wsum[k]));
  }
  meta.calibration = Math.round(sum.calibration / Math.max(0.0001, wsum.calibration));
  meta.frivolity = Math.round(sum.frivolity / Math.max(0.0001, wsum.frivolity));

  const confidence = computeTargetConfidence(answers);
  const quadrant = deriveQuadrant(axes);

  return { axes, meta, confidence, quadrant, points };
}

function computePoints(answers){
  const total = answers.reduce((acc, a) => acc + (clampInt(a.effort?.points_awarded, 0, 50) ?? 0), 0);
  const now = Math.min(100, total);
  return { now, total };
}

function computeTargetConfidence(answers){
  if(!answers.length) return emptyConfidence();

  const totalPts = answers.reduce((acc, a) => acc + (clampInt(a.effort?.points_awarded, 0, 50) ?? 0), 0);
  const ptsFactor = Math.max(0.4, Math.min(1.0, totalPts / 100));

  const sums = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0 };
  for(const a of answers){
    const c = a.confidence || {};
    sums.practicality += clamp01to100(c.practicality) ?? 60;
    sums.empathy += clamp01to100(c.empathy) ?? 60;
    sums.knowledge += clamp01to100(c.knowledge) ?? 60;
    sums.wisdom += clamp01to100(c.wisdom) ?? 60;
    sums.calibration += clamp01to100(c.calibration) ?? 60;
  }

  const base = {
    practicality: Math.round((sums.practicality / answers.length) * ptsFactor),
    empathy: Math.round((sums.empathy / answers.length) * ptsFactor),
    knowledge: Math.round((sums.knowledge / answers.length) * ptsFactor),
    wisdom: Math.round((sums.wisdom / answers.length) * ptsFactor),
    calibration: Math.round((sums.calibration / answers.length) * ptsFactor)
  };

  for(const k of Object.keys(base)){
    base[k] = Math.max(0, Math.min(100, base[k]));
  }
  return base;
}

function emptyConfidence(){
  return { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0 };
}

export function deriveQuadrant(axes){
  const x = (axes.practicality - axes.empathy);
  const y = (axes.wisdom - axes.knowledge);
  const qx = x >= 0 ? "Practicality" : "Empathy";
  const qy = y >= 0 ? "Wisdom" : "Knowledge";
  const label = `${qy} + ${qx}`;
  return { x, y, label };
}

export function pickNextQuestion(questions, answers, lastQid){
  const answered = new Set(answers.map(a => a.qid));
  const agg = computeAggregate(answers);
  const confidence = agg.confidence;

  const axisNeed = [
    ["practicality", 100 - (confidence.practicality ?? 0)],
    ["empathy", 100 - (confidence.empathy ?? 0)],
    ["knowledge", 100 - (confidence.knowledge ?? 0)],
    ["wisdom", 100 - (confidence.wisdom ?? 0)],
    ["calibration", 100 - (confidence.calibration ?? 0)]
  ].sort((a,b) => b[1]-a[1]);

  const topNeedAxes = axisNeed.slice(0, 2).map(x => x[0]);

  let best = null;
  let bestScore = -1e9;

  for(const q of questions){
    if(answered.has(q.id)) continue;

    const targets = q.targets || [];
    let infoGain = 0;
    for(const ax of targets){
      const needRow = axisNeed.find(r => r[0] === ax);
      if(needRow) infoGain += needRow[1];
      if(topNeedAxes.includes(ax)) infoGain += 12;
    }

    let rolePenalty = 0;
    if(lastQid){
      const lastQ = questions.find(x => x.id === lastQid);
      if(lastQ && lastQ.role === q.role) rolePenalty = 8;
    }

    const fatigueCost = (q.fatigue ?? 2) * 10;
    const score = infoGain - fatigueCost - rolePenalty;

    if(score > bestScore){
      bestScore = score;
      best = q;
    }
  }

  return best || questions[0];
}

export function shouldAutoCreatePersonaFromDraft(draftAgg){
  return draftAgg.points.total >= 100;
}

export function newId(prefix="p"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
