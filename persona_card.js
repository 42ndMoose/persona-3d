import { buildOverviewPrompt } from "./prompts.js";

const PRESET_URL = "./assets/presets.json";
let PRESETS_CACHE = null;

async function loadPresets(){
  if(PRESETS_CACHE) return PRESETS_CACHE;

  try{
    const r = await fetch(PRESET_URL, { cache: "no-store" });
    if(!r.ok) throw new Error("bad fetch");
    const j = await r.json();

    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.presets) ? j.presets : null);
    if(!arr) throw new Error("bad json shape");

    PRESETS_CACHE = arr
      .filter(p => p && typeof p.src === "string")
      .map(p => ({
        label: p.label ?? p.name ?? "preset",
        src: p.src,
        x: Number(p.x ?? 0),
        y: Number(p.y ?? 0),
        calibration: Number(p.calibration ?? 50),
        frivolity: Number(p.frivolity ?? p.playfulness ?? 0)
      }));

    return PRESETS_CACHE;
  }catch{
    PRESETS_CACHE = [];
    return PRESETS_CACHE;
  }
}

export function mountPersonaCards({
  layerEl,
  session,
  personas,
  selectedId,
  getAggForPersona,
  getPointsForPersona,
  getAnswersForPersona,
  onSelect,
  onDeselect,
  onUpdatePersona,
  onUpdatePersonaPosition,
  onRemovePersona,
  onCopyText
}){
  layerEl.innerHTML = "";

  for(const p of personas){
    const cardEl = document.createElement("div");
    const isSelected = (p.id === selectedId);

    const agg = getAggForPersona(p.id);
    const points = getPointsForPersona(p.id);

    const canExpand = (points.now >= 100);
    const expandTitle = canExpand ? "Expand" : "Locked until Fine-tune reaches 100";

    cardEl.className = "pfloat" + (isSelected ? " selected" : "") + (p.ui?.expanded ? " expanded" : "");
    cardEl.dataset.pid = p.id;

    const pos = session.ui?.persona_positions?.[p.id] || { x: 24, y: 160 };
    cardEl.style.left = `${pos.x}px`;
    cardEl.style.top = `${pos.y}px`;

    const name = (p.name || "Unnamed").trim();

    cardEl.innerHTML = `
      <div class="pbar" data-bar="1">
        <div class="pdrag" data-drag="1">
          <div class="pavatar" title="Change avatar">
            <img alt="" src="${escapeAttr(p.avatar?.src || fallbackAvatar())}" />
            <input class="pfile" type="file" accept="image/gif,image/png,image/webp" style="display:none" />
          </div>

          <div class="pnamewrap">
            <div class="pnameDisplay" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
            <div class="pnameEdit">
              <input type="text" value="${escapeAttr(name)}" />
            </div>
          </div>
        </div>

        <div class="pbarRight">
          <div class="pchip">Fine-tune: ${points.now}/100</div>
          <button class="picon" data-action="toggleExpand" ${canExpand ? "" : "disabled"} title="${escapeAttr(expandTitle)}">▾</button>
          <button class="picon" data-action="remove" title="Remove card">✕</button>
        </div>
      </div>

      <div class="pmini">
        <div class="pminiMap">
          ${miniMapSvg(agg, p.color || "#67d1ff")}
        </div>
        <div class="pminiMeta">
          <div><b>${escapeHtml(agg.quadrant.label)}</b></div>
          <div style="margin-top:6px; color:rgba(138,160,184,1)">
            x=${agg.quadrant.x} • y=${agg.quadrant.y}
          </div>
          <div style="margin-top:6px; color:rgba(138,160,184,1)">
            Total earned: ${points.total}
          </div>
        </div>
      </div>

      <div class="pexpand">
        <div class="pcloseRow">
          <div class="pchip">Fine-tune: ${points.now}/100 • Total: ${points.total}</div>
          <div class="row" style="margin:0">
            <button class="btn btn-secondary" data-action="collapse">Collapse</button>
          </div>
        </div>

        <div class="traits">
          ${traitBlock("Practicality", agg.axes.practicality)}
          ${traitBlock("Empathy", agg.axes.empathy)}
          ${traitBlock("Knowledge", agg.axes.knowledge)}
          ${traitBlock("Wisdom", agg.axes.wisdom)}
          ${traitBlock("Calibration", agg.meta.calibration)}
          ${traitBlock("Frivolity", agg.meta.frivolity)}
        </div>

        <div class="divider"></div>

        <div class="row" style="margin-top:0">
          <button class="btn" data-action="copyOverviewPrompt">Copy overview prompt</button>
        </div>

        <div class="smallnote">Paste the overview JSON here after the model generates it.</div>
        <textarea class="overviewIn" spellcheck="false" placeholder='Paste overview JSON here (JSON only).'></textarea>

        <div class="row">
          <button class="btn btn-secondary" data-action="saveOverview">Save overview</button>
          <button class="btn btn-ghost" data-action="clearOverview">Clear overview</button>
        </div>

        <div class="msg overviewMsg"></div>
        <div class="smallnote overviewRender"></div>
      </div>
    `;

    layerEl.appendChild(cardEl);

    wirePersonaCard(cardEl, p.id, { isSelected, canExpand, agg, points });
  }

  function wirePersonaCard(cardEl, personaId, ctx){
    // Toggle select when clicking card background (not buttons/inputs)
    cardEl.addEventListener("click", (e) => {
      if(e.target.closest("button")) return;
      if(e.target.closest("input") || e.target.closest("textarea")) return;
      if(e.target.closest(".apop")) return;

      if(selectedId === personaId){
        if(onDeselect) onDeselect();
      }else{
        onSelect(personaId);
      }
    });

    // Drag from top bar, except real interactive elements
    const bar = cardEl.querySelector("[data-bar='1']");
    let drag = { on:false, ox:0, oy:0, startX:0, startY:0 };

    bar.addEventListener("pointerdown", (e) => {
      if(e.button !== 0) return;

      // Block drag when clicking interactive things
      if(e.target.closest("button")) return;
      if(e.target.closest("input") || e.target.closest("textarea")) return;

      drag.on = true;
      drag.ox = e.clientX;
      drag.oy = e.clientY;
      drag.startX = parseFloat(cardEl.style.left || "0");
      drag.startY = parseFloat(cardEl.style.top || "0");

      e.preventDefault();
      e.stopPropagation();

      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
    }, true);

    function onMove(e){
      if(!drag.on) return;

      const dx = e.clientX - drag.ox;
      const dy = e.clientY - drag.oy;

      const nx = drag.startX + dx;
      const ny = drag.startY + dy;

      cardEl.style.left = `${nx}px`;
      cardEl.style.top = `${ny}px`;

      if(onUpdatePersonaPosition){
        onUpdatePersonaPosition(personaId, { x: nx, y: ny });
      }

      e.preventDefault();
      e.stopPropagation();
    }

    function onUp(e){
      drag.on = false;
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);

      e.preventDefault();
      e.stopPropagation();
    }

    // expand toggle
    const btnExpand = cardEl.querySelector('[data-action="toggleExpand"]');
    btnExpand.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if(btnExpand.hasAttribute("disabled")) return;

      const expanded = !(getPersonaUi(personaId).expanded);
      onUpdatePersona(session, personaId, { ui: { ...getPersonaUi(personaId), expanded } });
    });

    const btnCollapse = cardEl.querySelector('[data-action="collapse"]');
    btnCollapse.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onUpdatePersona(session, personaId, { ui: { ...getPersonaUi(personaId), expanded: false } });
    });

    // remove
    const btnRemove = cardEl.querySelector('[data-action="remove"]');
    btnRemove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = confirm("Remove this persona card and its linked answers?");
      if(!ok) return;
      onRemovePersona(personaId);
    });

    // name editing
    const display = cardEl.querySelector(".pnameDisplay");
    const editWrap = cardEl.querySelector(".pnameEdit");
    const input = editWrap.querySelector("input");

    display.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      editWrap.style.display = "block";
      display.style.display = "none";
      input.focus();
      input.select();
    });

    input.addEventListener("keydown", (e) => {
      if(e.key === "Enter") input.blur();
      if(e.key === "Escape") input.blur();
    });

    input.addEventListener("blur", () => {
      const persona = session.personas.find(x => x.id === personaId);
      const oldName = (persona?.name || "Unnamed").trim();
      const v = (input.value || "").trim() || "Unnamed";

      editWrap.style.display = "none";
      display.style.display = "block";

      if(v === oldName){
        input.value = oldName;
        return;
      }

      const ok = confirm("Set as card name?");
      if(!ok){
        input.value = oldName;
        return;
      }

      onUpdatePersona(session, personaId, { name: v });
    });

    // avatar popup
    const avatarWrap = cardEl.querySelector(".pavatar");
    const fileInput = cardEl.querySelector(".pfile");

    avatarWrap.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await openAvatarPopup(cardEl, personaId, ctx.agg);
    });

    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if(!f) return;
      if(f.size > 3_500_000){
        alert("That file is too big. Keep it under ~3.5MB.");
        fileInput.value = "";
        return;
      }
      const dataUrl = await readAsDataURL(f);
      onUpdatePersona(session, personaId, { avatar: { kind:"upload", src:dataUrl } });
      fileInput.value = "";
    });

    async function openAvatarPopup(cardEl, personaId, agg){
      closeAnyPopup();

      const pop = document.createElement("div");
      pop.className = "apop";
      pop.innerHTML = `
        <div class="apopTitle">Avatar</div>
        <div class="apopNote">
          Upload (gif/png/webp) or choose a preset stored in the repo.
          Presets are listed in <code>assets/presets.json</code>.
        </div>

        <div class="apopRow">
          <button class="btn btn-secondary" data-action="upload">Upload</button>
          <button class="btn btn-secondary" data-action="auto">Auto pick nearest</button>
          <button class="btn btn-ghost" data-action="close">Close</button>
        </div>

        <div class="apopGrid" data-grid="1"></div>
      `;

      const rect = cardEl.getBoundingClientRect();
      const host = cardEl.parentElement;
      const hostRect = host.getBoundingClientRect();

      pop.style.left = `${Math.min(hostRect.width - 360, rect.left - hostRect.left)}px`;
      pop.style.top = `${Math.min(hostRect.height - 240, rect.top - hostRect.top + 60)}px`;

      host.appendChild(pop);
      setActivePopup(pop);

      const presets = await loadPresets();
      const grid = pop.querySelector("[data-grid='1']");
      grid.innerHTML = "";

      const target = {
        x: agg.quadrant.x,
        y: agg.quadrant.y,
        calibration: agg.meta.calibration,
        frivolity: agg.meta.frivolity
      };

      const closest = closestPresets(presets, target, 12);
      for(const pr of closest){
        const div = document.createElement("div");
        div.className = "athumb";
        div.title = `${pr.label || "preset"} (x=${pr.x}, y=${pr.y})`;
        div.innerHTML = `<img alt="" src="${escapeAttr(pr.src)}" />`;
        div.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onUpdatePersona(session, personaId, { avatar: { kind:"preset", src: pr.src } });
          closeAnyPopup();
        });
        grid.appendChild(div);
      }

      pop.querySelector('[data-action="upload"]').addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
        closeAnyPopup();
      });

      pop.querySelector('[data-action="auto"]').addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pr = closestPresets(presets, target, 1)[0];
        if(pr){
          onUpdatePersona(session, personaId, { avatar: { kind:"preset", src: pr.src } });
        }
        closeAnyPopup();
      });

      pop.querySelector('[data-action="close"]').addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAnyPopup();
      });
    }

    // overview wiring
    const overviewIn = cardEl.querySelector(".overviewIn");
    const overviewMsg = cardEl.querySelector(".overviewMsg");
    const overviewRender = cardEl.querySelector(".overviewRender");

    const personaNow = session.personas.find(x => x.id === personaId);
    if(personaNow?.overview){
      overviewIn.value = JSON.stringify(personaNow.overview, null, 2);
      renderOverview(personaNow.overview, overviewRender);
    }

    const btnCopy = cardEl.querySelector('[data-action="copyOverviewPrompt"]');
    btnCopy.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const answers = getAnswersForPersona(personaId);
      const prompt = buildOverviewPrompt(answers);
      onCopyText(prompt);
      setMsg(overviewMsg, "Copied prompt.", true);
    });

    const btnSave = cardEl.querySelector('[data-action="saveOverview"]');
    btnSave.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const raw = (overviewIn.value || "").trim();
      if(!raw){
        setMsg(overviewMsg, "Paste overview JSON first.", false);
        return;
      }
      let obj;
      try{ obj = JSON.parse(raw); }catch{
        setMsg(overviewMsg, "Invalid JSON.", false);
        return;
      }
      if(obj.schema_version !== "persona_overview.v2"){
        setMsg(overviewMsg, "schema_version must be persona_overview.v2", false);
        return;
      }
      onUpdatePersona(session, personaId, { overview: obj });
      renderOverview(obj, overviewRender);
      setMsg(overviewMsg, "Saved overview.", true);
    });

    const btnClear = cardEl.querySelector('[data-action="clearOverview"]');
    btnClear.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onUpdatePersona(session, personaId, { overview: null });
      overviewIn.value = "";
      overviewRender.innerHTML = "";
      setMsg(overviewMsg, "Cleared overview.", true);
    });
  }

  function getPersonaUi(pid){
    const p = session.personas.find(x => x.id === pid);
    return (p && p.ui && typeof p.ui === "object") ? p.ui : { expanded:false };
  }
}

