// Yard Stars — Cloudflare Worker: game API, Telegram bot, Stars payments, notifications.
import { ECON, REPAIRS, REPAIR_NAMES, SKUS, HEROES, HERO_PRICE, HERO_NAMES, GIFT_LEVELS, SHARD_HEROES_PER_LEVELS, TEAM_OPEN, TEAM_SIZE,
  speedPrice, LOOKS, LOOK_NAMES, lookInfo, GEAR_STARS, HAIR, HAIR_LEVELS, costumeLevel, HERO_MAX_LEVEL, JAR_ENERGY, DAILY_JARS, SERVER_SKILLS, STAR_COST, STAR_SKILL, STARS_PER_LEVELS, HELPS, PLACE_OF, PLACE_JARS, FREE_ENERGY, FREE_PER_DAY, DSHOP, WSHOP, MISSIONS, MISSION_BOXES, TSHOP } from './config.js';

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

/* ------------------------------------------------------------------ utils */
const cors = (env) => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
});
const json = (env, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(env) } });

const almatyDay = (t, tz = 300) => new Date(t + tz * 60000).toISOString().slice(0, 10);
const localHour = (t, tz) => new Date(t + tz * 60000).getUTCHours();
const isQuiet = (t, tz) => { const h = localHour(t, tz); return h >= 23 || h < 7; };
function nextMorning(t, tz) {
  const d = new Date(t + tz * 60000);
  if (d.getUTCHours() >= 7) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(7, 0, 0, 0);
  return d.getTime() - tz * 60000;
}
const safeJson = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Telegram Mini App initData check: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export async function verifyInitData(initData, botToken, maxAgeSec = 7 * 24 * 3600) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const calc = hex(await hmac(secret, check));
  if (calc !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  const user = safeJson(params.get('user') || '');
  if (!user || !user.id) return null;
  return user;
}

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return data;
}

function playButton(env, text = 'Играть ▶️', query = '') {
  return { inline_keyboard: [[{ text, web_app: { url: env.GAME_URL + query } }]] };
}

/* ------------------------------------------------------------- db helpers */
async function getPlayer(env, uid) {
  return env.DB.prepare('SELECT * FROM players WHERE uid=?').bind(uid).first();
}
async function ensurePlayer(env, user, now) {
  await env.DB.prepare(
    `INSERT INTO players (uid, first_name, username, created_at, last_seen) VALUES (?,?,?,?,?)
     ON CONFLICT(uid) DO UPDATE SET first_name=excluded.first_name, username=excluded.username`
  ).bind(user.id, user.first_name || '', user.username || '', now, now).run();
  return getPlayer(env, user.id);
}
async function touch(env, uid, now, tz) {
  const day = almatyDay(now);
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET last_seen=?, tz=COALESCE(?, tz) WHERE uid=?').bind(now, Number.isFinite(tz) ? tz : null, uid),
    env.DB.prepare('INSERT OR IGNORE INTO visits (uid, day) VALUES (?,?)').bind(uid, day),
  ]);
}

/* ------------------------------------------------------- state validation */
// Fields only the server may change.
const SERVER_FIELDS = ['paid', 'paidHeroes', 'paidLooks', 'paidGear', 'paidTeams', 'createdAt', 'imported', 'badges', 'pendingChests', 'serverGifts', 'jarDay', 'helped', 'helpGiven', 'placesRewarded'];
const STARTERS = Object.keys(HEROES).filter((h) => HEROES[h] === 'starter');

// skill value of the hero that has this skill, if he stands in an open team
export function skillVal(st, kind) {
  const teams = Array.isArray(st && st.teams) ? st.teams : [];
  for (const [h, [k, per]] of Object.entries(SERVER_SKILLS)) {
    if (k !== kind) continue;
    const i = teams.findIndex((t) => Array.isArray(t) && t.includes(h));
    if (i < 0 || !TEAM_OPEN[i] || !((Number(st.level) || 1) >= TEAM_OPEN[i].lvl || (st.paidTeams || []).includes(i))) continue;
    const H = (st.heroes && st.heroes[h]) || {};
    const lv = Math.min(HERO_MAX_LEVEL, Number(H.lv) || 1), stars = Math.min(5, Number(H.stars) || 0);
    return per * lv * (1 + STAR_SKILL * stars);
  }
  return 0;
}
const regenMs = (st) => ECON.ENERGY_REGEN_MS / (1 + skillVal(st, 'regen'));

function regenEnergy(st, now) {
  let e = Number(st.energy) || 0, ts = Number(st.eTs) || now;
  const ms = regenMs(st);
  if (e < ECON.ENERGY_MAX) {
    const g = Math.floor((now - ts) / ms);
    if (g > 0) { e = Math.min(ECON.ENERGY_MAX, e + g); ts += g * ms; }
    if (e >= ECON.ENERGY_MAX) ts = now;
  } else ts = now;
  return { e, ts };
}

