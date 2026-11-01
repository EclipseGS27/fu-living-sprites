import { AnimState, ACTIONS, IDENTITY, compose, hashString } from "./engine.js";
import { MODULE, resolveConfig } from "./settings.js";
import { createCanvasShadow, placeShadow } from "./shadows.js";
import { hpEvents, reactFirst } from "./reactions.js";

const KEYS = ["x", "y", "sx", "sy", "rot", "alpha", "tint"];

function readMesh(mesh) {
  return {
    x: mesh.position.x, y: mesh.position.y,
    sx: mesh.scale.x, sy: mesh.scale.y,
    rot: mesh.rotation, alpha: mesh.alpha,
    tint: Number(mesh.tint ?? 0xffffff)
  };
}

/**
 * Drives one token's sprite. Foundry keeps writing its own values to the mesh,
 * so every frame we detect which values Foundry changed (anything that is not
 * what we wrote last frame) and treat those as the new base.
 */
export class TokenAnimator {
  constructor(token) {
    this.token = token;
    this.cfg = resolveConfig(token.document);
    this.state = new AnimState(this.cfg, hashString(token.id ?? "x"));
    this.mesh = null;
    this.base = null;
    this.written = null;
    this.prevBase = null;
    this.lastMoveAt = -Infinity;
    this.shadow = null;
    this.combatCache = { at: 0, value: false };
    this.ko = false;
    this.lastBar = undefined;
    this.attachedAt = performance.now();
    this.faced = false;
  }

  reloadConfig() {
    this.cfg = resolveConfig(this.token.document);
    this.state.setConfig(this.cfg);
  }

  get artDir() {
    return this.cfg.facing === "left" ? -1 : 1;
  }

  inCombat(now) {
    if (now - this.combatCache.at > 500) {
      this.combatCache = { at: now, value: !!this.token.document?.inCombat };
    }
    return this.combatCache.value;
  }

  syncBase(mesh) {
    const cur = readMesh(mesh);
    if (!this.base || !this.written) {
      this.base = cur;
      return;
    }
    for (const k of KEYS) {
      if (cur[k] !== this.written[k]) this.base[k] = cur[k];
    }
  }

  write(mesh, out) {
    mesh.position.set(out.x, out.y);
    mesh.scale.set(out.sx, out.sy);
    mesh.rotation = out.rot;
    mesh.alpha = out.alpha;
    if (Number(mesh.tint) !== out.tint) mesh.tint = out.tint;
    this.written = readMesh(mesh);
  }

  restore() {
    const mesh = this.mesh;
    if (mesh && !mesh.destroyed && this.written && this.base) {
      mesh.position.set(this.base.x, this.base.y);
      mesh.scale.set(this.base.sx, this.base.sy);
      mesh.rotation = this.base.rot;
      mesh.alpha = this.base.alpha;
      mesh.tint = this.base.tint;
    }
    this.written = null;
    if (this.shadow) this.shadow.visible = false;
  }

  /** Called by the manager on refreshToken. */
  onRefresh(flags, settings) {
    const doc = this.token.document;
    // Defeated -> knocked out
    const defeatedId = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
    const isDefeated = doc?.hasStatusEffect?.(defeatedId) ?? this.token.actor?.statuses?.has(defeatedId) ?? false;
    const ko = settings.autoKO && this.cfg.enabled && isDefeated;
    if (ko && !this.ko && performance.now() - this.attachedAt > 1000) {
      this.state.play("collapse", performance.now(), {});
    }
    this.ko = ko;

    // Bar 1 changed -> hurt, healed, Crisis, down or back up (Automatic actions)
    if (flags?.refreshBars || this.lastBar === undefined) {
      const bar = doc?.getBarAttribute?.("bar1");
      const value = bar?.type === "bar" ? Number(bar.value) : (Number.isFinite(Number(bar?.value)) ? Number(bar.value) : null);
      const max = bar?.type === "bar" ? Number(bar.max) : NaN;
      if (value !== null && this.lastBar !== undefined && this.lastBar !== null && performance.now() - this.attachedAt > 500) {
        const events = hpEvents(this.lastBar, value, max).filter(e => !ko || e === "revived" || e === "down");
        // the Defeated status already plays the collapse
        reactFirst(this.token, ko ? events.filter(e => e !== "down") : events);
      }
      this.lastBar = value;
    }
  }

