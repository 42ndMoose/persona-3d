const KEY = "persona3d.session.v3";

export function loadSession(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) return makeEmpty();
    const obj = JSON.parse(raw);
    return normalize(obj);
  }catch{
    return makeEmpty();
  }
}

export function saveSession(session){
  localStorage.setItem(KEY, JSON.stringify(normalize(session)));
}

export function clearSession(){
  localStorage.removeItem(KEY);
}

export function normalize(session){
  const s = (session && typeof session === "object") ? session : makeEmpty();
  if(!s.created_at) s.created_at = new Date().toISOString();

  if(!Array.isArray(s.answers)) s.answers = [];
  if(!Array.isArray(s.personas)) s.personas = [];
  if(!s.ui || typeof s.ui !== "object") s.ui = {};
  if(!s.ui.persona_positions || typeof s.ui.persona_positions !== "object") s.ui.persona_positions = {};

  if(typeof s.selected_persona_id !== "string") s.selected_persona_id = null;
  if(typeof s.last_qid !== "string") s.last_qid = null;

  return s;
}

function makeEmpty(){
  return {
    created_at: new Date().toISOString(),
    answers: [],
    personas: [],
    selected_persona_id: null,
    last_qid: null,
    ui: { persona_positions: {} }
  };
}