/* popup management */
let ACTIVE_POP = null;
function setActivePopup(pop){
  ACTIVE_POP = pop;
  setTimeout(() => {
    document.addEventListener("pointerdown", onDocDown, true);
  }, 0);
}
function closeAnyPopup(){
  if(ACTIVE_POP){
    try{ ACTIVE_POP.remove(); }catch{}
    ACTIVE_POP = null;
    document.removeEventListener("pointerdown", onDocDown, true);
  }
}
function onDocDown(e){
  if(!ACTIVE_POP) return;
  if(e.target.closest(".apop")) return;
  closeAnyPopup();
}

/* presets */
function closestPresets(presets, target, n){
  const x = Number(target.x ?? 0);
  const y = Number(target.y ?? 0);
  const c = Number(target.calibration ?? 50);
  const f = Number(target.frivolity ?? 0);

  const scored = presets.map(pr => {
    const dx = (Number(pr.x) - x);
    const dy = (Number(pr.y) - y);
    const dc = (Number(pr.calibration ?? 50) - c) * 0.35;
    const df = (Number(pr.frivolity ?? 0) - f) * 0.20;
    const d2 = dx*dx + dy*dy + dc*dc + df*df;
    return { ...pr, _d2: d2 };
  }).sort((a,b) => a._d2 - b._d2);

  return scored.slice(0, n);
}

