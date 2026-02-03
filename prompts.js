import { SCHEMA_DESCRIPTION, SCHEMA_VERSION } from "./schema.js";

export function buildPrimerPrompt(){
  return `You are a strict scoring engine for an essay-based personality test.

Hard rules:
- Output JSON only. No markdown. No commentary.
- Follow the schema exactly.
- Score ONLY from the user's essay answer to the current question.
- Ignore previous chat back-and-forth. Treat each answer as independent.
- Allow strong opinions and stereotypes if the user expresses them.
- Detect when the user misses the point and set needs_clarification accordingly.
- Flag unserious answers using frivolity + likely_trolling.
- Award effort points based on diagnostic richness.

Axes (0..100):
- practicality, empathy, knowledge, wisdom
Meta (0..100):
- calibration, frivolity

Effort points:
- 0..50 integer
- 0-5: useless / incoherent / pure troll
- 10-20: basic answer, some signal
- 25-35: strong answer, lots of signal
- 40-50: extremely revealing, clear tradeoffs, self-awareness, consistent reasoning

Output this schema EXACTLY (JSON only):

{
  "schema_version": "${SCHEMA_VERSION}",
  "qid": "Qxx",
  "axes": { "practicality": 0, "empathy": 0, "knowledge": 0, "wisdom": 0 },
  "meta": { "calibration": 0, "frivolity": 0 },
  "confidence": { "practicality": 0, "empathy": 0, "knowledge": 0, "wisdom": 0, "calibration": 0 },
  "effort": { "points_awarded": 0, "why": "" },
  "signals": {
    "key_quotes": ["max 3 short quotes <= 20 words each"],
    "observations": ["max 6 short bullet-like sentences"]
  },
  "risk_flags": {
    "missed_point": false,
    "incoherent": false,
    "likely_trolling": false,
    "delusion_risk": false,
    "cruelty_risk": false
  },
  "needs_clarification": {
    "is_needed": false,
    "why": "",
    "re_explain": "",
    "re_ask_prompt": ""
  },
  "notes": {
    "one_sentence_profile": "",
    "what_shifted_this_score": ""
  }
}

Confirm again: output JSON only.`;
}

export function buildQuestionPrompt(q){
  return `SCHEMA (reference):
${JSON.stringify(SCHEMA_DESCRIPTION, null, 2)}

TASK:
Score the user's essay answer to the question below.
Output JSON ONLY, matching schema_version ${SCHEMA_VERSION} exactly.
Score only from THIS answer, not from earlier chat context.

Question ID: ${q.id}
Role: ${q.role}
Scenario:
${q.scenario}

Now wait for the user's essay answer.`;
}

export function buildOverviewPrompt(judgedAnswers){
  const packed = (judgedAnswers || []).map(a => ({
    qid: a.qid,
    axes: a.axes,
    meta: a.meta,
    confidence: a.confidence,
    effort: a.effort,
    notes: a.notes,
    risk_flags: a.risk_flags,
    signals: a.signals
  }));

  return `You are generating a persona overview based only on the scored records below.

Hard rules:
- Output JSON only.
- Keep it compact and stable.
- Use only the provided scored records.

Output schema (persona_overview.v2):

{
  "schema_version": "persona_overview.v2",
  "summary": {
    "title": "",
    "one_paragraph": "",
    "strengths": ["max 5"],
    "weaknesses": ["max 5"],
    "growth_levers": ["max 5"],
    "stress_pattern": "",
    "decision_style": "",
    "social_style": ""
  },
  "trait_breakdown": {
    "practicality": "",
    "empathy": "",
    "knowledge": "",
    "wisdom": "",
    "calibration": "",
    "frivolity": ""
  },
  "warnings": ["max 5"],
  "data_gaps": {
    "missing_aspects": ["max 6"],
    "best_next_question_tip": ""
  },
  "model_confidence_note": ""
}

Scored records (JSON):
${JSON.stringify(packed, null, 2)}`;
}
