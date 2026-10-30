// Browser test: real game page + worker in-process (SQLite instead of D1), fake Telegram.
// run: node --no-warnings test/e2e.mjs <screenshots dir>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import worker from '../src/index.js';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/usr/local/lib/node_modules/playwright')); }

const OUT = process.argv[2] || '.';
const GAME = new URL('../../game/', import.meta.url).pathname;
class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) { this.args = a.map((x) => (x === undefined ? null : x)); return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }
class D1 { constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); }
  prepare(s) { return new Stmt(this.db, s); } async batch(l) { for (const s of l) await s.run(); } }
const env = { DB: new D1(), BOT_TOKEN: '111:AAA', OLD_BOT_TOKEN: '222:BBB', ADMIN_ID: '1001', WEBHOOK_SECRET: 's', GAME_URL: 'https://x/' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { if (String(url).includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: 'https://t.me/$inv' })); return realFetch(url, init); };

async function hmac(key, msg) { const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))); }
async function initData(user) { const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', [...(await hmac(await hmac('WebAppData', env.BOT_TOKEN), check))].map((x) => x.toString(16).padStart(2, '0')).join('')); return p.toString(); }

const INIT = await initData({ id: 1001, first_name: 'Илья' });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => { window.__noTips = true; });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text()); });

await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body:
  `window.Telegram={WebApp:{initData:${JSON.stringify(INIT)},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},openInvoice(link,cb){window.__inv=link;setTimeout(()=>cb('paid'),50)}}};` }));
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await page.route('https://yardstars.shawnwild.workers.dev/**', async (r) => {
  const req = r.request();
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: { 'content-type': 'application/json' }, body: req.method() === 'POST' ? req.postData() : undefined }), env, {});
  r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
});
await page.route('http://game.local/**', (r) => {
  const p = path.join(GAME, new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html');
  if (!existsSync(p)) return r.fulfill({ status: 404, body: '' });
  r.fulfill({ body: readFileSync(p), contentType: p.endsWith('.html') ? 'text/html' : p.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' });
});

const shot = async (n) => { await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const click = async (sel) => { await page.click(sel); await page.waitForTimeout(120); };

await page.goto('http://game.local/index.html');
await page.waitForSelector('[data-ob="next"]'); await shot('01-welcome');
await click('[data-ob="next"]');
await click('[data-ava="f2"]'); await page.fill('#obName', 'Илья'); await shot('02-avatar');
await click('[data-ob="next"]');
await click('[data-obhero="lifter"]'); await click('[data-obsex="f"]'); await shot('03a-hero-female');
await click('[data-obhero="grandma"]'); await click('[data-obsex="m"]'); await shot('03b-hero-grandpa');
const alts = await page.evaluate(() => ({ n: HERO_IDS.filter((h) => ALT[h]).length, sel: !!document.querySelector('[data-obsex="m"].pick'), name: document.querySelector('[data-obhero="grandma"] b').textContent }));
if (alts.n !== 15 || !alts.sel || alts.name !== 'Дедушка') errors.push('gender versions ' + JSON.stringify(alts)); else console.log('gender versions', JSON.stringify(alts));
await click('[data-obhero="cat"]'); await shot('03-hero');
await click('[data-ob="next"]'); await page.selectOption('#bdD', '15'); await page.selectOption('#bdM', '3');
await click('[data-ob="finish"]');
await page.waitForSelector('#board .cell'); await shot('04-kitchen');
await page.setViewportSize({ width: 384, height: 600 }); await page.waitForTimeout(300); await shot('04s-small-window');
const ov = await page.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(), s = document.getElementById('shelf').getBoundingClientRect(); return { boardBottom: b.bottom, shelfBottom: s.bottom, navTop: n.top }; });
if (ov.shelfBottom > ov.navTop + 1) errors.push('small window overlap ' + JSON.stringify(ov)); else console.log('small window fits', JSON.stringify(ov));
await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(200);

// spawn from generators and merge pairs by tapping
for (let i = 0; i < 14; i++) await click('.gen[data-c="d"]');
const merges = await page.evaluate(() => {
  let n = 0;
  for (let round = 0; round < 6; round++) {
    const b = S.board; let done = false;
    for (let i = 0; i < b.length && !done; i++) for (let j = i + 1; j < b.length && !done; j++)
      if (b[i] && b[j] && !b[i].sp && !b[j].sp && b[i].c === b[j].c && b[i].l === b[j].l && b[i].l < 4) { drop(i, j); n++; done = true; }
    renderKitchen();
  }
  return n;
});
console.log('merges', merges); await shot('05-kitchen-merged');

// real drag of one pair with the mouse
const pair = await page.evaluate(() => { const b = S.board; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i] && b[j] && !b[i].sp && !b[j].sp && b[i].c === b[j].c && b[i].l === b[j].l && b[i].l < 4) return [i, j]; return null; });
if (pair) {
  const a = await page.locator(`.cell[data-i="${pair[0]}"]`).boundingBox(), b = await page.locator(`.cell[data-i="${pair[1]}"]`).boundingBox();
  const lvBefore = await page.evaluate((j) => S.board[j].l, pair[1]);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  const lvAfter = await page.evaluate((j) => S.board[j] && S.board[j].l, pair[1]);
  if (lvAfter !== lvBefore + 1) errors.push('drag merge failed'); else console.log('drag merge ok');
}
// fulfil an order: put the needed items on the board directly
await page.evaluate(() => { const o = S.orders[1]; o.items.forEach((x) => place({ c: x.c, l: x.l })); renderKitchen(); });
const coins0 = await page.evaluate(() => S.coins);
await click('.give[data-k="1"]');
const coins1 = await page.evaluate(() => S.coins);
if (coins1 <= coins0) errors.push('order not paid'); else console.log('order paid', coins1 - coins0);
await shot('06-order');