  /** Work out where an attack should travel, then start the action. */
  playLocal(id, { target } = {}) {
    const now = performance.now();
    const ctx = {};
    const self = this.token;
    const grid = canvas.grid?.size ?? 100;
    if (target && target !== self) {
      const a = self.center, b = target.center;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.max(0, dist - ((self.w + target.w) / 2) * 0.55);
      ctx.travelX = (dx / dist) * reach;
      ctx.travelY = (dy / dist) * reach;
      if (Math.abs(dx) > 1) ctx.faceX = Math.sign(dx);
    } else {
      ctx.travelX = this.state.dir * grid * 0.6;
      ctx.travelY = 0;
    }
    this.state.play(id, now, ctx);
  }

  update(now, dt, settings) {
    const token = this.token;
    const mesh = token.mesh;
    if (!mesh || mesh.destroyed || token.destroyed) return;
    if (mesh !== this.mesh) {
      this.mesh = mesh;
      this.base = null;
      this.written = null;
      this.destroyShadow();
    }

    // FU Animations has priority: step aside while it moves this sprite
    if (settings.fu) {
      if (this.fuBusy(mesh, now)) return this.yieldToFU(mesh);
      if (this.yielding && !this.resumeFromFU(now)) return;
    }

    this.syncBase(mesh);
    const base = this.base;

    const acting = this.state.isActing(now);
    if (settings.disableLocal || (!this.cfg.enabled && !acting)) {
      if (this.written) this.restore();
      if (this.shadow) this.shadow.visible = false;
      this.prevBase = { x: base.x, y: base.y };
      return;
    }

    // First frame: face the way the artwork is shown
    const shownDir = this.artDir * Math.sign(base.sx || 1);
    // Respect Foundry's Mirror setting: re-sync whenever it changes, and always when auto-face is off
    if (!this.faced || shownDir !== this.lastShown || (!this.cfg.autoFace && !acting)) {
      this.state.face(shownDir);
      this.faced = true;
      this.lastShown = shownDir;
    }

    // Movement detection from Foundry's own position changes
    if (this.prevBase) {
      const dx = base.x - this.prevBase.x, dy = base.y - this.prevBase.y;
      if (Math.hypot(dx, dy) > 0.05) {
        this.lastMoveAt = now;
        if (this.cfg.autoFace && Math.abs(dx) > 0.3) this.state.face(Math.sign(dx));
      }
    }
    this.prevBase = { x: base.x, y: base.y };
    this.state.moving = now - this.lastMoveAt < 140;

    const idleOn = this.cfg.enabled && settings.strength > 0 && !(this.cfg.combatOnly && !this.inCombat(now));
    const p = this.state.pose(now, dt, { idleOn, ko: this.ko, strength: Math.max(settings.strength, acting ? 0.5 : 0) });
    const flip = this.state.dir === shownDir ? 1 : -1;
    const tex = mesh.texture;
    const out = compose(base, p, {
      texW: tex?.width ?? token.w,
      texH: tex?.height ?? token.h,
      anchorY: mesh.anchor?.y ?? 0.5,
      flip
    });
    this.write(mesh, out);
    this.updateShadow(out, p);
  }

  /* -------------------------------------------- */
  /*  FU Animations compatibility                  */
  /* -------------------------------------------- */

  /** FU is moving this sprite: a position offset this frame, or a recent scale/rotation write. */
  fuBusy(mesh, now) {
    const st = mesh.__fuAnim;
    const offset = !!st && (st.ax !== 0 || st.ay !== 0)
      && mesh.position.x === st.ex && mesh.position.y === st.ey;
    const ref = this.written ?? this.seen;
    if (ref && (mesh.rotation !== ref.rot || mesh.scale.x !== ref.sx || mesh.scale.y !== ref.sy)) {
      this.fuUntil = now + 350;
    }
    this.seen = this.yielding ? { rot: mesh.rotation, sx: mesh.scale.x, sy: mesh.scale.y } : null;
    return offset || now < (this.fuUntil ?? 0);
  }

