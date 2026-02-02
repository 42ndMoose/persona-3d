import { buildOverviewPrompt } from "./prompts.js";

export function renderPersonaCard({ mountEl, bucket, agg, points, session, presets, pickPreset, onSaveSession, onCopyText }) {
  mountEl.innerHTML = "";

  const unlocked = points.total >= 100;

  const wrap = document.createElement("div");
  wrap.className = "card persona";

  wrap.innerHTML = `
    <div class="card-h">
      <div class="card-title">Persona card</div>
      <div class="pill">${unlocked ? "Unlocked" : "Locked"} • ${points.total} pts</div>
    </div>

    ${unlocked ? `
      <div class="pcard">
        <div class="pavatar"><img id="pAvatarImg" alt=""/></div>
        <div class="pmain">
          <div class="pname">
            <input id="pName" type="text" placeholder="Set a name (saved locally)" />
            <div class="pbadge">Bucket: ${escapeHtml(bucket)}</div>
          </div>
          <div class="smallnote">
            Quadrant: <b>${escapeHtml(agg.quadrant.label)}</b> (x=${agg.quadrant.x}, y=${agg.quadrant.y})
            <br/>Axes: P${agg.axes.practicality} E${agg.axes.empathy} K${agg.axes.knowledge} W${agg.axes.wisdom}
            <br/>Meta: cal ${agg.meta.calibration} • play ${agg.meta.playfulness}
          </div>
        </div>
      </div>

      <div class="psection">
        <div class="row">
          <button id="btnCopyOverviewPrompt" class="btn">Copy overview prompt</button>
        </div>
        <div class="smallnote">
          Paste the prompt into the same model you used for this bucket (or any model you want, but then label the bucket accordingly).
          Then paste the overview JSON below.
        </div>

        <textarea id="overviewIn" spellcheck="false" placeholder='Paste persona overview JSON here (JSON only).'></textarea>
        <div class="row">
          <button id="btnSaveOverview" class="btn btn-secondary">Save overview</button>
          <button id="btnClearOverview" class="btn btn-ghost">Clear overview</button>
        </div>
        <div id="overviewMsg" class="msg"></div>

        <div id="overviewRender" class="smallnote"></div>

        <div class="qrwrap">
          <div>
            <div class="card-title" style="margin-bottom:6px">Share QR (summary only)</div>
            <div class="smallnote">This QR encodes a short summary. Full history can get too large for QR.</div>
            <div class="row">
              <button id="btnMakeQR" class="btn btn-secondary">Generate QR</button>
            </div>
          </div>
          <canvas id="qrCanvas" width="110" height="110"></canvas>
        </div>
      </div>
    ` : `
      <div class="smallnote">
        Unlocks when this bucket reaches 100 points. Effort points come from the model’s scoring per answer.
      </div>
    `}
  `;

  mountEl.appendChild(wrap);

  if(!unlocked) return;

  // set name
  const nameInput = wrap.querySelector("#pName");
  const prof = session.profiles?.[bucket] || {};
  nameInput.value = prof.name || "";

  nameInput.addEventListener("input", () => {
    session.profiles[bucket] = { ...(session.profiles[bucket] || {}), name: nameInput.value.trim() };
    onSaveSession(session);
  });

  // avatar preset
  const preset = pickPreset(presets, {
    x: agg.quadrant.x,
    y: agg.quadrant.y,
    calibration: agg.meta.calibration,
    playfulness: agg.meta.playfulness
  });

  const img = wrap.querySelector("#pAvatarImg");
  if(preset && preset.src){
    img.src = preset.src;
  }else{
    // fallback: use a tiny embedded gradient via SVG data uri
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(fallbackAvatarSvg())}`;
  }

  // overview prompt
  wrap.querySelector("#btnCopyOverviewPrompt").addEventListener("click", () => {
    const judgedAnswers = (session.answers || []).filter(a => (a.bucket || "general") === bucket);
    const prompt = buildOverviewPrompt(bucket, judgedAnswers);
    onCopyText(prompt);
  });

  // overview save/clear
  const overviewIn = wrap.querySelector("#overviewIn");
  const overviewMsg = wrap.querySelector("#overviewMsg");
  const overviewRender = wrap.querySelector("#overviewRender");

  const existing = session.overviews?.[bucket];
  if(existing){
    overviewIn.value = JSON.stringify(existing, null, 2);
    renderOverview(existing);
  }

  wrap.querySelector("#btnSaveOverview").addEventListener("click", () => {
    const raw = overviewIn.value.trim();
    if(!raw){
      setMsg(overviewMsg, "Paste overview JSON first.", false);
      return;
    }
    let obj;
    try{
      obj = JSON.parse(raw);
    }catch{
      setMsg(overviewMsg, "Invalid JSON.", false);
      return;
    }
    if(obj.schema_version !== "persona_overview.v1"){
      setMsg(overviewMsg, "schema_version must be persona_overview.v1", false);
      return;
    }
    if(obj.bucket_label !== bucket){
      setMsg(overviewMsg, `bucket_label must match current bucket: ${bucket}`, false);
      return;
    }

    session.overviews[bucket] = obj;
    onSaveSession(session);
    setMsg(overviewMsg, "Saved overview.", true);
    renderOverview(obj);
  });

  wrap.querySelector("#btnClearOverview").addEventListener("click", () => {
    delete session.overviews[bucket];
    onSaveSession(session);
    overviewIn.value = "";
    overviewRender.innerHTML = "";
    setMsg(overviewMsg, "Cleared overview.", true);
  });

  // QR summary
  wrap.querySelector("#btnMakeQR").addEventListener("click", async () => {
    const name = (session.profiles?.[bucket]?.name || "").trim();
    const payload = {
      schema: "persona_qr_summary.v1",
      bucket,
      name,
      quadrant: agg.quadrant,
      axes: agg.axes,
      meta: agg.meta,
      points: points.total,
      created_at: new Date().toISOString()
    };
    const text = JSON.stringify(payload);
    const canvas = wrap.querySelector("#qrCanvas");

    try{
      // QRCode is loaded globally from CDN in index.html
      await window.QRCode.toCanvas(canvas, text, { errorCorrectionLevel: "M", margin: 1, width: 110 });
      setMsg(overviewMsg, "QR generated (summary only).", true);
    }catch{
      setMsg(overviewMsg, "QR failed. Payload may be too large.", false);
    }
  });

  function renderOverview(obj){
    const s = obj.summary || {};
    const tb = obj.trait_breakdown || {};

    overviewRender.innerHTML = `
      <div><b>${escapeHtml(s.title || "Overview")}</b></div>
      <div style="margin-top:6px">${escapeHtml(s.one_paragraph || "")}</div>
      <div style="margin-top:10px">
        <b>Strengths:</b> ${(s.strengths || []).map(x => escapeHtml(x)).join(" • ")}
      </div>
      <div style="margin-top:6px">
        <b>Growth:</b> ${(s.growth_levers || []).map(x => escapeHtml(x)).join(" • ")}
      </div>
      <div style="margin-top:10px">
        <b>Trait breakdown:</b><br/>
        P: ${escapeHtml(tb.practicality || "")}<br/>
        E: ${escapeHtml(tb.empathy || "")}<br/>
        K: ${escapeHtml(tb.knowledge || "")}<br/>
        W: ${escapeHtml(tb.wisdom || "")}<br/>
        Cal: ${escapeHtml(tb.calibration || "")}<br/>
        Play: ${escapeHtml(tb.playfulness || "")}
      </div>
      <div style="margin-top:10px"><b>Confidence note:</b> ${escapeHtml(obj.confidence_note || "")}</div>
    `;
  }
}

function setMsg(el, text, ok){
  el.className = ok ? "msg ok" : "msg bad";
  el.textContent = text;
}

function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
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
