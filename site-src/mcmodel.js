// Minecraft JSON model resolution + three.js geometry building.
import * as THREE from 'three';

const FACE_DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];

// Minecraft-style directional shading baked into vertex colors.
const SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, west: 0.6, east: 0.6 };

const TINTS = { foliage: 0x77ab2f, grass: 0x7cbd6b, water: 0x3f76e4 };

export class ModelRepo {
  constructor(assetBase, animatedSet) {
    this.base = assetBase; // e.g. 'assets/minecraft'
    this.animated = animatedSet || new Set();
    this.modelCache = new Map();
    this.textureCache = new Map();
    this.animators = []; // live animated textures, advanced by tick()
    this.loader = new THREE.TextureLoader();
  }

  // Advance animated textures; called once per rendered frame with ms elapsed.
  tick(dt) {
    for (const a of this.animators) {
      a.acc += dt;
      const frameMs = (a.frames[a.i]?.time ?? a.frametime) * 50; // ticks → ms
      if (a.acc < frameMs) continue;
      a.acc = 0;
      a.i = (a.i + 1) % a.frames.length;
      const idx = a.frames[a.i].index;
      a.ctx.clearRect(0, 0, a.w, a.w);
      a.ctx.drawImage(a.img, 0, idx * a.w, a.w, a.w, 0, 0, a.w, a.w);
      a.texture.needsUpdate = true;
    }
  }

  stripNs(ref) { return ref.startsWith('minecraft:') ? ref.slice(10) : ref; }

  async fetchModel(id) {
    id = this.stripNs(id);
    if (this.modelCache.has(id)) return this.modelCache.get(id);
    const p = (async () => {
      const res = await fetch(`${this.base}/models/${id}.json`);
      if (!res.ok) return null;
      return res.json();
    })();
    this.modelCache.set(id, p);
    return p;
  }

  // Resolve parent chain into a flat {elements, textures, display}
  async resolve(id) {
    const chain = [];
    let cur = this.stripNs(id);
    let guard = 0;
    while (cur && guard++ < 24) {
      if (cur.startsWith('builtin/')) { chain.push({ builtin: cur }); break; }
      const m = await this.fetchModel(cur);
      if (!m) break;
      chain.push(m);
      cur = m.parent ? this.stripNs(m.parent) : null;
    }
    const out = { textures: {}, elements: null, builtin: null, guiLight: null };
    for (let i = chain.length - 1; i >= 0; i--) {
      const m = chain[i];
      if (m.builtin) out.builtin = m.builtin;
      if (m.textures) Object.assign(out.textures, m.textures);
      if (m.elements) out.elements = m.elements; // child overrides
      if (m.gui_light) out.guiLight = m.gui_light;
    }
    // Some packs use layered sprites with no elements: treat layer0 as sprite
    if (!out.elements && (out.textures.layer0 || out.builtin === 'builtin/generated')) {
      out.builtin = 'builtin/generated';
    }
    return out;
  }

  resolveTextureVar(textures, ref, guard = 0) {
    if (!ref || guard > 16) return null;
    if (ref.startsWith('#')) return this.resolveTextureVar(textures, textures[ref.slice(1)], guard + 1);
    return this.stripNs(ref);
  }

  placeholderTexture() {
    if (this._placeholder) return this._placeholder;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? '#f800f8' : '#000';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    this._placeholder = { texture: t, width: 16, height: 16 };
    return this._placeholder;
  }