// level up to 3 → gift starter joins and goes to team 1
await page.evaluate(() => { addXp(xpNeed(S.level)); addXp(xpNeed(S.level)); });
await page.waitForTimeout(1800);
const t1 = await page.evaluate(() => ({ heroes: Object.keys(S.heroes), team: S.teams[0], slots: orderSlots() }));
if (t1.heroes.length !== 2 || t1.team.length !== 2) errors.push('gift hero at lvl3 ' + JSON.stringify(t1)); else console.log('gift hero joined team', JSON.stringify(t1));
await shot('06b-gift-hero');
await page.waitForTimeout(3000);
const srv = JSON.parse(env.DB.db.prepare('SELECT state FROM players WHERE uid=1001').get().state);
if (Object.keys(srv.heroes).length !== 2) errors.push('server heroes ' + JSON.stringify(Object.keys(srv.heroes))); else console.log('server accepted gift hero');
// shards: 10 shards build a hero (server allows 1 per 4 levels → at level 3 it must be refused)
await page.evaluate(() => { addShard('dog', 10); render(); });
await page.waitForTimeout(3000);
const srv2 = JSON.parse(env.DB.db.prepare('SELECT state FROM players WHERE uid=1001').get().state);
const cd = await page.evaluate(() => ({ own: !!S.heroes.dog, shards: S.shards.dog }));
if (srv2.heroes.dog || cd.own || cd.shards !== 10) errors.push('shard cap ' + JSON.stringify(cd)); else console.log('shard hero waits for level 4 (client and server agree)');

