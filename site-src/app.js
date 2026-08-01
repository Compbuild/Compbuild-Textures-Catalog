import { ModelRepo } from './mcmodel.js';
import { Viewer } from './viewer.js';
import { renderCtmDemo, methodDescription } from './ctm.js';

const ASSETS = 'assets/minecraft';

let M = null;            // manifest
let repo = null;         // ModelRepo
let viewer = null;       // singleton Viewer bound to whichever detail canvas is live
const $ = sel => document.querySelector(sel);

// ------------------------------------------------------------------ helpers

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function texUrl(path) { return `${ASSETS}/textures/${path}.png`; }

const modelById = new Map();
function modelThumb(modelId, fallbackBase) {
  // Vanilla models referenced by retexture blocks aren't in the pack model
  // index, so fall back to conventional texture names for the block id.
  const m = modelById.get(modelId);
  const candidates = [];
  if (m && m.textures && m.textures[0]) candidates.push(m.textures[0]);
  if (fallbackBase) {
    candidates.push(fallbackBase, fallbackBase + '_top', fallbackBase + '_side', fallbackBase + '_front');
  }
  const img = h('img', { class: 'thumb', loading: 'lazy', alt: modelId });
  let i = 0;
  const next = () => { img.src = i < candidates.length ? texUrl(candidates[i++]) : 'placeholder.png'; };
  img.onerror = () => { if (img.src.endsWith('placeholder.png')) return; next(); };
  next();
  return img;
}

function badge(text, cls = '') { return h('span', { class: 'badge ' + cls }, text); }

function titleCase(s) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function ensureViewer(canvas) {
  if (viewer) viewer.dispose();
  viewer = new Viewer(canvas);
  return viewer;
}

async function show3D(canvas, modelId, opts = {}) {
  const v = ensureViewer(canvas);
  try {
    const mesh = await repo.buildMesh(modelId, opts);
    v.show(mesh);
  } catch (e) {
    console.error('render failed', modelId, e);
    canvas.parentElement.append(h('p', { class: 'err' }, `Could not render ${modelId}`));
  }
}

// ------------------------------------------------------------------- router

const routes = [];
function route(re, fn) { routes.push([re, fn]); }

function navigate() {
  const hash = location.hash.slice(1) || '/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      if (viewer) { viewer.dispose(); viewer = null; }
      const view = $('#view');
      view.innerHTML = '';
      const seg = hash.split('/')[1] || '';
      const section = { block: 'blocks', item: 'items', model: 'models', texture: 'textures' }[seg] || seg;
      document.querySelectorAll('nav a').forEach(a =>
        a.classList.toggle('active', a.getAttribute('href') === '#/' + section));
      fn(view, ...m.slice(1).map(decodeURIComponent));
      window.scrollTo(0, 0);
      return;
    }
  }
}

// -------------------------------------------------------------------- views

function viewHome(view) {
  const c = M.counts;
  view.append(
    h('section', { class: 'hero' },
      h('img', { src: 'pack.png', class: 'packicon', alt: 'Compbuild Textures' }),
      h('div', {},
        h('h1', {}, 'Compbuild Textures Catalog'),
        h('p', {}, `Every model, connected texture, and custom item in Compbuild Textures v10 — Minecraft ${M.mcVersion}.`),
        h('div', { class: 'stats' },
          statTile(c.models, 'models', '#/models'),
          statTile(c.blocks, 'blocks', '#/blocks'),
          statTile(c.renames, 'custom items', '#/items'),
          statTile(c.ctmGroups, 'CTM groups', '#/ctm'),
          statTile(c.textures, 'textures', '#/textures'),
        ))),
    h('section', {},
      h('h2', {}, 'Browse'),
      h('div', { class: 'grid tiles' },
        navTile('#/blocks', 'Blocks', 'Every block the pack retextures or remodels, organized by material'),
        navTile('#/items', 'Custom Items', 'Furniture and decor you place by renaming items on an anvil'),
        navTile('#/ctm', 'Connected Textures', 'Glass, walls and floors that join into seamless surfaces'),
        navTile('#/models', 'All Models', 'Browse the raw JSON models in 3D'),
        navTile('#/textures', 'Textures', 'The full texture gallery'),
        navTile('#/health', 'Pack Health', 'Dangling references and issues found while indexing'),
      )));
}
function statTile(n, label, href) {
  return h('a', { class: 'stat', href }, h('b', {}, String(n)), h('span', {}, label));
}
function navTile(href, title, desc) {
  return h('a', { class: 'card navtile', href }, h('h3', {}, title), h('p', {}, desc));
}

