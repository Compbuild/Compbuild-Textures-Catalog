# Compbuild Textures Catalog

An online catalog of everything inside the [Compbuild Textures](https://github.com/Compbuild/Compbuild-Textures)
resource pack — browsable 3D model previews, connected-texture (CTM) demos, the full
custom-item (rename) list, and a texture gallery, organized by block material.

Built from **Compbuild Textures v10** (Minecraft 1.21.11).

## What's inside

- **Blocks** — every block the pack retextures or remodels, grouped by material
  (Wood, Stone, Metal, Flora, Coral, …), with live rotatable 3D previews of each
  blockstate variant.
- **Custom Items** — the pack's 400+ rename-based items (the modern replacement for
  OptiFine CIT): rename a specific item on an anvil and it becomes furniture, decor,
  paintings, electronics, and more. Grouped by collection and category, each with a
  3D preview and usage instructions.
- **CTM** — all 357 OptiFine/Continuity connected-texture groups with live connection
  demos: full 47-tile CTM, compact CTM, horizontal/vertical, repeat patterns, and
  biome-dependent random tiles.
- **Models** — the raw JSON model browser (1,700+ models) rendered in 3D.
- **Textures** — searchable gallery of all block/item textures, with animation badges.
- **Pack Health** — dangling references found while indexing (useful for pack QA).

## How it works

Everything is static — no backend. A build script parses the resource pack and emits a
manifest plus a trimmed asset tree; the site renders Minecraft JSON models in the
browser with three.js (parent-chain resolution, element rotations, per-face UVs,
Minecraft-style directional shading) and draws CTM connection demos on canvas using
the same tile-selection logic OptiFine uses.

### Rebuilding from a new pack release

```bash
npm install
# unzip the pack release, then:
node tools/build-manifest.mjs /path/to/unzipped-pack
npx esbuild site-src/app.js --bundle --format=iife --minify --outfile=site/js/app.js
```

Vanilla models/textures the pack references but doesn't ship are fetched from the
[misode/mcmeta](https://github.com/misode/mcmeta) mirror (pinned to the pack's
Minecraft version) and cached in `tools/vanilla-cache/`.

### Local preview

```bash
cd site && python3 -m http.server 8930
# open http://localhost:8930
```

Deployed automatically to GitHub Pages from `main` via Actions.

## License

Catalog code: MIT. Pack textures and models © Compbuild, licensed
[CC BY-NC-ND 4.0](https://github.com/Compbuild/Compbuild-Textures/blob/master/LICENSE.md);
they are included here for preview purposes as part of the official Compbuild project.