// basket: 5 energy for 3 products of level 2
const bk = await page.evaluate(() => { S.energy = 50; S.board = S.board.map(()=>null); render(); const e0 = S.energy; document.querySelector('[data-basket]').click(); return { de: e0 - S.energy, items: S.board.filter(Boolean).length, lv: S.board.filter(Boolean).every(b => b.l === 1) }; });
if (bk.de !== 5 || bk.items !== 3 || !bk.lv) errors.push('basket ' + JSON.stringify(bk)); else console.log('basket: -5 energy, 3 products');
await shot('06c-basket');
// tips: dim screen + highlighted element, tap to go on
await page.evaluate(() => { window.__noTips = false; S.tips = []; view = 'kitchen'; render(); });
await page.waitForTimeout(700); await shot('06d-tip1');
const tp = await page.evaluate(() => !!document.querySelector('.coach .tip'));
if (!tp) errors.push('no tip shown'); else console.log('tips shown');
await page.click('.coach'); await page.waitForTimeout(300); await shot('06e-tip2');
await page.evaluate(() => { while(document.querySelector('.coach')) document.querySelector('.coach').click(); window.__noTips = true; S.tips = Object.keys(TIPS); });
// home + renovation
await page.evaluate(() => { S.coins += 100; });
await click('.nav [data-v="home"]'); await shot('07a-street');
await click('[data-place="home"]'); await shot('07-home-empty');
await click('[data-open="repair"]'); await shot('08-repair-sheet');
await click('[data-build="walls"]');
await page.waitForTimeout(3200); // server save
const up = await page.evaluate(() => S.upg.walls);
if (!up || up.state !== 'build' || up.end - Date.now() < 30000) errors.push('repair not on server clock ' + JSON.stringify(up)); else console.log('repair building, server end ok');
await click('[data-x]');
// fast-forward the clock of the client only: finish shouldn't stick (server keeps timer) — instead simulate done after real wait by editing end
await page.evaluate(() => { offset += 61000; tickBuilds(); });
await shot('09-home-walls');
for (const id of ['rug', 'sofa', 'lamp', 'table', 'shelf', 'plant', 'pictures', 'wardrobe', 'lights']) await page.evaluate((id) => { S.upg[id] = { state: 'done' }; }, id);
await page.evaluate(() => { offset -= 61000; render(); }); await shot('10-home-full');
// street: yard opens on level 3, its scene and own build list
await page.evaluate(() => { S.level = Math.max(S.level, 5); S.coins += 2000; curPlace = null; render(); });
await shot('10b-street-open');
await click('[data-place="yard"]'); await shot('10c-yard-empty');
await click('[data-open="repair"]');
const yb = await page.evaluate(() => !!document.querySelector('[data-build="y_bench"]') && !document.querySelector('[data-build="rug"]'));
if (!yb) errors.push('yard build list'); else console.log('yard has its own build list');
await click('[data-x]');
await page.evaluate(() => { for (const r of placeItems('yard')) S.upg[r.id] = { state: 'done' }; render(); });
await shot('10d-yard-full');
await page.evaluate(() => { S.level = Math.max(S.level, 20); });
for (const pl of ['sport', 'cafe', 'park', 'market']) {
  await page.evaluate((pl) => { for (const r of placeItems(pl)) S.upg[r.id] = { state: 'done' }; curPlace = pl; render(); }, pl);
  await shot('10e-' + pl + '-full');
}
await page.evaluate(() => { for (const r of placeItems('yard')) S.upg[r.id] = { state: 'done' }; curPlace = 'yard'; render(); });
await shot('10f-yard-full');
await click('[data-street]');
const sd = await page.evaluate(() => ({ list: document.querySelectorAll('.spot').length, done: placesDone() }));
if (sd.list !== 6) errors.push('street ' + JSON.stringify(sd)); else console.log('street ok', JSON.stringify(sd));

