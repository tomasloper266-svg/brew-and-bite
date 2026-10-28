/**
 * Brew & Bite — backend server (port 8820)
 *
 * Stack: Node.js + Express, SQLite via better-sqlite3, sessions via express-session.
 * One process serves:
 *   /          → public storefront (public/)
 *   /admin     → team admin panel (public/admin/)
 *   /uploads/* → uploaded images (data/uploads/)
 *   /api/*     → JSON API documented in API.md
 *
 * Menu data is intentionally NOT seeded here — a separate migration task
 * imports the old menu. The database starts with settings defaults + admin only.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const express = require('express');
const multer = require('multer');
const session = require('express-session');

const PORT = 8820;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_DIR = path.join(PUBLIC_DIR, 'admin');

const ORDER_STATUSES = ['new', 'preparing', 'done'];

// Every PUT /api/settings key must be in this list — the API is the source of
// truth for what the storefront may read, so unknown keys are rejected.
const SETTING_KEYS = [
  'exchange_rate_syp_per_usd',
  'phone',
  'opening_hours_ar',
  'opening_hours_en',
  'hero_image',
  'hero_title_ar',
  'hero_title_en',
  'hero_subtitle_ar',
  'hero_subtitle_en',
  'hero_chips_ar',
  'hero_chips_en',
  'hero_cta_ar',
  'hero_cta_en',
];

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const BCRYPT_ROUNDS = 12;

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Database schema
// ---------------------------------------------------------------------------

const db = new Database(path.join(DATA_DIR, 'brew-and-bite.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar     TEXT NOT NULL,
    name_en     TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    card_image  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name_ar      TEXT NOT NULL,
    name_en      TEXT NOT NULL DEFAULT '',
    desc_ar      TEXT NOT NULL DEFAULT '',
    desc_en      TEXT NOT NULL DEFAULT '',
    price_syp    INTEGER NOT NULL,
    image        TEXT NOT NULL DEFAULT '',
    is_offer     INTEGER NOT NULL DEFAULT 0,
    is_popular   INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1,
    is_hidden    INTEGER NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name  TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    address        TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    total_syp      INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','done')),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  -- order_items is a snapshot: name/price are copied so history stays correct
  -- even after items are renamed, repriced, or deleted (item_id then goes NULL).
  CREATE TABLE IF NOT EXISTS order_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id        INTEGER REFERENCES items(id) ON DELETE SET NULL,
    name_ar        TEXT NOT NULL,
    unit_price_syp INTEGER NOT NULL,
    qty            INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

// ---------------------------------------------------------------------------
// Seeds — settings defaults and the initial admin account
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  exchange_rate_syp_per_usd: '14000',
  phone: '',
  opening_hours_ar: '',
  opening_hours_en: '',
  hero_image: '',
  hero_title_ar: '',
  hero_title_en: '',
  hero_subtitle_ar: '',
  hero_subtitle_en: '',
  hero_chips_ar: '',
  hero_chips_en: '',
  hero_cta_ar: '',
  hero_cta_en: '',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

const nowISO = () => new Date().toISOString();

const accountsCount = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
if (accountsCount === 0) {
  const envPassword = process.env.ADMIN_PASSWORD;
  const generated = !(envPassword && envPassword.length >= 8);
  const password = generated
    ? crypto.randomBytes(9).toString('base64url') + '-' + crypto.randomInt(100, 999)
    : envPassword;
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  db.prepare('INSERT INTO accounts (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('admin', passwordHash, nowISO(), nowISO());
  console.log(generated
    ? `[seed] accounts table was empty — created admin account "admin" with generated password: ${password}`
    : '[seed] accounts table was empty — created admin account "admin" from ADMIN_PASSWORD env (password not logged)');
}

// Session secret persists on disk so server restarts don't invalidate sessions.
const SESSION_SECRET_FILE = path.join(DATA_DIR, 'session-secret.txt');
function loadOrCreateSessionSecret() {
  try {
    const existing = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // never swallow unexpected errors
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(SESSION_SECRET_FILE, secret + '\n', { mode: 0o600 });
  return secret;
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'bb.sid',
  secret: loadOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // TLS is terminated upstream, so the node connection is always http;
    // httpOnly + sameSite=lax still protect the cookie in the browser.
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// ---------------------------------------------------------------------------
// Helpers (pure validation + presentation)
// ---------------------------------------------------------------------------

function fail(res, status, message, details) {
  const body = { error: message };
  if (details !== undefined) body.details = details;
  res.status(status).json(body);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return fail(res, 401, 'Authentication required. Log in via POST /api/auth/login.');
}

function asRequiredString(v, minLen, maxLen) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= minLen && t.length <= maxLen ? t : null;
}

function asOptionalString(v, maxLen) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= maxLen ? t : null;
}

function toInt(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

function toBool(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  return null;
}

function getCategory(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) || null;
}

function presentCategory(row) {
  const out = {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    sort_order: row.sort_order,
    card_image: row.card_image,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.item_count !== undefined) out.item_count = row.item_count;
  return out;
}

function presentItem(row) {
  return {
    id: row.id,
    category_id: row.category_id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    desc_ar: row.desc_ar,
    desc_en: row.desc_en,
    price_syp: row.price_syp,
    image: row.image,
    is_offer: !!row.is_offer,
    is_popular: !!row.is_popular,
    is_available: !!row.is_available,
    is_hidden: !!row.is_hidden,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Public menu shape: display fields only (availability/hidden are implied true).
function presentMenuItem(row) {
  return {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    desc_ar: row.desc_ar,
    desc_en: row.desc_en,
    price_syp: row.price_syp,
    image: row.image,
    is_offer: !!row.is_offer,
    is_popular: !!row.is_popular,
    sort_order: row.sort_order,
  };
}

function getOrderWithItems(id) {
  const order = db.prepare(`
    SELECT id, customer_name, customer_phone, address, note, total_syp, status, created_at, updated_at
    FROM orders WHERE id = ?
  `).get(id);
  if (!order) return null;
  order.items = db.prepare(`
    SELECT item_id, name_ar, unit_price_syp, qty FROM order_items WHERE order_id = ? ORDER BY id ASC
  `).all(id);
  return order;
}

function allSettingsObject() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Static wiring (uploads, admin, site root)
// ---------------------------------------------------------------------------

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));
app.use('/admin', express.static(ADMIN_DIR));
app.use(express.static(PUBLIC_DIR));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const b = req.body || {};
  if (typeof b.username !== 'string' || typeof b.password !== 'string') {
    return fail(res, 400, 'username and password are required (strings).');
  }
  const account = db.prepare('SELECT id, username, password_hash FROM accounts WHERE username = ?')
    .get(b.username.trim());
  const ok = account ? bcrypt.compareSync(b.password, account.password_hash) : false;
  if (!ok) return fail(res, 401, 'Invalid username or password.');

  // Regenerate the session on login to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return fail(res, 500, 'Session error.');
    req.session.userId = account.id;
    req.session.username = account.username;
    res.json({ user: { id: account.id, username: account.username } });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) return fail(res, 401, 'Not logged in.');
  res.json({ user: { id: req.session.userId, username: req.session.username } });
});

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

app.post('/api/account/password', requireAuth, (req, res) => {
  const b = req.body || {};
  if (typeof b.current_password !== 'string' || typeof b.new_password !== 'string') {
    return fail(res, 400, 'current_password and new_password are required (strings).');
  }
  if (b.new_password.length < 8) {
    return fail(res, 400, 'new_password must be at least 8 characters.');
  }
  const account = db.prepare('SELECT id, password_hash FROM accounts WHERE id = ?').get(req.session.userId);
  if (!account) return fail(res, 401, 'Account not found.');
  if (!bcrypt.compareSync(b.current_password, account.password_hash)) {
    return fail(res, 400, 'Current password is incorrect.');
  }
  db.prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(b.new_password, BCRYPT_ROUNDS), nowISO(), account.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

app.get('/api/settings', (req, res) => {
  res.json({ settings: allSettingsObject() });
});

function validateSettingValue(key, value) {
  if (key === 'exchange_rate_syp_per_usd' && (!/^\d+$/.test(value) || Number(value) <= 0)) {
    return 'exchange_rate_syp_per_usd must be a positive integer (SYP per 1 USD).';
  }
  if (value.length > 1000) return `Setting "${key}" is too long (max 1000 characters).`;
  return null;
}

app.put('/api/settings', requireAuth, (req, res) => {
  const b = req.body || {};
  const keys = Object.keys(b);
  if (keys.length === 0) return fail(res, 400, 'Provide at least one setting to update.');

  const invalid = keys.filter((k) => !SETTING_KEYS.includes(k));
  if (invalid.length) {
    return fail(res, 400, `Unknown setting key(s): ${invalid.join(', ')}.`, { allowed_keys: SETTING_KEYS });
  }

  for (const key of keys) {
    const problem = validateSettingValue(key, String(b[key] ?? ''));
    if (problem) return fail(res, 400, problem);
  }

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const key of keys) upsert.run(key, String(b[key] ?? ''));
  })();

  res.json({ settings: allSettingsObject() });
});

// ---------------------------------------------------------------------------
// Categories (admin)
// ---------------------------------------------------------------------------

app.get('/api/categories', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count
    FROM categories c ORDER BY c.sort_order ASC, c.id ASC
  `).all();
  res.json({ categories: rows.map(presentCategory) });
});

app.get('/api/categories/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const row = id !== null ? getCategory(id) : null;
  if (!row) return fail(res, 404, 'Category not found.');
  const item_count = db.prepare('SELECT COUNT(*) AS n FROM items WHERE category_id = ?').get(id).n;
  res.json({ category: presentCategory({ ...row, item_count }) });
});

app.post('/api/categories', requireAuth, (req, res) => {
  const b = req.body || {};
  const errors = [];

  const name_ar = asRequiredString(b.name_ar, 1, 200);
  if (!name_ar) errors.push('name_ar is required (1-200 characters).');

  const name_en = 'name_en' in b ? asOptionalString(b.name_en, 200) : '';
  if (name_en === null) errors.push('name_en must be a string of up to 200 characters.');

  const card_image = 'card_image' in b ? asOptionalString(b.card_image, 300) : '';
  if (card_image === null) errors.push('card_image must be a string of up to 300 characters.');

  const sort_order = 'sort_order' in b ? toInt(b.sort_order) : 0;
  if (sort_order === null) errors.push('sort_order must be an integer.');

  if (errors.length) return fail(res, 400, 'Validation failed.', errors);

  const ts = nowISO();
  const info = db.prepare(`
    INSERT INTO categories (name_ar, name_en, sort_order, card_image, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name_ar, name_en, sort_order, card_image, ts, ts);

  res.status(201).json({ category: presentCategory(getCategory(info.lastInsertRowid)) });
});

app.put('/api/categories/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const existing = id !== null ? getCategory(id) : null;
  if (!existing) return fail(res, 404, 'Category not found.');

  const b = req.body || {};
  const errors = [];
  const updates = {};

  if ('name_ar' in b) {
    const v = asRequiredString(b.name_ar, 1, 200);
    if (!v) errors.push('name_ar must be 1-200 characters.');
    else updates.name_ar = v;
  }
  if ('name_en' in b) {
    const v = asOptionalString(b.name_en, 200);
    if (v === null) errors.push('name_en must be a string of up to 200 characters.');
    else updates.name_en = v;
  }
  if ('card_image' in b) {
    const v = asOptionalString(b.card_image, 300);
    if (v === null) errors.push('card_image must be a string of up to 300 characters.');
    else updates.card_image = v;
  }
  if ('sort_order' in b) {
    const v = toInt(b.sort_order);
    if (v === null) errors.push('sort_order must be an integer.');
    else updates.sort_order = v;
  }

  if (errors.length) return fail(res, 400, 'Validation failed.', errors);
  if (Object.keys(updates).length === 0) return fail(res, 400, 'No fields to update.');

  updates.updated_at = nowISO();
  const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE categories SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);

  res.json({ category: presentCategory(getCategory(id)) });
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const existing = id !== null ? getCategory(id) : null;
  if (!existing) return fail(res, 404, 'Category not found.');

  const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items WHERE category_id = ?').get(id).n;
  const cascade = req.query.cascade === 'true';
  if (itemCount > 0 && !cascade) {
    return fail(res, 409, `Category has ${itemCount} item(s). Move or delete them first, or retry with ?cascade=true to delete them too.`);
  }

  db.transaction(() => {
    if (cascade) db.prepare('DELETE FROM items WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  })();

  res.json({ ok: true, deleted_items: cascade ? itemCount : 0 });
});

app.post('/api/categories/reorder', requireAuth, (req, res) => {
  const order = (req.body || {}).order;
  if (!Array.isArray(order) || order.length === 0) {
    return fail(res, 400, 'order must be a non-empty array of category ids in the desired order.');
  }
  const ids = order.map(toInt);
  if (ids.some((n) => n === null)) return fail(res, 400, 'order must contain only numeric category ids.');
  if (new Set(ids).size !== ids.length) return fail(res, 400, 'order must not contain duplicate ids.');

  const existing = db.prepare('SELECT id FROM categories ORDER BY id ASC').all().map((r) => r.id);
  if (ids.length !== existing.length || !ids.every((id) => existing.includes(id))) {
    return fail(res, 400, `order must contain every category exactly once (all ${existing.length}).`, { category_ids: existing });
  }

  const ts = nowISO();
  const upd = db.prepare('UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, index) => upd.run(index, ts, id)))();

  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
  res.json({ categories: rows.map(presentCategory) });
});

// ---------------------------------------------------------------------------
// Items (admin)
// ---------------------------------------------------------------------------

app.get('/api/items', requireAuth, (req, res) => {
  const filter = req.query.category_id;
  if (filter !== undefined) {
    const category_id = toInt(filter);
    if (category_id === null) return fail(res, 400, 'category_id must be an integer.');
    const rows = db.prepare('SELECT * FROM items WHERE category_id = ? ORDER BY sort_order ASC, id ASC').all(category_id);
    return res.json({ items: rows.map(presentItem) });
  }
  const rows = db.prepare('SELECT * FROM items ORDER BY category_id ASC, sort_order ASC, id ASC').all();
  res.json({ items: rows.map(presentItem) });
});

app.get('/api/items/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const row = id !== null ? db.prepare('SELECT * FROM items WHERE id = ?').get(id) : null;
  if (!row) return fail(res, 404, 'Item not found.');
  res.json({ item: presentItem(row) });
});

app.post('/api/items', requireAuth, (req, res) => {
  const b = req.body || {};
  const errors = [];

  const category_id = toInt(b.category_id);
  if (category_id === null || !getCategory(category_id)) {
    errors.push('category_id must reference an existing category.');
  }

  const name_ar = asRequiredString(b.name_ar, 1, 200);
  if (!name_ar) errors.push('name_ar is required (1-200 characters).');

  const price_syp = toInt(b.price_syp);
  if (price_syp === null || price_syp < 0) errors.push('price_syp must be a non-negative integer (SYP).');

  const name_en = 'name_en' in b ? asOptionalString(b.name_en, 200) : '';
  if (name_en === null) errors.push('name_en must be a string of up to 200 characters.');

  const desc_ar = 'desc_ar' in b ? asOptionalString(b.desc_ar, 2000) : '';
  if (desc_ar === null) errors.push('desc_ar must be a string of up to 2000 characters.');

  const desc_en = 'desc_en' in b ? asOptionalString(b.desc_en, 2000) : '';
  if (desc_en === null) errors.push('desc_en must be a string of up to 2000 characters.');

  const image = 'image' in b ? asOptionalString(b.image, 300) : '';
  if (image === null) errors.push('image must be a string of up to 300 characters (e.g. an /uploads/... URL).');

  const defaults = { is_offer: false, is_popular: false, is_available: true, is_hidden: false };
  const flags = {};
  for (const key of ['is_offer', 'is_popular', 'is_available', 'is_hidden']) {
    if (key in b) {
      const v = toBool(b[key]);
      if (v === null) errors.push(`${key} must be a boolean.`);
      else flags[key] = v;
    } else {
      flags[key] = defaults[key];
    }
  }

  const sort_order = 'sort_order' in b ? toInt(b.sort_order) : 0;
  if (sort_order === null) errors.push('sort_order must be an integer.');

  if (errors.length) return fail(res, 400, 'Validation failed.', errors);

  const ts = nowISO();
  const info = db.prepare(`
    INSERT INTO items (category_id, name_ar, name_en, desc_ar, desc_en, price_syp, image,
                       is_offer, is_popular, is_available, is_hidden, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    category_id, name_ar, name_en, desc_ar, desc_en, price_syp, image,
    flags.is_offer ? 1 : 0, flags.is_popular ? 1 : 0, flags.is_available ? 1 : 0, flags.is_hidden ? 1 : 0,
    sort_order, ts, ts
  );

  res.status(201).json({ item: presentItem(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid)) });
});

app.put('/api/items/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const existing = id !== null ? db.prepare('SELECT * FROM items WHERE id = ?').get(id) : null;
  if (!existing) return fail(res, 404, 'Item not found.');

  const b = req.body || {};
  const errors = [];
  const updates = {};

  if ('category_id' in b) {
    const cid = toInt(b.category_id);
    if (cid === null || !getCategory(cid)) errors.push('category_id must reference an existing category.');
    else updates.category_id = cid;
  }
  if ('name_ar' in b) {
    const v = asRequiredString(b.name_ar, 1, 200);
    if (!v) errors.push('name_ar must be 1-200 characters.');
    else updates.name_ar = v;
  }
  for (const [key, maxLen] of [['name_en', 200], ['desc_ar', 2000], ['desc_en', 2000], ['image', 300]]) {
    if (key in b) {
      const v = asOptionalString(b[key], maxLen);
      if (v === null) errors.push(`${key} must be a string of up to ${maxLen} characters.`);
      else updates[key] = v;
    }
  }
  if ('price_syp' in b) {
    const v = toInt(b.price_syp);
    if (v === null || v < 0) errors.push('price_syp must be a non-negative integer (SYP).');
    else updates.price_syp = v;
  }
  for (const key of ['is_offer', 'is_popular', 'is_available', 'is_hidden']) {
    if (key in b) {
      const v = toBool(b[key]);
      if (v === null) errors.push(`${key} must be a boolean.`);
      else updates[key] = v ? 1 : 0;
    }
  }
  if ('sort_order' in b) {
    const v = toInt(b.sort_order);
    if (v === null) errors.push('sort_order must be an integer.');
    else updates.sort_order = v;
  }

  if (errors.length) return fail(res, 400, 'Validation failed.', errors);
  if (Object.keys(updates).length === 0) return fail(res, 400, 'No fields to update.');

  updates.updated_at = nowISO();
  const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE items SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);

  res.json({ item: presentItem(db.prepare('SELECT * FROM items WHERE id = ?').get(id)) });
});

app.delete('/api/items/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const info = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  if (info.changes === 0) return fail(res, 404, 'Item not found.');
  res.json({ ok: true });
});

app.post('/api/items/reorder', requireAuth, (req, res) => {
  const b = req.body || {};
  const category_id = toInt(b.category_id);
  if (category_id === null || !getCategory(category_id)) {
    return fail(res, 400, 'category_id must reference an existing category.');
  }
  const order = b.order;
  if (!Array.isArray(order) || order.length === 0) {
    return fail(res, 400, 'order must be a non-empty array of item ids in the desired order.');
  }
  const ids = order.map(toInt);
  if (ids.some((n) => n === null)) return fail(res, 400, 'order must contain only numeric item ids.');
  if (new Set(ids).size !== ids.length) return fail(res, 400, 'order must not contain duplicate ids.');

  const existing = db.prepare('SELECT id FROM items WHERE category_id = ?').all(category_id).map((r) => r.id);
  if (ids.length !== existing.length || !ids.every((id) => existing.includes(id))) {
    return fail(res, 400, `order must contain exactly the ${existing.length} item(s) of this category.`, { item_ids: existing });
  }

  const ts = nowISO();
  const upd = db.prepare('UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, index) => upd.run(index, ts, id)))();

  const rows = db.prepare('SELECT * FROM items WHERE category_id = ? ORDER BY sort_order ASC, id ASC').all(category_id);
  res.json({ items: rows.map(presentItem) });
});

// ---------------------------------------------------------------------------
// Uploads (admin)
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) return cb(new Error('UNSUPPORTED_IMAGE_TYPE'));
    cb(null, true);
  },
});

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, 400, "Attach an image in the 'file' field (multipart/form-data).");
  // Filenames are server-generated (timestamp + random hex), so no path-traversal risk.
  const ext = ALLOWED_IMAGE_TYPES[req.file.mimetype];
  const filename = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
  res.status(201).json({
    url: `/uploads/${filename}`,
    size: req.file.size,
    content_type: req.file.mimetype,
    original_name: req.file.originalname,
  });
});

// ---------------------------------------------------------------------------
// Public menu + orders
// ---------------------------------------------------------------------------

app.get('/api/menu', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
  const items = db.prepare(
    'SELECT * FROM items WHERE is_available = 1 AND is_hidden = 0 ORDER BY sort_order ASC, id ASC'
  ).all();

  const itemsByCategory = new Map(categories.map((c) => [c.id, []]));
  for (const item of items) {
    const bucket = itemsByCategory.get(item.category_id);
    if (bucket) bucket.push(presentMenuItem(item));
  }

  res.json({
    categories: categories
      .filter((c) => (itemsByCategory.get(c.id) || []).length > 0)
      .map((c) => ({
        id: c.id,
        name_ar: c.name_ar,
        name_en: c.name_en,
        sort_order: c.sort_order,
        card_image: c.card_image,
        items: itemsByCategory.get(c.id),
      })),
  });
});

app.post('/api/orders', (req, res) => {
  const b = req.body || {};

  const customer_name = asRequiredString(b.customer_name, 2, 100);
  if (!customer_name) return fail(res, 400, 'customer_name is required (2-100 characters).');

  const customer_phone = typeof b.customer_phone === 'string' ? b.customer_phone.trim() : '';
  if (!/^[0-9+\-\s()]{5,40}$/.test(customer_phone)) {
    return fail(res, 400, 'customer_phone is required (5-40 characters: digits, spaces, + - ( )).');
  }

  const address = typeof b.address === 'string' ? b.address.trim().slice(0, 500) : '';
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';

  const lines = Array.isArray(b.items) ? b.items : null;
  if (!lines || lines.length === 0 || lines.length > 50) {
    return fail(res, 400, 'items must be a non-empty array (max 50 lines) of { item_id, qty }.');
  }

  const requested = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') return fail(res, 400, 'Each line of items must be an object { item_id, qty }.');
    const item_id = toInt(line.item_id);
    const qty = toInt(line.qty);
    if (item_id === null || item_id <= 0) return fail(res, 400, 'Each item needs a positive numeric item_id.');
    if (qty === null || qty < 1 || qty > 99) return fail(res, 400, 'Each item needs qty between 1 and 99.');
    requested.push({ item_id, qty });
  }

  // Totals are computed ONLY from DB prices — client-sent totals are never read.
  const getItem = db.prepare('SELECT id, name_ar, price_syp FROM items WHERE id = ? AND is_available = 1 AND is_hidden = 0');
  const resolved = [];
  for (const { item_id, qty } of requested) {
    const row = getItem.get(item_id);
    if (!row) {
      return fail(res, 400, `Item ${item_id} cannot be ordered (it may not exist, be hidden, or be unavailable).`);
    }
    resolved.push({ item_id, qty, name_ar: row.name_ar, unit_price_syp: row.price_syp });
  }
  const total_syp = resolved.reduce((sum, r) => sum + r.unit_price_syp * r.qty, 0);

  const ts = nowISO();
  let orderId;
  db.transaction(() => {
    orderId = db.prepare(`
      INSERT INTO orders (customer_name, customer_phone, address, note, total_syp, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'new', ?, ?)
    `).run(customer_name, customer_phone, address, note, total_syp, ts, ts).lastInsertRowid;
    const insLine = db.prepare('INSERT INTO order_items (order_id, item_id, name_ar, unit_price_syp, qty) VALUES (?, ?, ?, ?, ?)');
    for (const r of resolved) insLine.run(orderId, r.item_id, r.name_ar, r.unit_price_syp, r.qty);
  })();

  res.status(201).json({ order: getOrderWithItems(orderId) });
});

// ---------------------------------------------------------------------------
// Orders (admin)
// ---------------------------------------------------------------------------

app.get('/api/orders', requireAuth, (req, res) => {
  let statuses = String(req.query.status || 'new,preparing')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = statuses.filter((s) => !ORDER_STATUSES.includes(s));
  if (invalid.length) {
    return fail(res, 400, `Invalid status value(s): ${invalid.join(', ')}.`, { allowed: ORDER_STATUSES });
  }
  if (statuses.length === 0) statuses = ['new', 'preparing'];

  const placeholders = statuses.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id FROM orders WHERE status IN (${placeholders}) ORDER BY created_at ASC, id ASC`
  ).all(...statuses);
  res.json({ orders: rows.map((r) => getOrderWithItems(r.id)) });
});

app.patch('/api/orders/:id/status', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid order id.');
  const status = (req.body || {}).status;
  if (!ORDER_STATUSES.includes(status)) {
    return fail(res, 400, `status must be one of: ${ORDER_STATUSES.join(', ')}.`);
  }
  // Any transition among the three states is allowed (e.g. new → done directly);
  // the typical flow is new → preparing → done.
  const info = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowISO(), id);
  if (info.changes === 0) return fail(res, 404, 'Order not found.');
  res.json({ order: getOrderWithItems(id) });
});

app.get('/api/orders/history', requireAuth, (req, res) => {
  let limit = toInt(req.query.limit);
  if (limit === null || limit < 1) limit = 100;
  if (limit > 500) limit = 500;
  const rows = db.prepare(
    "SELECT id FROM orders WHERE status = 'done' ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(limit);
  res.json({ orders: rows.map((r) => getOrderWithItems(r.id)) });
});

// ---------------------------------------------------------------------------
// Health, 404s, errors
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'brew-and-bite', time: nowISO() });
});

app.use('/api', (req, res) => fail(res, 404, `No such endpoint: ${req.method} ${req.originalUrl}`));

app.use((req, res) => res.status(404).send('Not found'));

// Central error handler — multer and JSON-parse errors land here too.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'Image too large. Max upload size is 5MB.');
    return fail(res, 400, `Upload failed: ${err.code}`);
  }
  if (err && err.message === 'UNSUPPORTED_IMAGE_TYPE') {
    return fail(res, 400, 'Unsupported file type. Allowed: webp, jpg, png.');
  }
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'Request body is not valid JSON.');
  }
  console.error('[error]', err);
  return fail(res, 500, 'Internal server error.');
});

app.listen(PORT, () => {
  console.log(`[brew-and-bite] API + static server listening on port ${PORT} (${nowISO()})`);
});
