# public/assets/

Drop game art, audio, and 3D files here. Files in `public/` are served at the root, e.g. `public/assets/hero.png` → `/assets/hero.png`.

Typical layout for a game:

```
public/assets/
  sprites/      # 2D art, PNG/WebP, ideally packed into atlases
  models/       # GLB / GLTF (run gltf-transform first)
  textures/     # standalone PBR maps
  audio/        # ogg / mp3
  fonts/        # subsetted woff2
```

Use the `asset-pipeline` agent to compress assets before committing.
