export async function loadPresets(){
  try{
    const res = await fetch("./assets/presets.json", { cache: "no-store" });
    if(!res.ok) return [];
    const data = await res.json();
    if(!Array.isArray(data)) return [];
    return data.filter(x => x && typeof x === "object");
  }catch{
    return [];
  }
}

export function pickNearestPreset(presets, target){
  if(!presets || presets.length === 0) return null;

  let best = null;
  let bestD = Infinity;

  for(const p of presets){
    const px = num(p.x, 0);
    const py = num(p.y, 0);
    const pc = num(p.calibration ?? 50, 50);
    const pp = num(p.playfulness ?? 0, 0);

    // Weights: quadrant plane most important, then calibration, then playfulness
    const dx = px - target.x;
    const dy = py - target.y;
    const dc = (pc - target.calibration) * 0.35;
    const dp = (pp - target.playfulness) * 0.20;

    const d = dx*dx + dy*dy + dc*dc + dp*dp;

    if(d < bestD){
      bestD = d;
      best = p;
    }
  }
  return best;
}

function num(v, fallback){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
