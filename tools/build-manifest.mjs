#!/usr/bin/env node
/**
 * Compbuild Textures catalog pipeline.
 *
 * Reads an unzipped Compbuild Textures resource pack, copies the assets the
 * catalog needs into site/assets/, fills in any vanilla models/textures the
 * pack references but does not ship (fetched from the misode/mcmeta mirror,
 * pinned to the pack's Minecraft version), and emits site/data/manifest.json
 * that drives the whole catalog UI.
 *
 * Usage: node tools/build-manifest.mjs /path/to/unzipped-pack
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const PACK_DIR = process.argv[2];
if (!PACK_DIR) {
  console.error('usage: node tools/build-manifest.mjs <pack-dir>');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = path.join(ROOT, 'site');
const SITE_ASSETS = path.join(SITE, 'assets', 'minecraft');
const VANILLA_CACHE = path.join(ROOT, 'tools', 'vanilla-cache');
const MC = path.join(PACK_DIR, 'assets', 'minecraft');
const MCMETA = 'https://raw.githubusercontent.com/misode/mcmeta/1.21.11-assets/assets/minecraft';

const JUNK = /(^|\/)(Thumbs\.db|\.DS_Store)$|\.psd$/;

// ---------------------------------------------------------------- helpers

async function walk(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

async function readJson(p) {
  // Some pack files have BOMs or trailing commas; be tolerant where cheap.
  let text = await fs.readFile(p, 'utf8');
  text = text.replace(/^﻿/, '');
  try { return JSON.parse(text); }
  catch (e) {
    // strip trailing commas and repair unterminated string values (both occur
    // in hand-edited pack files) and retry
    const cleaned = text
      .replace(/(:\s*"[^"\n]*?)\s*([},\]])/g, (m, a, b) => a.endsWith('"') ? m : a + '"' + b)
      .replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(cleaned); } catch { throw e; }
  }
}

function stripNs(ref) {
  return ref.startsWith('minecraft:') ? ref.slice('minecraft:'.length) : ref;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyInto(rel, from) {
  const dest = path.join(SITE_ASSETS, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(from, dest);
}

// ---------------------------------------------------------------- load pack

console.log('scanning pack …');

const modelFiles = (await walk(path.join(MC, 'models'))).filter(p => p.endsWith('.json'));
const blockstateFiles = (await walk(path.join(MC, 'blockstates'))).filter(p => p.endsWith('.json'));
const itemDefFiles = (await walk(path.join(MC, 'items'))).filter(p => p.endsWith('.json'));
const ctmFiles = (await walk(path.join(MC, 'optifine', 'ctm'))).filter(p => p.endsWith('.properties'));
const textureFiles = (await walk(path.join(MC, 'textures'))).filter(p => !JUNK.test(p));

const packModels = new Map();      // 'block/foo' -> parsed json
const badFiles = [];
for (const f of modelFiles) {
  const key = path.relative(path.join(MC, 'models'), f).replace(/\\/g, '/').replace(/\.json$/, '');
  try { packModels.set(key, await readJson(f)); }
  catch (e) { badFiles.push({ file: 'models/' + key + '.json', error: String(e.message).slice(0, 120) }); }
}

const packTextures = new Set(
  textureFiles.filter(p => p.endsWith('.png'))
    .map(p => path.relative(path.join(MC, 'textures'), p).replace(/\\/g, '/').replace(/\.png$/, ''))
);
const animatedTextures = new Set(
  textureFiles.filter(p => p.endsWith('.png.mcmeta'))
    .map(p => path.relative(path.join(MC, 'textures'), p).replace(/\\/g, '/').replace(/\.png\.mcmeta$/, ''))
);

console.log(`  ${packModels.size} models, ${packTextures.size} textures, ${blockstateFiles.length} blockstates, ${itemDefFiles.length} item defs, ${ctmFiles.length} ctm groups`);

// ------------------------------------------------- resolve refs, find gaps

const neededModels = new Set(packModels.keys());
const neededTextures = new Set();
const missingModels = new Set();

function noteTexture(ref) {
  if (!ref || ref.startsWith('#')) return;
  neededTextures.add(stripNs(ref));
}

// Seed model graph from blockstates and item defs too.
const blockstates = new Map(); // 'oak_shelf' -> parsed
for (const f of blockstateFiles) {
  const name = path.basename(f, '.json');
  try {
    const bs = await readJson(f);
    blockstates.set(name, bs);
    const refs = [];
    if (bs.variants) for (const v of Object.values(bs.variants)) {
      for (const alt of Array.isArray(v) ? v : [v]) if (alt.model) refs.push(alt.model);
    }
    if (bs.multipart) for (const part of bs.multipart) {
      const v = part.apply;
      for (const alt of Array.isArray(v) ? v : [v]) if (alt.model) refs.push(alt.model);
    }
    for (const r of refs) {
      const key = stripNs(r);
      if (!packModels.has(key)) missingModels.add(key);
      neededModels.add(key);
    }
  } catch (e) { badFiles.push({ file: 'blockstates/' + name + '.json', error: String(e.message).slice(0, 120) }); }
}

// item definitions (1.21.4+ format): walk the selector tree collecting models
const itemDefs = new Map();
function collectItemModels(node, out) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.model === 'string') out.push(node.model);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach(x => collectItemModels(x, out));
    else if (typeof v === 'object') collectItemModels(v, out);
  }
}
for (const f of itemDefFiles) {
  const name = path.basename(f, '.json');
  try {
    const def = await readJson(f);
    itemDefs.set(name, def);
    const refs = [];
    collectItemModels(def, refs);
    for (const r of refs) {
      const key = stripNs(r);
      if (!packModels.has(key)) missingModels.add(key);
      neededModels.add(key);
    }
  } catch (e) { badFiles.push({ file: 'items/' + name + '.json', error: String(e.message).slice(0, 120) }); }
}

// ------------------------------------------------- texture-only retextures
//
// The pack retextures far more blocks than it overrides blockstates for
// (oak_planks, glass, stone, …). Synthesize block entries for those by
// probing the vanilla blockstate registry (mcmeta mirror, cached) for block
// ids derived from pack texture names.

const texBlockCandidates = new Set();
{
  const suffixRe = /_(top|bottom|side\d*|front|back|end|on|off|inner|outer|lit|open|stage\d+|age\d+|flow|still|base|overlay|middle|upper|lower|head|foot|\d+)$/;
  const SKIP = new Set(['water', 'lava']); // liquid rendering is builtin; nothing to preview
  for (const t of packTextures) {
    if (!t.startsWith('block/')) continue;
    const rel = t.slice('block/'.length);
    if (rel.includes('/')) continue; // opt/, gradient/ etc. are detail sheets
    let name = rel;
    const names = new Set([name]);
    let m;
    while ((m = name.match(suffixRe))) { name = name.slice(0, -m[0].length); names.add(name); }
    for (const n of names) {
      if (n && !SKIP.has(n) && !blockstates.has(n)) texBlockCandidates.add(n);
    }
  }
}

async function fetchVanillaBlockstate(name) {
  const cache = path.join(VANILLA_CACHE, 'blockstates', name + '.json');
  const miss = cache + '.miss';
  if (await exists(cache)) return readJson(cache);
  if (await exists(miss)) return null;
  const res = await fetch(`${MCMETA}/blockstates/${name}.json`);
  await fs.mkdir(path.dirname(cache), { recursive: true });
  if (!res.ok) { await fs.writeFile(miss, ''); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(cache, buf);
  return JSON.parse(buf.toString('utf8'));
}

console.log(`probing ${texBlockCandidates.size} texture-derived block candidates …`);
const texDerivedBlocks = new Map(); // blockId -> vanilla blockstate json
{
  const queue = [...texBlockCandidates];
  const workers = Array.from({ length: 12 }, async () => {
    while (queue.length) {
      const name = queue.pop();
      const bs = await fetchVanillaBlockstate(name);
      if (bs) texDerivedBlocks.set(name, bs);
    }
  });
  await Promise.all(workers);
}
console.log(`  ${texDerivedBlocks.size} vanilla blocks matched`);

for (const bs of texDerivedBlocks.values()) {
  const refs = [];
  if (bs.variants) for (const v of Object.values(bs.variants)) {
    for (const alt of Array.isArray(v) ? v : [v]) if (alt.model) refs.push(alt.model);
  }
  if (bs.multipart) for (const part of bs.multipart) {
    const v = part.apply;
    for (const alt of Array.isArray(v) ? v : [v]) if (alt.model) refs.push(alt.model);
  }
  for (const r of refs) neededModels.add(stripNs(r));
}

// Transitively resolve parents + textures of every needed model.
const resolvedOnce = new Set();
const fetchedModels = new Map(); // vanilla models fetched from mcmeta
const unresolvable = new Set();

async function fetchVanilla(kind, key) {
  // kind: 'models' (json) | 'textures' (png). Returns local cache path or null.
  const rel = `${kind}/${key}${kind === 'models' ? '.json' : '.png'}`;
  const cache = path.join(VANILLA_CACHE, rel);
  if (await exists(cache)) return cache;
  const url = `${MCMETA}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  await fs.mkdir(path.dirname(cache), { recursive: true });
  await fs.writeFile(cache, Buffer.from(await res.arrayBuffer()));
  return cache;
}

async function getModel(key) {
  if (packModels.has(key)) return packModels.get(key);
  if (fetchedModels.has(key)) return fetchedModels.get(key);
  if (unresolvable.has(key)) return null;
  if (key.startsWith('builtin/')) return null; // handled client-side
  const cache = await fetchVanilla('models', key);
  if (!cache) { unresolvable.add(key); return null; }
  const json = await readJson(cache);
  fetchedModels.set(key, json);
  return json;
}

async function resolveModel(key) {
  if (resolvedOnce.has(key)) return;
  resolvedOnce.add(key);
  const m = await getModel(key);
  if (!m) { if (!key.startsWith('builtin/')) unresolvable.add(key); return; }
  if (m.textures) for (const t of Object.values(m.textures)) noteTexture(t);
  if (m.parent) {
    const p = stripNs(m.parent);
    neededModels.add(p);
    await resolveModel(p);
  }
}

console.log('resolving model graph (fetching vanilla fill-ins as needed) …');
for (const key of [...neededModels]) await resolveModel(key);
// resolveModel may have grown neededModels via parents
let prevSize = 0;
while (neededModels.size !== prevSize) {
  prevSize = neededModels.size;
  for (const key of [...neededModels]) await resolveModel(key);
}

// Textures: which are missing from the pack → fetch vanilla.
const missingTextures = [...neededTextures].filter(t => !packTextures.has(t));
console.log(`  ${fetchedModels.size} vanilla models fetched, ${missingTextures.length} textures to fetch, ${unresolvable.size} unresolvable`);

const fetchedTextures = new Set();
const missingTexturesFinal = [];
{
  const queue = [...missingTextures];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const t = queue.pop();
      const cache = await fetchVanilla('textures', t);
      if (cache) fetchedTextures.add(t);
      else missingTexturesFinal.push(t);
    }
  });
  await Promise.all(workers);
}
console.log(`  fetched ${fetchedTextures.size} vanilla textures; ${missingTexturesFinal.length} unresolved`);

// ---------------------------------------------------------------- CTM parse

function parseProperties(text) {
  const out = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function resolveTileRefs(tilesStr, dir) {
  // Returns array of texture paths relative to assets/minecraft (or null for <skip>/<default>)
  if (!tilesStr) return [];
  const out = [];
  for (const tok of tilesStr.split(/\s+/)) {
    if (!tok) continue;
    const range = tok.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let i = +range[1]; i <= +range[2]; i++) out.push(`optifine/ctm/${dir}/${i}.png`);
    } else if (/^\d+$/.test(tok)) {
      out.push(`optifine/ctm/${dir}/${tok}.png`);
    } else if (tok === '<skip>' || tok === '<default>') {
      out.push(null);
    } else if (tok.startsWith('assets/minecraft/')) {
      out.push(tok.slice('assets/minecraft/'.length).replace(/\.png$/, '') + '.png');
    } else {
      let t = tok.replace(/^\.\//, '').replace(/\.png$/, '');
      out.push(`optifine/ctm/${dir}/${t}.png`);
    }
  }
  return out;
}

console.log('parsing CTM …');
const ctmGroups = [];
for (const f of ctmFiles) {
  const dir = path.relative(path.join(MC, 'optifine', 'ctm'), path.dirname(f)).replace(/\\/g, '/');
  const name = path.basename(f, '.properties');
  const props = parseProperties(await fs.readFile(f, 'utf8'));
  const tiles = resolveTileRefs(props.tiles, dir);
  const matchTiles = props.matchTiles ? props.matchTiles.split(/\s+/) : (props.matchBlocks ? [] : [name]);
  const matchBlocks = props.matchBlocks ? props.matchBlocks.split(/\s+/) : [];
  ctmGroups.push({
    id: (dir ? dir + '/' : '') + name,
    dir, name,
    method: props.method || 'ctm',
    tiles,
    matchTiles, matchBlocks,
    connectBlocks: props.connectBlocks ? props.connectBlocks.split(/\s+/) : undefined,
    connectTiles: props.connectTiles ? props.connectTiles.split(/\s+/) : undefined,
    faces: props.faces, biomes: props.biomes ? props.biomes.split(/\s+/) : undefined,
    width: props.width ? +props.width : undefined,
    height: props.height ? +props.height : undefined,
    symmetry: props.symmetry, sides: props.sides,
  });
}

// Verify CTM tile files exist; copy them via the optifine/ctm subtree copy below.
const ctmMissingTiles = [];
for (const g of ctmGroups) {
  for (const t of g.tiles) {
    if (t && !(await exists(path.join(MC, t)))) ctmMissingTiles.push({ group: g.id, tile: t });
  }
}

// repeat groups whose declared pattern size disagrees with their tile count
const ctmPatternMismatch = ctmGroups
  .filter(g => g.method === 'repeat' && g.width && g.height && g.width * g.height !== g.tiles.length)
  .map(g => ({ group: g.id, width: g.width, height: g.height, tiles: g.tiles.length }));

// ------------------------------------------------------------- item renames

console.log('parsing item definitions …');

function* walkSelectors(node, pathCtx) {
  // yield {kind, when, model} entries describing leaf models with their conditions
  if (!node || typeof node !== 'object') return;
  const t = node.type ? stripNs(node.type) : null;
  if (t === 'model' && typeof node.model === 'string') {
    yield { ...pathCtx, model: stripNs(node.model) };
    return;
  }
  if (t === 'select') {
    const prop = node.property ? stripNs(node.property) : '';
    const comp = node.component ? stripNs(node.component) : '';
    for (const c of node.cases || []) {
      const whens = Array.isArray(c.when) ? c.when : [c.when];
      for (const w of whens) {
        yield* walkSelectors(c.model, { ...pathCtx, selectOn: comp || prop, when: typeof w === 'string' ? w : JSON.stringify(w) });
      }
    }
    if (node.fallback) yield* walkSelectors(node.fallback, { ...pathCtx, fallback: true });
    return;
  }
  if (t === 'condition') {
    yield* walkSelectors(node.on_true, { ...pathCtx, when: `${node.property}=true` });
    yield* walkSelectors(node.on_false, { ...pathCtx, when: `${node.property}=false` });
    return;
  }
  if (t === 'range_dispatch') {
    for (const e of node.entries || []) yield* walkSelectors(e.model, { ...pathCtx, when: `${stripNs(node.property || '')}≥${e.threshold}` });
    if (node.fallback) yield* walkSelectors(node.fallback, { ...pathCtx, fallback: true });
    return;
  }
  // constant/special/bed/etc: no model json to preview
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) { for (const x of v) yield* walkSelectors(x, pathCtx); }
    else if (v && typeof v === 'object') yield* walkSelectors(v, pathCtx);
  }
}

const renameRules = [];
for (const [item, def] of itemDefs) {
  for (const leaf of walkSelectors(def.model, {})) {
    if (leaf.selectOn === 'custom_name' && leaf.when && !leaf.fallback) {
      renameRules.push({ item, rename: leaf.when, model: leaf.model });
    }
  }
}
console.log(`  ${renameRules.length} rename rules across ${itemDefs.size} item defs`);

// -------------------------------------------------------------- categories

const BLOCK_CATEGORIES = [
  ['Coral', /coral/],
  ['Flora', /flower|tulip|orchid|daisy|rose_bush|lilac|peony|fern|(^|_)grass$|tall_grass|bush|sapling|vine|lily|moss|azalea|leaves|petals|wildflowers|dandelion|poppy|allium|azure|cornflower|torchflower|pitcher|spore|dripleaf|bamboo$|cactus|pumpkin|melon|wheat|carrot|potato|beetroot|sweet_berry|cave_vines|mushroom|fungus|roots|sprouts|nether_wart|flowerbed|leaf_litter/],
  ['Wood', /oak|spruce|birch|jungle|acacia|mangrove|cherry|crimson|warped|planks|(^|_)log|_wood|hyphae|stem$|bamboo_(block|planks|mosaic)/],
  ['Glass', /glass/],
  ['Wool & Carpet', /wool|carpet/],
  ['Concrete', /concrete/],
  ['Terracotta & Brick', /terracotta|brick|mud_/],
  ['Redstone & Utility', /redstone|piston|observer|dispenser|dropper|hopper|comparator|repeater|lever|(^|_)button|pressure_plate|rail$|rail_|target|note_block|jukebox|tnt|sculk|slime|honey/],
  ['Stone', /stone|cobble|andesite|diorite|granite|deepslate|tuff|basalt|calcite|dripstone|bedrock|smooth_|polished|obsidian/],
  ['Metal', /iron_|gold_|copper|netherite|anvil|(^|_)chain$|bars|lightning_rod/],
  ['Earth', /dirt|sand|gravel|clay|podzol|mycelium|grass_block|snow|mud$|soul_soil|farmland|path/],
  ['Ocean', /kelp|seagrass|prismarine|sea_|sponge|water|bubble/],
  ['Nether & End', /nether|soul_|shroomlight|end_|purpur|chorus|crying|magma|glowstone|quartz/],
  ['Lighting', /torch|lamp|lantern|candle|campfire|froglight/],
  ['Functional', /door|trapdoor|fence|wall$|stairs|slab|sign|shelf|barrel|chest|furnace|smoker|table|bookshelf|ladder|scaffold|composter|lectern|grindstone|stonecutter|loom|cauldron|bell|beacon|conduit|respawn|lodestone|item_frame|flower_pot|decorated_pot|bed$/],
];
function categorizeBlock(name) {
  for (const [cat, re] of BLOCK_CATEGORIES) if (re.test(name)) return cat;
  return 'Other';
}

const RENAME_CATEGORIES = [
  ['Art & Paintings', /painting|poster|canvas|movie|graffiti|mural|banner|flag/i],
  ['Seating', /chair|sofa|couch|stool|bench|seat|armchair|beanbag/i],
  ['Tables & Desks', /table|desk|counter(?!top)/i],
  ['Lighting', /lamp|light|sconce|chandelier|lantern|led|neon/i],
  ['Electronics', /tv|television|laptop|computer|phone|monitor|console|speaker|radio|screen|camera|arcade|pc\b/i],
  ['Kitchen', /kitchen|fridge|freezer|oven|sink|stove|microwave|toaster|kettle|blender|pan|pot\b|cutting board|coffee/i],
  ['Bathroom', /toilet|bath|shower|towel|basin|mirror/i],
  ['Bedroom', /bed\b|pillow|wardrobe|dresser|nightstand|closet/i],
  ['Gym & Sports', /gym|treadmill|squat|rack|weight|dumbbell|barbell|yoga|basketball|skate/i],
  ['Vehicles', /car\b|truck|bike|bicycle|motor|scooter|vehicle|boat/i],
  ['Plants & Garden', /plant|flower|bonsai|vase|planter|hedge|topiary|garden/i],
  ['Food & Drink', /food|pizza|burger|cake|drink|bottle|cup\b|plate|bowl/i],
  ['Storage', /shelf|shelving|box|crate|bin\b|basket|drawer/i],
  ['Office', /office|printer|file|whiteboard|clipboard/i],
];
function categorizeRename(rename) {
  const idx = rename.indexOf(':');
  const collection = idx > 0 && idx < 24 ? rename.slice(0, idx).trim() : null;
  const base = collection ? rename.slice(idx + 1).trim() : rename;
  for (const [cat, re] of RENAME_CATEGORIES) if (re.test(base)) return { collection, category: cat };
  return { collection, category: 'Decor & Misc' };
}

// --------------------------------------------------------------- manifest

console.log('building manifest …');

// Block entries from blockstates
const blockEntries = [];
for (const [name, bs] of blockstates) {
  const variants = [];
  if (bs.variants) {
    for (const [state, v] of Object.entries(bs.variants)) {
      const alts = Array.isArray(v) ? v : [v];
      variants.push({ state, models: alts.map(a => ({ model: stripNs(a.model || ''), x: a.x, y: a.y, weight: a.weight })) });
    }
  }
  if (bs.multipart) {
    for (const part of bs.multipart) {
      const alts = Array.isArray(part.apply) ? part.apply : [part.apply];
      variants.push({ state: part.when ? JSON.stringify(part.when) : '*', multipart: true, models: alts.map(a => ({ model: stripNs(a.model || ''), x: a.x, y: a.y })) });
    }
  }
  blockEntries.push({ id: name, category: categorizeBlock(name), variants });
}

// Synthesized entries for texture-only retextures (vanilla geometry + pack texture)
for (const [name, bs] of texDerivedBlocks) {
  const variants = [];
  if (bs.variants) {
    for (const [state, v] of Object.entries(bs.variants)) {
      const alts = Array.isArray(v) ? v : [v];
      variants.push({ state, models: alts.map(a => ({ model: stripNs(a.model || ''), x: a.x, y: a.y, weight: a.weight })) });
    }
  }
  if (bs.multipart) {
    for (const part of bs.multipart) {
      const alts = Array.isArray(part.apply) ? part.apply : [part.apply];
      variants.push({ state: part.when ? JSON.stringify(part.when) : '*', multipart: true, models: alts.map(a => ({ model: stripNs(a.model || ''), x: a.x, y: a.y })) });
    }
  }
  if (variants.length) {
    blockEntries.push({ id: name, category: categorizeBlock(name), variants, retexture: true });
  }
}
blockEntries.sort((a, b) => a.id.localeCompare(b.id));

// Models whose faces reference texture variables that never resolve
// (Blockbench "#missing" artifacts and models with no textures object).
const modelsWithMissingTextures = [];
function flatTextures(key, guard = 0) {
  const m = packModels.get(key) || fetchedModels.get(key);
  if (!m || guard > 24) return {};
  const parent = m.parent && !stripNs(m.parent).startsWith('builtin/')
    ? flatTextures(stripNs(m.parent), guard + 1) : {};
  return { ...parent, ...(m.textures || {}) };
}
for (const [key, m] of packModels) {
  if (!m.elements) continue;
  const tex = flatTextures(key);
  const bad = new Set();
  for (const el of m.elements) {
    for (const face of Object.values(el.faces || {})) {
      let ref = face.texture, hops = 0;
      while (typeof ref === 'string' && ref.startsWith('#') && hops++ < 16) ref = tex[ref.slice(1)];
      if (typeof ref !== 'string' || ref.startsWith('#')) bad.add(face.texture);
    }
  }
  if (bad.size) modelsWithMissingTextures.push({ model: key, refs: [...bad] });
}

// Model index: every model in the pack, tagged with source folder + stats
const modelIndex = [];
for (const [key, m] of packModels) {
  let cur = m, elements = 0, guard = 0;
  const texSet = new Set();
  let node = m;
  // count own elements only (resolution happens client-side); textures from own decl
  if (m.elements) elements = m.elements.length;
  if (m.textures) for (const t of Object.values(m.textures)) if (!t.startsWith('#')) texSet.add(stripNs(t));
  modelIndex.push({
    id: key,
    folder: key.split('/').slice(0, -1).join('/'),
    elements,
    parent: m.parent ? stripNs(m.parent) : undefined,
    textures: [...texSet],
  });
}

// Rename entries with categories/collections
const renames = renameRules.map(r => {
  const { collection, category } = categorizeRename(r.rename);
  return { ...r, collection: collection || undefined, category };
});

// Texture gallery: block + item textures with animation flag
const gallery = [...packTextures]
  .filter(t => t.startsWith('block/') || t.startsWith('item/'))
  .sort()
  .map(t => ({ path: t, animated: animatedTextures.has(t) || undefined }));

// Cross-reference: texture -> ctm groups that match it
const ctmByTile = {};
for (const g of ctmGroups) {
  for (const mt of g.matchTiles) {
    const key = mt.replace(/\.png$/, '');
    (ctmByTile[key] ??= []).push(g.id);
  }
}

const manifest = {
  generated: 'v10',
  mcVersion: '1.21.11',
  counts: {
    models: packModels.size,
    blocks: blockEntries.length,
    renames: renames.length,
    ctmGroups: ctmGroups.length,
    textures: gallery.length,
  },
  blocks: blockEntries,
  models: modelIndex,
  renames,
  ctm: ctmGroups,
  ctmByTile,
  textures: gallery,
  animated: [...animatedTextures],
  issues: {
    badFiles,
    unresolvableModels: [...unresolvable],
    missingTextures: missingTexturesFinal,
    ctmMissingTiles,
    ctmPatternMismatch,
    modelsWithMissingTextures,
  },
};

// ------------------------------------------------------------- copy assets

console.log('copying site assets …');
await fs.rm(path.join(SITE, 'assets'), { recursive: true, force: true });

let copied = 0;
// 1. pack models/blockstates/items wholesale
for (const f of modelFiles) { await copyInto('models/' + path.relative(path.join(MC, 'models'), f).replace(/\\/g, '/'), f); copied++; }
for (const f of blockstateFiles) { await copyInto('blockstates/' + path.basename(f), f); copied++; }
for (const f of itemDefFiles) { await copyInto('items/' + path.basename(f), f); copied++; }
// 2. pack textures: block/, item/, plus any other texture referenced by models; and their mcmeta
const wantedTexPrefix = t => t.startsWith('block/') || t.startsWith('item/') || neededTextures.has(t);
for (const f of textureFiles) {
  const rel = path.relative(path.join(MC, 'textures'), f).replace(/\\/g, '/');
  const base = rel.replace(/\.png(\.mcmeta)?$/, '');
  if (!rel.match(/\.png(\.mcmeta)?$/)) continue;
  if (wantedTexPrefix(base)) { await copyInto('textures/' + rel, f); copied++; }
}
// 3. optifine/ctm subtree (tiles + properties; excludes junk)
for (const f of await walk(path.join(MC, 'optifine', 'ctm'))) {
  if (JUNK.test(f)) continue;
  const rel = path.relative(path.join(MC, 'optifine'), f).replace(/\\/g, '/');
  await copyInto('optifine/' + rel, f); copied++;
}
// 4. vanilla fill-ins (models + textures) from cache
for (const key of fetchedModels.keys()) {
  await copyInto('models/' + key + '.json', path.join(VANILLA_CACHE, 'models', key + '.json')); copied++;
}
for (const t of fetchedTextures) {
  await copyInto('textures/' + t + '.png', path.join(VANILLA_CACHE, 'textures', t + '.png')); copied++;
}
// 5. pack icon
if (await exists(path.join(PACK_DIR, 'pack.png'))) {
  await fs.copyFile(path.join(PACK_DIR, 'pack.png'), path.join(SITE, 'pack.png'));
}

await fs.mkdir(path.join(SITE, 'data'), { recursive: true });
await fs.writeFile(path.join(SITE, 'data', 'manifest.json'), JSON.stringify(manifest));
console.log(`done: ${copied} files copied, manifest ${((await fs.stat(path.join(SITE, 'data', 'manifest.json'))).size / 1024 / 1024).toFixed(2)} MB`);
console.log('issues:', JSON.stringify({
  badFiles: badFiles.length,
  unresolvableModels: manifest.issues.unresolvableModels.length,
  missingTextures: missingTexturesFinal.length,
  ctmMissingTiles: ctmMissingTiles.length,
}));
