// Canvas-based CTM connection demos.
//
// Algorithms match OptiFine semantics as reimplemented by the MIT-licensed
// Continuity mod (CTMSpriteProvider.SPRITE_INDEX_MAP and friends), verified
// against this pack's own tile artwork.

// Full 47-tile CTM: 8-neighbor bitmask -> tile index.
// Bit layout:  128 64 32
//              1   *  16
//              2   4  8
// (corner bits only set when both adjacent sides are set)
const CTM47 = [
  0, 3, 0, 3, 12, 5, 12, 15, 0, 3, 0, 3, 12, 5, 12, 15,
  1, 2, 1, 2, 4, 7, 4, 29, 1, 2, 1, 2, 13, 31, 13, 14,
  0, 3, 0, 3, 12, 5, 12, 15, 0, 3, 0, 3, 12, 5, 12, 15,
  1, 2, 1, 2, 4, 7, 4, 29, 1, 2, 1, 2, 13, 31, 13, 14,
  36, 17, 36, 17, 24, 19, 24, 43, 36, 17, 36, 17, 24, 19, 24, 43,
  16, 18, 16, 18, 6, 46, 6, 21, 16, 18, 16, 18, 28, 9, 28, 22,
  36, 17, 36, 17, 24, 19, 24, 43, 36, 17, 36, 17, 24, 19, 24, 43,
  37, 40, 37, 40, 30, 8, 30, 34, 37, 40, 37, 40, 25, 23, 25, 45,
  0, 3, 0, 3, 12, 5, 12, 15, 0, 3, 0, 3, 12, 5, 12, 15,
  1, 2, 1, 2, 4, 7, 4, 29, 1, 2, 1, 2, 13, 31, 13, 14,
  0, 3, 0, 3, 12, 5, 12, 15, 0, 3, 0, 3, 12, 5, 12, 15,
  1, 2, 1, 2, 4, 7, 4, 29, 1, 2, 1, 2, 13, 31, 13, 14,
  36, 39, 36, 39, 24, 41, 24, 27, 36, 39, 36, 39, 24, 41, 24, 27,
  16, 42, 16, 42, 6, 20, 6, 10, 16, 42, 16, 42, 28, 35, 28, 44,
  36, 39, 36, 39, 24, 41, 24, 27, 36, 39, 36, 39, 24, 41, 24, 27,
  37, 38, 37, 38, 30, 11, 30, 32, 37, 38, 37, 38, 25, 33, 25, 26,
];

// Demo wall shape: 1 = block present. Exercises islands, runs, corners,
// interior, notches.
const DEMO_GRID = [
  [1, 1, 1, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 0, 1, 0, 0],
  [1, 1, 0, 1, 1, 1, 0, 1],
  [1, 1, 1, 1, 1, 0, 0, 1],
  [0, 0, 1, 1, 1, 1, 1, 1],
];

const COLUMN_GRID = [[1], [1], [1], [0], [1]]; // for vertical demos
const ROW_GRID = [[1, 1, 1, 0, 1]];            // for horizontal demos

function has(grid, x, y) {
  return y >= 0 && y < grid.length && x >= 0 && x < grid[0].length && !!grid[y][x];
}

