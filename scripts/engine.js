/**
 * Living Sprites animation engine.
 * Pure math, no Foundry dependencies, so it runs both on the canvas and in the Studio preview.
 *
 * A "pose" is a set of offsets applied on top of a sprite's normal placement:
 *   gx, gy     ground offset, in sprite heights (moves sprite and shadow)
 *   px, py     ground offset, in pixels (used for lunges toward a target)
 *   lift       height off the ground, in sprite heights (moves sprite only, shadow shrinks)
 *   sx, sy     scale multipliers, anchored at the feet
 *   rot        rotation in radians, pivoting at the feet
 *   alpha      opacity multiplier
 *   tint/tintAmt  colour wash and its strength (0..1)
 */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const lerp = (a, b, w) => a + (b - a) * w;

export const ease = {
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  outBack: t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
};

export const IDENTITY = Object.freeze({
  gx: 0, gy: 0, px: 0, py: 0, lift: 0, sx: 1, sy: 1, rot: 0, alpha: 1, tint: 0xffffff, tintAmt: 0
});

export function pose(partial) {
  return Object.assign({}, IDENTITY, partial);
}

/** Squash-and-stretch that roughly preserves volume. amount > 0 stretches tall, < 0 squashes. */
function squash(amount) {
  return { sy: 1 + amount, sx: 1 - amount * 0.5 };
}

/** Sharp bounce curve: 0 at contact, 1 at the top. */
function hopCurve(t, period) {
  return Math.abs(Math.sin((Math.PI * t) / period));
}

/* -------------------------------------------- */
/*  Idle presets (loop forever)                 */
/* -------------------------------------------- */

export const IDLE = {
  none: {
    label: "Still", icon: "fa-solid fa-ban",
    description: "No idle motion.",
    fn: () => ({})
  },
  breathe: {
    label: "Breathe", icon: "fa-solid fa-lungs",
    description: "Gentle in-and-out breathing. Works for almost anything.",
    fn: (t, k) => {
      const s = Math.sin((TAU * t) / 2.6);
      return { sy: 1 + 0.022 * k * s, sx: 1 - 0.011 * k * s };
    }
  },
  bob: {
    label: "Bob", icon: "fa-solid fa-arrows-up-down",
    description: "Soft up-and-down bob, like an old console RPG.",
    fn: (t, k) => {
      const c = 0.5 - 0.5 * Math.cos((TAU * t) / 1.8);
      return { lift: 0.025 * k * c, sy: 1 + 0.012 * k * (c - 0.5) };
    }
  },
  bounce: {
    label: "Bounce", icon: "fa-solid fa-basketball",
    description: "Springy battle bounce with squash on landing.",
    fn: (t, k) => {
      const h = hopCurve(t, 0.8);
      const contact = Math.pow(1 - h, 6);
      const amt = 0.03 * k * h - 0.05 * k * contact;
      return { lift: 0.035 * k * h, ...squash(amt) };
    }
  },
  battle: {
    label: "Battle Ready", icon: "fa-solid fa-hand-fist",
    description: "Leans forward and breathes fast. Good for combat.",
    fn: (t, k, ctx) => {
      const s = Math.sin((TAU * t) / 1.1);
      return { rot: ctx.dir * (0.035 * k + 0.008 * k * s), ...squash(0.028 * k * s) };
    }
  },
  sway: {
    label: "Sway", icon: "fa-solid fa-wind",
    description: "Rocks slowly side to side from the feet.",
    fn: (t, k) => ({ rot: 0.045 * k * Math.sin((TAU * t) / 3.2) })
  },
  hover: {
    label: "Hover", icon: "fa-solid fa-feather",
    description: "Floats above the ground. For flyers, spirits and mages.",
    fn: (t, k) => ({
      lift: (0.09 + 0.035 * Math.sin((TAU * t) / 2.4)) * k,
      rot: 0.02 * k * Math.sin((TAU * t) / 4.8)
    })
  },
  ghostly: {
    label: "Ghostly", icon: "fa-solid fa-ghost",
    description: "Hovers and fades in and out with a pale glow.",
    fn: (t, k) => ({
      lift: (0.07 + 0.03 * Math.sin((TAU * t) / 2.8)) * k,
      alpha: clamp(1 - 0.35 * k * (0.5 + 0.5 * Math.sin((TAU * t) / 3)), 0.2, 1),
      tint: 0xbfe3ff, tintAmt: 0.35
    })
  },
  nervous: {
    label: "Nervous", icon: "fa-solid fa-face-grimace",
    description: "Small shivers and quick breaths. Scared, cold or hurt.",
    fn: (t, k) => ({
      gx: 0.006 * k * (Math.sin(t * 47) + Math.sin(t * 31.7)) / 2,
      ...squash(0.014 * k * Math.sin((TAU * t) / 0.9))
    })
  },
  knockedOut: {
    label: "Knocked Out", icon: "fa-solid fa-bed",
    description: "Lying on the ground, greyed out.",
    fn: (t, k, ctx) => ({
      rot: -ctx.dir * 1.4,
      sy: 1 + 0.01 * Math.sin((TAU * t) / 4),
      alpha: 0.85, tint: 0x9a9a9a, tintAmt: 0.5
    })
  }
};