export function sanitize(prev, next, now, prevSavedAt) {
  if (!next || typeof next !== 'object') return prev;
  const out = { ...next };
  if (!prev) {
    // first save: fresh player. Clamp to starting values.
    out.coins = Math.min(Number(out.coins) || 0, 200);
    out.level = Math.min(Number(out.level) || 1, 2);
    out.energy = Math.min(Number(out.energy) || ECON.ENERGY_MAX, ECON.ENERGY_MAX + 20);
    out.eTs = Math.min(Number(out.eTs) || now, now);
    out.upg = {};
    // the main hero: any hero, male or female version
    const hs = Object.keys(out.heroes || {}).filter((h) => HEROES[h]).slice(0, 1);
    out.heroes = Object.fromEntries(hs.map((h) => [h, out.heroes[h] && out.heroes[h].sex === 'f' ? { lv: 1, xp: 0, sex: 'f' } : { lv: 1, xp: 0 }]));
    out.firstHero = hs[0];
    out.teams = [hs, [], [], []]; out.gear = {}; out.shards = {}; out.jars = 0;
    for (const f of SERVER_FIELDS) delete out[f];
    delete out.freeLeft; delete out.dshop; delete out.wshop; delete out.mis; out.tok = 0;
    out.createdAt = now;
    return out;
  }
  for (const f of SERVER_FIELDS) { if (prev[f] !== undefined) out[f] = prev[f]; else delete out[f]; }

  // level
  const pl = Number(prev.level) || 1;
  out.level = Math.max(pl, Math.min(Number(out.level) || pl, pl + 3));
  const levelGain = out.level - pl;

  // missions: claimed missions and activity chests give rewards once per day / week
  const mres = missionRewards(prev.mis, out.mis, now);
  if (mres.mis) out.mis = mres.mis; else delete out.mis;
  const mg = mres.give;

  // coins
  const mins = Math.max(0, (now - (prevSavedAt || now)) / 60000);
  const maxCoins = (Number(prev.coins) || 0) + ECON.COIN_EARN_SLACK + mins * ECON.COIN_EARN_PER_MIN + mg.coins;
  out.coins = Math.max(0, Math.min(Math.floor(Number(out.coins) || 0), Math.floor(maxCoins)));

  // daily goals: at most 3 done per day
  const pg = prev.goals || {}, ng = out.goals || {};
  let goalsGain = 0;
  if (ng && ng.done && typeof ng.done === 'object') {
    const keys = Object.keys(ng.done).slice(0, 3);
    ng.done = Object.fromEntries(keys.map((k) => [k, 1]));
    const prevDone = pg.day === ng.day ? Object.keys(pg.done || {}).length : 0;
    goalsGain = Math.max(0, keys.length - prevDone);
    out.goals = ng;
  }

  // daily/weekly limits and free energy: the server refills them, the game can only use them up
  const used = (pv, nv) => { const a = Math.max(0, Number(pv) || 0); const b = Math.max(0, Math.min(a, Math.floor(Number(nv)))); return Number.isFinite(b) ? b : a; };
  let freeUsed = 0, jarBought = 0, spent = 0;
  if (prev.freeLeft !== undefined) { out.freeLeft = used(prev.freeLeft, out.freeLeft); freeUsed = prev.freeLeft - out.freeLeft; } else delete out.freeLeft;
  if (prev.dshop && typeof prev.dshop === 'object') {
    const n = out.dshop && typeof out.dshop === 'object' ? out.dshop : {}, d = {};
    for (const k of Object.keys(DSHOP)) { d[k] = used(prev.dshop[k], n[k]); const b = (Number(prev.dshop[k]) || 0) - d[k]; spent += b * DSHOP[k].coins; if (k === 'jar') jarBought = b; }
    out.dshop = d;
  } else delete out.dshop;
  if (prev.wshop && typeof prev.wshop === 'object') {
    const n = out.wshop && out.wshop.left && typeof out.wshop.left === 'object' ? out.wshop.left : {}, left = {};
    for (const h of Object.keys(prev.wshop.left || {})) { left[h] = used(prev.wshop.left[h], n[h]); spent += ((Number(prev.wshop.left[h]) || 0) - left[h]) * WSHOP.coins; }
    out.wshop = { week: prev.wshop.week, left };
  } else delete out.wshop;
  if (spent) out.coins = Math.max(0, Math.min(out.coins, Math.floor(maxCoins - spent)));

  // жетоны соседа: earned from missions, spent in the token shop (jars bought with them are allowed)
  const ptok = Math.max(0, Number(prev.tok) || 0) + mg.tok;
  out.tok = Math.max(0, Math.min(Math.floor(Number(out.tok) || 0), ptok));
  const tokJars = Math.floor((ptok - out.tok) / TSHOP.jar);

  // energy
  const { e } = regenEnergy(prev, now);
  // jars: only the server adds them (daily gift, shops, missions); the game can only open (spend) them
  const pj = Math.max(0, Number(prev.jars) || 0) + jarBought + mg.jars + tokJars;
  out.jars = Math.max(0, Math.min(Math.floor(Number(out.jars) || 0), pj));
  const upper = e + freeUsed * FREE_ENERGY + (pj - out.jars) * JAR_ENERGY + goalsGain * (ECON.GOAL_ENERGY + Math.floor(skillVal(prev, 'goalE')))
    + levelGain * (ECON.LEVEL_ENERGY + Math.floor(skillVal(prev, 'levelE'))) + 2;
  out.energy = Math.max(0, Math.min(Math.floor(Number(out.energy) || 0), upper));
  out.eTs = Math.max(Number(prev.eTs) || 0, Math.min(Number(out.eTs) || now, now));

  // renovations: server owns the clock
  const pu = prev.upg || {}, nu = out.upg && typeof out.upg === 'object' ? out.upg : {};
  const fixed = {};
  for (const id of Object.keys(REPAIRS)) {
    const p = pu[id], n = nu[id];
    if (!n) { if (p) fixed[id] = p; continue; }
    if (n.state === 'done') {
      if (p && p.state === 'done') fixed[id] = p;
      else if (p && p.state === 'build' && now >= p.end - 3000) fixed[id] = { state: 'done' };
      else if (p) fixed[id] = p;
      continue;
    }
    if (n.state === 'build') {
      if (p && p.state === 'build') fixed[id] = p;
      else if (p && p.state === 'done') fixed[id] = p;
      else fixed[id] = { state: 'build', start: now, end: now + Math.round(REPAIRS[id] * 1000 * (1 - Math.min(0.5, skillVal(prev, 'build')))) };
    }
  }
  // one build at a time, two with the paid «second builder»
  const builders = (prev.paid || []).includes('builder') ? 2 : 1;
  const active = Object.keys(fixed).filter((id) => fixed[id].state === 'build');
  let room = builders - active.filter((id) => pu[id] && pu[id].state === 'build').length;
  for (const id of active) if (!(pu[id] && pu[id].state === 'build')) { if (room > 0) room--; else delete fixed[id]; }
  out.upg = fixed;
  // a fully finished place gives energy jars once
  const done = new Set(Object.keys(fixed).filter((id) => fixed[id].state === 'done'));
  const rewarded = new Set(out.placesRewarded || []);
  for (const pl of new Set(Object.values(PLACE_OF))) {
    if (rewarded.has(pl)) continue;
    const ids = Object.keys(PLACE_OF).filter((id) => PLACE_OF[id] === pl);
    if (ids.every((id) => done.has(id))) { rewarded.add(pl); out.jars = (Number(out.jars) || 0) + PLACE_JARS; }
  }
  if (rewarded.size) out.placesRewarded = [...rewarded];

  // heroes: 1 starter + gift starters by level + paid + shard-built (capped by level)
  const ph = prev.heroes || {}, nh = out.heroes && typeof out.heroes === 'object' ? out.heroes : {};
  const paidH = new Set(prev.paidHeroes || []);
  const gifts = 1 + GIFT_LEVELS.filter((l) => out.level >= l).length;
  const shardCap = Math.floor(out.level / SHARD_HEROES_PER_LEVELS);
  const heroes = {};
  for (const h of Object.keys(ph)) heroes[h] = { ...ph[h], ...(nh[h] || {}) };
  for (const h of paidH) if (!heroes[h]) heroes[h] = { lv: 1, xp: 0 };
  const count = (pred) => Object.keys(heroes).filter(pred).length;
  for (const h of Object.keys(nh)) {
    if (heroes[h] || !HEROES[h]) continue;
    const starter = HEROES[h] === 'starter';
    if (starter && count((x) => HEROES[x] === 'starter') < gifts) heroes[h] = { lv: 1, xp: 0, ...nh[h] };
    else if (!starter && count((x) => HEROES[x] !== 'starter' && !paidH.has(x) && x !== prev.firstHero) < shardCap) heroes[h] = { lv: 1, xp: 0, ...nh[h] };
  }
  // looks: free ones or bought ones; 'auto' = gear-set look decided by the game
  const paidL = new Set(prev.paidLooks || []);
  for (const h of Object.keys(heroes)) {
    const L = LOOKS[h] || {}, hr = HAIR[h] || [], H = heroes[h], P = ph[h] || {};
    // hero level grows by at most 1 per save
    const plv = Number(P.lv) || 1;
    H.lv = Math.max(plv, Math.min(Number(H.lv) || 1, plv + 1, HERO_MAX_LEVEL));
    delete H.freeHair;
    if (P.sex === 'f') H.sex = 'f'; else delete H.sex;   // chosen once at the start
    if (H.name !== undefined) { const nmv = String(H.name).replace(/[<>\n\r\t]/g, '').trim().slice(0, 16); if (nmv) H.name = nmv; else delete H.name; }
    // stars: +1 per save at most, capped by player level
    const ps = Number(P.stars) || 0;
    H.stars = Math.max(ps, Math.min(Number(H.stars) || 0, ps + 1, 5, Math.floor((Number(out.level) || 1) / STARS_PER_LEVELS)));
    if (!H.stars) delete H.stars;
    const owns = (id) => L[id] === 0 || paidL.has(id) || (hr.includes(id) && H.lv >= HAIR_LEVELS[hr.indexOf(id)]);
    if (H.hair && !(hr.includes(H.hair) && owns(H.hair))) { if (P.hair && owns(P.hair)) H.hair = P.hair; else delete H.hair; }
    const want = H.look;
    if (want && want !== 'auto' && !(want in L && owns(want))) H.look = P.look || 'auto';
  }
  out.heroes = heroes;

  // gear: items for Stars only if paid; gear never disappears
  const paidG = new Set(prev.paidGear || []);
  const gear = {};
  const ng2 = out.gear && typeof out.gear === 'object' ? out.gear : {}, pg2 = prev.gear || {};
  for (const h of Object.keys(heroes)) {
    const items = new Set([...(Array.isArray(ng2[h]) ? ng2[h] : []), ...(pg2[h] || [])]);
    for (const k of Object.keys(GEAR_STARS)) { const [gh, gid] = k.split(':'); if (gh === h && paidG.has(k)) items.add(gid); }
    gear[h] = [...items].filter((id) => typeof id === 'string' && (!GEAR_STARS[h + ':' + id] || paidG.has(h + ':' + id))).slice(0, 40);
  }
  out.gear = gear;

  // teams: only open teams, only owned heroes, no duplicates
  const paidT = new Set(prev.paidTeams || []);
  const seen = new Set();
  out.teams = [0, 1, 2, 3].map((i) => {
    const open = out.level >= TEAM_OPEN[i].lvl || paidT.has(i);
    const t = Array.isArray(out.teams && out.teams[i]) ? out.teams[i] : [];
    return open ? t.filter((h) => heroes[h] && !seen.has(h) && seen.add(h)).slice(0, TEAM_SIZE) : [];
  });
  if (!out.paidTeams && prev.paidTeams) out.paidTeams = prev.paidTeams;

  // chests granted by the server are taken one by one; the counter only grows
  out.chestsTaken = Math.max(Number(prev.chestsTaken) || 0, Math.min(Number(out.chestsTaken) || 0, Number(prev.pendingChests) || 0));

  // wardrobe: can't lose owned items
  const po = (prev.wardrobe && prev.wardrobe.owned) || [];
  out.wardrobe = out.wardrobe && typeof out.wardrobe === 'object' ? out.wardrobe : {};
  const owned = new Set([...(Array.isArray(out.wardrobe.owned) ? out.wardrobe.owned : []), ...po]);
  out.wardrobe.owned = [...owned].slice(0, 600);
  return out;
}