// heroes
await page.evaluate(() => { S = JSON.parse(JSON.stringify(S)); }); await page.reload(); await page.waitForSelector('.nav');
await click('.nav [data-v="heroes"]'); await shot('11-heroes');
await click('[data-htab="all"]'); await shot('11b-collection'); await click('[data-htab="teams"]');
await click('[data-slot="0:0"]');
const tk = await page.evaluate(() => ({ kind, team: S.teams[0].length }));
if (tk.kind !== 'hero' || tk.team < 1) errors.push('slot tap ' + JSON.stringify(tk)); else console.log('team slot opens hero card');
await shot('11c-hero-from-team'); await click('[data-x]');
await click('[data-slot="0:' + (await page.evaluate(() => S.teams[0].length)) + '"]');
const pk = await page.evaluate(() => kind);
if (pk !== 'pick') errors.push('plus tap ' + pk); else console.log('plus opens picker');
await shot('11d-pick'); await click('[data-x]');
await click('[data-htab="all"]');
await page.evaluate(() => { S.coins += 500; S.heroes.cat.lv = 10; });
await click('.card[data-hero="cat"]'); await shot('12-hero-sheet');
await page.fill('#hname', 'Барсик'); await click('[data-hname="cat"]');
const nm = await page.evaluate(() => ({ n: S.heroes.cat.name, t: document.querySelector('.hc-top h2').textContent }));
if (nm.n !== 'Барсик' || nm.t !== 'Барсик') errors.push('hero name ' + JSON.stringify(nm)); else console.log('hero named');
await click('[data-gear="cat:collar"]');
const g = await page.evaluate(() => ({ gear: S.gear.cat, bonus: gearBonus('cat') }));
if (!g.gear || !g.gear.includes('collar')) errors.push('gear buy failed'); else console.log('gear bought, bonus', g.bonus);
await page.evaluate(() => document.querySelector('[data-buy="look:c_pirate"]').scrollIntoView()); await shot('12b-hero-looks');
await click('[data-x]');
// lifter sheet with full gear set changes the look
await page.evaluate(() => { S.heroes.lifter = {lv:1,xp:0}; S.gear.lifter = ['singlet','squatbelt','softwraps','sleeves','squatshoes']; render(); openSheet('hero','lifter'); });
const lk = await page.evaluate(() => curLook('lifter'));
if (lk !== 'l_novice') errors.push('set look ' + lk); else console.log('gear set look ok');
const lk0 = await page.evaluate(() => ({ locked: !!document.querySelector('[data-buy="look:l_bald"]'), gold: !!document.querySelector('[data-buy="look:l_gold"]') }));
if (!lk0.locked || !lk0.gold) errors.push('lv1 locks ' + JSON.stringify(lk0)); else console.log('level 1: appearances locked, legendary as silhouette for sale');
await page.evaluate(() => { S.heroes.lifter.lv = 15; drawSheet(); });
await click('[data-hair="lifter:l_hair"]');
const lk2 = await page.evaluate(() => ({ cur: curLook('lifter'), last: !!document.querySelector('[data-buy="look:l_hairbeard"]') }));
if (lk2.cur !== 'l_hair_novice' || !lk2.last) errors.push('hair by level ' + JSON.stringify(lk2)); else console.log('appearance by level + set per appearance ok');
await shot('12c-lifter-gear'); await click('[data-x]');
// hero stars from extra shards
const stq = await page.evaluate(() => { S.level = 12; S.heroes.cat.lv = 3; S.shards.cat = 10; heroCardTab = 'info'; openSheet('hero','cat'); return !!document.querySelector('[data-star="cat"]'); });
if (!stq) errors.push('no star button'); else { await click('[data-star="cat"]'); const st = await page.evaluate(() => ({ s: S.heroes.cat.stars, sh: S.shards.cat||0, v: heroSkillVal('cat') })); if (st.s !== 1 || st.sh !== 0) errors.push('star up ' + JSON.stringify(st)); else console.log('star up ok, skill', st.v.toFixed(3)); }
await shot('12e-stars'); await click('[data-x]');
// costume in collection adds coins to the hero
const cc = await page.evaluate(() => { S.paidLooks = [...(S.paidLooks||[]), 'c_pirate']; return costumeCoins('cat'); });
if (Math.abs(cc - .02) > 1e-9) errors.push('costume coins ' + cc); else console.log('costume coins ok');
// repair sheet: help and second builder rows
await page.evaluate(() => { S.upg = { walls: { state:'build', start: now(), end: now() + 60000 } }; openSheet('repair'); });
const rp = await page.evaluate(() => ({ help: !!document.querySelector('[data-help]'), next: !!document.querySelector('[data-build="rug"]') }));
await click('[data-build="rug"]');
const busy = await page.evaluate(() => ({ kind, offer: !!document.querySelector('#sheet [data-buy="builder"]'), rug: S.upg.rug }));
if (!rp.help || !rp.next || busy.kind !== 'busy' || !busy.offer || busy.rug) errors.push('repair busy ' + JSON.stringify({rp, busy})); else console.log('repair: busy master offers second master and help');
await shot('12g-busy');
await page.evaluate(() => { S.paid = ['builder']; S.coins = 5; openSheet('repair'); });
await click('[data-build="rug"]');
const nc = await page.evaluate(() => kind);
if (nc !== 'need') errors.push('no coins offer ' + nc); else console.log('not enough coins: offer sheet');
await shot('12h-need-coins');
const rp2 = await page.evaluate(() => { S.paid = ['builder']; S.coins = 500; openSheet('repair'); document.querySelector('[data-build="rug"]').click(); return S.upg.rug && S.upg.rug.state; });
if (rp2 !== 'build') errors.push('second builder not working'); else console.log('second builder ok');
await shot('12f-repair'); await click('[data-x]');
await page.evaluate(() => { S.upg = {}; S.paid = []; render(); });
// energy jars: open from the energy pill, energy goes over 100
await page.evaluate(() => { S.jars = 3; S.energy = 98; render(); });
await click('[data-energy]'); await shot('12d-energy');
await click('[data-jar="3"]');
const ej = await page.evaluate(() => ({ e: S.energy, j: S.jars }));
if (ej.j !== 0 || ej.e < 113) errors.push('jars ' + JSON.stringify(ej)); else console.log('jars opened, energy', ej.e);
await click('[data-x]');
// skills: trainer in team speeds up regen
const sk = await page.evaluate(() => { S.heroes.trainer = S.heroes.trainer || {lv:1,xp:0}; S.heroes.trainer.lv = 20; if(teamOf('trainer')<0) S.teams[0].push('trainer'); return { ms: regenMs(), txt: SKILLS.trainer[2](heroSkillVal('trainer')) }; });
if (Math.abs(sk.ms - 250000) > 1) errors.push('regen skill ' + JSON.stringify(sk)); else console.log('skill:', sk.txt);
await page.evaluate(() => { delete S.heroes.lifter; delete S.gear.lifter; render(); });

