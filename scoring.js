import { AXES, META, clamp01to100, clampInt, SCHEMA_V1, SCHEMA_V2 } from "./schema.js";

export function normalizeBucket(label){
  const x = (label || "").trim();
  return x ? x : "general";
}

export function validateAndMigrateModelJson(obj){
  const errs = [];
  if(!obj || typeof obj !== "object") return { ok:false, errs:["Not an object."], migrated:null };

  const sv = obj.schema_version;

  if(sv !== SCHEMA_V2 && sv !== SCHEMA_V1){
    return { ok:false, errs:[`schema_version must be ${SCHEMA_V2} (or legacy ${SCHEMA_V1})`], migrated:null };
  }

  // V1 -> V2 migration
  let m = obj;
  if(sv === SCHEMA_V1){
    m = migrateV1toV2(obj);
  }

  // Required keys
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

  // confidence keys (required in v2)
  for(const k of [...AXES, "calibration"]){
    const v = clamp01to100(m.confidence[k]);
    if(v === null) errs.push(`confidence.${k} must be 0..100`);
  }

  // effort points
  const pts = clampInt(m.effort.points_awarded, 0, 50);
  if(pts === null) errs.push("effort.points_awarded must be an int 0..50");
  if(typeof m.effort.why !== "string") errs.push("effort.why must be a string");

  return { ok: errs.length === 0, errs, migrated: m };
}

function migrateV1toV2(v1){
  // default effort points for old records:
  // estimate from average confidence (rough)
  const avgConf = avg([
    v1.confidence?.practicality, v1.confidence?.empathy, v1.confidence?.knowledge, v1.confidence?.wisdom, v1.confidence?.calibration
  ].map(x => (Number.isFinite(Number(x)) ? Number(x) : 50)));

  const approxPts = Math.max(10, Math.min(35, Math.round(avgConf / 3)));

  return {
    schema_version: SCHEMA_V2,
    qid: v1.qid,
    axes: v1.axes,
    meta: v1.meta,
    confidence: {
      practicality: v1.confidence?.practicality ?? 60,
      empathy: v1.confidence?.empathy ?? 60,
      knowledge: v1.confidence?.knowledge ?? 60,
      wisdom: v1.confidence?.wisdom ?? 60,
      calibration: v1.confidence?.calibration ?? 60
    },
    effort: { points_awarded: approxPts, why: "Migrated from v1 record (approx points)." },
    signals: v1.signals,
    risk_flags: v1.risk_flags,
    needs_clarification: v1.needs_clarification,
    notes: v1.notes
  };
}

function avg(arr){
  if(!arr.length) return 50;
  const s = arr.reduce((a,b)=>a+b,0);
  return s / arr.length;
}

export function stableHashForDuplicate(obj, bucket){
  // Normalize and hash (FNV-1a)
  const stable = stableStringify(obj);
  const text = `${bucket}::${stable}`;
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

export function computeAggregateForBucket(session, bucket){
  const b = normalizeBucket(bucket);
  const answers = (session.answers || []).filter(a => normalizeBucket(a.bucket) === b);

  // default
  const axes = { practicality:50, empathy:50, knowledge:50, wisdom:50 };
  const meta = { calibration:50, playfulness:0 };
  const points = computePoints(answers);

  if(answers.length === 0){
    return { axes, meta, confidence: emptyConfidence(), quadrant: {x:0,y:0,label:"—"}, points };
  }

  // weighted mean by effort points * confidence
  const sum = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0, playfulness:0 };
  const wsum = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0, playfulness:0 };

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

    // playfulness: average (effort-weighted only)
    {
      const v = clamp01to100(m.playfulness);
      const w = (effort / 50);
      if(v !== null){
        sum.playfulness += v * w;
        wsum.playfulness += w;
      }
    }
  }

  for(const k of AXES){
    axes[k] = Math.round(sum[k] / Math.max(0.0001, wsum[k]));
  }
  meta.calibration = Math.round(sum.calibration / Math.max(0.0001, wsum.calibration));
  meta.playfulness = Math.round(sum.playfulness / Math.max(0.0001, wsum.playfulness));

  const confidence = computeBucketConfidence(answers);
  const quadrant = deriveQuadrant(axes);

  return { axes, meta, confidence, quadrant, points };
}

function computePoints(answers){
  const total = answers.reduce((acc, a) => acc + (clampInt(a.effort?.points_awarded, 0, 50) ?? 0), 0);
  const now = Math.min(100, total);
  return { now, total };
}

function computeBucketConfidence(answers){
  if(!answers.length) return emptyConfidence();

  // map points to confidence fullness: once total >= 100, you're "ready"
  // Still keep per-axis confidence averaged, but also allow points to lift overall stability.
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

  // clamp
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

  const qx = x >= 0 ? "P" : "E";
  const qy = y >= 0 ? "W" : "K";
  const label = `${qy}${qx}`;

  return { x, y, label };
}

export function pickNextQuestion(questions, session, bucket){
  const b = normalizeBucket(bucket);
  const answered = new Set((session.answers || []).filter(a => normalizeBucket(a.bucket) === b).map(a => a.qid));
  const agg = computeAggregateForBucket(session, b);
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
    const last = session.last_qid;
    if(last){
      const lastQ = questions.find(x => x.id === last);
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