/* --------------------------------------------------------------- grants */
function applyGrant(st, sku, now) {
  st.paid = st.paid || [];
  if (sku.startsWith('speed:')) {
    const id = sku.slice(6);
    if (st.upg && st.upg[id] && st.upg[id].state === 'build') st.upg[id] = { state: 'build', start: st.upg[id].start, end: now };
    return 'Стройка «' + (REPAIR_NAMES[id] || id) + '» закончена!';
  }
  if (sku.startsWith('look:')) {
    const id = sku.slice(5), li = lookInfo(id);
    if (!li) return '';
    st.paidLooks = [...new Set([...(st.paidLooks || []), id])];
    st.heroes = st.heroes || {};
    const hh = st.heroes[li.hero];
    if (hh) { if ((HAIR[li.hero] || []).includes(id)) { hh.hair = id; hh.look = 'auto'; } else hh.look = id; }
    return 'Образ «' + (LOOK_NAMES[id] || id) + '» уже на герое!';
  }
  if (sku.startsWith('gear:')) {
    const key = sku.slice(5), g = GEAR_STARS[key];
    if (!g) return '';
    const [h, id] = key.split(':');
    st.paidGear = [...new Set([...(st.paidGear || []), key])];
    st.gear = st.gear || {}; st.gear[h] = [...new Set([...(st.gear[h] || []), id])];
    return g[0] + ' — уже на герое!';
  }
  if (sku.startsWith('team:')) {
    const i = Number(sku.slice(5));
    st.paidTeams = [...new Set([...(st.paidTeams || []), i])];
    return 'Команда ' + (i + 1) + ' открыта!';
  }
  if (sku.startsWith('hero:')) {
    const h = sku.slice(5);
    st.paidHeroes = [...new Set([...(st.paidHeroes || []), h])];
    st.heroes = st.heroes || {};
    if (!st.heroes[h]) st.heroes[h] = { lv: 1, xp: 0 };
    st.teams = st.teams || [[], [], []];
    if (!st.teams.flat().includes(h)) { const t = st.teams.find((x, i) => ((st.level || 1) >= TEAM_OPEN[i].lvl || (st.paidTeams || []).includes(i)) && x.length < TEAM_SIZE); if (t) t.push(h); }
    return (HERO_NAMES[h] || h) + ' переехал к тебе во двор!';
  }
  const s = SKUS[sku];
  if (!s) return '';
  const g = s.give || {};
  if (g.coins) st.coins = (Number(st.coins) || 0) + g.coins;
  if (g.energy) { const r = regenEnergy(st, now); st.energy = r.e + g.energy; st.eTs = r.ts; }
  if (g.jars) st.jars = (Number(st.jars) || 0) + g.jars;
  if (g.chests) st.pendingChests = (st.pendingChests || 0) + g.chests;
  if (g.items) { st.wardrobe = st.wardrobe || {}; st.wardrobe.owned = [...new Set([...(st.wardrobe.owned || []), ...g.items])]; }
  if (s.once) st.paid.push(sku);
  return 'Покупка «' + s.title + '» уже в игре!';
}

