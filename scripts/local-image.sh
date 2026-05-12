#!/usr/bin/env bash
set -euo pipefail

# Wrapper around mflux-generate (https://github.com/filipstrand/mflux).
# Runs FLUX.1 locally on Apple Silicon. No keys, no quota.
#
# Usage: scripts/local-image.sh "<prompt>" [--out path] [--model schnell|dev]
#                                          [--steps N] [--seed N]
#                                          [--width N] [--height N] [--quant 4|8]

DEFAULT_OUT_DIR="public/assets/generated"
MODEL="schnell"
STEPS="4"
WIDTH="1024"
HEIGHT="1024"
QUANT="8"
SEED=""
OUT=""
PROMPT=""

usage() {
  sed -n '3,8p' "$0" >&2
  exit 64
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)    OUT="$2";    shift 2 ;;
    --model)  MODEL="$2";  shift 2 ;;
    --steps)  STEPS="$2";  shift 2 ;;
    --seed)   SEED="$2";   shift 2 ;;
    --width)  WIDTH="$2";  shift 2 ;;
    --height) HEIGHT="$2"; shift 2 ;;
    --quant)  QUANT="$2";  shift 2 ;;
    -h|--help) usage ;;
    --*)      echo "Unknown flag: $1" >&2; exit 64 ;;
    *)
      if [[ -z "$PROMPT" ]]; then PROMPT="$1"
      else PROMPT="$PROMPT $1"
      fi
      shift ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Missing prompt. Usage: scripts/local-image.sh \"<prompt>\" [flags]" >&2
  exit 64
fi

if ! command -v mflux-generate >/dev/null 2>&1; then
  echo "mflux not installed. Run: uv tool install --upgrade mflux --with hf_transfer" >&2
  exit 1
fi

if [[ -z "$OUT" ]]; then
  ts="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  OUT="${DEFAULT_OUT_DIR}/local-${ts}.png"
fi
mkdir -p "$(dirname "$OUT")"

args=(
  --model "$MODEL"
  --prompt "$PROMPT"
  --output "$OUT"
  --steps "$STEPS"
  --width "$WIDTH"
  --height "$HEIGHT"
  --quantize "$QUANT"
)
[[ -n "$SEED" ]] && args+=(--seed "$SEED")

mflux-generate "${args[@]}" >&2

echo "$OUT"