async function loadTiles(assetBase, tilePaths) {
  return Promise.all(tilePaths.map(p => new Promise(res => {
    if (!p) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = `${assetBase}/${p}`;
  })));
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function renderCtmDemo(canvas, group, assetBase) {
  const method = group.method;
  const tiles = await loadTiles(assetBase, group.tiles);
  const T = 16, S = 3; // tile px, scale
  const ctx2 = (cols, rows) => {
    canvas.width = cols * T * S;
    canvas.height = rows * T * S;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    return g;
  };
  const draw = (g, img, x, y) => {
    if (img) g.drawImage(img, x * T * S, y * T * S, T * S, T * S);
    else { g.fillStyle = '#f0f'; g.fillRect(x * T * S, y * T * S, T * S, T * S); }
  };

  if (method === 'repeat' && group.width && group.height) {
    // Some pack groups declare width*height that disagrees with the tile
    // count; trust the tile list (derive width from it) so the demo doesn't
    // show phantom missing tiles.
    let pw = group.width, ph = group.height;
    if (pw * ph !== tiles.length && tiles.length % ph === 0) pw = tiles.length / ph;
    else if (pw * ph !== tiles.length && tiles.length % pw === 0) ph = tiles.length / pw;
    const W = Math.max(pw * 2, 8), H = Math.max(ph * 2, 4);
    const g = ctx2(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      draw(g, tiles[(y % ph) * pw + (x % pw)], x, y);
    }
    return;
  }

  if (method === 'random' || method === 'top' || !method) {
    const W = 8, H = 4;
    const g = ctx2(W, H);
    const rnd = seededRandom(7);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      draw(g, tiles[(rnd() * tiles.length) | 0], x, y);
    }
    return;
  }

  if (method === 'vertical') {
    // tiles order: bottom, middle, top, single
    const grid = COLUMN_GRID, H = grid.length;
    const g = ctx2(3, H);
    for (let y = 0; y < H; y++) {
      if (!has(grid, 0, y)) continue;
      const up = has(grid, 0, y - 1), down = has(grid, 0, y + 1);
      const idx = up && down ? 1 : up ? 0 : down ? 2 : 3;
      draw(g, tiles[idx] || tiles[0], 1, y);
    }
    return;
  }

  if (method === 'horizontal') {
    // tiles order: left, middle, right, single
    const grid = ROW_GRID, W = grid[0].length;
    const g = ctx2(W, 3);
    for (let x = 0; x < W; x++) {
      if (!has(grid, x, 0)) continue;
      const left = has(grid, x - 1, 0), right = has(grid, x + 1, 0);
      const idx = left && right ? 1 : right ? 0 : left ? 2 : 3;
      draw(g, tiles[idx] || tiles[0], x, 1);
    }
    return;
  }

  if (method === 'ctm_compact') {
    // 5 quadrant-case tiles: 0 unconnected, 1 full interior, 2 vertical-run,
    // 3 horizontal-run, 4 inner corner. Artwork authored for the top-left
    // quadrant; other quadrants sample mirrored.
    const grid = DEMO_GRID, H = grid.length, W = grid[0].length;
    const g = ctx2(W, H);
    const q = T * S / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!has(grid, x, y)) continue;
      for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
        const hN = has(grid, x + (qx ? 1 : -1), y);
        const vN = has(grid, x, y + (qy ? 1 : -1));
        const dN = has(grid, x + (qx ? 1 : -1), y + (qy ? 1 : -1));
        const idx = !hN && !vN ? 0 : hN && !vN ? 3 : !hN && vN ? 2 : dN ? 1 : 4;
        const img = tiles[idx] || tiles[0];
        const dx = x * T * S + qx * q, dy = y * T * S + qy * q;
        g.save();
        g.translate(dx + (qx ? q : 0), dy + (qy ? q : 0));
        g.scale(qx ? -1 : 1, qy ? -1 : 1);
        if (img) g.drawImage(img, 0, 0, img.width / 2, img.height / 2, 0, 0, q, q);
        g.restore();
      }
    }
    return;
  }

  if (method === 'ctm') {
    const grid = DEMO_GRID, H = grid.length, W = grid[0].length;
    const g = ctx2(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!has(grid, x, y)) continue;
      const L = has(grid, x - 1, y), R = has(grid, x + 1, y);
      const U = has(grid, x, y - 1), D = has(grid, x, y + 1);
      let m = 0;
      if (L) m |= 1;
      if (D) m |= 4;
      if (R) m |= 16;
      if (U) m |= 64;
      if (L && D && has(grid, x - 1, y + 1)) m |= 2;
      if (D && R && has(grid, x + 1, y + 1)) m |= 8;
      if (R && U && has(grid, x + 1, y - 1)) m |= 32;
      if (U && L && has(grid, x - 1, y - 1)) m |= 128;
      draw(g, tiles[CTM47[m]] || tiles[0], x, y);
    }
    return;
  }

  // overlay + anything else: show the tile strip
  const W = Math.min(tiles.length, 12), H = Math.ceil(tiles.length / 12);
  const g = ctx2(W, H);
  tiles.forEach((img, i) => draw(g, img, i % 12, (i / 12) | 0));
}

export function methodDescription(method) {
  return {
    ctm: '47-tile connected textures — the texture changes based on all 8 neighbors',
    ctm_compact: 'Compact connected textures — 5 tiles cover every connection case',
    horizontal: 'Connects to matching blocks left and right',
    vertical: 'Connects to matching blocks above and below',
    random: 'Randomly picks one of the tiles for each block position',
    repeat: 'Tiles a fixed pattern across the wall',
    overlay: 'Draws transition overlays where this block meets other blocks',
    top: 'Special texture on top contact',
  }[method] || method;
}
