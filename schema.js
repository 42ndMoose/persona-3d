export const SCHEMA_VERSION = "persona.schema.v1";

export const SCHEMA_DESCRIPTION = {
  version: SCHEMA_VERSION,
  core_axes: ["practicality", "empathy", "knowledge", "wisdom"],
  meta_axes: ["calibration", "playfulness"],
  ranges: "All axes 0..100 inclusive. Higher = more of that trait.",
  notes: {
    practicality: "Plans, executes, optimizes, handles tradeoffs, acts under constraints.",
    empathy: "Reads people, cares, protects dignity, avoids cruelty, understands feelings.",
    knowledge: "Breadth/depth of concepts, curiosity, retention, structured thinking.",
    wisdom: "Judgment, long-term thinking, ethics under pressure, sees second-order effects.",
    calibration: "Groundedness + epistemic humility. Spots uncertainty, updates beliefs, avoids magical thinking.",
    playfulness: "How much the answer signals joking/trolling/roleplay for fun. High does not mean bad, it flags interpretability."
  }
};

export function clamp01to100(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}
