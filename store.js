const KEY = "persona3d.session.v2";

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

  // answers
  if(!Array.isArray(s.answers)) s.answers = [];
  // profiles: bucket -> { name }
  if(!s.profiles || typeof s.profiles !== "object") s.profiles = {};
  // overviews: bucket -> overviewJson
  if(!s.overviews || typeof s.overviews !== "object") s.overviews = {};

  if(!s.last_qid) s.last_qid = null;

  // migration: accept old key if someone imported it
  // (We don't auto-read old localStorage keys because that can create confusion.)
  return s;
}

function makeEmpty(){
  return {
    created_at: new Date().toISOString(),
    answers: [],
    profiles: {},
    overviews: {},
    last_qid: null
  };
}
