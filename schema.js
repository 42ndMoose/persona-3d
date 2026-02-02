export const SCHEMA_V1 = "persona.schema.v1";
export const SCHEMA_V2 = "persona.schema.v2";

export const SCHEMA_VERSION = SCHEMA_V2;

export const AXES = ["practicality","empathy","knowledge","wisdom"];
export const META = ["calibration","playfulness"];

export const SCHEMA_DESCRIPTION = {
  version: SCHEMA_VERSION,
  core_axes: AXES,
  meta_axes: META,
  ranges: "All axes 0..100 inclusive. Higher = more of that trait.",
  effort_points: "effort.points_awarded is an integer 0..50. Points represent answer richness and diagnostic value.",
  notes: {
    practicality: "Plans, executes, optimizes, handles tradeoffs, acts under constraints.",
    empathy: "Reads people, cares, protects dignity, avoids cruelty, understands feelings.",
    knowledge: "Breadth/depth of concepts, curiosity, retention, structured thinking.",
    wisdom: "Judgment, long-term thinking, ethics under pressure, sees second-order effects.",
    calibration: "Groundedness + epistemic humility. Spots uncertainty, updates beliefs, avoids magical thinking.",
    playfulness: "Signals joking/trolling/roleplay for fun. High flags interpretability."
  }
};

export function clamp01to100(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function clampInt(n, min, max){
  const x = Number(n);
  if(!Number.isFinite(x)) return null;
  const y = Math.round(x);
  return Math.max(min, Math.min(max, y));
}
