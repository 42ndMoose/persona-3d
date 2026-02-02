const KEY = "persona3d.session.v1";

export function loadSession(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) return makeEmpty();
    const obj = JSON.parse(raw);
    if(!obj || typeof obj !== "object") return makeEmpty();
    if(!Array.isArray(obj.answers)) obj.answers = [];
    if(!obj.created_at) obj.created_at = new Date().toISOString();
    return obj;
  }catch{
    return makeEmpty();
  }
}

export function saveSession(session){
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(){
  localStorage.removeItem(KEY);
}

function makeEmpty(){
  return {
    created_at: new Date().toISOString(),
    answers: [],
    last_qid: null
  };
}