// goals
await click('.nav [data-v="goals"]'); await shot('13a-missions-day');
await click('[data-ttab="mine"]');
for (const g of ['water', 'move', 'sleep']) await click(`[data-gp="${g}"]`);
await shot('13-goals-pick'); await click('[data-goalsave]');
const e0 = await page.evaluate(() => S.energy);
await click('[data-gd="water"]'); await click('[data-gd="move"]'); await click('[data-gd="sleep"]');
const e1 = await page.evaluate(() => S.energy);
if (e1 - e0 !== 30) errors.push('goals energy ' + (e1 - e0)); await shot('14-goals-done');
// missions: counters from play, claim, activity chest
await click('[data-ttab="day"]');
const ms = await page.evaluate(() => ({ goal: S.mis.c.goal, login: S.mis.c.login, merges: S.mis.c.merges||0 }));
if (ms.goal !== 3 || ms.login !== 1) errors.push('mission counters ' + JSON.stringify(ms)); else console.log('mission counters', JSON.stringify(ms));
const tk0 = await page.evaluate(() => S.tok||0);
await click('[data-mclaim="day:login"]'); await click('[data-mclaim="day:goal"]');
const tk1 = await page.evaluate(() => ({ tok: S.tok, pts: misPts('day') }));
if (tk1.tok !== tk0 + 10 || tk1.pts !== 30) errors.push('mission claim ' + JSON.stringify(tk1)); else console.log('missions claimed', JSON.stringify(tk1));
const j0m = await page.evaluate(() => S.jars||0);
await click('[data-mbox="day:0"]');
const j1m = await page.evaluate(() => ({ jars: S.jars, bx: S.mis.bx }));
if (j1m.jars !== j0m + 2) errors.push('activity chest ' + JSON.stringify(j1m)); else console.log('activity chest 20 opened');
await shot('14b-missions-claimed');
await click('[data-ttab="week"]'); await shot('14c-missions-week');
await page.waitForTimeout(3200);
const srvm = JSON.parse(env.DB.db.prepare('SELECT state FROM players WHERE uid=1001').get().state);
if (!srvm.mis || !srvm.mis.ok.includes('login') || srvm.tok !== tk1.tok) errors.push('server missions ' + JSON.stringify({ mis: srvm.mis, tok: srvm.tok })); else console.log('server accepted missions and tokens');

