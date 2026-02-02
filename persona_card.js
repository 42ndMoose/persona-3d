import { buildOverviewPrompt } from "./prompts.js";

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
  onRemovePersona,
  onCopyText
}){
  layerEl.innerHTML = "";

  // background click deselect (only if click passes through layer background)
  layerEl.addEventListener("pointerdown", (e) => {
    if(e.target === layerEl){
      onDeselect();
    }
  }, { once:true });

  for(const p of personas){
    const el = document.createElement("div");
    el.className = "pfloat" + (p.id === selectedId ? " selected" : "") + (p.ui?.expanded ? " expanded" : "");
    el.dataset.pid = p.id;

    const pos = session.ui?.persona_positions?.[p.id] || { x: 24, y: 180 };
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    const name = (p.name || "Unnamed").trim();
    const agg = getAggForPersona(p.id);
    const points = getPointsForPersona(p.id);

    el.innerHTML = `
      <div class="pbar" data-drag="1">
        <div class="pavatar" title="Click to change avatar">
          <img alt="" src="${escapeAttr(p.avatar?.src || fallbackAvatar())}" />
          <input class="pfile" type="file" accept="image/gif,image/png,image/webp" style="display:none" />
        </div>

        <div class="pnamewrap">
          <div class="pnameDisplay" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
          <div class="pnameEdit">
            <input type="text" value="${escapeAttr(name)}" />
          </div>
        </div>

        <div class="pchip">${points.total}</div>
      </div>

      <div class="pmini">
        <div class="pminiMap">
          ${miniMapSvg(agg)}
        </div>
        <div class="pminiMeta">
          <div><b>${escapeHtml(agg.quadrant.label)}</b></div>
          <div style="margin-top:6px; color:${escapeAttr("rgba(138,160,184,1)")}">
            x=${agg.quadrant.x} • y=${agg.quadrant.y}
          </div>
        </div>
      </div>

      <div class="pexpand">
        <div class="pcloseRow">
          <div class="pchip">Points: ${points.total} (cap 100)</div>
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
          <button class="btn btn-ghost" data-action="removePersona">Remove</button>
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

    layerEl.appendChild(el);

    // pointer events
    wirePersonaCard(el, p);
  }

  function wirePersonaCard(cardEl, persona){
    // select on click (but not when dragging)
    let dragging = false;

    // drag behavior
    const bar = cardEl.querySelector(".pbar");
    let drag = { on:false, ox:0, oy:0, startX:0, startY:0 };

    bar.addEventListener("pointerdown", (e) => {
      if(e.button !== 0) return;
      dragging = false;
      drag.on = true;
      drag.ox = e.clientX;
      drag.oy = e.clientY;
      drag.startX = parseFloat(cardEl.style.left || "0");
      drag.startY = parseFloat(cardEl.style.top || "0");
      bar.setPointerCapture(e.pointerId);
    });

    bar.addEventListener("pointermove", (e) => {
      if(!drag.on) return;
      const dx = e.clientX - drag.ox;
      const dy = e.clientY - drag.oy;

      if(Math.abs(dx) + Math.abs(dy) > 4) dragging = true;

      const nx = drag.startX + dx;
      const ny = drag.startY + dy;
      cardEl.style.left = `${nx}px`;
      cardEl.style.top = `${ny}px`;

      session.ui.persona_positions[persona.id] = { x: nx, y: ny };
      onUpdatePersona(session, persona, { ui: persona.ui || {} }, true);
    });

    bar.addEventListener("pointerup", (e) => {
      drag.on = false;
      try{ bar.releasePointerCapture(e.pointerId); }catch{}
      if(!dragging){
        onSelect(persona.id);
      }
    });

    // expand on double click (bar)
    bar.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const next = !(persona.ui?.expanded);
      onUpdatePersona(session, persona, { ui: { ...(persona.ui || {}), expanded: next } });
    });

    // collapse button
    const collapseBtn = cardEl.querySelector('[data-action="collapse"]');
    if(collapseBtn){
      collapseBtn.addEventListener("click", () => {
        onUpdatePersona(session, persona, { ui: { ...(persona.ui || {}), expanded: false } });
      });
    }

    // name editing
    const display = cardEl.querySelector(".pnameDisplay");
    const editWrap = cardEl.querySelector(".pnameEdit");
    const input = editWrap.querySelector("input");

    display.addEventListener("click", (e) => {
      e.stopPropagation();
      editWrap.style.display = "block";
      display.style.display = "none";
      input.focus();
      input.select();
    });

    input.addEventListener("keydown", (e) => {
      if(e.key === "Enter"){
        input.blur();
      }
      if(e.key === "Escape"){
        input.value = persona.name || "Unnamed";
        input.blur();
      }
    });

    input.addEventListener("blur", () => {
      const v = (input.value || "").trim() || "Unnamed";
      onUpdatePersona(session, persona, { name: v });
    });

    // avatar click upload
    const avatarWrap = cardEl.querySelector(".pavatar");
    const fileInput = cardEl.querySelector(".pfile");

    avatarWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if(!f) return;
      if(f.size > 3_500_000){
        // keep localStorage from exploding
        alert("That file is too big. Keep it under ~3.5MB.");
        fileInput.value = "";
        return;
      }
      const dataUrl = await readAsDataURL(f);
      onUpdatePersona(session, persona, { avatar: { kind:"upload", src:dataUrl } });
      fileInput.value = "";
    });

    // overview section
    const overviewIn = cardEl.querySelector(".overviewIn");
    const overviewMsg = cardEl.querySelector(".overviewMsg");
    const overviewRender = cardEl.querySelector(".overviewRender");

    if(persona.overview){
      overviewIn.value = JSON.stringify(persona.overview, null, 2);
      renderOverview(persona.overview, overviewRender);
    }

    const btnCopy = cardEl.querySelector('[data-action="copyOverviewPrompt"]');
    btnCopy.addEventListener("click", () => {
      const answers = getAnswersForPersona(persona.id);
      const prompt = buildOverviewPrompt(answers);
      onCopyText(prompt);
      setMsg(overviewMsg, "Copied prompt.", true);
    });

    const btnSave = cardEl.querySelector('[data-action="saveOverview"]');
    btnSave.addEventListener("click", () => {
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
      onUpdatePersona(session, persona, { overview: obj });
      renderOverview(obj, overviewRender);
      setMsg(overviewMsg, "Saved overview.", true);
    });

    const btnClear = cardEl.querySelector('[data-action="clearOverview"]');
    btnClear.addEventListener("click", () => {
      onUpdatePersona(session, persona, { overview: null });
      overviewIn.value = "";
      overviewRender.innerHTML = "";
      setMsg(overviewMsg, "Cleared overview.", true);
    });

    const btnRemove = cardEl.querySelector('[data-action="removePersona"]');
    btnRemove.addEventListener("click", () => {
      const ok = confirm("Remove this persona card and its linked answers?");
      if(!ok) return;
      onRemovePersona(persona.id);
    });
  }
}

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
  // Make “centered” feel rewarding, not like “mid”
  const band = (v >= 45 && v <= 55) ? "Balanced and flexible." :
               (v >= 35 && v <= 65) ? "Well-rounded range." :
               (v < 35) ? "Lower pull here, other traits may dominate." :
               "Strong pull here, this trait often drives choices.";

  if(label === "Frivolity"){
    if(v <= 15) return "Mostly serious answers. Good signal quality.";
    if(v <= 35) return "Some joking or performative tone, still usable.";
    return "High unserious energy. Interpret with caution.";
  }
  if(label === "Calibration"){
    if(v >= 65) return "Grounded and reality-checked under uncertainty.";
    if(v >= 45) return "Generally grounded, occasional leaps or blind spots.";
    return "More risk of confident leaps, needs more constraint-based answers.";
  }
  return band;
}

function miniMapSvg(agg){
  const x = clampSigned(agg.quadrant.x, -100, 100);
  const y = clampSigned(agg.quadrant.y, -100, 100);

  // map [-100,100] => [12,108]
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

    <circle cx="${px}" cy="${py}" r="4.2" fill="rgba(103,209,255,0.95)" />
    <circle cx="${px}" cy="${py}" r="9" fill="rgba(103,209,255,0.12)" />
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

    <div style="margin-top:10px"><b>Model's confidence note</b><div style="margin-top:6px">${escapeHtml(obj.model_confidence_note || "")}</div></div>
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
