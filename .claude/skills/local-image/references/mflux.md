# mflux — Reference

[mflux](https://github.com/filipstrand/mflux) is an MLX-native implementation of FLUX.1 (and several other diffusion models) that runs locally on Apple Silicon GPUs.

## CLI family

mflux installs one entry-point per model family. The script in this skill uses `mflux-generate` (the FLUX.1 entry-point). Others exist for advanced use:

| Command | Model | Use |
|---|---|---|
| `mflux-generate` | FLUX.1 schnell / dev | text-to-image (this skill) |
| `mflux-generate-kontext` | FLUX.1 Kontext | image editing / image-to-image (not wrapped yet) |
| `mflux-generate-z-image-turbo` | Z-Image Turbo | fast small-model generation |
| `mflux-generate-fill` | FLUX.1 Fill | inpainting / outpainting |
| `mflux-generate-redux` | FLUX.1 Redux | reference-guided generation |

## `mflux-generate` flags (FLUX.1)

```
mflux-generate \
  --model schnell|dev \
  --prompt "..." \
  --output path/to/file.png \
  --steps 4               # 4 for schnell, 20-50 for dev
  --width 1024 --height 1024
  --seed 42               # optional; random if omitted
  --quantize 4|8          # int4 or int8 weight quantization; lower = less RAM
  --guidance 3.5          # CFG scale; ignored by schnell (uses guidance-distilled training)
  --metadata path.json    # optional: dump generation params alongside the image
```

## Model cache

Models are downloaded to the Hugging Face cache:
```
~/.cache/huggingface/hub/models--black-forest-labs--FLUX.1-schnell/
~/.cache/huggingface/hub/models--black-forest-labs--FLUX.1-dev/
```

Approximate disk sizes (post-download):

| Model | Size | License |
|---|---|---|
| FLUX.1-schnell | ~13 GB | **Apache 2.0** (commercial OK) |
| FLUX.1-dev | ~24 GB | Non-commercial only |
| FLUX.1-Kontext | ~24 GB | Non-commercial only |

Remove a single model's cache:
```bash
rm -rf ~/.cache/huggingface/hub/models--black-forest-labs--FLUX.1-schnell
```

## Performance on Apple Silicon

- **M4 Pro / M3 Max / M2 Ultra**: `-q 8` keeps unified-memory pressure manageable (~12–16 GB peak). Expect ~15–30 s for a 1024×1024 schnell image at 4 steps.
- **M1 / M2 base (8 GB)**: use `-q 4` and stick to 512×512; otherwise mflux will swap heavily.
- Background apps with high VRAM use (other ML tools, Chrome with many tabs) will slow generation noticeably.

## When to prefer `dev` over `schnell`

Pick `schnell` unless you need:
- Higher prompt fidelity / detail (try `--steps 30 --guidance 3.5` on `dev`).
- Specific styles where dev's longer schedule helps.

Remember `dev` is non-commercial — fine for prototyping, not for shipped game assets.