function priceFor(sku, st, now, isAdmin) {
  if (sku.startsWith('speed:')) {
    const id = sku.slice(6), u = st && st.upg && st.upg[id];
    if (!u || u.state !== 'build' || u.end <= now) return null;
    return { title: 'Ускорить: ' + (REPAIR_NAMES[id] || id), desc: 'Закончить стройку прямо сейчас', stars: speedPrice(u.end - now) };
  }
  if (sku.startsWith('look:')) {
    const id = sku.slice(5), li = lookInfo(id);
    if (!li || !li.stars || (st && (st.paidLooks || []).includes(id))) return null;
    if (!(st && st.heroes && st.heroes[li.hero])) return null;
    const hv = Number(st.heroes[li.hero].lv) || 1, hr = HAIR[li.hero] || [];
    if (hr.includes(id) && hv >= HAIR_LEVELS[hr.indexOf(id)]) return null; // already open by level
    return { title: 'Образ: ' + (LOOK_NAMES[id] || id), desc: 'Новый образ героя — навсегда', stars: li.stars };
  }
  if (sku.startsWith('gear:')) {
    const key = sku.slice(5), g = GEAR_STARS[key];
    if (!g || (st && (st.paidGear || []).includes(key))) return null;
    if (!(st && st.heroes && st.heroes[key.split(':')[0]])) return null;
    return { title: g[0], desc: 'Экипировка героя — навсегда, даёт бонус к монетам', stars: g[1] };
  }
  if (sku.startsWith('team:')) {
    const i = Number(sku.slice(5)), t = TEAM_OPEN[i];
    if (!t || !t.stars || (st && ((st.paidTeams || []).includes(i) || (st.level || 1) >= t.lvl))) return null;
    return { title: 'Команда ' + (i + 1), desc: 'Ещё 5 героев и ещё один заказ на кухне', stars: t.stars };
  }
  if (sku.startsWith('hero:')) {
    const h = sku.slice(5);
    if (!HERO_PRICE[HEROES[h]] || (st && st.heroes && st.heroes[h])) return null;
    return { title: 'Герой: ' + (HERO_NAMES[h] || h), desc: 'Новый сосед во дворе прямо сейчас', stars: HERO_PRICE[HEROES[h]] };
  }
  const s = SKUS[sku];
  if (!s) return null;
  if (s.adminOnly && !isAdmin) return null;
  if (s.once && st && (st.paid || []).includes(sku)) return null;
  if (s.starter && st && st.createdAt && now - st.createdAt > ECON.STARTER_WINDOW_MS) return null;
  return s;
}

function shopFor(st, now, isAdmin) {
  const list = [];
  for (const id of Object.keys(SKUS)) {
    const p = priceFor(id, st, now, isAdmin);
    if (p) list.push({ id, title: p.title, desc: p.desc, stars: p.stars, until: SKUS[id].starter && st && st.createdAt ? st.createdAt + ECON.STARTER_WINDOW_MS : null });
  }
  return list;
}

/* --------------------------------------------------------------- alerts */
function voice(st) { const h = st && st.firstHero; return HERO_NAMES[h] || 'Шеф'; }

async function rescheduleAlerts(env, uid, st, now) {
  const stmts = [env.DB.prepare('DELETE FROM alerts WHERE uid=?').bind(uid)];
  for (const [id, u] of Object.entries(st.upg || {})) {
    if (u.state === 'build' && u.end > now) {
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO alerts (uid, kind, at, text) VALUES (?,?,?,?)')
        .bind(uid, 'repair', u.end, `🔨 ${REPAIR_NAMES[id] || 'Ремонт'} — готово! Заходи посмотреть, как стало уютно. — ${voice(st)}`));
    }
  }
  const e = Number(st.energy) || 0;
  if (e < ECON.ENERGY_MAX) {
    const at = (Number(st.eTs) || now) + (ECON.ENERGY_MAX - e) * regenMs(st);
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO alerts (uid, kind, at, text) VALUES (?,?,?,?)')
      .bind(uid, 'energy', Math.max(at, now + 60 * 60 * 1000), '⚡ Энергия снова 100/100 — соседи ждут заказы на кухне. Заходи! — Шеф'));
  }
  await env.DB.batch(stmts);
}

async function sendTo(env, uid, text, withButton = true) {
  const r = await tg(env, 'sendMessage', { chat_id: uid, text, reply_markup: withButton ? playButton(env) : undefined });
  if (!r.ok && (r.error_code === 403 || r.error_code === 400)) {
    await env.DB.prepare('UPDATE players SET blocked=1 WHERE uid=?').bind(uid).run();
  }
  return !!r.ok;
}

async function countSend(env, p, now) {
  const day = almatyDay(now, p.tz);
  const n = p.sent_day === day ? p.sent_count : 0;
  if (n >= 4) return false;
  await env.DB.prepare('UPDATE players SET sent_day=?, sent_count=? WHERE uid=?').bind(day, n + 1, p.uid).run();
  return true;
}

/* -------------------------------------------------------------- API routes */
async function apiAuth(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  return user;
}