/* render helpers */
function traitBlock(label, value){
  const v = clamp(value);
  const pct = v;
  const desc = descriptor(label, v);

  return `
    <div class="trait">
      <div class="traitTop">
        <div class="traitName">${escapeHtml(label)}</div>
        <div class="traitVal">${pct} / 100</div>
      </div>
      <div class="traitBar">
        <div class="traitFill" style="width:${pct}%"></div>
        <div class="traitMid"></div>
      </div>
      <div class="traitNote">${escapeHtml(desc)}</div>
    </div>
  `;
}

function descriptor(label, v){
  const band =
    (v >= 45 && v <= 55) ? "Balanced and flexible." :
    (v >= 35 && v <= 65) ? "Well-rounded range." :
    (v < 35) ? "Lower pull here, other traits may dominate." :
    "Strong pull here, this trait often drives choices.";

  if(label === "Frivolity"){
    if(v <= 15) return "Mostly serious answers. Good signal quality.";
    if(v <= 35) return "Some joking tone, still usable.";
    return "High unserious energy. Interpret with caution.";
  }
  if(label === "Calibration"){
    if(v >= 65) return "Grounded and reality-checked under uncertainty.";
    if(v >= 45) return "Generally grounded, occasional leaps.";
    return "More risk of confident leaps. Needs more constraint-based answers.";
  }
  return band;
}

