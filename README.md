# Living Sprites

Make any token image feel alive. Pick a preset, see it move in a live preview, click Save. No sprite sheets, no frame-by-frame work.

Foundry VTT v13 and v14.

## What it does

Every animation is generated from the single image already on the token, so it works with portraits, pixel art, cutouts or anything else.

**Standing still:** Breathe, Bob, Bounce, Battle Ready, Sway, Hover, Ghostly, Nervous, Still

**Moving:** Hop, Waddle, March, Glide, Fly, None. Tokens keep their orientation by default; tick "Turn to face the way it walks" to let them flip.

**Actions (play once):** Attack, Hit, Cast, Heal, Dodge, Jump, Victory, Collapse. Attack dashes to your current target and back.

**Shadows:** Soft oval (shrinks as the sprite lifts off the ground) or a slanted silhouette.

**Automatic actions:** tokens act on their own when something happens. The GM picks an action (or Nothing) for each event under **Automatic actions** in the module settings, and each token can choose its own in its Studio (More options → Automatic actions).

| Event | Default |
|---|---|
| Takes damage (Bar 1 goes down) | Hit |
| Is healed (Bar 1 goes up) | Heal |
| Falls into Crisis (half HP or less) | Nothing |
| Drops to 0 HP | Collapse |
| Gets back up (from 0 HP) | Jump |
| A combat starts (every combatant) | Nothing |
| Its turn starts | Nothing |
| The combat ends (everyone still standing) | Victory |
| Attacks · Casts a spell · Dodges (Project FU chat cards) | Attack · Cast · Dodge |
| Gains a status | Nothing |

When one change means several things (a hit that drops it to 0), only the most important plays. Attacks, spells and dodges are left to FU Animations when it is active. Every client works the events out from what it already sees, so nothing extra goes over the network.

Also: tokens with the Defeated status collapse and stay down, and crowds don't move in sync; each token has its own rhythm.

## How to use

1. Right-click a token. Click the running figure on the right side of the HUD.
2. Click **Studio**.
3. Pick how it stands, how it moves and its shadow. Hover any option to preview it. Press **Walk** to see movement.
4. Click **Save**. Use **Save to selected** for a whole group, or **Save for actor** so every new token of that actor comes animated.

You can also open the Studio from the token's settings, on the Appearance tab.

To play an action during the game, open the same HUD button and click one. Target a token first to make Attack dash to it.

## Settings

| Setting | Who | What it does |
|---|---|---|
| Animate every token by default | GM | Uses the defaults below for any token not set up in the Studio |
| Default animation (button) | GM | Opens the Studio to set the default for all tokens. Can also overwrite every token in the current scene |
| Automatic actions (button) | GM | What tokens do on their own for each event (see above) |
| Fall over when defeated | GM | Collapse and stay down while Defeated |
| Players can trigger actions | GM | Lets players play actions on tokens they own |
| Animation strength on this computer | Each player | Turn motion down or off for comfort |
| Turn off Living Sprites on this computer | Each player | Disables everything locally |

## Macros and other modules

```js
// Attack the targeted token
LivingSprites.play(canvas.tokens.controlled[0], "attack", { target: game.user.targets.first() });

// Other actions: "hurt", "cast", "heal", "dodge", "jump", "victory", "collapse"
LivingSprites.play(token, "victory");

// Open the Studio
LivingSprites.studio(token);
```

`play` shows the animation to everyone at the table. The API is also at `game.modules.get("living-sprites").api`.

## How it works

The engine (`scripts/engine.js`) has no Foundry code in it. Each preset is a small function that returns offsets (lift, squash, lean, tint) for a moment in time. Each frame the module reads where Foundry placed the sprite, adds those offsets, pivoting from the feet, and writes the result back. Anything Foundry changes (moving, resizing, mirroring, swapping the image) is picked up automatically, so it plays well with other modules that change token art.

Adding a preset means adding one entry to `IDLE`, `MOVE` or `ACTIONS` in `engine.js`. The Studio, HUD and settings pick it up automatically.

## FU Animations

If the FU Animations module is active, it takes priority. While FU moves a token (lunges, knockback, squash, stagger, combat hover), Living Sprites leaves that sprite alone and fades back in afterwards. Shadows stay on the ground under FU's motion.
