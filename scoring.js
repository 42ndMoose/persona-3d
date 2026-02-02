import { clamp01to100 } from "./schema.js";

export function validateModelJson(obj){
  const errs = [];
  if(!obj || typeof obj !== "object") errs.push("Not an object.");

  if(obj.schema_version !== "persona.schema.v1") errs.push("schema_version must be persona.schema.v1");
  if(typeof obj.qid !== "string") errs.push("qid missing.");

  const requiredAxes = ["practicality","empathy","knowledge","wisdom"];
  const requiredMeta = ["calibration","playfulness"];

  const axes = obj.axes || {};
  const meta = obj.meta || {};
  const conf = obj.confidence || {};

  for(const k of requiredAxes){
    const v = clamp01to100(axes[k]);
    if(v === null) errs.push(`axes.${k} must be a number 0..100`);
  }
  for(const k of requiredMeta){
    const v = clamp01to100(meta[k]);
    if(v === null) errs.push(`meta.${k} must be a number 0..100`);
  }

  // confidence: allow missing keys but if present must be valid
  for(const k of [...requiredAxes, "calibration"]){
    if(conf[k] === undefined) continue;
    const v = clamp01to100(conf[k]);
    if(v === null) errs.push(`confidence.${k} must be a number 0..100`);
  }

  if(!obj.risk_flags || typeof obj.risk_flags !== "object") errs.push("risk_flags missing.");
  if(!obj.signals || typeof obj.signals !== "object") errs.push("signals missing.");
  if(!obj.needs_clarification || typeof obj.needs_clarification !== "object") errs.push("needs_clarification missing.");
  if(!obj.notes || typeof obj.notes !== "object") errs.push("notes missing.");

  return { ok: errs.length === 0, errs };
}

export function computeAggregate(session){
  const answers = session.answers || [];
  const axes = { practicality: 50, empathy: 50, knowledge: 50, wisdom: 50 };
  const meta = { calibration: 50, playfulness: 0 };

  if(answers.length === 0){
    return { axes, meta, confidence: { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0 }, quadrant: emptyQuadrant() };
  }

  // weighted mean: weight = (confidence or 60) / 100, with floor to avoid 0 weight
  const sum = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0, playfulness:0 };
  const wsum = { practicality:0, empathy:0, knowledge:0, wisdom:0, calibration:0, playfulness:0 };

  for(const a of answers){
    const ax = a.axes || {};
    const m = a.meta || {};
    const c = a.confidence || {};
    const w = {
      practicality: ((c.practicality ?? 60) / 100) || 0.6,
      empathy: ((c.empathy ?? 60) / 100) || 0.6,
      knowledge: ((c.knowledge ?? 60) / 100) || 0.6,
      wisdom: ((c.wisdom ?? 60) / 100) || 0.6,
      calibration: ((c.calibration ?? 60) / 100) || 0.6,
      playfulness: 1.0
    };

    for(const k of ["practicality","empathy","knowledge","wisdom"]){
      const v = clamp01to100(ax[k]);
      if(v === null) continue;
      sum[k] += v * w[k];
      wsum[k] += w[k];
    }

    const cal = clamp01to100(m.calibration);
    if(cal !== null){ sum.calibration += cal * w.calibration; wsum.calibration += w.calibration; }

    const pl = clamp01to100(m.playfulness);
    if(pl !== null){ sum.playfulness += pl * w.playfulness; wsum.playfulness += w.playfulness; }
  }

  for(const k of ["practicality","empathy","knowledge","wisdom"]){
    axes[k] = Math.round(sum[k] / Math.max(0.001, wsum[k]));
  }
  meta.calibration = Math.round(sum.calibration / Math.max(0.001, wsum.calibration));
  meta.playfulness = Math.round(sum.playfulness / Math.max(0.001, wsum.playfulness));

  const confidence = {
    practicality: Math.round(Math.min(100, (wsum.practicality / answers.length) * 100)),
    empathy: Math.round(Math.min(100, (wsum.empathy / answers.length) * 100)),
    knowledge: Math.round(Math.min(100, (wsum.knowledge / answers.length) * 100)),
    wisdom: Math.round(Math.min(100, (wsum.wisdom / answers.length) * 100)),
    calibration: Math.round(Math.min(100, (wsum.calibration / answers.length) * 100))
  };

  const quadrant = deriveQuadrant(axes);

  return { axes, meta, confidence, quadrant };
}

export function deriveQuadrant(axes){
  // 2D plane:
  // x = practicality - empathy (right = more practical, left = more empathetic)
  // y = wisdom - knowledge (up = more wisdom, down = more knowledge)
  const x = (axes.practicality - axes.empathy);
  const y = (axes.wisdom - axes.knowledge);

  const qx = x >= 0 ? "P" : "E";
  const qy = y >= 0 ? "W" : "K";
  const label = `${qy}${qx}`; // e.g. WP, WE, KP, KE

  return { x, y, label };
}

function emptyQuadrant(){
  return { x: 0, y: 0, label: "—" };
}

export function pickNextQuestion(questions, session){
  const answered = new Set((session.answers || []).map(a => a.qid));
  const { confidence } = computeAggregate(session);

  // target the lowest-confidence axis first to reduce fatigue.
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
      if(topNeedAxes.includes(ax)) infoGain += 12; // boost top needs
    }

    // mild diversity: avoid repeating same role twice in a row
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

  // if everything answered, loop back to first
  return best || questions[0];
}