  yieldToFU(mesh) {
    if (!this.yielding) {
      // Put the sprite back to rest once, then leave it entirely to FU
      if (this.written && this.base) {
        mesh.position.set(this.base.x, this.base.y);
        mesh.scale.set(this.base.sx, this.base.sy);
        mesh.rotation = this.base.rot;
        mesh.alpha = this.base.alpha;
        mesh.tint = this.base.tint;
      }
      this.written = null;
      this.yielding = true;
      this.resumeAt = null;
      this.seen = { rot: mesh.rotation, sx: mesh.scale.x, sy: mesh.scale.y };
    }
    this.state.idleW = 0;
    this.state.moveW = 0;
    this.fuShadow(mesh);
  }

  /** Ask Foundry to re-place the sprite, wait a few frames, then take a clean base. */
  resumeFromFU(now) {
    if (this.resumeAt == null) {
      this.resumeAt = now;
      const known = this.token.constructor.RENDER_FLAGS ?? {};
      const flags = Object.fromEntries(["refreshMesh", "refreshSize", "refreshPosition"].filter(f => f in known).map(f => [f, true]));
      try { this.token.renderFlags?.set(flags); } catch { /* ignore */ }
      return false;
    }
    if (now - this.resumeAt < 60) return false;
    this.yielding = false;
    this.resumeAt = null;
    this.base = null;
    this.written = null;
    this.prevBase = null;
    this.seen = null;
    return true;
  }

  /** Keep the shadow on the ground under FU's motion: FU's token offset is ground, the extra mesh offset is lift. */
  fuShadow(mesh) {
    if (!this.cfg.enabled) return;
    const ms = mesh.__fuAnim, ts = this.token.__fuAnim;
    const base = readMesh(mesh);
    if (ms && mesh.position.x === ms.ex && mesh.position.y === ms.ey) {
      base.x -= ms.ax;
      base.y -= ms.ay;
    }
    const tok = this.token;
    const groundLive = ts && tok.x === ts.ex && tok.y === ts.ey;
    const gx = groundLive ? ts.ax : 0, gy = groundLive ? ts.ay : 0;
    const h = Math.max(1, (mesh.texture?.height ?? tok.h) * Math.abs(base.sy));
    const liftPx = Math.max(0, gy - (ms?.ay ?? 0));
    const p = { ...IDENTITY, px: gx, py: gy, lift: liftPx / h };
    const out = compose(base, p, {
      texW: mesh.texture?.width ?? tok.w, texH: mesh.texture?.height ?? tok.h,
      anchorY: mesh.anchor?.y ?? 0.5, flip: 1
    });
    this.updateShadow(out, p);
  }

  updateShadow(out, p) {
    const style = this.cfg.enabled ? (this.cfg.shadow?.style ?? "none") : "none";
    if (this.shadow && this.shadow._lsStyle !== style) this.destroyShadow();
    if (style === "none") return;
    if (!this.shadow) this.shadow = createCanvasShadow(style, this.mesh);
    const s = this.shadow;
    if (!s || s.destroyed) return;

    const mesh = this.mesh;
    s.visible = !!(mesh.visible && this.token.visible);
    if (!s.visible) return;

    // Sort just beneath the token sprite
    const elevation = mesh.elevation ?? 0;
    const sortLayer = mesh.sortLayer ?? 700;
    const sort = (mesh.sort ?? 0) - 0.5;
    if (s.elevation !== elevation || s.sortLayer !== sortLayer || s.sort !== sort) {
      s.elevation = elevation;
      s.sortLayer = sortLayer;
      s.sort = sort;
      s.zIndex = (mesh.zIndex ?? 0) - 1;
      if (canvas.primary) canvas.primary.sortDirty = true;
    }
    placeShadow(s, out, p, this.cfg.shadow, Math.min(out.w, this.token.w), mesh.texture);
  }

