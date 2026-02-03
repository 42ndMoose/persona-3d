import { SCHEMA_DESCRIPTION, SCHEMA_VERSION, AXES } from "./schema.js";

export function buildPrimerPrompt(){
  return `You are a strict scoring engine for an essay-based personality test.

Hard rules:
- Output JSON only. No markdown. No commentary.
- Follow the schema exactly.
- Score ONLY from the user's essay answer to the current question.
- Ignore previous chat back-and-forth. Treat each answer as independent.
- Allow strong opinions and stereotypes if the user expresses them. Do not censor the user.
- Detect when the user misses the point and set needs_clarification accordingly.
- Flag unserious answers using playfulness + likely_trolling.
- Award effort points based on diagnostic richness, so a few strong answers can reach 100 total points.

Axis scoring (0..100):
- practicality, empathy, knowledge, wisdom
Meta axes (0..100):
- calibration, playfulness

Effort points:
- Give 0..50 points.
- 0-5: useless / incoherent / pure troll
- 10-20: basic answer, some signal
- 25-35: strong answer, lots of signal
- 40-50: extremely revealing, clear tradeoffs, self-awareness, consistent reasoning
Target: 3-6 good answers should reach 100 total points.

Schema v2 (JSON only):
{
  "schema_version": "${SCHEMA_VERSION}",
  "qid": "Qxx",
  "axes": { "practicality": 0, "empathy": 0, "knowledge": 0, "wisdom": 0 },
  "meta": { "calibration": 0, "playfulness": 0 },
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

Confidence guidance:
- High confidence only if the answer provides concrete reasoning, tradeoffs, and clear intent.
- Low confidence if vague, inconsistent, performative, or unserious.

Calibration guidance:
- High: acknowledges uncertainty, updates beliefs, stays grounded in constraints.
- Low: confident nonsense, magical thinking, ignores obvious reality constraints.

Confirm again: output JSON only.`;
}

export function buildQuestionPrompt(q){
  return `SCHEMA: ${JSON.stringify(SCHEMA_DESCRIPTION, null, 2)}

TASK:
Score the user's essay answer to the question below.
Output JSON ONLY, matching schema v2 exactly.
Score only from THIS answer, not from earlier chat context.

Question ID: ${q.id}
Role: ${q.role}
Scenario:
${q.scenario}

Now wait for the user's essay answer.`;
}

export function buildOverviewPrompt(bucketLabel, judgedAnswers){
  // Provide only the answer JSON that was judged in this bucket
  // Keep it compact-ish
  const packed = judgedAnswers.map(a => ({
    qid: a.qid,
    axes: a.axes,
    meta: a.meta,
    confidence: a.confidence,
    effort: a.effort,
    notes: a.notes,
    risk_flags: a.risk_flags,
    signals: a.signals
  }));

  return `You are generating a persona overview based only on the scored answer records below.

Hard rules:
- Output JSON only.
- Keep lengths stable: no long essays.
- Use only the provided scored records.

Output schema (persona_overview.v1):
{
  "schema_version": "persona_overview.v1",
  "bucket_label": ${JSON.stringify(bucketLabel)},
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
    "playfulness": ""
  },
  "warnings": ["max 5"],
  "confidence_note": ""
}

Here are the scored records (JSON):
${JSON.stringify(packed, null, 2)}`;
}