/* -------------------------------------------- */
/*  Movement presets (while the token travels)  */
/* -------------------------------------------- */

export const MOVE = {
  none: {
    label: "None", icon: "fa-solid fa-ban",
    description: "Slides without extra motion.",
    fn: () => ({})
  },
  hop: {
    label: "Hop", icon: "fa-solid fa-frog",
    description: "Quick little hops. The classic JRPG walk.",
    fn: (t, k) => {
      const h = hopCurve(t, 0.32);
      const contact = Math.pow(1 - h, 6);
      return { lift: 0.05 * k * h, ...squash(0.03 * k * h - 0.04 * k * contact) };
    }
  },
  waddle: {
    label: "Waddle", icon: "fa-solid fa-person-walking",
    description: "Rocks side to side with each step.",
    fn: (t, k) => ({
      rot: 0.07 * k * Math.sin((TAU * t) / 0.5),
      lift: 0.012 * k * Math.abs(Math.sin((TAU * t) / 0.5))
    })
  },
  march: {
    label: "March", icon: "fa-solid fa-shoe-prints",
    description: "Heavy stomping steps. Knights, golems, big folk.",
    fn: (t, k) => {
      const h = hopCurve(t, 0.4);
      return { lift: 0.02 * k * h, ...squash(-0.035 * k * Math.pow(1 - h, 4)) };
    }
  },
  glide: {
    label: "Glide", icon: "fa-solid fa-person-skating",
    description: "Leans into the direction of travel.",
    fn: (t, k, ctx) => ({
      rot: ctx.dir * 0.06 * k,
      lift: 0.01 * k * Math.sin((TAU * t) / 0.6)
    })
  },
  fly: {
    label: "Fly", icon: "fa-solid fa-dove",
    description: "Rises and tilts forward while travelling.",
    fn: (t, k, ctx) => ({
      lift: 0.06 * k + 0.015 * k * Math.sin((TAU * t) / 1.2),
      rot: ctx.dir * 0.04 * k
    })
  }
};

/* -------------------------------------------- */
/*  Actions (play once)                         */
/*  fn(p, k, ctx) with p running 0 -> 1          */
/* -------------------------------------------- */

