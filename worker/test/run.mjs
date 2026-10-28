// Local test of the worker without Cloudflare: SQLite stands in for D1, Telegram is mocked.
// run: node --no-warnings test/run.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) { this.args = a.map((x) => (x === undefined ? null : x)); return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }
}

const env = { DB: new D1(), BOT_TOKEN: '111:AAA', OLD_BOT_TOKEN: '222:BBB', ADMIN_ID: '42', WEBHOOK_SECRET: 'sec', SETUP_KEY: 'k',
  GAME_URL: 'https://example.github.io/yardstars/', BOT_USERNAME: 'YardStarsGameBot' };

const tgCalls = [];
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').pop(); const body = JSON.parse(init.body || '{}');
  tgCalls.push({ method, body });
  const result = method === 'createInvoiceLink' ? 'https://t.me/$invoice' : true;
  return new Response(JSON.stringify({ ok: true, result }));
};

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
async function initData(user, token, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', token);
  p.set('hash', [...(await hmac(secret, check))].map((x) => x.toString(16).padStart(2, '0')).join(''));
  return p.toString();
}
const call = async (path, body, headers = {}) => {
  const r = await worker.fetch(new Request('https://w.dev' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), env, {});
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const tgUpdate = (u) => worker.fetch(new Request('https://w.dev/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify(u) }), env, {});
const cron = async () => { let p; await worker.scheduled({}, env, { waitUntil: (x) => (p = x) }); await p; };

let pass = 0; const ok = (name) => { pass++; console.log('✓', name); };
const user = { id: 1001, first_name: 'Илья', username: 'ilya' };
const INIT = await initData(user, env.BOT_TOKEN);

// --- auth
assert.equal((await call('/api/load', { initData: 'bad' })).status, 401); ok('bad initData rejected');
assert.equal((await call('/api/load', { initData: await initData(user, 'wrong:token') })).status, 401); ok('foreign bot signature rejected');

// --- load new player
let r = await call('/api/load', { initData: INIT, tz: 300 });
assert.equal(r.status, 200); assert.equal(r.data.state, null); assert.equal(r.data.rev, 0);
assert.ok(r.data.shop.find((x) => x.id === 'starter')); assert.ok(!r.data.shop.find((x) => x.id === 'test'));
ok('new player loads empty state with shop (no admin test item)');

// --- first save is clamped to a fresh start
const st0 = { owner: { avatar: 'm0', name: 'Илья' }, firstHero: 'trainer', heroes: { trainer: { lv: 1, xp: 0 }, cat: { lv: 1, xp: 0 } },
  coins: 999999, level: 50, energy: 100, eTs: Date.now(), upg: { sofa: { state: 'done' } }, board: [], paid: ['starter'] };
r = await call('/api/save', { initData: INIT, rev: 0, state: st0 });
assert.equal(r.status, 200); assert.equal(r.data.rev, 1);
assert.equal(r.data.fix.coins, 200); assert.equal(r.data.fix.level, 2); assert.deepEqual(Object.keys(r.data.fix.heroes), ['trainer']); assert.deepEqual(r.data.fix.upg, {});
let row = await env.DB.prepare('SELECT state FROM players WHERE uid=1001').first();
assert.ok(!JSON.parse(row.state).paid); ok('first save: coins/level/heroes/renovations clamped, server fields stripped');

// --- stale rev → conflict
r = await call('/api/save', { initData: INIT, rev: 0, state: st0 });
assert.equal(r.status, 409); assert.equal(r.data.rev, 1); ok('stale save returns conflict with server state');

// --- coin cap, hero unlock by level, renovation clock
let st = JSON.parse(row.state);
st.coins = 100000; st.level = 2; st.heroes.office = { lv: 1, xp: 0 }; st.heroes.cat = { lv: 1, xp: 0 }; st.upg = { walls: { state: 'build', start: 0, end: 1 } };
r = await call('/api/save', { initData: INIT, rev: 1, state: st });
assert.ok(r.data.fix.coins <= 200 + 600 + 80); assert.equal(Object.keys(r.data.fix.heroes).length, 1);
assert.equal(r.data.fix.upg.walls.state, 'build'); assert.ok(r.data.fix.upg.walls.end - Date.now() > 55000);
ok('coins capped, extra heroes refused at level 2, renovation timer set by server');

st.upg = { walls: { state: 'done' } };
r = await call('/api/save', { initData: INIT, rev: 2, state: st });
assert.equal(r.data.fix.upg.walls.state, 'build'); ok('cannot finish renovation early');

let al = await env.DB.prepare("SELECT * FROM alerts WHERE uid=1001 AND kind='repair'").first();
assert.ok(al && al.text.includes('Новые стены')); ok('repair alert scheduled');

// --- payments
r = await call('/api/invoice', { initData: INIT, sku: 'coinsM' });
assert.equal(r.data.link, 'https://t.me/$invoice');
const inv = tgCalls.findLast((c) => c.method === 'createInvoiceLink'); assert.equal(inv.body.currency, 'XTR'); assert.equal(inv.body.prices[0].amount, 100);
ok('invoice link in Stars');
assert.equal((await call('/api/invoice', { initData: INIT, sku: 'test' })).status, 400); ok('admin-only item hidden from players');

await tgUpdate({ pre_checkout_query: { id: 'pq1', from: user, invoice_payload: inv.body.payload } });
assert.equal(tgCalls.findLast((c) => c.method === 'answerPreCheckoutQuery').body.ok, true); ok('pre-checkout approved');
await tgUpdate({ pre_checkout_query: { id: 'pq2', from: { id: 999 }, invoice_payload: inv.body.payload } });
assert.equal(tgCalls.findLast((c) => c.method === 'answerPreCheckoutQuery').body.ok, false); ok('pre-checkout from another user refused');

const before = JSON.parse((await env.DB.prepare('SELECT state FROM players WHERE uid=1001').first()).state).coins;
const paid = { message: { message_id: 5, from: user, chat: { id: 1001 }, successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: inv.body.payload, telegram_payment_charge_id: 'ch1' } } };
await tgUpdate(paid); await tgUpdate(paid);
row = await env.DB.prepare('SELECT state, rev FROM players WHERE uid=1001').first();
assert.equal(JSON.parse(row.state).coins, before + 550); ok('payment credited exactly once');
r = await call('/api/claim', { initData: INIT });
assert.equal(r.data.rev, row.rev); assert.equal(r.data.state.coins, before + 550); ok('claim returns paid state');

// starter pack once
r = await call('/api/invoice', { initData: INIT, sku: 'starter' });
const inv2 = tgCalls.findLast((c) => c.method === 'createInvoiceLink');
await tgUpdate({ message: { from: user, chat: { id: 1001 }, successful_payment: { currency: 'XTR', total_amount: 50, invoice_payload: inv2.body.payload, telegram_payment_charge_id: 'ch2' } } });
r = await call('/api/load', { initData: INIT });
assert.ok(!r.data.shop.find((x) => x.id === 'starter')); assert.equal(r.data.state.pendingChests, 2); assert.ok(r.data.state.wardrobe.owned.includes('top:ys_hoodie'));
ok('starter pack: once, gives chests and hoodie');

// client can't drop server fields
st = r.data.state; st.paid = []; st.pendingChests = 99; st.chestsTaken = -5;
r = await call('/api/save', { initData: INIT, rev: r.data.rev, state: st });
row = JSON.parse((await env.DB.prepare('SELECT state FROM players WHERE uid=1001').first()).state);
assert.deepEqual(row.paid, ['starter']); assert.equal(row.pendingChests, 2); assert.equal(row.chestsTaken, 0); ok('server-only fields protected');

// speed-up purchase
const upEnd = row.upg.walls.end;
r = await call('/api/invoice', { initData: INIT, sku: 'speed:walls' });
const inv3 = tgCalls.findLast((c) => c.method === 'createInvoiceLink'); assert.ok(inv3.body.prices[0].amount >= 5);
await tgUpdate({ message: { from: user, chat: { id: 1001 }, successful_payment: { currency: 'XTR', total_amount: 5, invoice_payload: inv3.body.payload, telegram_payment_charge_id: 'ch3' } } });
row = JSON.parse((await env.DB.prepare('SELECT state FROM players WHERE uid=1001').first()).state);
assert.ok(row.upg.walls.end < upEnd); ok('speed-up ends the renovation now');

// --- import from the old game
const old = { id: 2002, first_name: 'Даша' };
r = await call('/api/import', { initData: await initData(old, env.BOT_TOKEN), data: { coins: 40 } });
assert.equal(r.status, 401); ok('import only accepts the OLD bot signature');
r = await call('/api/import', { initData: await initData(old, env.OLD_BOT_TOKEN), data: { coins: 40, owned: ['hat:crown', 'top:tux'], pet: { type: 'cat', name: 'Барсик', sex: 'm' } } });
assert.equal(r.status, 200);
const INIT2 = await initData(old, env.BOT_TOKEN);
r = await call('/api/load', { initData: INIT2 });
assert.equal(r.data.state, null); assert.equal(r.data.importedNow.pending, true); assert.equal(r.data.importedNow.pet.name, 'Барсик'); ok('import waits for onboarding');
await call('/api/save', { initData: INIT2, rev: 0, state: { owner: { avatar: 'f0' }, firstHero: 'cat', heroes: { cat: { lv: 1 } }, coins: 20, level: 1, energy: 100, eTs: Date.now() } });
r = await call('/api/load', { initData: INIT2 });
assert.equal(r.data.state.coins, 20 + 40 + 200); assert.ok(r.data.state.wardrobe.owned.includes('hat:crown')); assert.equal(r.data.state.pendingChests, 2);
assert.ok(r.data.state.badges.includes('first_neighbor')); assert.ok(!r.data.importedNow.pending); ok('import applied once after onboarding');
r = await call('/api/load', { initData: INIT2 }); assert.equal(r.data.importedNow, null); assert.equal(r.data.state.coins, 260); ok('import not applied twice');

// --- bot commands
tgCalls.length = 0;
await tgUpdate({ message: { from: { id: 3003, first_name: 'Лёша' }, chat: { id: 3003 }, text: '/start' } });
let m = tgCalls.find((c) => c.method === 'sendMessage'); assert.ok(m.body.text.includes('Yard Stars')); assert.equal(m.body.reply_markup.inline_keyboard[0][0].web_app.url, env.GAME_URL);
ok('/start welcomes with game button');
await tgUpdate({ message: { from: { id: 3003 }, chat: { id: 3003 }, text: '/bez_novostey' } });
assert.equal((await env.DB.prepare('SELECT news FROM players WHERE uid=3003').first()).news, 0); ok('/bez_novostey turns news off');
tgCalls.length = 0;
await tgUpdate({ message: { from: { id: 3003 }, chat: { id: 3003 }, text: '/stats' } });
assert.ok(!tgCalls.some((c) => (c.body.text || '').includes('📊'))); ok('/stats hidden from non-admin');
await tgUpdate({ message: { from: { id: 42, first_name: 'Admin' }, chat: { id: 42 }, text: '/stats' } });
assert.ok(tgCalls.some((c) => (c.body.text || '').includes('📊'))); ok('/stats works for admin');

// broadcast
await env.DB.prepare('UPDATE players SET started=1').run();
tgCalls.length = 0;
await tgUpdate({ message: { from: { id: 42 }, chat: { id: 42 }, text: '/rassylka Скоро Новый год во дворе!' } });
const bcRow = await env.DB.prepare('SELECT * FROM broadcasts').first(); assert.equal(bcRow.status, 'draft');
await tgUpdate({ callback_query: { id: 'cq', from: { id: 42 }, data: 'bc:go:' + bcRow.id, message: { chat: { id: 42 }, message_id: 7 } } });
tgCalls.length = 0; await cron();
const got = tgCalls.filter((c) => c.method === 'sendMessage' && c.body.text === 'Скоро Новый год во дворе!').map((c) => c.body.chat_id);
assert.ok(got.includes(1001) && !got.includes(3003)); ok('broadcast goes to news subscribers only (' + got.length + ')');
assert.equal((await env.DB.prepare('SELECT status FROM broadcasts').first()).status, 'done'); ok('broadcast finishes');

// --- alerts: due alert is sent unless the player is in the game; quiet hours postpone
await env.DB.prepare('DELETE FROM alerts').run();
await env.DB.prepare("INSERT INTO alerts VALUES (1001,'repair',?, 'готово!')").bind(Date.now() - 1000).run();
await env.DB.prepare('UPDATE players SET last_seen=? WHERE uid=1001').bind(Date.now()).run();
tgCalls.length = 0; await cron();
assert.ok(!tgCalls.some((c) => c.body.text === 'готово!')); assert.equal((await env.DB.prepare('SELECT COUNT(*) c FROM alerts').first()).c, 0); ok('alert skipped while player is in the game');

const realNow = Date.now;
const atLocal = (h) => { const d = new Date(); d.setUTCHours(h - 5, 0, 0, 0); return d.getTime(); }; // Almaty = UTC+5
await env.DB.prepare("INSERT INTO alerts VALUES (1001,'repair',?, 'готово!')").bind(atLocal(14) - 1000).run();
await env.DB.prepare('UPDATE players SET last_seen=?, sent_count=0 WHERE uid=1001').bind(atLocal(14) - 3600000).run();
Date.now = () => atLocal(14); tgCalls.length = 0; await cron();
assert.ok(tgCalls.some((c) => c.body.text === 'готово!')); ok('alert sent in the daytime');
await env.DB.prepare("INSERT INTO alerts VALUES (1001,'energy',?, 'энергия!')").bind(atLocal(23) + 60000).run();
Date.now = () => atLocal(23) + 120000; tgCalls.length = 0; await cron();
assert.ok(!tgCalls.some((c) => c.body.text === 'энергия!'));
const moved = await env.DB.prepare("SELECT at FROM alerts WHERE kind='energy'").first(); assert.ok(new Date(moved.at + 5 * 3600000).getUTCHours() === 7); ok('night alert moved to 7:00 local');
Date.now = realNow;

// --- heroes, teams, gear, looks
{
  const U = { id: 5005, first_name: 'Лук' }, I = await initData(U, env.BOT_TOKEN);
  await call('/api/load', { initData: I });
  let r = await call('/api/save', { initData: I, rev: 0, state: { owner: { avatar: 'm0' }, firstHero: 'lifter', heroes: { lifter: { lv: 1 }, strongman: { lv: 1 } }, coins: 20, level: 1, energy: 100, eTs: Date.now() } });
  assert.deepEqual(Object.keys(r.data.fix.heroes), ['lifter']); ok('start: one starter hero only');
  const row = () => env.DB.prepare('SELECT state, rev FROM players WHERE uid=5005').first();
  let p = await row(), st = JSON.parse(p.state);
  assert.deepEqual(st.teams, [['lifter'], [], [], []]); ok('starter placed in team 1');
  // level 3: a gift starter is allowed; non-starters still need shards/stars
  st.level = 3; st.heroes.trainer = { lv: 1 }; st.heroes.zoomer = { lv: 1 }; st.teams = [['lifter', 'trainer', 'zoomer'], ['cat'], []];
  st.gear = { lifter: ['singlet', 'benchbelt'] }; st.heroes.lifter.look = 'l_gold';
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.deepEqual(Object.keys(r.data.fix.heroes).sort(), ['lifter', 'trainer']); ok('gift starter at level 3, zoomer refused');
  p = await row(); st = JSON.parse(p.state);
  assert.deepEqual(st.teams, [['lifter', 'trainer'], [], [], []]); ok('teams: unknown heroes and closed team 2 cleared');
  assert.deepEqual(st.gear.lifter, ['singlet']); ok('gear for Stars refused without payment');
  assert.notEqual(st.heroes.lifter.look, 'l_gold'); ok('unpaid look refused');
  // level 4: one shard-built hero allowed
  st.level = 4; st.heroes.zoomer = { lv: 1 }; st.heroes.kid = { lv: 1 };
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(Object.keys(r.data.fix.heroes).length, 3); ok('shard hero cap: 1 per 4 levels');
  // buy gear, look, team, hero
  const pay = async (sku, charge) => {
    await call('/api/invoice', { initData: I, sku }); const iv = tgCalls.findLast((c) => c.method === 'createInvoiceLink');
    await tgUpdate({ message: { from: U, chat: { id: 5005 }, successful_payment: { currency: 'XTR', total_amount: iv.body.prices[0].amount, invoice_payload: iv.body.payload, telegram_payment_charge_id: charge } } });
    return iv.body.prices[0].amount;
  };
  assert.equal(await pay('gear:lifter:benchbelt', 'g1'), 100);
  assert.equal((await call('/api/invoice', { initData: I, sku: 'look:l_gold' })).status, 200); ok('whales can buy a costume before its level');
  { const q = await row(), x = JSON.parse(q.state); x.heroes.lifter.lv = 30; await env.DB.prepare('UPDATE players SET state=? WHERE uid=5005').bind(JSON.stringify(x)).run(); }
  assert.equal(await pay('look:l_gold', 'g2'), 1000);
  assert.equal(await pay('team:1', 'g3'), 300);
  assert.equal(await pay('hero:yoga', 'g4'), 500);
  r = await call('/api/load', { initData: I }); st = r.data.state;
  assert.ok(st.gear.lifter.includes('benchbelt')); assert.equal(st.heroes.lifter.look, 'l_gold'); assert.deepEqual(st.paidTeams, [1]); assert.ok(st.heroes.yoga);
  ok('paid gear, legendary look, team 2 and epic hero delivered');
  assert.equal((await call('/api/invoice', { initData: I, sku: 'look:l_plain' })).status, 400); ok('free look not for sale');
  assert.equal((await call('/api/invoice', { initData: I, sku: 'look:c_pirate' })).status, 400); ok('look for a hero you do not have is not for sale');
  assert.ok(st.teams[0].includes('yoga')); ok('bought hero joins a team automatically');
  st.teams[0] = st.teams[0].filter((h) => h !== 'yoga'); st.teams[1] = ['yoga']; st.heroes.lifter.look = 'l_plain';
  r = await call('/api/save', { initData: I, rev: r.data.rev, state: st });
  p = await row(); st = JSON.parse(p.state);
  assert.deepEqual(st.teams[1], ['yoga']); ok('paid team 2 usable before level 10');
  st.heroes.lifter.look = 'l_gold'; r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.heroes.lifter.look, 'l_gold'); ok('switch between owned looks');
  // appearances: open with hero level (lifter set to 14: 2nd at 5 open, 3rd at 15 after one level, 4th at 25 closed)
  { const q = await row(), x = JSON.parse(q.state); x.heroes.lifter.lv = 14; await env.DB.prepare('UPDATE players SET state=? WHERE uid=5005').bind(JSON.stringify(x)).run(); }
  p = await row(); st = JSON.parse(p.state);
  st.heroes.lifter.hair = 'l_hairbeard'; st.heroes.lifter.lv = 20;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  p = await row(); st = JSON.parse(p.state);
  assert.equal(st.heroes.lifter.lv, 15); ok('hero level grows by one per save');
  assert.notEqual(st.heroes.lifter.hair, 'l_hairbeard'); ok('appearance above hero level refused');
  st.heroes.lifter.hair = 'l_hair'; r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  p = await row(); st = JSON.parse(p.state);
  assert.equal(st.heroes.lifter.hair, 'l_hair'); ok('appearance opened by hero level');
  assert.equal((await call('/api/invoice', { initData: I, sku: 'look:l_hair' })).status, 400); ok('opened appearance not for sale');
  assert.equal(await pay('look:l_hairbeard', 'g5'), 75);
  r = await call('/api/load', { initData: I }); assert.equal(r.data.state.heroes.lifter.hair, 'l_hairbeard'); ok('appearance bought before its level is worn');
}

// missions: the last activity chest is reachable
{
  const { MISSIONS, MISSION_BOXES } = await import('../src/config.js');
  for (const k of ['day', 'week']) assert.ok(Object.values(MISSIONS[k]).reduce((a, x) => a + x.pts, 0) >= MISSION_BOXES[k].at(-1).at, k);
  ok('all missions give enough points for the last chest');
}

// main hero: any hero, female version kept, sex cannot change later
{
  const U = { id: 6106, first_name: 'Даша' }, I = await initData(U, env.BOT_TOKEN);
  await call('/api/load', { initData: I });
  let r = await call('/api/save', { initData: I, rev: 0, state: { owner: { avatar: 'f2' }, firstHero: 'lifter', heroes: { lifter: { lv: 1, sex: 'f' } }, coins: 20, level: 1, energy: 100, eTs: Date.now() } });
  const row = () => env.DB.prepare('SELECT state, rev FROM players WHERE uid=6106').first();
  let p = await row(), st = JSON.parse(p.state);
  assert.equal(st.heroes.lifter.sex, 'f'); ok('female main hero saved');
  st.heroes.lifter.sex = 'm'; r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(JSON.parse((await row()).state).heroes.lifter.sex, 'f'); ok('hero sex is chosen once');
  const U2 = { id: 6107, first_name: 'Ян' }, I2 = await initData(U2, env.BOT_TOKEN);
  await call('/api/load', { initData: I2 });
  await call('/api/save', { initData: I2, rev: 0, state: { owner: { avatar: 'm1' }, firstHero: 'hamster', heroes: { hamster: { lv: 1 } }, teams: [['hamster'], [], [], []], coins: 20, level: 1, energy: 100, eTs: Date.now() } });
  const s2 = JSON.parse((await env.DB.prepare('SELECT state FROM players WHERE uid=6107').first()).state);
  assert.ok(s2.heroes.hamster && s2.teams[0][0] === 'hamster'); ok('any hero can be the main one');
}

// energy jars and hero skills
{
  const U = { id: 6006, first_name: 'Банка' }, I = await initData(U, env.BOT_TOKEN);
  let r = await call('/api/load', { initData: I });
  r = await call('/api/save', { initData: I, rev: 0, state: { owner: { avatar: 'm0' }, firstHero: 'trainer', heroes: { trainer: { lv: 1 } }, coins: 20, level: 1, energy: 100, eTs: Date.now(), jars: 50 } });
  const row = () => env.DB.prepare('SELECT state, rev FROM players WHERE uid=6006').first();
  let p = await row(), st = JSON.parse(p.state);
  assert.equal(st.jars, 0); ok('fresh player cannot invent jars');
  r = await call('/api/load', { initData: I, tz: 300 });
  assert.equal(r.data.jarGift, 2); assert.equal(r.data.state.jars, 2); ok('daily gift: 2 jars');
  r = await call('/api/load', { initData: I, tz: 300 });
  assert.equal(r.data.jarGift, 0); ok('daily gift only once a day');
  st = r.data.state; st.jars = 0; st.energy = 110;
  r = await call('/api/save', { initData: I, rev: r.data.rev, state: st });
  assert.equal(r.data.fix.energy, 110); assert.equal(r.data.fix.jars, 0); ok('opened jars push energy over the cap');
  p = await row(); st = JSON.parse(p.state); st.jars = 9; st.energy = 200;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.jars, 0); assert.ok(r.data.fix.energy <= 112); ok('jars and energy cannot be added by the game');
  // free energy twice a day, daily/weekly coin shop
  r = await call('/api/load', { initData: I, tz: 300 }); st = r.data.state;
  assert.equal(st.freeLeft, 2); assert.equal(st.dshop.jar, 3); assert.equal(Object.keys(st.wshop.left).length, 3); ok('daily refill: free energy 2, daily shop, weekly heroes');
  st.energy = 0; await env.DB.prepare('UPDATE players SET state=? WHERE uid=6006').bind(JSON.stringify(st)).run();
  p = await row(); st = JSON.parse(p.state); st.freeLeft = 1; st.energy = 30;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.ok(r.data.fix.energy >= 30 && r.data.fix.energy <= 33, 'free ' + r.data.fix.energy); ok('free claim gives +30 energy');
  p = await row(); st = JSON.parse(p.state); st.freeLeft = 5; st.energy = 200;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.freeLeft, 1); assert.ok(r.data.fix.energy <= 33); ok('free claims cannot be refilled by the game');
  p = await row(); st = JSON.parse(p.state); st.coins = 500; await env.DB.prepare('UPDATE players SET state=? WHERE uid=6006').bind(JSON.stringify(st)).run();
  p = await row(); st = JSON.parse(p.state); st.dshop.jar = 1; st.jars = (st.jars || 0) + 2; st.coins = 500;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.jars, JSON.parse(p.state).jars + 2); assert.ok(r.data.fix.coins <= 500 - 160 + 600, 'coins'); ok('daily shop: bought jars kept, coins charged');
  p = await row(); st = JSON.parse(p.state); st.jars += 5;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.jars, JSON.parse(p.state).jars); ok('jars beyond the daily shop are refused');
  // missions: rewards once, boxes need points, fake days refused
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const mon = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  p = await row(); st = JSON.parse(p.state); const tok0 = st.tok || 0, jar0 = st.jars;
  st.mis = { d: today, ok: ['login', 'orders'], bx: [0, 1, 4], w: mon, wok: ['login'], wbx: [] }; st.tok = tok0 + 999; st.jars = jar0 + 99;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.tok, tok0 + 5 + 10 + 30); assert.equal(r.data.fix.jars, jar0 + 1 + 2); assert.deepEqual(r.data.fix.mis.bx, [0]); ok('missions: rewards counted by the server, chest 150 needs points');
  p = await row(); st = JSON.parse(p.state); st.tok += 50; st.mis.ok = ['login', 'orders', 'login'];
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.tok, JSON.parse(p.state).tok); ok('missions: no double rewards');
  p = await row(); st = JSON.parse(p.state); st.mis = { d: '2030-01-01', ok: ['login'], bx: [], w: mon, wok: ['login'], wbx: [] }; st.tok += 5;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.mis.d, today); assert.equal(r.data.fix.tok, JSON.parse(p.state).tok); ok('missions: fake future day refused');
  p = await row(); st = JSON.parse(p.state); const t1 = st.tok, j1 = st.jars; st.tok = t1 - 30; st.jars = j1 + 2;
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.tok, t1 - 30); assert.equal(r.data.fix.jars, j1 + 2); ok('token shop: jars bought with tokens kept');
  p = await row(); st = JSON.parse(p.state); st.heroes.trainer.name = '<b>Супер Тренер Дима из двора</b>';
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(JSON.parse((await row()).state).heroes.trainer.name, 'bСупер Тренер Ди'); ok('hero name cleaned and cut to 16');
  const { skillVal } = await import('../src/index.js');
  const base = { level: 5, teams: [['trainer'], [], [], []], heroes: { trainer: { lv: 20 } } };
  assert.equal(skillVal(base, 'regen'), 0.2); assert.equal(skillVal({ ...base, teams: [[], [], [], ['trainer']] }, 'regen'), 0); ok('skill works only from an open team, grows with hero level');
}

