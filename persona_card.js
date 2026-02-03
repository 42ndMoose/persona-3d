function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export class PersonaCard {
  constructor({
    parentEl,
    persona,
    onSelect,
    onDelete,
    onRename,
    onToggleExpand,
    bringToFront
  }) {
    this.parentEl = parentEl;
    this.persona = persona;
    this.onSelect = onSelect;
    this.onDelete = onDelete;
    this.onRename = onRename;
    this.onToggleExpand = onToggleExpand;
    this.bringToFront = bringToFront;

    this.expanded = false;

    this.el = document.createElement("div");
    this.el.className = "persona-card";
    this.el.style.left = `${persona.ui.x}px`;
    this.el.style.top = `${persona.ui.y}px`;
    this.el.style.zIndex = `${persona.ui.z}`;

    this.el.addEventListener("pointerdown", (e) => {
      // select on any click
      if (typeof this.onSelect === "function") this.onSelect(this.persona.id);
      if (typeof this.bringToFront === "function") this.bringToFront(this.persona.id);
      e.stopPropagation();
    });

    this.render();
    parentEl.appendChild(this.el);

    this.installDrag();
  }

  installDrag() {
    const header = this.el.querySelector(".pc-header");
    if (!header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let pid = null;

    header.addEventListener("pointerdown", (e) => {
      // do not start drag when clicking buttons
      const btn = e.target.closest("button");
      if (btn) return;

      dragging = true;
      pid = e.pointerId;
      header.setPointerCapture(pid);

      startX = e.clientX;
      startY = e.clientY;
      baseX = this.persona.ui.x;
      baseY = this.persona.ui.y;

      e.preventDefault();
      e.stopPropagation();
    });

    header.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pid) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const nx = baseX + dx;
      const ny = baseY + dy;

      this.persona.ui.x = nx;
      this.persona.ui.y = ny;

      this.el.style.left = `${nx}px`;
      this.el.style.top = `${ny}px`;

      e.preventDefault();
      e.stopPropagation();
    });

    header.addEventListener("pointerup", (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      try { header.releasePointerCapture(pid); } catch {}
      pid = null;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  setSelected(isSelected) {
    this.el.style.outline = isSelected ? "2px solid rgba(85,167,255,0.55)" : "none";
  }

  setZ(z) {
    this.persona.ui.z = z;
    this.el.style.zIndex = `${z}`;
  }

  setExpanded(expanded) {
    this.expanded = expanded;
    this.render();
  }

  update(persona) {
    this.persona = persona;
    this.el.style.left = `${persona.ui.x}px`;
    this.el.style.top = `${persona.ui.y}px`;
    this.el.style.zIndex = `${persona.ui.z}`;
    this.render();
  }

  render() {
    const p = this.persona;

    const unlock = p.progress.total;
    const unlocked = unlock >= 100;

    const nameHtml = `
      <div class="pc-titleWrap">
        <img class="pc-avatar" src="${p.avatarSrc}" alt="" />
        <div class="pc-name" title="${p.name}">${p.name}</div>
      </div>
    `;

    const expandBtn = `
      <button class="pc-iconBtn" title="${unlocked ? "Expand" : "Locked until 100"}" ${unlocked ? "" : "disabled"} data-action="toggle">
        ▾
      </button>
    `;

    const closeBtn = `
      <button class="pc-iconBtn" title="Remove" data-action="delete">✕</button>
    `;

    const quad = this.renderMiniQuadrant(p);

    const bodyCollapsed = `
      <div class="pc-body">
        ${quad}
        <div class="pc-statRow">
          <div><b>Fine-tune:</b> ${p.progress.total}/100</div>
          <div style="color: rgba(255,255,255,0.50)">${p.modelLabel || "Unspecified model"}</div>
        </div>

        ${this.expanded ? this.renderExpanded(p) : ""}
      </div>
    `;

    this.el.innerHTML = `
      <div class="pc-header">
        ${nameHtml}
        ${expandBtn}
        ${closeBtn}
      </div>
      ${bodyCollapsed}
    `;

    // wire actions
    const toggle = this.el.querySelector('[data-action="toggle"]');
    if (toggle) {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof this.onToggleExpand === "function") this.onToggleExpand(p.id);
      });
    }

    const del = this.el.querySelector('[data-action="delete"]');
    if (del) {
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        const ok = confirm("Remove this persona card?");
        if (!ok) return;
        if (typeof this.onDelete === "function") this.onDelete(p.id);
      });
    }

    // name edit
    const nameEl = this.el.querySelector(".pc-name");
    if (nameEl) {
      nameEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startRename();
      });
    }
  }

  startRename() {
    const p = this.persona;
    const nameEl = this.el.querySelector(".pc-name");
    if (!nameEl) return;

    nameEl.classList.add("editing");
    const input = document.createElement("input");
    input.className = "input";
    input.value = p.name;
    input.style.padding = "8px";
    input.style.fontWeight = "800";
    input.style.fontSize = "14px";

    const wrap = nameEl.parentElement;
    wrap.replaceChild(input, nameEl);
    input.focus();
    input.select();

    const commit = () => {
      const next = input.value.trim() || "Unnamed";
      const ok = confirm(`Set as card name?\n\n${next}`);
      if (!ok) {
        this.render();
        return;
      }
      if (typeof this.onRename === "function") this.onRename(p.id, next);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") this.render();
    });

    input.addEventListener("blur", () => {
      // blur should not auto-commit without confirmation
      this.render();
    });
  }

  renderMiniQuadrant(p) {
    const size = 116;
    const edgePad = 10;

    // coords are in [-50..50] typical, but clamp anyway
    const x = clamp(p.coords.x, -50, 50);
    const y = clamp(p.coords.y, -50, 50);

    const nx = (x + 50) / 100;
    const ny = (y + 50) / 100;

    const px = edgePad + nx * (size - edgePad * 2);
    const py = edgePad + (1 - ny) * (size - edgePad * 2);

    const dotColor = `#${p.color.toString(16).padStart(6, "0")}`;

    return `
      <div class="pc-miniQuad" style="height:${size}px">
        <div class="label top">Practicality</div>
        <div class="label bottom">Empathy</div>
        <div class="label left">Knowledge</div>
        <div class="label right">Wisdom</div>
        <div class="dot" style="left:${px}px; top:${py}px; background:${dotColor};"></div>
      </div>
    `;
  }

  renderExpanded(p) {
    const primer = (p.overviewPrimer || "").trim();
    const overview = (p.overviewText || "").trim();

    const primerBlock = primer
      ? `<div class="pc-pre">${escapeHtml(primer)}</div>`
      : `<div class="pc-pre">No overview primer stored yet.</div>`;

    const overviewBlock = overview
      ? `<div class="pc-pre">${escapeHtml(overview)}</div>`
      : `<div class="pc-pre">No overview stored yet.</div>`;

    return `
      <div class="pc-expanded">
        <div class="pc-sectionTitle">Overview primer</div>
        ${primerBlock}
        <div style="height:10px"></div>
        <div class="pc-sectionTitle">Overview</div>
        ${overviewBlock}
      </div>
    `;
  }

  destroy() {
    this.el.remove();
  }
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
