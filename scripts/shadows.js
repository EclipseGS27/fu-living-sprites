import { clamp } from "./engine.js";

const BLOB_RADIUS = 50;

/** Soft oval made of stacked translucent ellipses (no filters, cheap to render). */
export function drawBlob(g) {
  g.clear();
  const rings = 7;
  for (let i = 0; i < rings; i++) {
    const r = BLOB_RADIUS * (1 - i * 0.11);
    g.beginFill(0x000000, 0.16);
    g.drawEllipse(0, 0, r, r * 0.32);
    g.endFill();
  }
  return g;
}

/** Find a constructor across Foundry v12 globals and v13+ namespaces. */
function primaryClass(name) {
  return foundry?.canvas?.primary?.[name] ?? globalThis[name] ?? null;
}

/** Create a shadow object that lives in the canvas primary group, sorted just under the token. */
export function createCanvasShadow(style, mesh) {
  let obj = null;
  if (style === "blob") {
    const G = primaryClass("PrimaryGraphics");
    try { obj = G ? new G() : null; } catch { obj = null; }
    obj ??= new PIXI.Graphics();
    drawBlob(obj);
  } else if (style === "silhouette") {
    const S = primaryClass("PrimarySpriteMesh");
    try { obj = S ? new S({ texture: mesh.texture, name: "living-sprites-shadow" }) : null; } catch { obj = null; }
    if (!obj) {
      try { obj = S ? new S(mesh.texture) : null; } catch { obj = null; }
    }
    obj ??= new PIXI.Sprite(mesh.texture);
    obj.tint = 0x000000;
  }
  if (!obj) return null;
  obj.name = "living-sprites-shadow";
  obj.eventMode = "none";
  obj._lsStyle = style;
  try {
    canvas.primary.addChild(obj);
  } catch (err) {
    console.warn("Living Sprites | could not add shadow", err);
    obj.destroy();
    return null;
  }
  return obj;
}

/** Shared placement maths for the canvas and the Studio preview. */
export function placeShadow(obj, out, p, shadowCfg, footprint, texture) {
  const liftFade = clamp(1 - p.lift * 1.6, 0.3, 1);
  const opacity = shadowCfg.opacity ?? 0.45;
  const size = shadowCfg.size ?? 1;
  const offsetY = (shadowCfg.offset ?? 0) * out.h;

  if (obj._lsStyle === "blob") {
    const width = Math.max(4, footprint * 0.8 * size * (0.55 + 0.45 * liftFade));
    obj.position.set(out.feetX, out.feetY + offsetY);
    obj.scale.set(width / (BLOB_RADIUS * 2));
    obj.rotation = 0;
    obj.alpha = opacity * liftFade * out.alpha;
  } else {
    if (texture && obj.texture !== texture) obj.texture = texture;
    obj.anchor?.set(0.5, 1);
    obj.position.set(out.feetX, out.feetY + offsetY);
    obj.scale.set(out.sx, Math.abs(out.sy) * 0.38 * size);
    obj.skew.set(-0.9, 0);
    obj.rotation = 0;
    obj.alpha = opacity * liftFade * out.alpha;
  }
}