// second builder, hero stars, neighbour help
{
  const A = { id: 7007, first_name: 'Аня' }, IA = await initData(A, env.BOT_TOKEN);
  const B = { id: 7008, first_name: 'Боря' }, IB = await initData(B, env.BOT_TOKEN);
  await call('/api/load', { initData: IA }); await call('/api/load', { initData: IB });
  await call('/api/save', { initData: IA, rev: 0, state: { owner: { avatar: 'm0', name: 'Аня' }, firstHero: 'cat', heroes: { cat: { lv: 1 } }, coins: 20, level: 1, energy: 100, eTs: Date.now() } });
  await call('/api/save', { initData: IB, rev: 0, state: { owner: { avatar: 'm1', name: 'Боря' }, firstHero: 'trainer', heroes: { trainer: { lv: 1 } }, coins: 20, level: 1, energy: 100, eTs: Date.now() } });
  const rowA = () => env.DB.prepare('SELECT state, rev FROM players WHERE uid=7007').first();
  { const x = JSON.parse((await rowA()).state); x.level = 10; await env.DB.prepare('UPDATE players SET state=? WHERE uid=7007').bind(JSON.stringify(x)).run(); }
  let p = await rowA(), st = JSON.parse(p.state);
  st.upg = { walls: { state: 'build' }, rug: { state: 'build' } }; st.heroes.cat.stars = 3;
  let r = await call('/api/save', { initData: IA, rev: p.rev, state: st });
  assert.deepEqual(Object.keys(r.data.fix.upg), ['walls']); ok('one build at a time without the second builder');
  p = await rowA(); st = JSON.parse(p.state);
  assert.equal(st.heroes.cat.stars, 1); ok('stars: +1 per save');
  // help from Боря
  r = await call('/api/help', { initData: IB, target: 7007 });
  assert.equal(r.data.ok, true); assert.equal(r.data.reward, 1); ok('neighbour help accepted, helper gets a jar');
  const after = JSON.parse((await rowA()).state).upg.walls;
  assert.ok(after.end - after.start < 60000); ok('help cut the build time');
  r = await call('/api/help', { initData: IB, target: 7007 }); assert.equal(r.data.why, 'already'); ok('one help per neighbour per day');
  r = await call('/api/help', { initData: IA, target: 7007 }); assert.equal(r.data.why, 'self'); ok('cannot help yourself');
  // bot deep link
  tgCalls.length = 0;
  await tgUpdate({ message: { from: B, chat: { id: 7008 }, text: '/start help_7007' } });
  const m = tgCalls.find((c) => c.method === 'sendMessage');
  assert.ok(m.body.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?help=7007')); ok('help link opens the game with the neighbour id');
  // second builder
  p = await rowA(); st = JSON.parse(p.state); st.paid = [...(st.paid || []), 'builder'];
  await env.DB.prepare('UPDATE players SET state=? WHERE uid=7007').bind(JSON.stringify(st)).run();
  p = await rowA(); st = JSON.parse(p.state); st.upg.rug = { state: 'build' }; st.upg.sofa = { state: 'build' };
  r = await call('/api/save', { initData: IA, rev: p.rev, state: st });
  assert.equal(Object.values(r.data.fix.upg).filter((u) => u.state === 'build').length, 2); ok('second builder: two builds at once');
}

// a finished place gives 5 jars once
{
  const U = { id: 8008, first_name: 'Место' }, I = await initData(U, env.BOT_TOKEN);
  await call('/api/load', { initData: I });
  await call('/api/save', { initData: I, rev: 0, state: { owner: { avatar: 'm0' }, firstHero: 'cat', heroes: { cat: { lv: 1 } }, coins: 20, level: 1, energy: 100, eTs: Date.now() } });
  const yard = ['y_bench','y_sandbox','y_swing','y_lamp','y_flowers','y_slide','y_tree','y_fountain'];
  const x = JSON.parse((await env.DB.prepare('SELECT state FROM players WHERE uid=8008').first()).state);
  x.upg = Object.fromEntries(yard.map((id) => [id, { state: 'done' }])); x.jars = 0;
  await env.DB.prepare('UPDATE players SET state=? WHERE uid=8008').bind(JSON.stringify(x)).run();
  let p = await env.DB.prepare('SELECT state, rev FROM players WHERE uid=8008').first(), st = JSON.parse(p.state);
  let r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.jars, 5); ok('finished yard gives 5 jars');
  p = await env.DB.prepare('SELECT state, rev FROM players WHERE uid=8008').first(); st = JSON.parse(p.state);
  r = await call('/api/save', { initData: I, rev: p.rev, state: st });
  assert.equal(r.data.fix.jars, 5); ok('place reward only once');
}

// setup endpoint
let res = await worker.fetch(new Request('https://w.dev/setup?key=bad'), env, {}); assert.equal(res.status, 403);
tgCalls.length = 0; res = await worker.fetch(new Request('https://w.dev/setup?key=k'), env, {});
assert.equal(res.status, 200); assert.equal(tgCalls.find((c) => c.method === 'setWebhook').body.url, 'https://w.dev/tg'); ok('setup registers webhook, commands, menu button');
res = await worker.fetch(new Request('https://w.dev/tg', { method: 'POST', body: '{}' }), env, {}); assert.equal(res.status, 403); ok('webhook requires secret');

console.log(`\nall ${pass} checks passed`);
