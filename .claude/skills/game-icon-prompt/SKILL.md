---
name: game-icon-prompt
description: "Compose FLUX prompts for cohesive game-UI icons via the local-image skill. Use when generating HUD glyphs, button icons, upgrade-card icons, or title art that need to share a visual style across a batch. Picks an asset template (size + framing) and a style preset (look + suffix) and composes them with a subject phrase. Pairs with the local-image skill. Triggers on: game icon, UI icon, HUD icon, button glyph, upgrade icon, sticker icon, icon set, replace emoji, prompt template, FLUX prompt."
---

# Game Icon Prompt Templates

A thin layer on top of [[local-image]] for keeping a *set* of game-UI icons visually consistent. The local-image skill handles the mflux invocation; this skill standardises the **prompt** and **dimensions** so a batch of icons looks like one set.

## How a prompt is built

```
final_prompt = "<subject phrase>, <style-preset suffix>"
```

Then pick an **asset template** for the dimensions / output path, plug into `scripts/local-image.sh`, and pin a `--seed` so the icon is reproducible.

## Style presets

| Preset | Suffix |
|---|---|
| `cute-sticker` | `cute 2D sticker icon, bold black outline, flat saturated colors, glossy highlight, centered single subject, dark navy background #0b1020, game UI asset, no text, no shadow on background` |

Add new presets by appending a row. Presets and templates compose orthogonally.

## Asset templates

| Template | W × H | Output dir | Notes |
|---|---|---|---|
| `hud-icon` | 256 × 256 | `public/assets/icons/` | Small inline glyph next to a stat number or label. |
| `button-glyph` | 256 × 256 | `public/assets/icons/` | Sits next to button text. Same size as hud-icon. |
| `upgrade-icon` | 512 × 512 | `public/assets/icons/upgrades/` | Larger, used in upgrade cards. |
| `title-glyph` | 1024 × 512 | `public/assets/icons/` | Wide banner / phase title art. |

## Subject phrasing tips

- One subject, no scene. `"a slice of pepperoni pizza"` ✅ — `"a pizza chef tossing dough in a kitchen"` ❌.
- Lead with the noun, not adjectives. FLUX-schnell weights the first tokens highest.
- Don't ask for emoji — say *what the emoji depicts*. `🍕` → `"a slice of pepperoni pizza"`.
- Avoid words like "icon" or "logo" in the subject phrase — the style preset already supplies them.

## Compose & run

```bash
scripts/local-image.sh \
  "a slice of pepperoni pizza, cute 2D sticker icon, bold black outline, flat saturated colors, glossy highlight, centered single subject, dark navy background #0b1020, game UI asset, no text, no shadow on background" \
  --width 256 --height 256 --seed 11 \
  --out public/assets/icons/pizza.png
```

Each generation takes ~15–30 s on M-series after the first run.

## Reproducibility

Pin a seed per icon. If you re-roll, **update the seed in the appendix** so the next person regenerating the set gets the same picks.

### Known-good seeds

| Icon | Subject | Preset | Template | Seed |
|---|---|---|---|---|
| `pizza` | a slice of pepperoni pizza | cute-sticker | hud-icon | 11 |
| `star` | a five-pointed gold star | cute-sticker | hud-icon | 7 |
| `money` | a stack of folded US dollar bills | cute-sticker | hud-icon | 23 |
| `dollar` | a green dollar sign symbol made of gold coins | cute-sticker | hud-icon | 50 |
| `cosmic` | a cluster of glowing magic sparkles | cute-sticker | hud-icon | 42 |
| `swirl` | a spiral galaxy swirl symbol | cute-sticker | hud-icon | 17 |
| `wormhole` | a glowing purple and blue cosmic wormhole portal | cute-sticker | upgrade-icon | 88 |
| `audio-on` | a speaker icon with two sound waves emitting | cute-sticker | hud-icon | 31 |
| `audio-off` | a muted speaker icon with a red diagonal slash through it | cute-sticker | hud-icon | 33 |
| `dough` | a ball of fresh pizza dough on a wooden surface | cute-sticker | upgrade-icon | 4 |
| `cheese` | a wedge of yellow cheese with holes | cute-sticker | upgrade-icon | 5 |
| `fire` | a bright orange and yellow flame | cute-sticker | upgrade-icon | 9 |
| `bike` | a red delivery bicycle with a pizza box on the back | cute-sticker | upgrade-icon | 14 |
| `store` | a small storefront building with awning | cute-sticker | upgrade-icon | 20 |
| `megaphone` | a red and white megaphone bullhorn | cute-sticker | upgrade-icon | 12 |
| `robot` | a friendly chef robot head with antenna | cute-sticker | upgrade-icon | 28 |
| `drone` | a small flying delivery drone with a pizza box | cute-sticker | upgrade-icon | 19 |

## Rules

1. **One subject per icon.** Multi-subject prompts produce muddled glyphs at 256×256.
2. **Match the preset's background to the UI surface.** The `cute-sticker` preset uses `#0b1020` to blend into the HUD chips; if the UI background changes, fork the preset.
3. **Don't mix presets inside one set.** Pick one preset for the whole batch; introducing variants mid-set is what makes icon sets look inconsistent.
4. **Resize, don't regenerate, for variants.** If you need a 64×64 version, downscale the 256 PNG with a sharp filter rather than calling FLUX again at a smaller size.

## See also

- [[local-image]] — the underlying mflux wrapper. Invoke its script directly; this skill only shapes the prompt.