// ---- blocks

function viewBlocks(view, filterCat) {
  const cats = [...new Set(M.blocks.map(b => b.category))].sort();
  view.append(h('h1', {}, 'Blocks'), chipRow(cats, filterCat, c => `#/blocks${c ? '/cat/' + encodeURIComponent(c) : ''}`));
  const list = M.blocks.filter(b => !filterCat || b.category === filterCat)
    .sort((a, b) => a.id.localeCompare(b.id));
  view.append(h('div', { class: 'grid' }, list.map(b => {
    const model = b.variants[0] && b.variants[0].models[0] && b.variants[0].models[0].model;
    return h('a', { class: 'card', href: `#/block/${encodeURIComponent(b.id)}` },
      model ? modelThumb(model, 'block/' + b.id) : h('div', { class: 'thumb' }),
      h('h3', {}, titleCase(b.id)),
      h('p', {}, badge(b.category), b.retexture ? badge('retexture', 'dim') : null,
        b.variants.length > 1 ? badge(`${b.variants.length} variants`, 'dim') : null));
  })));
}

function chipRow(cats, active, hrefFor) {
  // entries are strings or {value, label}
  return h('div', { class: 'chips' },
    h('a', { class: 'chip' + (!active ? ' active' : ''), href: hrefFor('') }, 'All'),
    cats.map(c => {
      const value = typeof c === 'string' ? c : c.value;
      const label = typeof c === 'string' ? c : c.label;
      return h('a', { class: 'chip' + (value === active ? ' active' : ''), href: hrefFor(value) }, label);
    }));
}