export const ACTIONS = {
  attack: {
    label: "Attack", icon: "fa-solid fa-khanda", duration: 1.0,
    description: "Winds up, dashes to the target (or forward) and hops back.",
    fn: (p, k, ctx) => {
      const wind = seg(p, 0, 0.18);
      const dash = seg(p, 0.18, 0.34);
      const back = seg(p, 0.6, 0.95);
      const d = ease.out(dash) * (1 - ease.inOut(back));
      const windBack = ease.inOut(wind) * (1 - dash);
      return {
        px: ctx.travelX * d,
        py: ctx.travelY * d,
        gx: -ctx.dir * 0.06 * k * windBack,
        rot: ctx.dir * k * (-0.08 * windBack + 0.12 * Math.sin(Math.PI * seg(p, 0.18, 0.55))),
        lift: 0.04 * k * Math.sin(Math.PI * dash) + 0.05 * k * Math.sin(Math.PI * back),
        sx: 1 + 0.08 * k * Math.sin(Math.PI * dash)
      };
    }
  },
  hurt: {
    label: "Hit", icon: "fa-solid fa-burst", duration: 0.55,
    description: "Knocked back with a red flash.",
    fn: (p, k, ctx) => {
      const kb = Math.sin(Math.PI * Math.min(1, p * 1.6));
      const flicker = p < 0.5 && Math.floor(p * 14) % 2 === 1;
      return {
        gx: -ctx.dir * 0.07 * k * kb + 0.02 * k * Math.sin(p * 90) * (1 - p),
        rot: -ctx.dir * 0.08 * k * kb,
        tint: 0xff3b3b, tintAmt: 0.9 * Math.pow(1 - p, 2),
        alpha: flicker ? 0.55 : 1
      };
    }
  },
  cast: {
    label: "Cast", icon: "fa-solid fa-wand-sparkles", duration: 1.2,
    description: "Rises, stretches tall and glows.",
    fn: (p, k) => {
      const rise = Math.sin(Math.PI * p);
      return {
        lift: 0.06 * k * rise,
        ...squash(0.05 * k * rise),
        tint: 0x9fd8ff, tintAmt: 0.6 * rise * (0.7 + 0.3 * Math.sin(p * 40))
      };
    }
  },
  heal: {
    label: "Heal", icon: "fa-solid fa-heart-pulse", duration: 1.1,
    description: "A gentle lift with a green glow.",
    fn: (p, k) => {
      const rise = Math.sin(Math.PI * p);
      return {
        lift: 0.035 * k * rise,
        ...squash(0.025 * k * Math.sin(TAU * p * 2) * rise),
        tint: 0x8dffa8, tintAmt: 0.55 * rise
      };
    }
  },
  dodge: {
    label: "Dodge", icon: "fa-solid fa-person-running", duration: 0.55,
    description: "Quick backstep with an afterimage fade.",
    fn: (p, k, ctx) => {
      const d = ease.out(seg(p, 0, 0.3)) * (1 - ease.inOut(seg(p, 0.45, 1)));
      return {
        gx: -ctx.dir * 0.35 * k * d,
        lift: 0.04 * k * Math.sin(Math.PI * seg(p, 0, 0.3)),
        rot: -ctx.dir * 0.06 * k * d,
        alpha: 1 - 0.45 * d
      };
    }
  },
  jump: {
    label: "Jump", icon: "fa-solid fa-person-arrow-up-from-line", duration: 0.75,
    description: "Crouch, leap, land.",
    fn: (p, k) => {
      const crouch = Math.sin(Math.PI * seg(p, 0, 0.18));
      const air = seg(p, 0.15, 0.8);
      const land = Math.sin(Math.PI * seg(p, 0.78, 1));
      const inAir = air > 0 && air < 1 ? Math.sin(Math.PI * air) : 0;
      return {
        lift: 0.35 * k * inAir,
        ...squash(-0.08 * k * crouch + 0.06 * k * inAir * (1 - air) - 0.07 * k * land)
      };
    }
  },
  victory: {
    label: "Victory", icon: "fa-solid fa-trophy", duration: 1.5,
    description: "Two happy hops and a spin.",
    fn: (p, k) => {
      const hops = p < 0.6 ? Math.abs(Math.sin((TAU * p) / 0.6)) : 0;
      const spin = ease.inOut(seg(p, 0.6, 1.0));
      return {
        lift: 0.12 * k * hops,
        ...squash(0.03 * k * hops),
        sx: (1 - 0.015 * k * hops) * Math.cos(TAU * spin)
      };
    }
  },
  collapse: {
    label: "Collapse", icon: "fa-solid fa-skull", duration: 1.6,
    description: "Staggers and falls over. Gets back up unless the token is defeated.",
    fn: (p, k, ctx) => {
      const shake = p < 0.15 ? 0.015 * Math.sin(p * 120) : 0;
      const fall = ease.out(seg(p, 0.12, 0.45));
      const rise = ctx.ko ? 0 : ease.inOut(seg(p, 0.75, 1));
      const a = fall * (1 - rise);
      return {
        gx: shake,
        rot: -ctx.dir * 1.4 * a,
        alpha: 1 - 0.15 * a,
        tint: 0x9a9a9a, tintAmt: 0.5 * a
      };
    }
  }
};

