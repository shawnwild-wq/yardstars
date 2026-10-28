// Old game «Береги его» with migration patch: exports to the new server and shows the banner.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import worker from '../src/index.js';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/usr/local/lib/node_modules/playwright')); }
class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a.map((x) => (x === undefined ? null : x)); return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; } async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }
class D1 { constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); } prepare(s) { return new Stmt(this.db, s); } async batch(l) { for (const s of l) await s.run(); } }
const env = { DB: new D1(), BOT_TOKEN: '111:AAA', OLD_BOT_TOKEN: '222:BBB' };
async function hmac(key, msg) { const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))); }
const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 777, first_name: 'Старожил' }) });
const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
p.set('hash', [...(await hmac(await hmac('WebAppData', env.OLD_BOT_TOKEN), check))].map((x) => x.toString(16).padStart(2, '0')).join(''));
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((st) => { localStorage.setItem('beregi-v2', JSON.stringify(st)); }, { pet: null, graves: [], best: 0, coins: 37, owned: ['hat:crown', 'top:tux'], ownInit: true, coinsInit: true, lastDead: { type: 'cat', name: 'Барсик', sex: 'm' } });
await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(p.toString())},ready(){},expand(){},openTelegramLink(u){window.__opened=u}}};` }));
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '' }));
await page.route('https://beregi-bot.shawnwild.workers.dev/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
await page.route('https://yardstars.shawnwild.workers.dev/**', async (r) => { const q = r.request();
  const res = await worker.fetch(new Request(q.url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: q.postData() }), env, {});
  r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() }); });
await page.route('http://old.local/', (r) => r.fulfill({ contentType: 'text/html', body: readFileSync(new URL('../../migration/beregi-index-step2-moved-banner.html', import.meta.url)) }));
await page.goto('http://old.local/'); await page.waitForTimeout(3500);
const row = env.DB.db.prepare('SELECT * FROM imports WHERE uid=777').get();
console.log('import row:', row && row.data);
await page.click('text=Открыть Yard Stars'); console.log('opened:', await page.evaluate(() => window.__opened));
await page.screenshot({ path: process.argv[2] + '/old-banner.png' });
console.log(errs.length ? 'ERRORS ' + errs.join('; ') : 'no errors'); await browser.close();
