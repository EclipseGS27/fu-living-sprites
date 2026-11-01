export const MODULE = "living-sprites";

export const DEFAULTS = Object.freeze({
  enabled: true,
  idle: { preset: "breathe", intensity: 1, speed: 1 },
  move: { preset: "hop", intensity: 1, speed: 1 },
  shadow: { style: "blob", opacity: 0.45, size: 1, offset: 0 },
  facing: "right",
  autoFace: false,
  combatOnly: false,
  // per-token choices for automatic actions ("default" or missing = the world's)
  reactions: {}
});

export function registerSettings(onChange) {
  const world = (key, data) => game.settings.register(MODULE, key, { scope: "world", config: true, onChange, ...data });
  const client = (key, data) => game.settings.register(MODULE, key, { scope: "client", config: true, onChange, ...data });

  world("autoEnable", {
    name: "Animate every token by default",
    hint: "Tokens you haven't set up individually use the Default Animation above. Off means only tokens you configure are animated.",
    type: Boolean, default: false
  });
  game.settings.register(MODULE, "defaults", { scope: "world", config: false, type: Object, default: foundry.utils.deepClone(DEFAULTS), onChange });
  // superseded by Automatic actions ("Takes damage"); kept so turning it off still works
  game.settings.register(MODULE, "autoHurt", { scope: "world", config: false, type: Boolean, default: true, onChange });
  game.settings.register(MODULE, "reactions", { scope: "world", config: false, type: Object, default: {}, onChange });
  world("autoKO", {
    name: "Fall over when defeated",
    hint: "Animated tokens with the Defeated status collapse and stay down until it is removed.",
    type: Boolean, default: true
  });
  world("playerActions", {
    name: "Players can trigger actions",
    hint: "Lets players play actions (Attack, Cast...) on tokens they own.",
    type: Boolean, default: true
  });

  client("strength", {
    name: "Animation strength on this computer",
    hint: "Turn motion down if it is distracting or uncomfortable. 0 stops idle motion.",
    type: Number, range: { min: 0, max: 1.5, step: 0.05 }, default: 1
  });
  client("disableLocal", {
    name: "Turn off Living Sprites on this computer",
    type: Boolean, default: false
  });
}

export function mergeConfig(partial) {
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), partial ?? {}, { inplace: false });
}

export function worldDefaults() {
  return mergeConfig({ ...game.settings.get(MODULE, "defaults"), enabled: true });
}

/** The config a token should actually use on the canvas. */
export function resolveConfig(doc) {
  const flag = doc?.getFlag?.(MODULE, "config");
  if (flag) return mergeConfig(flag);
  if (game.settings.get(MODULE, "autoEnable")) return worldDefaults();
  return mergeConfig({ enabled: false });
}

/** The config the Studio should start from when opened on a token. */
export function studioConfig(doc) {
  const flag = doc?.getFlag?.(MODULE, "config");
  if (flag) return mergeConfig(flag);
  return worldDefaults();
}