// missions: day = local date shifted by 7 h ("YYYY-MM-DD"), week = that day's Monday
const plausible = (d, now, slackDays) => { const t = Date.parse(d + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(t) && Math.abs(t - now) <= slackDays * 86400000; };
function claimSide(kind, pd, pok, pbx, nd, nok, nbx, now, slack) {
  const M = MISSIONS[kind], B = MISSION_BOXES[kind];
  const valid = (a) => [...new Set(Array.isArray(a) ? a : [])];
  let base = { d: pd, ok: valid(pok).filter((id) => M[id]), bx: valid(pbx).filter((i) => B[i]) };
  if (nd && nd !== pd && plausible(nd, now, slack) && (!pd || nd > pd)) base = { d: nd, ok: [], bx: [] };
  if (!base.d || nd !== base.d) return { side: base, give: [] };
  const ok = [...new Set([...base.ok, ...valid(nok).filter((id) => M[id])])];
  const pts = ok.reduce((a, id) => a + M[id].pts, 0);
  const bx = [...new Set([...base.bx, ...valid(nbx).filter((i) => B[i] && B[i].at <= pts)])];
  const give = [...ok.filter((id) => !base.ok.includes(id)).map((id) => M[id].give), ...bx.filter((i) => !base.bx.includes(i)).map((i) => B[i].give)];
  return { side: { d: base.d, ok, bx }, give };
}
function missionRewards(pm, nm, now) {
  const z = { tok: 0, jars: 0, coins: 0 };
  if (!nm || typeof nm !== 'object') return { mis: pm, give: z };
  pm = pm || {};
  const D = claimSide('day', pm.d, pm.ok, pm.bx, nm.d, nm.ok, nm.bx, now, 1.5);
  const W = claimSide('week', pm.w, pm.wok, pm.wbx, nm.w, nm.wok, nm.wbx, now, 8);
  for (const g of [...D.give, ...W.give]) { z.tok += g.tok || 0; z.jars += g.jars || 0; z.coins += g.coins || 0; }
  const keep = { d: D.side.d, ok: D.side.ok, bx: D.side.bx, w: W.side.d, wok: W.side.ok, wbx: W.side.bx };
  keep.c = nm.c && typeof nm.c === 'object' && nm.d === keep.d ? nm.c : {};
  keep.wc = nm.wc && typeof nm.wc === 'object' && nm.w === keep.w ? nm.wc : {};
  return { mis: keep, give: z };
}

// week number (Monday-based) and the heroes on sale that week
function weekOf(t) { return Math.floor((t / 86400000 + 3) / 7); }
function weekHeroes(week) {
  const pool = Object.keys(HEROES).filter((h) => HEROES[h] !== 'starter');
  const out = []; let i = (week * 5) % pool.length;
  while (out.length < WSHOP.heroes) { out.push(pool[i % pool.length]); i += 3; }
  return [...new Set(out)];
}
async function apiLoad(env, body, now) {
  const user = await apiAuth(env, body);
  if (!user) return json(env, { error: 'auth' }, 401);
  let p = await ensurePlayer(env, user, now);
  await touch(env, user.id, now, Number(body.tz));
  let st = safeJson(p.state);
  let importedNow = null;
  const imp = await env.DB.prepare('SELECT * FROM imports WHERE uid=? AND applied=0').bind(user.id).first();
  if (imp) {
    const d = safeJson(imp.data, {}) || {};
    importedNow = { coins: Math.max(0, Math.min(5000, Number(d.coins) || 0)), items: Array.isArray(d.owned) ? d.owned.slice(0, 400) : [], pet: d.pet || null };
    if (st) {
      st.coins = (Number(st.coins) || 0) + importedNow.coins + 200;
      st.pendingChests = (st.pendingChests || 0) + 2;
      st.wardrobe = st.wardrobe || {};
      st.wardrobe.owned = [...new Set([...(st.wardrobe.owned || []), ...importedNow.items])];
      st.badges = [...new Set([...(st.badges || []), 'first_neighbor'])];
      st.imported = true;
      await env.DB.batch([
        env.DB.prepare('UPDATE players SET state=?, rev=rev+1 WHERE uid=?').bind(JSON.stringify(st), user.id),
        env.DB.prepare('UPDATE imports SET applied=1 WHERE uid=?').bind(user.id),
      ]);
      p = await getPlayer(env, user.id);
    } else importedNow.pending = true; // applied after onboarding (next load)
  }
  // daily gift: energy jars, once per local day
  let jarGift = 0;
  if (st) {
    const tz = Math.max(-840, Math.min(840, Number(body.tz) || 0));
    const day = new Date(now + tz * 60000 - 7 * 3600000).toISOString().slice(0, 10);  // the day starts at 7:00 local
    const week = weekOf(now + tz * 60000 - 7 * 3600000);
    let changed = false;
    if (st.jarDay !== day) {
      st.jarDay = day; st.jars = (Number(st.jars) || 0) + DAILY_JARS; jarGift = DAILY_JARS;
      st.freeLeft = FREE_PER_DAY; st.dshop = Object.fromEntries(Object.keys(DSHOP).map((k) => [k, DSHOP[k].lim]));
      changed = true;
    }
    if (!st.wshop || st.wshop.week !== week) { st.wshop = { week, left: Object.fromEntries(weekHeroes(week).map((h) => [h, WSHOP.lim])) }; changed = true; }
    if (changed) {
      await env.DB.prepare('UPDATE players SET state=?, rev=rev+1 WHERE uid=?').bind(JSON.stringify(st), user.id).run();
      p = await getPlayer(env, user.id);
    }
  }
  const isAdmin = String(user.id) === String(env.ADMIN_ID);
  return json(env, {
    now, rev: p.rev, state: st, user: { id: user.id, first_name: user.first_name },
    shop: shopFor(st, now, isAdmin), importedNow, isAdmin, jarGift,
  });
}

async function apiSave(env, body, now) {
  const user = await apiAuth(env, body);
  if (!user) return json(env, { error: 'auth' }, 401);
  const raw = JSON.stringify(body.state || null);
  if (raw.length > ECON.MAX_STATE_BYTES) return json(env, { error: 'too_big' }, 413);
  const p = await ensurePlayer(env, user, now);
  if (Number(body.rev) !== Number(p.rev)) {
    return json(env, { error: 'conflict', rev: p.rev, state: safeJson(p.state), now }, 409);
  }
  const prev = safeJson(p.state);
  const st = sanitize(prev, body.state, now, prev && prev.savedAt);
  st.savedAt = now;
  const rev = p.rev + 1;
  await env.DB.prepare('UPDATE players SET state=?, rev=?, last_seen=? WHERE uid=?').bind(JSON.stringify(st), rev, now, user.id).run();
  await rescheduleAlerts(env, user.id, st, now);
  // tell the client only what the server corrected
  return json(env, { ok: true, rev, now, fix: { coins: st.coins, energy: st.energy, eTs: st.eTs, jars: st.jars, level: st.level, upg: st.upg, heroes: st.heroes, freeLeft: st.freeLeft, dshop: st.dshop, wshop: st.wshop, tok: st.tok, mis: st.mis } });
}

async function apiInvoice(env, body, now) {
  const user = await apiAuth(env, body);
  if (!user) return json(env, { error: 'auth' }, 401);
  const p = await ensurePlayer(env, user, now);
  const st = safeJson(p.state);
  const sku = String(body.sku || '');
  const isAdmin = String(user.id) === String(env.ADMIN_ID);
  const s = priceFor(sku, st, now, isAdmin);
  if (!s) return json(env, { error: 'unavailable' }, 400);
  const r = await tg(env, 'createInvoiceLink', {
    title: s.title, description: s.desc, payload: JSON.stringify({ u: user.id, s: sku, t: now }),
    currency: 'XTR', prices: [{ label: s.title, amount: s.stars }],
  });
  if (!r.ok) return json(env, { error: 'telegram', detail: r.description }, 502);
  return json(env, { link: r.result });
}

async function apiClaim(env, body, now) {
  const user = await apiAuth(env, body);
  if (!user) return json(env, { error: 'auth' }, 401);
  const p = await getPlayer(env, user.id);
  const isAdmin = String(user.id) === String(env.ADMIN_ID);
  const st = safeJson(p && p.state);
  return json(env, { rev: p ? p.rev : 0, state: st, now, shop: shopFor(st, now, isAdmin) });
}

// a neighbour helps with the current renovation of another player
async function apiHelp(env, body, now) {
  const user = await apiAuth(env, body);
  if (!user) return json(env, { error: 'auth' }, 401);
  const target = Number(body.target);
  if (!target || target === Number(user.id)) return json(env, { ok: false, why: 'self' });
  const tp = await getPlayer(env, target), ts = tp && safeJson(tp.state);
  if (!ts) return json(env, { ok: false, why: 'nobody' });
  const day = new Date(now).toISOString().slice(0, 10), who = ts.owner && ts.owner.name;
  const h = ts.helped && ts.helped.day === day ? ts.helped : { day, by: [] };
  if (h.by.includes(Number(user.id))) return json(env, { ok: false, why: 'already', name: who });
  if (h.by.length >= HELPS.PER_DAY) return json(env, { ok: false, why: 'full', name: who });
  const id = Object.keys(ts.upg || {}).find((k) => ts.upg[k].state === 'build' && ts.upg[k].end > now);
  if (!id) return json(env, { ok: false, why: 'nobuild', name: who });
  const u = ts.upg[id], cut = Math.max(HELPS.MIN_MS, Math.round((u.end - u.start) * HELPS.CUT));
  u.end = Math.max(now, u.end - cut);
  h.by.push(Number(user.id)); ts.helped = h;
  await env.DB.prepare('UPDATE players SET state=?, rev=rev+1 WHERE uid=?').bind(JSON.stringify(ts), target).run();
  await rescheduleAlerts(env, target, ts, now);
  let reward = 0;
  const mp = await getPlayer(env, user.id), ms = mp && safeJson(mp.state);
  if (ms) {
    const g = ms.helpGiven && ms.helpGiven.day === day ? ms.helpGiven : { day, n: 0 };
    if (g.n < HELPS.REWARD_PER_DAY) { g.n++; ms.jars = (Number(ms.jars) || 0) + 1; reward = 1; }
    ms.helpGiven = g;
    await env.DB.prepare('UPDATE players SET state=?, rev=rev+1 WHERE uid=?').bind(JSON.stringify(ms), user.id).run();
  }
  const minutes = Math.round(cut / 60000);
  await tg(env, 'sendMessage', { chat_id: target, text: '🤝 ' + (user.first_name || 'Сосед') + ' помог с ремонтом «' + (REPAIR_NAMES[id] || id) + '» — быстрее на ' + minutes + ' мин!', reply_markup: playButton(env) });
  return json(env, { ok: true, name: who, repair: REPAIR_NAMES[id] || id, minutes, reward });
}

async function apiImport(env, body, now) {
  // Called by the OLD game «Береги его»: initData is signed by the old bot.
  const user = await verifyInitData(body && body.initData, env.OLD_BOT_TOKEN, 30 * 24 * 3600);
  if (!user) return json(env, { error: 'auth' }, 401);
  const d = body.data || {};
  const data = JSON.stringify({
    coins: Math.max(0, Math.min(5000, Number(d.coins) || 0)),
    owned: Array.isArray(d.owned) ? d.owned.filter((x) => typeof x === 'string').slice(0, 400) : [],
    pet: d.pet && typeof d.pet === 'object' ? { type: String(d.pet.type || ''), name: String(d.pet.name || '').slice(0, 40), sex: d.pet.sex === 'f' ? 'f' : 'm' } : null,
  });
  await env.DB.prepare(
    `INSERT INTO imports (uid, data, at) VALUES (?,?,?)
     ON CONFLICT(uid) DO UPDATE SET data=excluded.data, at=excluded.at WHERE imports.applied=0`
  ).bind(user.id, data, now).run();
  return json(env, { ok: true, bot: env.BOT_USERNAME || '' });
}

/* -------------------------------------------------------------- bot logic */
const WELCOME = (name) =>
  `Привет${name ? ', ' + name : ''}! 👋\n\nДобро пожаловать в Yard Stars ⭐ — двор, где живут твои герои.\n\n🍳 Готовь на кухне: соединяй продукты и выполняй заказы соседей\n🏗️ Отстраивай улицу: дом, двор, спортплощадку, кафе, парк и рынок\n🦸 Собирай команду героев, наряжай их и прокачивай\n📋 Выполняй миссии и забирай сундуки\n\nВыбери своего главного героя — и вперёд! Я напишу, когда стройка закончится или энергия восстановится.\n\nНовости: /bez_novostey — выключить, /s_novostyami — включить.`;
const HELP =
  'Yard Stars — уютная игра про двор и соседей.\n\n🍳 Кухня: соединяй одинаковые продукты и выполняй заказы героев.\n🏠 Дом: монеты идут на ремонт.\n✅ Цели дня: позаботься о себе и получи энергию.\n\nКоманды:\n/bez_novostey — без новостей\n/s_novostyami — с новостями\n/paysupport — помощь с оплатой';

async function onMessage(env, m, now) {
  const uid = m.from && m.from.id;
  if (!uid) return;
  const isAdmin = String(uid) === String(env.ADMIN_ID);

  if (m.successful_payment) return onPaid(env, m, now);

  const text = (m.text || '').trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = text.slice(cmd.length).trim();
  await ensurePlayer(env, m.from, now);
  await env.DB.prepare('UPDATE players SET started=1, blocked=0 WHERE uid=?').bind(uid).run();

  switch (cmd.split('@')[0]) {
    case '/start': {
      const help = /^help_(\d+)$/.exec(arg);
      if (help && help[1] !== String(uid)) {
        return tg(env, 'sendMessage', { chat_id: uid, text: 'Соседу нужна помощь с ремонтом! Открой двор — твоя помощь ускорит стройку, а тебе достанется банка энергии 🥫', reply_markup: playButton(env, 'Помочь соседу 🤝', '?help=' + help[1]) });
      }
      return tg(env, 'sendMessage', { chat_id: uid, text: WELCOME(m.from.first_name), reply_markup: playButton(env, 'Открыть двор ▶️') });
    }
    case '/help':
      return tg(env, 'sendMessage', { chat_id: uid, text: HELP, reply_markup: playButton(env) });
    case '/bez_novostey':
      await env.DB.prepare('UPDATE players SET news=0 WHERE uid=?').bind(uid).run();
      return tg(env, 'sendMessage', { chat_id: uid, text: 'Готово: новости больше не пришлю. Сообщения «твоё готово» остаются. Включить обратно — /s_novostyami' });
    case '/s_novostyami':
      await env.DB.prepare('UPDATE players SET news=1 WHERE uid=?').bind(uid).run();
      return tg(env, 'sendMessage', { chat_id: uid, text: 'Готово: буду присылать новости о праздниках, нарядах и обновлениях.' });
    case '/paysupport':
      return tg(env, 'sendMessage', { chat_id: uid, text: 'Проблема с покупкой? Напиши одним сообщением, что купил и когда, — разберёмся и, если нужно, вернём звёзды. Обычно отвечаем в течение суток.' });
  }

  if (isAdmin) {
    if (cmd === '/stats') return tg(env, 'sendMessage', { chat_id: uid, text: await statsText(env, now) });
    if (cmd === '/rassylka') {
      if (!arg) return tg(env, 'sendMessage', { chat_id: uid, text: 'Напиши так: /rassylka Текст сообщения' });
      const r = await env.DB.prepare('INSERT INTO broadcasts (text, created) VALUES (?,?)').bind(arg, now).run();
      const id = r.meta.last_row_id;
      const n = await env.DB.prepare('SELECT COUNT(*) c FROM players WHERE news=1 AND started=1 AND blocked=0').first();
      await tg(env, 'sendMessage', { chat_id: uid, text: arg, reply_markup: playButton(env) });
      return tg(env, 'sendMessage', {
        chat_id: uid, text: `☝️ Так увидят игроки. Получателей: ${n.c}. Отправляем?`,
        reply_markup: { inline_keyboard: [[{ text: '✅ Отправить', callback_data: 'bc:go:' + id }, { text: '✖️ Отмена', callback_data: 'bc:no:' + id }]] },
      });
    }
    if (cmd === '/igrok') {
      if (!arg) return tg(env, 'sendMessage', { chat_id: uid, text: 'Напиши так: /igrok Имя  или  /igrok @username' });
      const q = '%' + arg.replace(/^@/, '').toLowerCase() + '%';
      const rows = (await env.DB.prepare('SELECT uid, first_name, username, state FROM players WHERE lower(first_name) LIKE ? OR lower(username) LIKE ? LIMIT 10').bind(q, q).all()).results || [];
      const lines = rows.map((r) => { const st = safeJson(r.state) || {}; return `id ${r.uid} — ${r.first_name || '—'} (@${r.username || '—'}), ур. ${st.level || '—'}, монет ${st.coins ?? '—'}`; });
      return tg(env, 'sendMessage', { chat_id: uid, text: lines.length ? lines.join('\n') + '\n\nПодарок: /podarok id монеты банки' : 'Никого не нашёл.' });
    }
    if (cmd === '/podarok') {
      const [u, c, j, ...extra] = rest; const target = Number(u);
      const p = target && await getPlayer(env, target); const st = p && safeJson(p.state);
      if (!st) return tg(env, 'sendMessage', { chat_id: uid, text: 'Напиши так: /podarok id монеты банки [look:… gear:…]\nИгрок должен уже начать игру. id ищи через /igrok Имя' });
      const coins = Math.max(0, Math.min(100000, Number(c) || 0)), jars = Math.max(0, Math.min(1000, Number(j) || 0));
      st.coins = (Number(st.coins) || 0) + coins; st.jars = (Number(st.jars) || 0) + jars;
      const got = []; if (coins) got.push(coins + ' монет'); if (jars) got.push(jars + ' банок энергии');
      for (const sku of extra) { const msg = applyGrant(st, sku, now); if (msg) got.push(LOOK_NAMES[sku.slice(5)] || sku); }
      await env.DB.prepare('UPDATE players SET state=?, rev=rev+1 WHERE uid=?').bind(JSON.stringify(st), target).run();
      await tg(env, 'sendMessage', { chat_id: target, text: '🎁 Подарок от Yard Stars: ' + (got.join(', ') || 'сюрприз') + '!\nСпасибо, что ты с нами с самого начала 💛', reply_markup: playButton(env, 'Забрать ▶️') });
      return tg(env, 'sendMessage', { chat_id: uid, text: 'Готово: ' + (got.join(', ') || 'ничего') + ' → id ' + target });
    }
    if (cmd === '/sbros') {
      const target = Number(rest[0]); const p = target && await getPlayer(env, target);
      if (!p || !p.state) return tg(env, 'sendMessage', { chat_id: uid, text: 'Напиши так: /sbros id — игрок начнёт заново и выберет героя. id ищи через /igrok Имя' });
      await env.DB.batch([
        env.DB.prepare('UPDATE players SET state=NULL, rev=rev+1 WHERE uid=?').bind(target),
        env.DB.prepare('UPDATE imports SET applied=0 WHERE uid=?').bind(target),
      ]);
      await tg(env, 'sendMessage', { chat_id: target, text: '✨ Можно выбрать главного героя заново — теперь есть и мужские, и женские версии! Закрой игру, если она открыта, и открой снова.', reply_markup: playButton(env, 'Выбрать героя ▶️') });
      return tg(env, 'sendMessage', { chat_id: uid, text: 'Готово: id ' + target + ' начнёт заново (монеты и вещи из старой игры вернутся). Подарок /podarok — после того как выберет героя.' });
    }
    if (cmd === '/refund') {
      const [u, charge] = rest;
      const r = await tg(env, 'refundStarPayment', { user_id: Number(u), telegram_payment_charge_id: charge });
      if (r.ok) await env.DB.prepare('UPDATE payments SET refunded=1 WHERE charge_id=?').bind(charge).run();
      return tg(env, 'sendMessage', { chat_id: uid, text: r.ok ? 'Звёзды возвращены.' : 'Не получилось: ' + (r.description || '') });
    }
  }
  // anything else: a gentle nudge to the game (and forward to admin as support)
  if (env.ADMIN_ID && !isAdmin && text && !text.startsWith('/')) {
    await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: `✉️ От ${m.from.first_name || ''} (@${m.from.username || '—'}, id ${uid}):\n${text}` });
  }
  return tg(env, 'sendMessage', { chat_id: uid, text: 'Спасибо, сообщение получено! А двор ждёт тебя 👇', reply_markup: playButton(env) });
}

