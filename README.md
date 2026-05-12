# Web Game Boilerplate — Three.js + PixiJS + Claude Code

Clone-and-go starter for building web games with Claude Code as a pair programmer. Ships with a Vite + TypeScript scaffold, working hello-world scenes for **Three.js** (3D) and **PixiJS** (2D), and a fully wired `.claude/` directory: 37 library skills + 4 specialized game-dev agents.

## Quickstart

```bash
npm install
npm run dev      # → http://localhost:5173/
```

Switch engine via URL:

- `/` or `/?engine=three` → rotating 3D cube (Three.js)
- `/?engine=pixi` → spinning bunny sprite (PixiJS)

## Layout

```
.claude/
  skills/     # 10 threejs-*, 25 pixijs-*, visual-feedback-loop, blender-mcp
  agents/     # game-architect, shader-author, perf-profiler, asset-pipeline
  settings.json
src/
  main.ts          # engine switch
  scenes/
    threeScene.ts
    pixiScene.ts
  style.css
public/
  assets/          # drop sprites, GLBs, audio, fonts here
index.html
CLAUDE.md          # behavioral guidelines + project-context block
```

## Agents

| Agent | When to invoke |
|---|---|
| `game-architect` | New game, refactoring main loop, multi-scene flow, save system |
| `shader-author` | Custom GLSL / WGSL for `ShaderMaterial` or `Filter.from()` |
| `perf-profiler` | Frame drops, high draw calls, memory growth |
| `asset-pipeline` | Shrinking GLBs, packing spritesheets, Blender → web workflow |

## Skills

All library skills auto-load when context matches. Examples of triggers:

- "Set up a basic 3D scene" → `threejs-fundamentals`
- "Load a GLTF with Draco" → `threejs-loaders` + `asset-pipeline` agent
- "Add a glow filter to my sprite" → `pixijs-filters`
- "Optimize sprite count above 1000" → `pixijs-scene-particle-container` + `pixijs-performance`
- "Screenshot the canvas to debug" → `visual-feedback-loop`
- "Export this from Blender to web" → `blender-mcp`

Full list: `ls .claude/skills`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check then production build into `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run typecheck` | `tsc --noEmit` only |

## Library selection rule (also in CLAUDE.md)

2D / sprite / canvas / UI → **PixiJS v8**. 3D / WebGL / WebGPU mesh work → **Three.js**. For HUD over a 3D scene, prefer HTML/CSS or a second canvas layer rather than mixing renderers in one context.

## License

MIT (skills retain their upstream licenses — see each `SKILL.md`).