  destroyShadow() {
    if (this.shadow && !this.shadow.destroyed) {
      this.shadow.parent?.removeChild(this.shadow);
      this.shadow.destroy();
    }
    this.shadow = null;
  }

  destroy() {
    this.restore();
    this.destroyShadow();
  }
}

/* -------------------------------------------- */
/*  Manager                                     */
/* -------------------------------------------- */

class Manager {
  animators = new Map();
  last = performance.now();
  ticking = false;
  settings = { strength: 1, disableLocal: false, autoHurt: true, autoKO: true };

  refreshSettings() {
    const get = k => game.settings.get(MODULE, k);
    this.settings = {
      strength: get("strength"),
      disableLocal: get("disableLocal"),
      autoHurt: get("autoHurt"),
      autoKO: get("autoKO"),
      fu: !!game.modules.get("fu-animations")?.active
    };
  }

  start() {
    if (this.ticking || !canvas.app) return;
    canvas.app.ticker.add(this.tick, this, PIXI.UPDATE_PRIORITY.LOW + 1);
    this.ticking = true;
  }

  stop() {
    if (!this.ticking) return;
    canvas.app?.ticker.remove(this.tick, this);
    this.ticking = false;
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (const a of this.animators.values()) {
      try {
        a.update(now, dt, this.settings);
      } catch (err) {
        console.error("Living Sprites | animation error", err);
        this.detach(a.token);
      }
    }
  }

  attach(token) {
    if (!token || token.isPreview || !token.id) return null;
    const existing = this.animators.get(token.id);
    if (existing?.token === token) {
      existing.reloadConfig();
      return existing;
    }
    existing?.destroy();
    const a = new TokenAnimator(token);
    this.animators.set(token.id, a);
    this.start();
    return a;
  }

  detach(token) {
    if (!token?.id) return;
    const a = this.animators.get(token.id);
    if (a && a.token === token) {
      a.destroy();
      this.animators.delete(token.id);
    }
  }

  detachAll() {
    for (const a of this.animators.values()) a.destroy();
    this.animators.clear();
    this.stop();
  }

  reloadAll() {
    this.refreshSettings();
    for (const a of this.animators.values()) a.reloadConfig();
  }

  get(token) {
    return this.animators.get(token?.id ?? token) ?? null;
  }

  resolveToken(ref) {
    if (!ref) return null;
    if (typeof ref === "string") return canvas.tokens?.get(ref) ?? null;
    if (ref.documentName === "Token") return ref.object ?? null;
    return ref;
  }

  /**
   * Play an action on a token for everyone at the table.
   * @param {Token|TokenDocument|string} tokenRef
   * @param {string} action   one of ACTIONS
   * @param {object} [opts]
   * @param {Token|string} [opts.target]   token to dash toward (attack)
   * @param {boolean} [opts.broadcast=true]
   */
  play(tokenRef, action, { target = null, broadcast = true } = {}) {
    const token = this.resolveToken(tokenRef);
    if (!token || !ACTIONS[action]) return false;
    const targetToken = this.resolveToken(target);
    if (broadcast && !game.user.isGM && !game.settings.get(MODULE, "playerActions")) {
      ui.notifications.warn("Only the GM can trigger sprite actions in this world.");
      return false;
    }
    const a = this.get(token) ?? this.attach(token);
    a?.playLocal(action, { target: targetToken });
    if (broadcast) {
      game.socket.emit(`module.${MODULE}`, {
        type: "play", scene: canvas.scene?.id, token: token.id, action, target: targetToken?.id ?? null
      });
    }
    return true;
  }

  listen() {
    game.socket.on(`module.${MODULE}`, msg => {
      if (msg?.type !== "play" || msg.scene !== canvas.scene?.id) return;
      this.play(msg.token, msg.action, { target: msg.target, broadcast: false });
    });
  }
}

export const manager = new Manager();