function miniMapSvg(agg, dotColor){
  const x = clampSigned(agg.quadrant.x, -100, 100);
  const y = clampSigned(agg.quadrant.y, -100, 100);

  const px = 60 + (x / 100) * 46;
  const py = 60 - (y / 100) * 46;

  return `
  <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="8" width="104" height="104" rx="14" fill="rgba(0,0,0,0.10)" stroke="rgba(255,255,255,0.10)"/>
    <line x1="60" y1="12" x2="60" y2="108" stroke="rgba(255,255,255,0.18)" />
    <line x1="12" y1="60" x2="108" y2="60" stroke="rgba(255,255,255,0.18)" />

    <text x="60" y="18" font-size="9" text-anchor="middle" fill="rgba(207,226,255,0.90)">Wisdom</text>
    <text x="60" y="116" font-size="9" text-anchor="middle" fill="rgba(207,226,255,0.90)">Knowledge</text>
    <text x="16" y="62" font-size="9" text-anchor="start" fill="rgba(207,226,255,0.90)">Empathy</text>
    <text x="104" y="62" font-size="9" text-anchor="end" fill="rgba(207,226,255,0.90)">Practicality</text>

    <circle cx="${px}" cy="${py}" r="4.2" fill="${escapeAttr(dotColor)}" />
    <circle cx="${px}" cy="${py}" r="9" fill="${escapeAttr(hexToRgba(dotColor, 0.12))}" />
  </svg>`;
}