// shop + paid flow
await click('.nav [data-v="shop"]'); await shot('15-shop');
const c2 = await page.evaluate(() => S.coins);
await page.evaluate(() => save());
await click('[data-buy="coinsS"]');
await page.waitForTimeout(200);
const payload = await page.evaluate(() => window.__inv);
// simulate Telegram delivering successful_payment to the bot
const inv = JSON.parse(env.DB.db.prepare('SELECT 1').get() ? '{}' : '{}');
const lastInvoice = await (async () => { const st = env.DB.db.prepare('SELECT state FROM players WHERE uid=1001').get(); return st; })();
await worker.fetch(new Request('https://w/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 's' }, body: JSON.stringify({ message: { from: { id: 1001 }, chat: { id: 1001 },
  successful_payment: { currency: 'XTR', total_amount: 25, invoice_payload: JSON.stringify({ u: 1001, s: 'coinsS', t: Date.now() }), telegram_payment_charge_id: 'e2e1' } } }) }), env, {});
await page.waitForTimeout(1800);
const c3 = await page.evaluate(() => S.coins);
if (c3 - c2 !== 100) errors.push('paid coins not in game: ' + (c3 - c2)); else console.log('payment shows in game');
await shot('16-after-pay');

// reload: progress persists
await page.waitForTimeout(3000);
await page.reload(); await page.waitForSelector('.nav'); await shot('17-reload');
const lvl = await page.evaluate(() => ({ coins: S.coins, upg: Object.keys(S.upg).length, hero: S.firstHero, owner: S.owner }));
console.log('after reload', JSON.stringify(lvl));
if (lvl.hero !== 'cat') errors.push('progress lost on reload');

// free energy twice a day + shop tabs (server filled them on load)
const f0 = await page.evaluate(() => ({ left: S.freeLeft, d: S.dshop, w: S.wshop && Object.keys(S.wshop.left).length }));
if (f0.left !== 2 || !f0.d || f0.w !== 3) errors.push('daily fields ' + JSON.stringify(f0)); else console.log('free energy and shops filled by server');
await page.evaluate(() => { S.energy = 10; render(); });
await click('[data-energy]'); await shot('18-energy-sheet');
await click('[data-free]');
const f1 = await page.evaluate(() => ({ e: S.energy, left: S.freeLeft }));
if (f1.left !== 1 || f1.e < 40) errors.push('free claim ' + JSON.stringify(f1)); else console.log('free claim +30');
await click('[data-shopgo="daily"]'); await shot('19-shop-daily');
await page.evaluate(() => { S.coins = 1000; render(); });
const j0 = await page.evaluate(() => S.jars || 0);
await click('[data-dbuy="jar"]');
const j1 = await page.evaluate(() => ({ jars: S.jars, left: S.dshop.jar, coins: S.coins }));
if (j1.jars !== j0 + 1 || j1.left !== 2) errors.push('daily jar ' + JSON.stringify(j1)); else console.log('daily shop jar bought');
await click('[data-stab="coins"]'); await shot('20-shop-coins');
await click('[data-stab="stars"]'); await shot('21-shop-stars');
await page.evaluate(() => { S.tok = 100; render(); });
await click('[data-stab="tok"]'); await shot('22-shop-tokens');
const jt = await page.evaluate(() => S.jars);
const jt2 = await page.evaluate(() => { S.tok = 100; document.querySelector('[data-tbuy="jar"]').click(); return { j: S.jars, t: S.tok }; });
if (jt2.j !== jt + 1 || jt2.t !== 85) errors.push('token shop ' + JSON.stringify(jt2)); else console.log('token shop jar bought');
await page.waitForTimeout(3200);
const srv3 = JSON.parse(env.DB.db.prepare('SELECT state FROM players WHERE uid=1001').get().state);
if (srv3.freeLeft !== 1 || srv3.dshop.jar !== 2) errors.push('server free/shop ' + JSON.stringify({ f: srv3.freeLeft, d: srv3.dshop })); else console.log('server accepted free claim and daily purchase');