export const SHADOW_STYLES = {
  none: { label: "None", icon: "fa-solid fa-ban", description: "No shadow." },
  blob: { label: "Soft", icon: "fa-solid fa-circle", description: "A soft oval under the feet. Shrinks when the sprite lifts off." },
  silhouette: { label: "Silhouette", icon: "fa-solid fa-user", description: "A slanted copy of the sprite's outline, cast behind it." }
};

/* -------------------------------------------- */
/*  Pose maths                                  */
/* -------------------------------------------- */

/** Blend from IDENTITY (w = 0) to the given pose (w = 1). */
export function weigh(p, w) {
  return lerpPose(IDENTITY, p, w);
}

export function lerpPose(a, b, w) {
  a = pose(a); b = pose(b);
  if (w <= 0) return a;
  if (w >= 1) return b;
  const out = {};
  for (const key of ["gx", "gy", "px", "py", "lift", "sx", "sy", "rot", "alpha", "tintAmt"]) out[key] = lerp(a[key], b[key], w);
  out.tint = b.tintAmt >= a.tintAmt ? b.tint : a.tint;
  return out;
}

/** Layer pose b on top of pose a. */
export function combine(a, b) {
  a = pose(a); b = pose(b);
  const strongerTint = b.tintAmt > a.tintAmt;
  return {
    gx: a.gx + b.gx, gy: a.gy + b.gy,
    px: a.px + b.px, py: a.py + b.py,
    lift: a.lift + b.lift,
    sx: a.sx * b.sx, sy: a.sy * b.sy,
    rot: a.rot + b.rot,
    alpha: a.alpha * b.alpha,
    tint: strongerTint ? b.tint : a.tint,
    tintAmt: Math.max(a.tintAmt, b.tintAmt)
  };
}

export function mixTint(base, tint, amt) {
  base = Number(base ?? 0xffffff);
  if (!amt) return base;
  const ch = (c, s) => (c >> s) & 0xff;
  let out = 0;
  for (const s of [16, 8, 0]) {
    const wash = 255 + (ch(tint, s) - 255) * clamp(amt, 0, 1);
    out |= Math.round((ch(base, s) * wash) / 255) << s;
  }
  return out;
}

/**
 * Turn a base placement + pose into final sprite values.
 * base: { x, y, sx, sy, rot, alpha, tint } as Foundry placed the sprite (x, y at the anchor).
 * info: { texW, texH, anchorY, flip }
 */
export function compose(base, p, info) {
  const h = info.texH * Math.abs(base.sy);
  const w = info.texW * Math.abs(base.sx);
  const foot = h * (1 - info.anchorY);
  const c0 = Math.cos(base.rot), s0 = Math.sin(base.rot);
  const fx = base.x - s0 * foot;
  const fy = base.y + c0 * foot;
  const groundX = p.gx * h + p.px;
  const groundY = p.gy * h + p.py;
  const r = base.rot + p.rot;
  const newFoot = foot * p.sy;
  return {
    x: fx + groundX + Math.sin(r) * newFoot,
    y: fy + groundY - Math.cos(r) * newFoot - p.lift * h,
    sx: base.sx * p.sx * (info.flip ?? 1),
    sy: base.sy * p.sy,
    rot: r,
    alpha: clamp(base.alpha * p.alpha, 0, 1),
    tint: mixTint(base.tint, p.tint, p.tintAmt),
    feetX: fx + groundX,
    feetY: fy + groundY,
    h, w
  };
}