async function onCallback(env, q) {
  const [k, act, id] = String(q.data || '').split(':');
  if (k !== 'bc' || String(q.from.id) !== String(env.ADMIN_ID)) return tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
  if (act === 'go') {
    await env.DB.prepare("UPDATE broadcasts SET status='running' WHERE id=? AND status='draft'").bind(Number(id)).run();
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: '🚀 Рассылка пошла. Сообщу, когда закончится.' });
  } else {
    await env.DB.prepare("UPDATE broadcasts SET status='cancelled' WHERE id=?").bind(Number(id)).run();
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: 'Рассылка отменена.' });
  }
  return tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
}

async function onPreCheckout(env, q, now) {
  const pl = safeJson(q.invoice_payload, {}) || {};
  const p = await getPlayer(env, q.from.id);
  const st = safeJson(p && p.state);
  const isAdmin = String(q.from.id) === String(env.ADMIN_ID);
  const s = pl.u === q.from.id ? priceFor(String(pl.s || ''), st, now, isAdmin) : null;
  return tg(env, 'answerPreCheckoutQuery', s
    ? { pre_checkout_query_id: q.id, ok: true }
    : { pre_checkout_query_id: q.id, ok: false, error_message: 'Этот товар сейчас недоступен. Звёзды не списаны.' });
}