// orders come from all characters, not only from the team; an order from a hero the player does not have can be given
const ord = await page.evaluate(() => {
  const team = teamHeroes(), seen = new Set(); let fromTeam = 0;
  for (let i = 0; i < 300; i++) { const o = mkOrder(); seen.add(o.hero); if (team.includes(o.hero)) fromTeam++; }
  const stranger = HERO_IDS.find((h) => !S.heroes[h]);
  S.orders[1] = mkOrder(stranger); const o = S.orders[1]; S.board = S.board.map(() => null); o.items.forEach((x) => place({ c: x.c, l: x.l }));
  const c0 = S.coins; give(1);
  return { kinds: seen.size, fromTeam, stranger, paid: S.coins - c0, ownsAfter: !!S.heroes[stranger] };
});
if (ord.kinds < 6 || ord.fromTeam < 90 || ord.fromTeam > 210 || ord.paid <= 0 || ord.ownsAfter) errors.push('orders from all ' + JSON.stringify(ord)); else console.log('orders from all characters', JSON.stringify(ord));

// signature dishes: every hero has one, all its products exist, a dish order pays 1.5x and can be given
const dish = await page.evaluate(() => {
  view = 'kitchen'; render(); S.level = Math.max(S.level, 6); const bad = HERO_IDS.filter((h) => !DISH[h] || DISH[h].items.some(([c, l]) => !LINES[c] || !LINES[c].it[l]));
  const o = mkDish('strongman'); S.orders[1] = o; S.board = S.board.map(() => null); o.items.forEach((x) => place({ c: x.c, l: x.l })); renderKitchen();
  const card = !!document.querySelector('.order.dishy .dish'); const c0 = S.coins; give(1);
  let seen = 0; for (let i = 0; i < 400; i++) { const x = mkOrder(); if (x && x.dish) seen++; }
  return { bad, card, paid: S.coins - c0, reward: o.reward, seen, lines: LINE_ORDER.length, gens: document.querySelectorAll('#shelf .gen').length };
});
if (dish.bad.length || !dish.card || dish.paid < dish.reward || dish.seen < 30 || dish.lines !== 6) errors.push('dishes ' + JSON.stringify(dish)); else console.log('signature dishes', JSON.stringify(dish));
await page.evaluate(() => { view = 'kitchen'; S.orders[0] = mkDish('cat'); S.orders[1] = mkDish('trainer'); S.orders[2] = mkDish('strongman'); render(); });
await shot('23-kitchen-dishes');

// sound: avatar opens settings, toggles are remembered, music zone follows the screen, effects do not throw
await page.evaluate(() => { closeSheet(); view = 'kitchen'; render(); });
await click('.hud [data-sound]'); await shot('24-sound');
const snd = await page.evaluate(() => {
  const z = []; for (const v of ['kitchen', 'heroes']) { view = v; render(); z.push(zoneOf()); }
  view = 'home'; curPlace = 'home'; render(); z.push(zoneOf()); curPlace = null; render(); z.push(zoneOf());
  ['tap', 'pop', 'merge', 'coins', 'level', 'built', 'chest', 'buy', 'nope'].forEach((n) => Sound.play(n, 3));
  openSheet('sound'); const musicRow = !!document.querySelector('[data-snd="music"]'); document.querySelector('[data-snd="sfx"]').click();
  return { zones: z.join(','), musicRow, sfx: Sound.prefs.sfx, saved: JSON.parse(localStorage.getItem('ys_audio') || '{}').sfx };
});
if (snd.zones !== 'kitchen,menu,home,street' || snd.musicRow || snd.sfx !== false || snd.saved !== false) errors.push('sound ' + JSON.stringify(snd)); else console.log('sound', JSON.stringify(snd));
await page.evaluate(() => { Sound.set('sfx', true); closeSheet(); });

// pictures: no cut furniture, no bits of neighbouring pictures (tools/check_assets.py)
{ const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python3', ['-I', new URL('../../tools/check_assets.py', import.meta.url).pathname], { encoding: 'utf8' });
  if (r.error) console.log('image check skipped: no python3'); else if (r.status !== 0) errors.push('images:\n' + r.stdout); else console.log(r.stdout.trim()); }

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nno errors');
await browser.close();
