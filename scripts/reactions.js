import { ACTIONS } from "./engine.js";
import { MODULE } from "./settings.js";

/**
 * Automatic actions: game events that make a token play an action on its own. The GM picks an action for each
 * event (Automatic actions in the module settings); a token can pick its own in the Studio.
 *
 * Every client works events out from what it already sees (HP bars, combat updates, chat cards), so nothing
 * extra is sent over the network and everyone sees the same thing.
 */

export const EVENTS = [
  { id: "hurt", label: "Takes damage", hint: "Bar 1 (HP) goes down.", default: "hurt" },
  { id: "healed", label: "Is healed", hint: "Bar 1 (HP) goes up.", default: "heal" },
  { id: "crisis", label: "Falls into Crisis", hint: "Bar 1 drops to half or less of its maximum.", default: "none" },
  { id: "down", label: "Drops to 0 HP", hint: "Bar 1 reaches 0. (\"Fall over when defeated\" keeps it down while it has the Defeated status.)", default: "collapse" },
  { id: "revived", label: "Gets back up", hint: "Bar 1 goes from 0 back above it.", default: "jump" },
  { id: "combatStart", label: "A combat starts", hint: "Every combatant, when round 1 begins.", default: "none" },
  { id: "turnStart", label: "Its turn starts", hint: "The combatant whose turn it is.", default: "none" },
  { id: "combatEnd", label: "The combat ends", hint: "Every combatant still standing, when the combat is ended.", default: "victory" },
  { id: "attack", label: "Attacks", hint: "Project FU: an attack card from this token (dashes to its first target). Skipped while FU Animations is active, which animates attacks itself.", default: "attack" },
  { id: "spell", label: "Casts a spell", hint: "Project FU: a spell card from this token. Skipped while FU Animations is active.", default: "cast" },
  { id: "dodge", label: "Dodges", hint: "Project FU: an attack against it misses. Skipped while FU Animations is active.", default: "dodge" },
  { id: "status", label: "Gains a status", hint: "A status effect (dazed, poisoned, slow...) is added to it.", default: "none" }
];

/** Which events outrank others when several happen at once (a hit that drops it to 0 is a "down", not a "hurt") */
const RANK = { down: 5, revived: 4, crisis: 3, hurt: 2, healed: 1 };

export const DEFAULT_REACTIONS = Object.freeze(Object.fromEntries(EVENTS.map(e => [e.id, e.default])));

export function worldReactions() {
  let saved = {};
  try {
    saved = game.settings.get(MODULE, "reactions") ?? {};
  } catch {
    saved = {};
  }
  const out = { ...DEFAULT_REACTIONS, ...saved };
  // the older "Flinch when hurt" switch still turns the hurt flinch off
  try {
    if (game.settings.get(MODULE, "autoHurt") === false && !("hurt" in saved)) out.hurt = "none";
  } catch { /* not registered */ }
  return out;
}

/** The action a token plays for an event: its own choice from the Studio, else the world's */
export function actionFor(animator, event) {
  const own = animator?.cfg?.reactions?.[event];
  const id = own && own !== "default" ? own : worldReactions()[event];
  return id && id !== "none" && ACTIONS[id] ? id : null;
}

let managerRef = null;

/** Play the action for an event on a token, on this client only */
export function react(token, event, { target = null } = {}) {
  if (!token || !managerRef) return false;
  const a = managerRef.get(token) ?? managerRef.attach(token);
  if (!a || managerRef.settings.disableLocal) return false;
  const id = actionFor(a, event);
  if (!id) return false;
  // a token that is knocked out only reacts by getting up
  if (a.ko && event !== "revived") return false;
  a.playLocal(id, { target });
  return true;
}

/**
 * HP changes seen on a token's Bar 1: the events they mean, most important first.
 * @returns {string[]}
 */
export function hpEvents(before, after, max) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return [];
  const out = [];
  if (after <= 0 && before > 0) out.push("down");
  if (before <= 0 && after > 0) out.push("revived");
  if (Number.isFinite(max) && max > 0 && after > 0 && after <= max / 2 && before > max / 2) out.push("crisis");
  if (after < before) out.push("hurt");
  if (after > before) out.push("healed");
  return out.sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0));
}

/** Play the first of several events that has an action, so one change never plays two animations */
export function reactFirst(token, events) {
  for (const e of events) if (react(token, e)) return e;
  return null;
}

/* -------------------------------------------- */
/*  Combat and chat                             */
/* -------------------------------------------- */

const tokensOfCombat = combat => (combat?.combatants?.contents ?? [...(combat?.combatants ?? [])])
  .map(c => c.token?.object ?? canvas.tokens?.get(c.tokenId))
  .filter(t => t && t.scene?.id === canvas.scene?.id);

const standing = token => {
  const bar = token.document?.getBarAttribute?.("bar1");
  const v = Number(bar?.value);
  return !Number.isFinite(v) || v > 0;
};