  async loadTexture(path) {
    // path like 'block/foo'. Returns {texture, width, height} with first
    // animation frame cropped out when the texture is animated.
    if (this.textureCache.has(path)) return this.textureCache.get(path);
    const p = (async () => {
      const img = new Image();
      img.src = `${this.base}/textures/${path}.png`;
      try { await img.decode(); } catch { return this.placeholderTexture(); }
      let { width: w, height: h } = img;
      let source = img;
      if (this.animated.has(path) && h > w && h % w === 0) {
        // Animated texture: draw frames into a canvas and keep it advancing.
        const c = document.createElement('canvas');
        c.width = w; c.height = w;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, w, 0, 0, w, w);
        source = c; h = w;
        let meta = {};
        try {
          const res = await fetch(`${this.base}/textures/${path}.png.mcmeta`);
          if (res.ok) meta = (await res.json()).animation || {};
        } catch { /* default timing */ }
        const total = img.height / w;
        const rawFrames = meta.frames && meta.frames.length
          ? meta.frames : Array.from({ length: total }, (_, i) => i);
        const frames = rawFrames
          .map(f => typeof f === 'number' ? { index: f } : { index: f.index, time: f.time })
          .filter(f => f.index < total);
        if (frames.length > 1) {
          const t2 = new THREE.CanvasTexture(c);
          t2.magFilter = t2.minFilter = THREE.NearestFilter;
          t2.colorSpace = THREE.SRGBColorSpace;
          this.animators.push({
            img, ctx, w, frames, i: 0, acc: 0,
            frametime: meta.frametime || 2, texture: t2,
          });
          return { texture: t2, width: w, height: w };
        }
      }
      const t = new THREE.Texture(source);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return { texture: t, width: w, height: h };
    })();
    this.textureCache.set(path, p);
    return p;
  }

  guessTint(modelId, texPath) {
    const s = modelId + ' ' + (texPath || '');
    if (/water/.test(s)) return TINTS.water;
    if (/grass_block|grass\b|tall_grass|fern|sugar_cane/.test(s)) return TINTS.grass;
    return TINTS.foliage;
  }

  // Build a THREE.Group for a resolved model. opts: {x, y} blockstate rotations (deg)
  async buildMesh(modelId, opts = {}) {
    const resolved = await this.resolve(modelId);
    const group = new THREE.Group();

    if (resolved.builtin === 'builtin/generated' || (!resolved.elements && resolved.textures.layer0)) {
      // flat layered sprite item
      let layer = 0, off = 0;
      while (resolved.textures['layer' + layer] !== undefined && layer < 5) {
        const texPath = this.resolveTextureVar(resolved.textures, '#layer' + layer);
        const { texture } = texPath ? await this.loadTexture(texPath) : this.placeholderTexture();
        const mat = new THREE.MeshBasicMaterial({
          map: texture, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide,
        });
        const geo = new THREE.PlaneGeometry(16, 16);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(8, 8, 8 + off);
        group.add(mesh);
        layer++; off += 0.06;
      }
      return this.finishGroup(group, opts);
    }

    if (!resolved.elements) return this.finishGroup(group, opts); // nothing renderable

    // group faces by texture path → one geometry per material
    const buckets = new Map(); // texPath -> {positions, normals, uvs, colors, indices}
    const bucket = (key) => {
      if (!buckets.has(key)) buckets.set(key, { pos: [], uv: [], col: [], idx: [] });
      return buckets.get(key);
    };

    const texMeta = new Map();
    const texFor = async (ref) => {
      const path = this.resolveTextureVar(resolved.textures, ref);
      const key = path || '__missing__';
      if (!texMeta.has(key)) {
        texMeta.set(key, path ? await this.loadTexture(path) : this.placeholderTexture());
      }
      return { key, path, meta: texMeta.get(key) };
    };

    for (const el of resolved.elements) {
      const from = el.from, to = el.to;
      let mtx = new THREE.Matrix4();
      if (el.rotation) {
        const { origin = [8, 8, 8], axis, angle = 0, rescale } = el.rotation;
        let rot;
        if (axis) {
          const rad = angle * Math.PI / 180;
          const ax = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[axis];
          rot = new THREE.Matrix4().makeRotationAxis(ax, rad);
          if (rescale) {
            const s = 1 / Math.cos(rad);
            const sv = new THREE.Vector3(axis === 'x' ? 1 : s, axis === 'y' ? 1 : s, axis === 'z' ? 1 : s);
            rot.scale(sv);
          }
        } else {
          // Blockbench free-rotation export: {x, y, z, origin} in degrees
          const d = Math.PI / 180;
          rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
            (el.rotation.x || 0) * d, (el.rotation.y || 0) * d, (el.rotation.z || 0) * d, 'ZYX'));
        }
        mtx = new THREE.Matrix4().makeTranslation(origin[0], origin[1], origin[2])
          .multiply(rot)
          .multiply(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]));
      }

      for (const dir of FACE_DIRS) {
        const face = el.faces && el.faces[dir];
        if (!face) continue;
        const { key, meta } = await texFor(face.texture);
        const b = bucket(key + (face.tintindex !== undefined ? '|tint' : ''));
        b.tint = face.tintindex !== undefined ? this.guessTint(modelId, key) : null;
        b.texMeta = meta;

        const corners = faceCorners(dir, from, to).map(v =>
          new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(mtx));

        let uv = face.uv || autoUV(dir, from, to);
        // MC uv is [x1,y1,x2,y2] in 0-16 space, origin top-left
        let uvc = uvCorners(uv, face.rotation || 0).map(([u, v]) => [u / 16, 1 - v / 16]);

        const base = b.pos.length / 3;
        const shade = SHADE[dir];
        for (let i = 0; i < 4; i++) {
          const c = corners[i];
          b.pos.push(c.x, c.y, c.z);
          b.uv.push(uvc[i][0], uvc[i][1]);
          b.col.push(shade, shade, shade);
        }
        b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }

    for (const [key, b] of buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      geo.setIndex(b.idx);
      const mat = new THREE.MeshBasicMaterial({
        map: b.texMeta.texture, vertexColors: true, transparent: true,
        alphaTest: 0.05, side: THREE.DoubleSide,
      });
      if (b.tint) mat.color = new THREE.Color(b.tint);
      group.add(new THREE.Mesh(geo, mat));
    }
    return this.finishGroup(group, opts);
  }

  finishGroup(group, opts) {
    // blockstate x/y rotations happen about block center
    const pivot = new THREE.Group();
    group.position.set(-8, -8, -8);
    pivot.add(group);
    if (opts.x) pivot.rotateX(-opts.x * Math.PI / 180);
    if (opts.y) pivot.rotateY(-opts.y * Math.PI / 180);
    return pivot;
  }
}

function faceCorners(dir, f, t) {
  // Counter-clockwise when viewed from outside, starting top-left in UV space.
  switch (dir) {
    case 'north': return [[t[0], t[1], f[2]], [f[0], t[1], f[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]]];
    case 'south': return [[f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], f[1], t[2]], [f[0], f[1], t[2]]];
    case 'west':  return [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [f[0], f[1], t[2]], [f[0], f[1], f[2]]];
    case 'east':  return [[t[0], t[1], t[2]], [t[0], t[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]];
    case 'up':    return [[f[0], t[1], f[2]], [t[0], t[1], f[2]], [t[0], t[1], t[2]], [f[0], t[1], t[2]]];
    case 'down':  return [[f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]]];
  }
}

function autoUV(dir, f, t) {
  switch (dir) {
    case 'north': return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case 'south': return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case 'west':  return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case 'east':  return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
    case 'up':    return [f[0], f[2], t[0], t[2]];
    case 'down':  return [f[0], 16 - t[2], t[0], 16 - f[2]];
  }
}

function uvCorners([x1, y1, x2, y2], rotation) {
  // corners in same order as faceCorners: top-left, top-right, bottom-right, bottom-left
  let c = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const steps = ((rotation || 0) / 90) | 0;
  for (let i = 0; i < steps; i++) c.unshift(c.pop());
  return c;
}