function renderOverview(obj, mount){
  const s = obj.summary || {};
  const tb = obj.trait_breakdown || {};
  const gaps = obj.data_gaps || {};

  mount.innerHTML = `
    <div><b>${escapeHtml(s.title || "Overview")}</b></div>
    <div style="margin-top:8px">${escapeHtml(s.one_paragraph || "")}</div>

    ${listBlock("Strengths", s.strengths)}
    ${listBlock("Weaknesses", s.weaknesses)}
    ${listBlock("Growth levers", s.growth_levers)}

    <div style="margin-top:10px"><b>Stress pattern</b><div style="margin-top:6px">${escapeHtml(s.stress_pattern || "")}</div></div>
    <div style="margin-top:10px"><b>Decision style</b><div style="margin-top:6px">${escapeHtml(s.decision_style || "")}</div></div>
    <div style="margin-top:10px"><b>Social style</b><div style="margin-top:6px">${escapeHtml(s.social_style || "")}</div></div>

    <div class="divider"></div>

    <div><b>Trait breakdown</b></div>
    <div style="margin-top:8px; color: rgba(138,160,184,1); line-height:1.35">
      <div><b>Practicality:</b> ${escapeHtml(tb.practicality || "")}</div>
      <div><b>Empathy:</b> ${escapeHtml(tb.empathy || "")}</div>
      <div><b>Knowledge:</b> ${escapeHtml(tb.knowledge || "")}</div>
      <div><b>Wisdom:</b> ${escapeHtml(tb.wisdom || "")}</div>
      <div><b>Calibration:</b> ${escapeHtml(tb.calibration || "")}</div>
      <div><b>Frivolity:</b> ${escapeHtml(tb.frivolity || "")}</div>
    </div>

    <div class="divider"></div>

    ${listBlock("Warnings", obj.warnings)}

    <div style="margin-top:10px"><b>Data gaps</b></div>
    ${listBlock("Missing aspects", gaps.missing_aspects)}
    <div style="margin-top:8px"><b>Best next question tip</b><div style="margin-top:6px">${escapeHtml(gaps.best_next_question_tip || "")}</div></div>

    <div class="divider"></div>

    <div style="margin-top:10px"><b>Model confidence note</b><div style="margin-top:6px">${escapeHtml(obj.model_confidence_note || "")}</div></div>
  `;
}

function listBlock(title, arr){
  const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if(a.length === 0) return "";
  const items = a.map(x => `<li>${escapeHtml(String(x))}</li>`).join("");
  return `
    <div style="margin-top:10px"><b>${escapeHtml(title)}</b></div>
    <ul class="ul">${items}</ul>
  `;
}

function setMsg(el, text, ok){
  el.className = ok ? "msg ok overviewMsg" : "msg bad overviewMsg";
  el.textContent = text;
}

function readAsDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read fail"));
    r.readAsDataURL(file);
  });
}

function clamp(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}
function clampSigned(n,a,b){
  const x = Number(n);
  if(!Number.isFinite(x)) return 0;
  return Math.max(a, Math.min(b, Math.round(x)));
}

function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function escapeAttr(s){
  return String(s).replaceAll("&","&amp;").replaceAll("\"","&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function fallbackAvatar(){
  return `data:image/svg+xml;utf8,${encodeURIComponent(fallbackAvatarSvg())}`;
}
function fallbackAvatarSvg(){
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <defs>
      <radialGradient id="g" cx="30%" cy="20%" r="80%">
        <stop offset="0%" stop-color="#67d1ff"/>
        <stop offset="55%" stop-color="#1b3b55"/>
        <stop offset="100%" stop-color="#0b0f14"/>
      </radialGradient>
    </defs>
    <rect width="200" height="200" fill="url(#g)"/>
  </svg>`;
}

function hexToRgba(hex, a){
  const h = String(hex || "#67d1ff").replace("#","");
  const n = parseInt(h.length === 3 ? h.split("").map(c=>c+c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
