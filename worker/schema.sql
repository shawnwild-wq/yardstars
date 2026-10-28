-- Yard Stars database (Cloudflare D1)
CREATE TABLE IF NOT EXISTS players (
  uid        INTEGER PRIMARY KEY,
  first_name TEXT,
  username   TEXT,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL DEFAULT 0,
  last_nudge INTEGER NOT NULL DEFAULT 0,
  tz         INTEGER NOT NULL DEFAULT 300,   -- minutes east of UTC (Almaty = 300)
  news       INTEGER NOT NULL DEFAULT 1,
  started    INTEGER NOT NULL DEFAULT 0,     -- pressed /start in the bot (bot may write)
  blocked    INTEGER NOT NULL DEFAULT 0,
  sent_day   TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL DEFAULT 0,
  state      TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  uid       INTEGER NOT NULL,
  sku       TEXT NOT NULL,
  stars     INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  refunded  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS payments_uid ON payments(uid);

CREATE TABLE IF NOT EXISTS alerts (
  uid  INTEGER NOT NULL,
  kind TEXT NOT NULL,
  at   INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (uid, kind)
);
CREATE INDEX IF NOT EXISTS alerts_at ON alerts(at);

CREATE TABLE IF NOT EXISTS imports (
  uid     INTEGER PRIMARY KEY,
  data    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visits (
  uid INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (uid, day)
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  text    TEXT NOT NULL,
  cursor  INTEGER NOT NULL DEFAULT 0,
  sent    INTEGER NOT NULL DEFAULT 0,
  status  TEXT NOT NULL DEFAULT 'draft',   -- draft | running | done | cancelled
  created INTEGER NOT NULL
);
