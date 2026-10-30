import { AnimState, ACTIONS, IDLE, MOVE, SHADOW_STYLES, compose } from "./engine.js";
import { MODULE, mergeConfig, studioConfig, worldDefaults } from "./settings.js";
import { drawBlob, placeShadow } from "./shadows.js";
import { manager } from "./animator.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STAGE_W = 320;
const STAGE_H = 360;

/* -------------------------------------------- */
/*  Live preview                                */
/* -------------------------------------------- */

class Preview {
  constructor(cfg) {
    this.cfg = cfg;
    this.override = null;          // temporary cfg while hovering a card
    this.state = new AnimState(cfg, 7);
    this.walk = false;
    this.started = performance.now();
    this.last = this.started;
    this.prevX = null;
    this.lastMoveAt = -Infinity;
    this.app = new PIXI.Application({
      width: STAGE_W, height: STAGE_H, backgroundAlpha: 0, antialias: true,
      resolution: window.devicePixelRatio || 1, autoDensity: true
    });
    this.view = this.app.view;
    this.view.classList.add("ls-preview-canvas");

    this.ground = new PIXI.Graphics();
    this.ground.beginFill(0xffffff, 0.06).drawEllipse(STAGE_W / 2, STAGE_H - 70, 130, 26).endFill();
    this.app.stage.addChild(this.ground);
    this.shadowLayer = new PIXI.Container();
    this.app.stage.addChild(this.shadowLayer);
    this.sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this.sprite.anchor.set(0.5, 0.5);
    this.app.stage.addChild(this.sprite);
    this.shadow = null;
    this.app.ticker.add(this.tick, this);
  }

  async setImage(src) {
    let tex = null;
    try {
      const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
      tex = await load(src);
    } catch { tex = null; }
    if (!tex) {
      try { tex = PIXI.Texture.from(src); } catch { tex = PIXI.Texture.WHITE; }
    }
    if (this.app?.stage) this.sprite.texture = tex;
  }

  get activeCfg() {
    return this.override ?? this.cfg;
  }

  setShadowStyle(style) {
    if (this.shadow?._lsStyle === style) return;
    if (this.shadow) { this.shadow.destroy(); this.shadow = null; }
    if (style === "blob") {
      this.shadow = drawBlob(new PIXI.Graphics());
    } else if (style === "silhouette") {
      this.shadow = new PIXI.Sprite(this.sprite.texture);
      this.shadow.tint = 0x000000;
    }
    if (this.shadow) {
      this.shadow._lsStyle = style;
      this.shadowLayer.addChild(this.shadow);
    }
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const cfg = this.activeCfg;
    this.state.setConfig(cfg);

    const tex = this.sprite.texture;
    const tw = Math.max(1, tex.width), th = Math.max(1, tex.height);
    const fit = Math.min(200 / th, 200 / tw);
    const artDir = cfg.facing === "left" ? -1 : 1;

    // Walk demo: pace left and right across the stage
    const t = (now - this.started) / 1000;
    const x = STAGE_W / 2 + (this.walk ? 75 * Math.sin(t * 1.3) : 0);
    if (this.prevX !== null && Math.abs(x - this.prevX) > 0.05) {
      this.lastMoveAt = now;
      if (cfg.autoFace) this.state.face(Math.sign(x - this.prevX));
    }
    this.prevX = x;
    this.state.moving = now - this.lastMoveAt < 140;

    const base = { x, y: STAGE_H - 70 - (th * fit) / 2, sx: fit, sy: fit, rot: 0, alpha: 1, tint: 0xffffff };
    const p = this.state.pose(now, dt, { idleOn: true, strength: 1 });
    const out = compose(base, p, { texW: tw, texH: th, anchorY: 0.5, flip: this.state.dir === artDir ? 1 : -1 });

    this.sprite.position.set(out.x, out.y);
    this.sprite.scale.set(out.sx, out.sy);
    this.sprite.rotation = out.rot;
    this.sprite.alpha = out.alpha;
    this.sprite.tint = out.tint;

    this.setShadowStyle(cfg.shadow.style);
    if (this.shadow) placeShadow(this.shadow, out, p, cfg.shadow, out.w * 0.9, tex);
  }

  play(id) {
    const dir = this.state.dir;
    this.state.play(id, performance.now(), { travelX: dir * 80, travelY: 0 });
  }