/* -------------------------------------------- */
/*  Per-sprite state machine                    */
/* -------------------------------------------- */

export class AnimState {
  constructor(cfg, seed = 0) {
    this.cfg = cfg;
    this.phase = (seed % 1000) / 97;   // desync crowds
    this.dir = 1;                      // +1 = facing right on screen, -1 = left
    this.moving = false;
    this.moveW = 0;
    this.idleW = 1;
    this.action = null;
    this.idleCur = null;
    this.idlePrev = null;
    this.idleSwitch = 0;
  }

  setConfig(cfg) { this.cfg = cfg; }

  face(sign) {
    if (sign) this.dir = Math.sign(sign);
  }

  isActing(now) {
    if (!this.action) return false;
    const def = ACTIONS[this.action.id];
    return now - this.action.start < def.duration * 1000;
  }

  /**
   * Start an action. ctx may include travelX / travelY (pixels) for attacks.
   */
  play(id, now, ctx = {}) {
    if (!ACTIONS[id]) return false;
    if (ctx.faceX) this.face(ctx.faceX);
    this.action = { id, start: now, ctx: { travelX: 0, travelY: 0, ...ctx } };
    return true;
  }

  pose(now, dt, opts = {}) {
    const cfg = this.cfg;
    const strength = opts.strength ?? 1;
    const t = now / 1000 + this.phase;
    const ko = !!opts.ko;
    const idleOn = opts.idleOn !== false;
    const ctx = { dir: this.dir, ko };

    const idleId = !idleOn ? "none" : (ko ? "knockedOut" : (IDLE[cfg.idle?.preset] ? cfg.idle.preset : "none"));
    const moveId = !idleOn || ko ? "none" : (MOVE[cfg.move?.preset] ? cfg.move.preset : "none");

    // Crossfade when the idle preset changes
    if (idleId !== this.idleCur) {
      this.idlePrev = this.idleCur;
      this.idleCur = idleId;
      this.idleSwitch = now;
    }
    const ik = (cfg.idle?.intensity ?? 1) * strength;
    const isp = cfg.idle?.speed ?? 1;
    let idle = pose(IDLE[idleId].fn(t * isp, ik, ctx));
    const sw = clamp((now - this.idleSwitch) / 350, 0, 1);
    if (sw < 1 && this.idlePrev) {
      idle = lerpPose(IDLE[this.idlePrev].fn(t * isp, ik, ctx), idle, ease.inOut(sw));
    }

    // Action
    let act = null;
    if (this.action) {
      const def = ACTIONS[this.action.id];
      const p = (now - this.action.start) / (def.duration * 1000);
      if (p >= 1) {
        if (this.action.id === "collapse" && ko) this.idleW = 1;
        this.action = null;
      } else {
        act = pose(def.fn(Math.max(0, p), strength, { ...ctx, ...this.action.ctx, dir: this.dir, ko }));
      }
    }

    const step = Math.min(1, dt * 10);
    this.idleW += ((act ? 0 : 1) - this.idleW) * step;
    const wantMove = this.moving && moveId !== "none" && !act;
    this.moveW += ((wantMove ? 1 : 0) - this.moveW) * step;

    let out = weigh(idle, this.idleW * (moveId !== "none" ? 1 - this.moveW : 1));
    if (moveId !== "none" && this.moveW > 0.001) {
      const mk = (cfg.move?.intensity ?? 1) * strength;
      const msp = cfg.move?.speed ?? 1;
      out = combine(out, weigh(MOVE[moveId].fn(t * msp, mk, ctx), this.moveW));
    }
    if (act) out = combine(out, act);
    return out;
  }
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
