---
name: local-image
description: "Generate images locally on Apple Silicon via mflux (MLX port of FLUX.1). Use when the user asks to generate, create, draw, or make an image, sprite, texture, icon, or game asset from a text prompt. Runs fully on-device on the M-series GPU with FLUX.1-schnell (Apache 2.0), no API key, no quota, no per-call cost — free forever after a one-time ~13 GB model download. Output saved under public/assets/generated/. Triggers on: generate image, create image, make a picture, draw, generate sprite, generate texture, generate icon, game asset, FLUX, mflux, local image, on-device image."
---

# Local Image Generation (mflux / FLUX.1-schnell)

Generate images locally on this Mac with no API key and no per-call cost. Runs FLUX.1-schnell natively on Apple Silicon via Apple's MLX framework.

## What it does

Wraps the `mflux-generate` CLI from [mflux](https://github.com/filipstrand/mflux) in a tiny bash script (`scripts/local-image.sh`). Output PNGs land in `public/assets/generated/` by default, so they're immediately reachable at `/assets/generated/<file>.png` when `npm run dev` is running.

The model runs **fully offline** after the first download — no keys, no `.env`, no quotas.

## Setup (one-time)

### 1. Install mflux

```bash
uv tool install --upgrade mflux --with hf_transfer
```

No `uv`? Install it with `brew install uv`, or fall back to:
```bash
python3 -m pip install --user mflux
```

### 2. Authenticate to Hugging Face

FLUX.1-schnell is a **gated repo** — free to use, but requires accepting the license and authenticating:

1. Visit https://huggingface.co/black-forest-labs/FLUX.1-schnell, log in, click **"Agree and access repository"**.
2. Create a Read token at https://huggingface.co/settings/tokens.
3. Write the token to the standard HF cache location:
   ```bash
   mkdir -p ~/.cache/huggingface && printf '%s' 'hf_YOUR_TOKEN' > ~/.cache/huggingface/token
   ```

mflux / `huggingface_hub` auto-discovers the token from that path. No `.env` needed; the token is user-level, not project-level.

### 3. First generation

The **first call** downloads FLUX.1-schnell (~13 GB) to `~/.cache/huggingface/hub/`. Expect several minutes on first run, then ~15–30 s per image on M4 Pro.

## Usage

Run from the repo root:

```bash
scripts/local-image.sh "<prompt>" [flags]
```

Flags:

| Flag | Default | Meaning |
|---|---|---|
| `--out <path>` | `public/assets/generated/local-<UTC>.png` | Output PNG path (parent dir auto-created). |
| `--model <id>` | `schnell` | `schnell` (4 steps, Apache 2.0) or `dev` (20–50 steps, non-commercial). |
| `--steps <n>` | `4` | Inference steps. 4 is the schnell sweet spot. |
| `--width <px>` | `1024` | Output width. |
| `--height <px>` | `1024` | Output height. |
| `--seed <n>` | random | Reproducible seed. |
| `--quant <4\|8>` | `8` | Weight quantization. 8 = balanced; 4 = lowest RAM, lower fidelity. |

The script prints the saved file path to stdout (one line); mflux's progress goes to stderr.

## Examples

Basic text-to-image:
```bash
scripts/local-image.sh "pixel-art neon arcade joystick on a dark background"
```

Square sprite, reproducible:
```bash
scripts/local-image.sh "tiny pizza slice icon, flat illustration, transparent feel" \
  --width 512 --height 512 --seed 42
```

Wide title card with explicit output:
```bash
scripts/local-image.sh "cinematic cosmic pizza game title card, neon arcade" \
  --width 1280 --height 512 --out public/assets/generated/title-card.png
```

## Rules

1. **Never auto-install.** If `mflux-generate` is missing, the script prints the install command and exits 1 — relay it to the user; don't run it for them.
2. **Gated-repo errors** (`GatedRepoError`, `401 Unauthorized` on `huggingface.co`) mean the user hasn't completed step 2 of Setup. Send them to the model page to accept the license and create a token. Don't try to bypass it.
2. First generation downloads ~13 GB. **Warn the user before the first run** if they're on a metered/slow connection.
3. FLUX.1-**schnell** is Apache 2.0 (commercial use OK). FLUX.1-**dev** is non-commercial — flag this if the user wants `--model dev` for a shipping asset.
4. `schnell` is **text-only**. For image editing / image-to-image, mflux ships `mflux-generate-kontext` with the FLUX.1-Kontext model; this script doesn't wrap it yet. Mention this if the user asks to edit an existing image.
5. The model cache lives at `~/.cache/huggingface/hub/`. Free it with `rm -rf ~/.cache/huggingface/hub/models--black-forest-labs--FLUX.1-schnell` if disk gets tight.

## Reference

See [references/mflux.md](references/mflux.md) for the full mflux CLI surface, license details, and performance notes.