/** A little stagger so a crowd doesn't move as one */
const stagger = (list, fn) => list.forEach((t, i) => setTimeout(() => fn(t), i * 90 + Math.random() * 120));

const started = new Set();

function onUpdateCombat(combat, changes) {
  if (!canvas.ready || combat.scene?.id && combat.scene.id !== canvas.scene?.id) return;
  if ("round" in changes && changes.round === 1 && !started.has(combat.id)) {
    started.add(combat.id);
    stagger(tokensOfCombat(combat).filter(standing), t => react(t, "combatStart"));
  }
  if ("turn" in changes || "round" in changes) {
    const t = combat.combatant?.token?.object;
    if (t && standing(t)) setTimeout(() => react(t, "turnStart"), 250);
  }
}

function onDeleteCombat(combat) {
  started.delete(combat.id);
  if (!canvas.ready || !combat.started) return;
  stagger(tokensOfCombat(combat).filter(standing), t => react(t, "combatEnd"));
}

/** The token a chat card speaks for */
function speakerToken(msg) {
  const s = msg.speaker ?? {};
  if (s.scene && s.scene !== canvas.scene?.id) return null;
  return (s.token && canvas.tokens?.get(s.token)) || (s.actor && canvas.tokens?.placeables.find(t => t.actor?.id === s.actor)) || null;
}

function tokenOfUuid(uuid) {
  if (!uuid) return null;
  try {
    const doc = fromUuidSync(uuid);
    if (doc?.documentName === "Token") return doc.object ?? null;
    if (doc?.documentName === "Actor") return doc.getActiveTokens?.(true)?.[0] ?? null;
  } catch { /* not on this scene */ }
  return null;
}

function onChatMessage(msg) {
  if (!canvas.ready || game.system.id !== "projectfu") return;
  // FU Animations plays attacks, spells and dodges itself
  if (managerRef?.settings.fu) return;
  const check = msg.getFlag?.("projectfu", "Check");
  if (!check) return;
  const src = speakerToken(msg);
  const targets = (check.additionalData?.targets ?? []).map(t => ({ token: tokenOfUuid(t.token ?? t.uuid), result: t.result })).filter(t => t.token);
  const type = check.type;
  if (src) {
    if (type === "accuracy") react(src, "attack", { target: targets[0]?.token ?? null });
    else if (type === "magic") react(src, "spell");
  }
  // targets that dodged, a moment later as the blow arrives
  for (const t of targets) if (t.result === "miss") setTimeout(() => react(t.token, "dodge"), 450);
}

function onStatus(effect) {
  if (!canvas.ready || !effect?.statuses?.size) return;
  const defeated = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
  if (effect.statuses.has(defeated)) return;
  const actor = effect.parent?.documentName === "Actor" ? effect.parent : effect.parent?.parent;
  for (const t of actor?.getActiveTokens?.(true) ?? []) react(t, "status");
}

export function registerReactions(manager) {
  managerRef = manager;
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("createChatMessage", onChatMessage);
  Hooks.on("createActiveEffect", onStatus);
}

/* -------------------------------------------- */
/*  The GM's table of events                    */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export class ReactionsConfig extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "living-sprites-reactions",
    classes: ["living-sprites", "ls-reactions-app"],
    tag: "form",
    window: { title: "Automatic actions", icon: "fa-solid fa-bolt" },
    position: { width: 520, height: "auto" },
    form: { handler: ReactionsConfig.#onSubmit, closeOnSubmit: true }
  };

  async _renderHTML() {
    const cur = worldReactions();
    const options = sel => [["none", "Nothing"], ...Object.entries(ACTIONS).map(([id, a]) => [id, a.label])]
      .map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
    const div = document.createElement("div");
    div.className = "ls-reactions";
    div.innerHTML = `
      <p class="ls-note">When something happens to an animated token, it plays an action on its own. Each token can pick differently in its Studio (More options).</p>
      <div class="ls-rx-list">${EVENTS.map(e => `
        <label class="ls-rx"><span><b>${esc(e.label)}</b><small>${esc(e.hint)}</small></span>
          <select name="${e.id}">${options(cur[e.id])}</select></label>`).join("")}</div>
      <footer class="ls-footer"><button type="button" data-reset><i class="fa-solid fa-rotate-left"></i> Defaults</button><span class="ls-spacer"></span><button type="submit" class="ls-primary"><i class="fa-solid fa-check"></i> Save</button></footer>`;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.querySelector("[data-reset]")?.addEventListener("click", () => {
      for (const s of content.querySelectorAll("select[name]")) s.value = DEFAULT_REACTIONS[s.name] ?? "none";
    });
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    await game.settings.set(MODULE, "reactions", Object.fromEntries(EVENTS.map(e => [e.id, data[e.id] ?? e.default])));
    ui.notifications.info("Automatic actions saved.");
  }
}