async function onPaid(env, m, now) {
  const sp = m.successful_payment;
  const pl = safeJson(sp.invoice_payload, {}) || {};
  const uid = m.from.id;
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO payments (charge_id, uid, sku, stars, at) VALUES (?,?,?,?,?)')
    .bind(sp.telegram_payment_charge_id, uid, String(pl.s || ''), sp.total_amount, now).run();
  if (!ins.meta.changes) return; // already processed
  const p = await getPlayer(env, uid);
  const st = safeJson(p && p.state) || { coins: 0, energy: ECON.ENERGY_MAX, eTs: now, level: 1, createdAt: now };
  const msg = applyGrant(st, String(pl.s || ''), now);
  await env.DB.prepare('UPDATE players SET state=?, rev=rev+1 WHERE uid=?').bind(JSON.stringify(st), uid).run();
  await rescheduleAlerts(env, uid, st, now);
  await tg(env, 'sendMessage', { chat_id: uid, text: '⭐ Спасибо! ' + msg, reply_markup: playButton(env) });
}

async function statsText(env, now) {
  const today = almatyDay(now), yday = almatyDay(now - DAY), d7 = almatyDay(now - 7 * DAY);
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const total = await q('SELECT COUNT(*) c FROM players WHERE state IS NOT NULL');
  const act = await q('SELECT COUNT(*) c FROM visits WHERE day=?', today);
  const newT = await q("SELECT COUNT(*) c FROM players WHERE state IS NOT NULL AND date(created_at/1000 + 18000, 'unixepoch')=?", today);
  const coh1 = await q("SELECT COUNT(*) c FROM players WHERE state IS NOT NULL AND date(created_at/1000 + 18000, 'unixepoch')=?", yday);
  const ret1 = await q("SELECT COUNT(*) c FROM players p JOIN visits v ON v.uid=p.uid AND v.day=? WHERE date(p.created_at/1000 + 18000, 'unixepoch')=?", today, yday);
  const coh7 = await q("SELECT COUNT(*) c FROM players WHERE state IS NOT NULL AND date(created_at/1000 + 18000, 'unixepoch')=?", d7);
  const ret7 = await q("SELECT COUNT(*) c FROM players p JOIN visits v ON v.uid=p.uid AND v.day=? WHERE date(p.created_at/1000 + 18000, 'unixepoch')=?", today, d7);
  const pay = await q('SELECT COUNT(DISTINCT uid) u, COALESCE(SUM(stars),0) s FROM payments WHERE refunded=0');
  const pay7 = await q('SELECT COALESCE(SUM(stars),0) s FROM payments WHERE refunded=0 AND at>?', now - 7 * DAY);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  return `📊 Yard Stars, ${today}\n\nИгроков всего: ${total.c}\nЗашли сегодня: ${act.c}\nНовых сегодня: ${newT.c}\n\nВернулись на 2-й день: ${pct(ret1.c, coh1.c)} (из ${coh1.c})\nВернулись на 8-й день: ${pct(ret7.c, coh7.c)} (из ${coh7.c})\n\nПокупателей: ${pay.u} (${pct(pay.u, total.c)})\nЗвёзд всего: ${pay.s} ⭐, за 7 дней: ${pay7.s} ⭐`;
}