  destroy() {
    this.app?.ticker.remove(this.tick, this);
    this.app?.destroy(true, { children: true, texture: false, baseTexture: false });
    this.app = null;
  }
}

/* -------------------------------------------- */
/*  Studio window                               */
/* -------------------------------------------- */

export class AnimationStudio extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(doc, options = {}) {
    super({ id: `living-sprites-studio-${doc?.id ?? "defaults"}`, ...options });
    this.doc = doc ?? null;
    this.cfg = doc ? studioConfig(doc) : worldDefaults();
    this.preview = null;
  }

  get isDefaults() {
    return !this.doc;
  }

  static DEFAULT_OPTIONS = {
    classes: ["living-sprites", "ls-studio-app"],
    tag: "div",
    window: { title: "Animation Studio", icon: "fa-solid fa-person-running", resizable: false },
    position: { width: 860, height: "auto" },
    actions: {
      pick: AnimationStudio.#onPick,
      tryAction: AnimationStudio.#onTryAction,
      toggleWalk: AnimationStudio.#onToggleWalk,
      setFacing: AnimationStudio.#onSetFacing,
      save: AnimationStudio.#onSave,
      saveSelected: AnimationStudio.#onSaveSelected,
      saveActor: AnimationStudio.#onSaveActor,
      reset: AnimationStudio.#onReset,
      saveDefaults: AnimationStudio.#onSaveDefaults,
      applyScene: AnimationStudio.#onApplyScene
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE}/templates/studio.hbs` }
  };

  get title() {
    return this.doc ? `Animation Studio: ${this.doc.name}` : "Animation Studio: Default for all tokens";
  }

  async _prepareContext() {
    const cfg = this.cfg;
    const list = (table, current) => Object.entries(table).map(([id, d]) => ({
      id, label: d.label, icon: d.icon, description: d.description, active: id === current
    }));
    return {
      cfg,
      name: this.doc?.name,
      isDefaults: this.isDefaults,
      isGM: game.user.isGM,
      idle: list(IDLE, cfg.idle.preset).filter(i => i.id !== "knockedOut"),
      move: list(MOVE, cfg.move.preset),
      shadows: list(SHADOW_STYLES, cfg.shadow.style),
      actions: list(ACTIONS, null),
      facingRight: cfg.facing !== "left",
      canSaveActor: !!this.doc?.actor?.isOwner,
      walk: !!this.preview?.walk
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    // Mount the live preview
    const stage = root.querySelector(".ls-preview");
    if (!this.preview) {
      this.preview = new Preview(this.cfg);
      this.preview.setImage(this.doc?.texture?.src ?? "icons/svg/mystery-man.svg");
    }
    this.preview.cfg = this.cfg;
    stage?.replaceChildren(this.preview.view);

    // Sliders and toggles update the config live
    for (const input of root.querySelectorAll("input[data-field]")) {
      input.addEventListener("input", ev => this.#onField(ev.currentTarget));
      input.addEventListener("change", ev => this.#onField(ev.currentTarget));
    }

    // Hovering a card previews it
    for (const card of root.querySelectorAll(".ls-card[data-slot]")) {
      card.addEventListener("mouseenter", () => {
        const { slot, preset } = card.dataset;
        const preview = foundry.utils.deepClone(this.cfg);
        if (slot === "shadow") preview.shadow.style = preset;
        else preview[slot].preset = preset;
        this.preview.override = preview;
        if (slot === "move") this.preview.walk = true;
      });
      card.addEventListener("mouseleave", () => {
        this.preview.override = null;
        this.preview.walk = root.querySelector("[data-action=toggleWalk]")?.classList.contains("active") ?? false;
      });
    }
  }

  #onField(input) {
    const path = input.dataset.field;
    const value = input.type === "checkbox" ? input.checked : Number(input.value);
    foundry.utils.setProperty(this.cfg, path, value);
    const label = this.element.querySelector(`[data-out="${path}"]`);
    if (label) label.textContent = input.type === "checkbox" ? "" : `${Math.round(value * 100)}%`;
    if (path === "enabled") this.element.querySelector(".ls-studio")?.classList.toggle("is-off", !value);
  }

  static #onPick(event, target) {
    const { slot, preset } = target.dataset;
    if (slot === "shadow") this.cfg.shadow.style = preset;
    else this.cfg[slot].preset = preset;
    for (const el of this.element.querySelectorAll(`.ls-card[data-slot="${slot}"]`)) {
      el.classList.toggle("active", el.dataset.preset === preset);
    }
    this.preview.override = null;
  }

  static #onTryAction(event, target) {
    this.preview?.play(target.dataset.preset);
  }

  static #onToggleWalk(event, target) {
    this.preview.walk = !this.preview.walk;
    target.classList.toggle("active", this.preview.walk);
  }

  static #onSetFacing(event, target) {
    this.cfg.facing = target.dataset.facing;
    for (const el of this.element.querySelectorAll("[data-action=setFacing]")) {
      el.classList.toggle("active", el.dataset.facing === this.cfg.facing);
    }
    this.preview.state.face(this.cfg.facing === "left" ? -1 : 1);
  }

  static async #onSave() {
    if (!this.doc.isOwner) return ui.notifications.warn("You don't own this token.");
    await this.doc.update({ [`flags.${MODULE}.config`]: foundry.utils.deepClone(this.cfg) });
    ui.notifications.info(`${this.doc.name} is now animated.`);
  }

  static async #onSaveSelected() {
    const docs = canvas.tokens.controlled.map(t => t.document).filter(d => d.isOwner && d.parent === canvas.scene);
    if (!docs.find(d => d.id === this.doc.id) && this.doc.isOwner && this.doc.parent === canvas.scene) docs.push(this.doc);
    if (!docs.length) return ui.notifications.warn("Select some tokens you own first.");
    const cfg = foundry.utils.deepClone(this.cfg);
    await canvas.scene.updateEmbeddedDocuments("Token", docs.map(d => ({ _id: d.id, [`flags.${MODULE}.config`]: cfg })));
    ui.notifications.info(`Applied to ${docs.length} token${docs.length === 1 ? "" : "s"}.`);
  }

  static async #onSaveActor() {
    const actor = this.doc.actor;
    if (!actor?.isOwner) return;
    const cfg = foundry.utils.deepClone(this.cfg);
    await actor.update({ [`prototypeToken.flags.${MODULE}.config`]: cfg });
    if (this.doc.isOwner) await this.doc.update({ [`flags.${MODULE}.config`]: cfg });
    ui.notifications.info(`New ${actor.name} tokens will use these animations.`);
  }

  static #onReset() {
    this.cfg = this.isDefaults ? mergeConfig({}) : worldDefaults();
    this.render();
  }

  static async #onSaveDefaults() {
    const cfg = foundry.utils.deepClone(this.cfg);
    cfg.enabled = true;
    await game.settings.set(MODULE, "defaults", cfg);
    ui.notifications.info("Default animation saved. Tokens without their own setup now use it.");
  }

  static async #onApplyScene() {
    const scene = canvas.scene;
    if (!game.user.isGM || !scene) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Apply to every token" },
      content: `<p>Replace the animation on all ${scene.tokens.size} tokens in <strong>${scene.name}</strong> with this one?</p>`
    });
    if (!ok) return;
    const cfg = foundry.utils.deepClone(this.cfg);
    cfg.enabled = true;
    await game.settings.set(MODULE, "defaults", cfg);
    await scene.updateEmbeddedDocuments("Token", scene.tokens.map(d => ({ _id: d.id, [`flags.${MODULE}.config`]: cfg })));
    ui.notifications.info(`Applied to ${scene.tokens.size} tokens.`);
  }

  async _onClose(options) {
    this.preview?.destroy();
    this.preview = null;
    return super._onClose?.(options);
  }
}

/** Opened from the module settings: edits the world default instead of one token. */
export class DefaultsStudio extends AnimationStudio {
  constructor(options = {}) {
    super(null, options);
  }
}

export function openStudio(ref) {
  const token = manager.resolveToken(ref);
  const doc = token?.document ?? (ref?.documentName === "Token" ? ref : null);
  if (!doc) return ui.notifications.warn("Pick a token first.");
  const existing = foundry.applications.instances?.get(`living-sprites-studio-${doc.id}`);
  if (existing) return existing.render({ force: true });
  return new AnimationStudio(doc).render({ force: true });
}
