import { ACTIONS, IDLE, MOVE, SHADOW_STYLES } from "./engine.js";
import { MODULE, resolveConfig } from "./settings.js";
import { manager } from "./animator.js";
import { openStudio } from "./studio.js";

const el = html => (html instanceof HTMLElement ? html : html?.[0] ?? null);

/** Token HUD: one button that opens a palette of actions plus the Studio. */
export function renderTokenHUD(hud, html) {
  const root = el(html);
  const token = hud.object;
  if (!root || !token?.document?.isOwner) return;
  const col = root.querySelector(".col.right") ?? root.querySelector(".right");
  if (!col) return;

  const cfg = resolveConfig(token.document);
  const canAct = game.user.isGM || game.settings.get(MODULE, "playerActions");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon ls-hud-button";
  btn.dataset.tooltip = "Living Sprites";
  btn.innerHTML = `<i class="fa-solid fa-person-running"></i>`;

  const palette = document.createElement("div");
  palette.className = "ls-hud-palette";
  const actionButtons = canAct
    ? Object.entries(ACTIONS).map(([id, d]) =>
      `<button type="button" data-ls-action="${id}" data-tooltip="${d.description}"><i class="${d.icon}"></i><span>${d.label}</span></button>`).join("")
    : "";
  palette.innerHTML = `
    <div class="ls-hud-title">Play</div>
    <div class="ls-hud-grid">${actionButtons}</div>
    <div class="ls-hud-footer">
      <button type="button" data-ls-toggle class="${cfg.enabled ? "active" : ""}">
        <i class="fa-solid ${cfg.enabled ? "fa-toggle-on" : "fa-toggle-off"}"></i> ${cfg.enabled ? "Animated" : "Not animated"}
      </button>
      <button type="button" data-ls-studio><i class="fa-solid fa-sliders"></i> Studio</button>
    </div>`;

  btn.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    palette.classList.toggle("open");
    btn.classList.toggle("active", palette.classList.contains("open"));
  });

  palette.addEventListener("click", async ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (b.dataset.lsAction) {
      const target = game.user.targets.first() ?? null;
      const tokens = canvas.tokens.controlled.length ? canvas.tokens.controlled : [token];
      for (const t of tokens) manager.play(t, b.dataset.lsAction, { target: t === target ? null : target });
    } else if (b.hasAttribute("data-ls-studio")) {
      openStudio(token);
      hud.close?.();
    } else if (b.hasAttribute("data-ls-toggle")) {
      const current = resolveConfig(token.document);
      const next = foundry.utils.mergeObject(current, { enabled: !current.enabled }, { inplace: false });
      await token.document.update({ [`flags.${MODULE}.config`]: next });
      hud.render?.();
    }
  });

  const wrap = document.createElement("div");
  wrap.className = "ls-hud-wrap";
  wrap.append(btn, palette);
  col.append(wrap);
}

/** Token Config: a fieldset on the Appearance tab with a button into the Studio. */
export function renderTokenConfig(app, html) {
  const root = el(html) ?? app.element;
  const doc = app.document ?? app.token;
  if (!root || doc?.documentName !== "Token" || !doc.id || !doc.parent) return;
  if (root.querySelector(".ls-config-fieldset")) return;
  const tab = root.querySelector('.tab[data-tab="appearance"]');
  if (!tab) return;

  const cfg = resolveConfig(doc);
  const fs = document.createElement("fieldset");
  fs.className = "ls-config-fieldset";
  fs.innerHTML = `
    <legend>Living Sprites</legend>
    <p class="hint">${cfg.enabled
      ? `Animated: <strong>${IDLE[cfg.idle.preset]?.label ?? "Still"}</strong> idle, <strong>${MOVE[cfg.move.preset]?.label ?? "None"}</strong> movement, <strong>${SHADOW_STYLES[cfg.shadow.style]?.label ?? "No"}</strong> shadow.`
      : "This token is not animated yet."}</p>
    <button type="button" class="ls-open-studio"><i class="fa-solid fa-person-running"></i> Open Animation Studio</button>`;
  fs.querySelector("button").addEventListener("click", ev => {
    ev.preventDefault();
    openStudio(doc);
  });
  tab.append(fs);
}
