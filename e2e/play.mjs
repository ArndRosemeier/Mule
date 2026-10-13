/**
 * Plays a complete single-player game through the real UI (keyboard and
 * pointer only, reading state to decide), at accelerated speed, and checks
 * that it reaches the end without errors. Screenshots land in SHOTS.
 *
 *   node e2e/play.mjs [url] [shotsDir]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5173/?speed=6';
const SHOTS = process.argv[3] ?? 'e2e/shots';
const DIFF = process.env.DIFF ?? 'Standard';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL);
await page.getByRole('button', { name: 'New game' }).click();
await page.getByRole('button', { name: new RegExp(DIFF) }).click();
await page.getByRole('button', { name: 'Land on Irata' }).click();
await page.waitForFunction(() => window.__mule);

const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const taken = new Set();
const once = async (name) => { if (!taken.has(name)) { taken.add(name); await shot(name); } };

const canvasBox = await page.locator('canvas').boundingBox();
const clickWorld = (x, y) => page.mouse.click(canvasBox.x + (x / 900) * canvasBox.width, canvasBox.y + (y / 500) * canvasBox.height);

let held = null;
const hold = async (key) => {
  if (held === key) return;
  if (held) await page.keyboard.up(held);
  held = key;
  if (key) await page.keyboard.down(key);
};

const snapshot = () => page.evaluate(() => {
  const s = window.__mule.session.state;
  return JSON.parse(JSON.stringify({ phase: s.phase, players: s.players, map: s.map.map((p) => ({ i: p.index, owner: p.owner, mule: p.mule, terrain: p.terrain })), store: s.store, round: s.round, rounds: s.config.rounds }));
});

const STREET = 250;
const doors = { corral: [112.5, 311], pub: [337.5, 311], food: [112.5, 189], energy: [337.5, 189] };
let lastClick = '';
let lastClickAt = 0;
const goto = async (key, x, y) => {
  const now = Date.now();
  if (lastClick === key && now - lastClickAt < 1500) return;
  lastClick = key;
  lastClickAt = now;
  await clickWorld(x, y);
};

const started = Date.now();
let ticks = 0;
let roundsSeen = new Set();
while (Date.now() - started < 25 * 60_000) {
  const s = await snapshot();
  const ph = s.phase;
  const me = 0;
  ticks++;
  if (!roundsSeen.has(s.round)) { roundsSeen.add(s.round); console.log(`round ${s.round} money=${s.players[0].money}`); }
  if (ph.kind === 'gameOver') { await hold(null); await page.waitForTimeout(800); await shot('99-game-over'); break; }
  switch (ph.kind) {
    case 'roundIntro':
      if (s.round === 2) await once('10-round2-intro');
      await hold(null); await page.keyboard.press('Space'); break;
    case 'landGrant':
      await hold(null);
      if (!ph.done && ph.claims[me] === null) {
        await once('11-land-grant');
        const plot = s.map[ph.cursor];
        // Prefer river and mountains, settle for anything after a few steps.
        if (plot && (plot.terrain !== 'plain' || Math.random() < 0.25)) await page.keyboard.press('Space');
      }
      break;
    case 'landAuction':
      await once('12-land-auction-' + ph.auction.stage);
      if (ph.auction.stage === 'bidding') await hold(Math.random() < 0.5 ? 'Space' : null);
      else { await hold(null); await page.keyboard.press('Space'); }
      break;
    case 'production':
      await hold(null); await page.waitForTimeout(300); await once('30-production'); await page.keyboard.press('Space'); break;
    case 'auction': {
      const a = ph.auction;
      if (a.stage === 'trading') {
        await once('40-auction-' + a.resource);
        const mine = a.participants.find((p) => p.playerId === me);
        const short = mine && s.players[me].goods[a.resource] < mine.stopAt + 1;
        await hold(mine?.role === 'seller' ? 'ArrowDown' : mine?.role === 'buyer' && short ? 'ArrowUp' : null);
      } else {
        if (a.stage === 'status') await once('39-auction-status');
        await hold(null); await page.keyboard.press('Space');
      }
      break;
    }
    case 'development': {
      const t = ph.turn;
      if (t.playerId !== me) { await hold(null); if (t.stage === 'active' && t.scene === 'map') await once('25-ai-on-map'); break; }
      if (t.stage === 'intro') { await once('20-my-turn'); await page.keyboard.press('Space'); break; }
      if (t.stage !== 'active') break;
      if (t.menu) { await page.keyboard.press('Escape'); break; }
      const myEmpty = s.map.filter((p) => p.owner === me && !p.mule);
      const target = myEmpty[0];
      if (t.scene === 'town') {
        await once('21-town');
        if (!t.mule && target && s.players[me].money >= s.store.mulePrice + 50 && s.store.mules > 0 && t.timeLeft > 15000) {
          await goto('corral-front', doors.corral[0], STREET);
          if (Math.abs(t.pos.x - doors.corral[0]) < 6) await goto('corral', ...doors.corral);
        } else if (t.mule && !t.mule.outfit) {
          const shop = target && target.terrain === 'river' ? 'food' : 'energy';
          await goto(shop + '-front', doors[shop][0], STREET);
          if (Math.abs(t.pos.x - doors[shop][0]) < 6) await goto(shop, ...doors[shop]);
        } else if (t.mule) {
          await once('22-town-with-mule');
          const west = target && target.i % 9 < 4;
          await goto('exit', west ? 2 : 898, STREET);
          if (Math.abs(t.pos.x - (west ? 2 : 898)) < 8) await hold(west ? 'ArrowLeft' : 'ArrowRight');
        } else {
          await hold(null);
          await goto('pub-front', doors.pub[0], STREET);
          if (Math.abs(t.pos.x - doors.pub[0]) < 6) await goto('pub', ...doors.pub);
        }
      } else {
        await hold(null);
        if (t.mule && target) {
          await once('23-map-with-mule');
          const cx = (target.i % 9) * 100 + 50, cy = Math.floor(target.i / 9) * 100 + 50;
          // Walk around the town: go to the target row beside the town first.
          const side = t.pos.x < 450 ? 380 : 520;
          if (Math.abs(t.pos.y - cy) > 8 && Math.abs(cx - 450) < 120) await goto('row', side, cy);
          else await goto('plot', cx, cy);
        } else {
          await goto('town', 450, 250);
        }
      }
      break;
    }
  }
  await page.waitForTimeout(40);
}
const final = await snapshot();
console.log('final phase', final.phase.kind, 'round', final.round, 'my plots', final.map.filter((p) => p.owner === 0).length, 'mules', final.map.filter((p) => p.owner === 0 && p.mule).length);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
if (final.phase.kind !== 'gameOver' || errors.length) process.exit(1);
