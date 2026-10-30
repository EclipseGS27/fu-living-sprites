import { ACTIONS, IDLE, MOVE, SHADOW_STYLES } from "./engine.js";
import { MODULE, registerSettings } from "./settings.js";
import { manager } from "./animator.js";
import { openStudio, AnimationStudio, DefaultsStudio } from "./studio.js";
import { renderTokenHUD, renderTokenConfig } from "./ui.js";

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE, "defaultsMenu", {
    name: "Default animation",
    label: "Edit default animation",
    hint: "Pick the idle, movement and shadow every token uses unless you set it up individually.",
    icon: "fa-solid fa-person-running",
    type: DefaultsStudio,
    restricted: true
  });
  registerSettings(() => manager.reloadAll());
});

Hooks.once("ready", () => {
  manager.refreshSettings();
  manager.listen();

  const api = {
    /** LivingSprites.play(token, "attack", { target }) */
    play: (token, action, opts) => manager.play(token, action, opts),
    /** LivingSprites.studio(token) */
    studio: token => openStudio(token),
    presets: { idle: Object.keys(IDLE), move: Object.keys(MOVE), actions: Object.keys(ACTIONS), shadows: Object.keys(SHADOW_STYLES) },
    AnimationStudio
  };
  game.modules.get(MODULE).api = api;
  globalThis.LivingSprites = api;

  // The canvas may already be up by the time ready fires
  if (canvas.ready) attachAll();
});

function attachAll() {
  manager.refreshSettings();
  for (const t of canvas.tokens?.placeables ?? []) manager.attach(t);
  manager.start();
}

Hooks.on("canvasReady", attachAll);
Hooks.on("canvasTearDown", () => manager.detachAll());

Hooks.on("drawToken", token => {
  if (!canvas.ready) return;
  manager.attach(token);
});
Hooks.on("destroyToken", token => manager.detach(token));

Hooks.on("refreshToken", (token, flags) => {
  const a = manager.get(token);
  if (a && a.token === token) a.onRefresh(flags, manager.settings);
});

Hooks.on("updateToken", (doc, changes) => {
  if (!foundry.utils.hasProperty(changes, `flags.${MODULE}`) && !foundry.utils.hasProperty(changes, `flags.-=${MODULE}`)) return;
  const token = doc.object;
  if (!token) return;
  (manager.get(token) ?? manager.attach(token))?.reloadConfig();
});

Hooks.on("renderTokenHUD", renderTokenHUD);
Hooks.on("renderTokenConfig", renderTokenConfig);