function viewBlock(view, id) {
  const b = M.blocks.find(x => x.id === id);
  if (!b) { view.append('Unknown block: ' + id); return; }
  view.append(h('a', { href: '#/blocks', class: 'crumb' }, '← Blocks'),
    h('h1', {}, titleCase(b.id)),
    h('p', {}, badge(b.category), b.retexture ? badge('retexture — vanilla model, Compbuild textures', 'dim') : null));

  const canvasWrap = h('div', { class: 'viewerbox' }, h('canvas', {}));
  view.append(canvasWrap);

  const variants = b.variants.flatMap(v => v.models.map(mm => ({ state: v.state, ...mm })));
  if (variants.length > 1) {
    const sel = h('select', {
      onchange: e => {
        const v = variants[e.target.value];
        show3D(canvasWrap.querySelector('canvas'), v.model, { x: v.x, y: v.y });
      }
    }, variants.map((v, i) => h('option', { value: i }, `${v.state || 'default'} → ${v.model}`)));
    view.append(h('div', { class: 'row' }, 'Variant: ', sel));
  }
  const first = variants[0];
  if (first) show3D(canvasWrap.querySelector('canvas'), first.model, { x: first.x, y: first.y });

  // related CTM groups (by texture)
  const model = modelById.get(first && first.model);
  const rel = new Set();
  if (model) for (const t of model.textures || []) {
    const key = t.replace(/^block\//, '');
    for (const gid of (M.ctmByTile[key] || [])) rel.add(gid);
    for (const gid of (M.ctmByTile[t] || [])) rel.add(gid);
  }
  for (const g of M.ctm) {
    if ((g.matchBlocks || []).some(mb => mb.replace('minecraft:', '') === b.id)) rel.add(g.id);
  }
  if (rel.size) {
    view.append(h('h2', {}, 'Connected textures'),
      h('div', { class: 'grid' }, [...rel].slice(0, 24).map(gid => ctmCard(M.ctm.find(g => g.id === gid)))));
  }
}

// ---- models

function viewModels(view, folder) {
  const folders = [...new Set(M.models.map(m => m.folder))].sort();
  view.append(h('h1', {}, 'Models'));
  const sel = h('select', { onchange: e => location.hash = `#/models${e.target.value ? '/folder/' + encodeURIComponent(e.target.value) : ''}` },
    h('option', { value: '' }, 'All folders'),
    folders.map(f => h('option', { value: f, selected: f === folder ? '' : undefined }, f || '(root)')));
  view.append(h('div', { class: 'row' }, 'Folder: ', sel, h('span', { class: 'dim' }, ` ${M.models.length} models total`)));
  const list = M.models.filter(m => folder === undefined || m.folder === folder).slice(0, 500);
  view.append(h('div', { class: 'grid' }, list.map(m =>
    h('a', { class: 'card', href: `#/model/${encodeURIComponent(m.id)}` },
      modelThumb(m.id),
      h('h3', {}, m.id.split('/').pop()),
      h('p', {}, badge(`${m.elements} elem`, 'dim'), m.parent ? badge(m.parent.split('/').pop(), 'dim') : null)))));
  if (M.models.length > 500 && folder === undefined) {
    view.append(h('p', { class: 'dim' }, 'Showing first 500 — pick a folder to narrow down.'));
  }
}

function viewModel(view, id) {
  const m = modelById.get(id);
  view.append(h('a', { href: '#/models', class: 'crumb' }, '← Models'), h('h1', {}, id));
  const canvasWrap = h('div', { class: 'viewerbox' }, h('canvas', {}));
  view.append(canvasWrap);
  show3D(canvasWrap.querySelector('canvas'), id);
  if (m) {
    view.append(h('p', {},
      m.parent ? badge('parent: ' + m.parent, 'dim') : null,
      badge(`${m.elements} elements`, 'dim')));
    if (m.textures.length) {
      view.append(h('h2', {}, 'Textures'), h('div', { class: 'texrow' },
        m.textures.map(t => h('a', { href: `#/textures/${encodeURIComponent(t)}`, class: 'texchip' },
          h('img', { src: texUrl(t), loading: 'lazy' }), t))));
    }
  }
}

// ---- custom items (renames)

function viewItems(view, filter) {
  const collections = [...new Set(M.renames.map(r => r.collection).filter(Boolean))].sort();
  const cats = [...new Set(M.renames.map(r => r.category))].sort();
  view.append(h('h1', {}, 'Custom Items'),
    h('p', { class: 'lead' }, 'Rename the listed item on an anvil to get the model — no mods needed beyond the pack itself.'));
  view.append(chipRow([...collections.map(c => ({ value: 'c:' + c, label: c })), ...cats], filter,
    c => `#/items${c ? '/f/' + encodeURIComponent(c) : ''}`));
  let list = M.renames;
  if (filter) {
    list = filter.startsWith('c:')
      ? list.filter(r => r.collection === filter.slice(2))
      : list.filter(r => r.category === filter);
  }
  view.append(h('div', { class: 'grid' }, list.sort((a, b) => a.rename.localeCompare(b.rename)).map(r =>
    h('a', { class: 'card', href: `#/item/${encodeURIComponent(r.item)}/${encodeURIComponent(r.rename)}` },
      modelThumb(r.model),
      h('h3', {}, r.rename),
      h('p', {}, badge(titleCase(r.item), 'dim'), badge(r.category))))));
}

function viewItem(view, item, rename) {
  const r = M.renames.find(x => x.item === item && x.rename === rename);
  if (!r) { view.append('Unknown item'); return; }
  view.append(h('a', { href: '#/items', class: 'crumb' }, '← Custom Items'),
    h('h1', {}, r.rename),
    h('p', {}, badge(r.category), r.collection ? badge(r.collection) : null));
  const canvasWrap = h('div', { class: 'viewerbox' }, h('canvas', {}));
  view.append(canvasWrap);
  show3D(canvasWrap.querySelector('canvas'), r.model);
  view.append(h('div', { class: 'howto' },
    h('h2', {}, 'How to get it'),
    h('ol', {},
      h('li', {}, 'Put a ', h('b', {}, titleCase(r.item)), ' in an anvil'),
      h('li', {}, 'Rename it to ', h('code', {}, r.rename), ' (exact spelling)'),
      h('li', {}, 'Place or hold it — it becomes this model'))),
    h('p', { class: 'dim' }, 'Model: ' + r.model));
}

// ---- CTM

function ctmCard(g) {
  if (!g) return null;
  const first = g.tiles.find(Boolean);
  const img = h('img', { class: 'thumb', loading: 'lazy' });
  if (first) { img.src = `${ASSETS}/${first}`; img.onerror = () => img.remove(); }
  return h('a', { class: 'card', href: `#/ctm/${encodeURIComponent(g.id)}` },
    img,
    h('h3', {}, g.name),
    h('p', {}, badge(g.method), g.biomes ? badge('biome', 'dim') : null, h('span', { class: 'dim path' }, g.dir)));
}

function viewCtmList(view, filterMethod) {
  const methods = [...new Set(M.ctm.map(g => g.method))].sort();
  view.append(h('h1', {}, 'Connected & Contextual Textures'),
    h('p', { class: 'lead' }, 'OptiFine/Continuity CTM: textures that change based on neighboring blocks, biome, or position.'));
  view.append(chipRow(methods, filterMethod, c => `#/ctm${c ? '/method/' + encodeURIComponent(c) : ''}`));
  const list = M.ctm.filter(g => !filterMethod || g.method === filterMethod);
  view.append(h('div', { class: 'grid' }, list.map(ctmCard)));
}

function viewCtm(view, id) {
  const g = M.ctm.find(x => x.id === id);
  if (!g) { view.append('Unknown CTM group'); return; }
  view.append(h('a', { href: '#/ctm', class: 'crumb' }, '← CTM'),
    h('h1', {}, g.name), h('p', {}, badge(g.method), h('span', { class: 'dim' }, ' ' + methodDescription(g.method))));

  const demo = h('canvas', { class: 'ctmdemo' });
  view.append(h('div', { class: 'demobox' }, demo));
  renderCtmDemo(demo, g, ASSETS);

  const meta = [];
  if (g.matchBlocks && g.matchBlocks.length) meta.push(['Matches blocks', g.matchBlocks.join(', ')]);
  if (g.matchTiles && g.matchTiles.length) meta.push(['Matches textures', g.matchTiles.join(', ')]);
  if (g.biomes) meta.push(['Biomes', g.biomes.join(', ')]);
  if (g.faces) meta.push(['Faces', g.faces]);
  if (g.width) meta.push(['Pattern', `${g.width}×${g.height}`]);
  view.append(h('dl', { class: 'meta' }, meta.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));

  view.append(h('h2', {}, `Tiles (${g.tiles.filter(Boolean).length})`),
    h('div', { class: 'texrow' }, g.tiles.filter(Boolean).slice(0, 64).map(t =>
      h('img', { src: `${ASSETS}/${t}`, class: 'tile', loading: 'lazy' }))));
}

// ---- textures

function viewTextures(view, focus) {
  view.append(h('h1', {}, 'Textures'));
  const input = h('input', { class: 'search', placeholder: 'Filter textures…', value: focus || '' });
  const grid = h('div', { class: 'grid texgrid' });
  const render = () => {
    const q = input.value.toLowerCase();
    grid.innerHTML = '';
    const list = M.textures.filter(t => t.path.includes(q)).slice(0, 400);
    grid.append(...list.map(t => h('figure', { class: 'texcard' },
      h('img', { src: texUrl(t.path), loading: 'lazy' }),
      h('figcaption', {}, t.path.split('/').pop(), t.animated ? badge('animated') : null))));
  };
  input.addEventListener('input', render);
  view.append(input, grid);
  render();
}

// ---- health

function viewHealth(view) {
  const i = M.issues;
  view.append(h('h1', {}, 'Pack Health'),
    h('p', { class: 'lead' }, 'References that point at files missing from the pack — candidates for fixing in the next release.'));
  const section = (title, items, fmt) => items.length ? [h('h2', {}, `${title} (${items.length})`),
    h('ul', { class: 'issues' }, items.map(x => h('li', {}, fmt(x))))] : [];
  view.append(
    ...section('Malformed JSON files', i.badFiles, x => [h('code', {}, x.file), ' — ' + x.error]),
    ...section('Models referenced but missing', i.unresolvableModels, x => h('code', {}, x)),
    ...section('Textures referenced but missing', i.missingTextures, x => h('code', {}, x)),
    ...section('CTM tiles referenced but missing', i.ctmMissingTiles, x => [h('code', {}, x.tile), ' in ', h('code', {}, x.group)]),
    ...section('CTM repeat patterns with mismatched tile counts', i.ctmPatternMismatch || [], x =>
      [h('code', {}, x.group), ` — declares ${x.width}×${x.height} but lists ${x.tiles} tiles`]),
    ...section('Models with unresolved texture variables', i.modelsWithMissingTextures || [], x =>
      [h('code', {}, x.model), ' — ', h('code', {}, x.refs.join(', '))]),
  );
  if (Object.values(i).every(list => !list.length)) {
    view.append(h('p', {}, 'No issues found 🎉'));
  }
}

// ---- search

function viewSearch(view, q) {
  q = (q || '').toLowerCase();
  view.append(h('h1', {}, `Search: ${q}`));
  const hits = [];
  for (const b of M.blocks) if (b.id.includes(q)) {
    const model = b.variants[0] && b.variants[0].models[0] && b.variants[0].models[0].model;
    hits.push(h('a', { class: 'card', href: `#/block/${b.id}` }, model ? modelThumb(model, 'block/' + b.id) : null, h('h3', {}, titleCase(b.id)), h('p', {}, badge('block'))));
  }
  for (const r of M.renames) if (r.rename.toLowerCase().includes(q)) hits.push(h('a', { class: 'card', href: `#/item/${encodeURIComponent(r.item)}/${encodeURIComponent(r.rename)}` }, modelThumb(r.model), h('h3', {}, r.rename), h('p', {}, badge('item'))));
  for (const m of M.models) if (m.id.includes(q)) hits.push(h('a', { class: 'card', href: `#/model/${encodeURIComponent(m.id)}` }, modelThumb(m.id), h('h3', {}, m.id), h('p', {}, badge('model', 'dim'))));
  for (const g of M.ctm) if (g.id.includes(q)) hits.push(ctmCard(g));
  view.append(h('p', { class: 'dim' }, `${hits.length} results`), h('div', { class: 'grid' }, hits.slice(0, 200)));
}

// -------------------------------------------------------------------- boot

route(/^\/$/, viewHome);
route(/^\/blocks$/, viewBlocks);
route(/^\/blocks\/cat\/(.+)$/, (v, c) => viewBlocks(v, c));
route(/^\/block\/(.+)$/, viewBlock);
route(/^\/models$/, viewModels);
route(/^\/models\/folder\/(.*)$/, (v, f) => viewModels(v, f));
route(/^\/model\/(.+)$/, viewModel);
route(/^\/items$/, viewItems);
route(/^\/items\/f\/(.+)$/, (v, f) => viewItems(v, f));
route(/^\/item\/([^/]+)\/(.+)$/, viewItem);
route(/^\/ctm$/, viewCtmList);
route(/^\/ctm\/method\/([^/]+)$/, (v, m) => viewCtmList(v, m));
route(/^\/ctm\/(.+)$/, viewCtm);
route(/^\/textures$/, viewTextures);
route(/^\/textures\/(.+)$/, (v, t) => viewTextures(v, t));
route(/^\/health$/, viewHealth);
route(/^\/search\/(.*)$/, viewSearch);

async function boot() {
  const res = await fetch('data/manifest.json');
  M = await res.json();
  for (const m of M.models) modelById.set(m.id, m);
  repo = new ModelRepo(ASSETS, new Set(M.animated));
  $('#globalsearch').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      location.hash = '#/search/' + encodeURIComponent(e.target.value.trim());
    }
  });
  window.addEventListener('hashchange', navigate);
  navigate();
}
boot();