/* --------------------------------------------------------------- cron jobs */
const NUDGES = [
  '🍳 У нас новый заказ, ждём тебя на кухне!',
  '🏠 Во дворе соскучились. Заглянешь?',
  '🧺 Генераторы полны продуктов — самое время готовить!',
];

async function runCron(env, now) {
  // 1) "your thing is ready" alerts
  const due = await env.DB.prepare(
    `SELECT a.uid, a.kind, a.at, a.text, p.tz, p.blocked, p.started, p.last_seen, p.sent_day, p.sent_count
     FROM alerts a JOIN players p ON p.uid=a.uid WHERE a.at<=? ORDER BY a.at LIMIT 40`
  ).bind(now).all();
  for (const a of due.results || []) {
    const del = () => env.DB.prepare('DELETE FROM alerts WHERE uid=? AND kind=?').bind(a.uid, a.kind).run();
    if (a.blocked || !a.started || now - a.last_seen < (a.kind === 'energy' ? 60 : 2) * 60 * 1000) { await del(); continue; }
    if (isQuiet(now, a.tz)) {
      await env.DB.prepare('UPDATE alerts SET at=? WHERE uid=? AND kind=?').bind(nextMorning(now, a.tz), a.uid, a.kind).run();
      continue;
    }
    if (await countSend(env, { uid: a.uid, tz: a.tz, sent_day: a.sent_day, sent_count: a.sent_count }, now)) await sendTo(env, a.uid, a.text);
    await del();
  }

  // 2) gentle "we miss you": once a day, after 3 days away once every 3 days, stop after 30 days
  const away = await env.DB.prepare(
    `SELECT uid, tz, last_seen, sent_day, sent_count FROM players
     WHERE started=1 AND blocked=0 AND state IS NOT NULL
       AND last_seen < ?1 - 86400000 AND last_seen > ?1 - 30*86400000
       AND last_nudge < ?1 - (CASE WHEN last_seen < ?1 - 3*86400000 THEN 3*86400000 ELSE 86400000 END)
     LIMIT 25`
  ).bind(now).all();
  for (const p of away.results || []) {
    if (isQuiet(now, p.tz) || localHour(now, p.tz) < 10) continue;
    await env.DB.prepare('UPDATE players SET last_nudge=? WHERE uid=?').bind(now, p.uid).run();
    if (await countSend(env, p, now)) await sendTo(env, p.uid, NUDGES[Math.floor(Math.random() * NUDGES.length)]);
  }

  // 3) running broadcast, 25 messages per minute
  const bc = await env.DB.prepare("SELECT * FROM broadcasts WHERE status='running' ORDER BY id LIMIT 1").first();
  if (bc) {
    const batch = await env.DB.prepare('SELECT uid FROM players WHERE uid>? AND news=1 AND started=1 AND blocked=0 ORDER BY uid LIMIT 25').bind(bc.cursor).all();
    let sent = 0, last = bc.cursor;
    for (const r of batch.results || []) { if (await sendTo(env, r.uid, bc.text)) sent++; last = r.uid; }
    const done = (batch.results || []).length < 25;
    await env.DB.prepare('UPDATE broadcasts SET cursor=?, sent=sent+?, status=? WHERE id=?').bind(last, sent, done ? 'done' : 'running', bc.id).run();
    if (done && env.ADMIN_ID) await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: `✅ Рассылка закончена. Доставлено: ${bc.sent + sent}.` });
  }
}

/* ------------------------------------------------------------- one-time setup */
async function setup(env, url) {
  const base = `${url.protocol}//${url.host}`;
  const out = {};
  out.webhook = await tg(env, 'setWebhook', {
    url: base + '/tg', secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query', 'pre_checkout_query'], drop_pending_updates: true,
  });
  out.commands = await tg(env, 'setMyCommands', { commands: [
    { command: 'start', description: 'Открыть двор' },
    { command: 'help', description: 'Как играть' },
    { command: 'bez_novostey', description: 'Без новостей' },
    { command: 's_novostyami', description: 'С новостями' },
    { command: 'paysupport', description: 'Помощь с оплатой' },
  ] });
  out.menu = await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: env.GAME_URL } } });
  out.description = await tg(env, 'setMyShortDescription', { short_description: 'Уютный двор: готовь для соседей-героев, ремонтируй дом и заботься о себе.' });
  return out;
}

/* ------------------------------------------------------------------ entry */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const now = Date.now();
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    try {
      if (url.pathname === '/tg' && request.method === 'POST') {
        if (request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('no', { status: 403 });
        const u = await request.json();
        if (u.message) await onMessage(env, u.message, now);
        else if (u.callback_query) await onCallback(env, u.callback_query);
        else if (u.pre_checkout_query) await onPreCheckout(env, u.pre_checkout_query, now);
        return new Response('ok');
      }
      if (url.pathname === '/setup') {
        if (!env.SETUP_KEY || url.searchParams.get('key') !== env.SETUP_KEY) return new Response('wrong key', { status: 403 });
        return json(env, await setup(env, url));
      }
      if (url.pathname === '/health') return json(env, { ok: true, now });
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        const body = await request.json().catch(() => ({}));
        switch (url.pathname) {
          case '/api/load': return await apiLoad(env, body, now);
          case '/api/save': return await apiSave(env, body, now);
          case '/api/invoice': return await apiInvoice(env, body, now);
          case '/api/claim': return await apiClaim(env, body, now);
          case '/api/import': return await apiImport(env, body, now);
          case '/api/help': return await apiHelp(env, body, now);
        }
      }
      return new Response('Yard Stars', { status: 404, headers: cors(env) });
    } catch (e) {
      console.error(e && e.stack || e);
      return json(env, { error: 'server' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, Date.now()));
  },
};
