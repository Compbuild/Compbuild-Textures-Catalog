// Screenshot catalog pages for visual verification.
import { chromium } from 'playwright';

const OUT = process.argv[2] || '/tmp/shots';
const BASE = 'http://localhost:8930';

const PAGES = [
  ['home', '#/'],
  ['blocks', '#/blocks'],
  ['block-detail', '#/block/birch_button'],
  ['items', '#/items'],
  ['item-detail', '#/item/comparator/Squat%20Rack'],
  ['ctm', '#/ctm'],
  ['ctm-compact', '#/ctm/glass%2Fconnected%2Fwhite%2Fconnected_white'],
  ['ctm-47', '#/ctm/__blocks%2Fblock%2Ffoundations%2Fbricks%2F_halftimber%2Fred%2Fhalftimber'],
  ['ctm-repeat-random', '#/ctm/method/repeat'],
  ['models', '#/models'],
  ['textures', '#/textures'],
  ['health', '#/health'],
];

const extra = process.argv.slice(3);
for (let i = 0; i < extra.length; i += 2) PAGES.push([extra[i], extra[i + 1]]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)); });
page.on('pageerror', err => errors.push('PAGEERROR: ' + String(err).slice(0, 300)));

for (const [name, hash] of PAGES) {
  await page.goto(`${BASE}/index.html${hash}`);
  await page.waitForTimeout(name.includes('detail') || name.includes('ctm-') ? 3500 : 2000);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}
console.log('CONSOLE ERRORS:', JSON.stringify([...new Set(errors)], null, 1).slice(0, 3000));
await browser.close();
