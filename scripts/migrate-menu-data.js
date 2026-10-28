#!/usr/bin/env node
/**
 * migrate-menu-data.js — import the legacy bite-house-menu data into the
 * Brew & Bite SQLite database (categories, items, images, settings).
 *
 * Idempotent: categories match on name_ar, items on (category_id, name_ar);
 * re-runs update in place and never insert a second copy.
 * Safe alongside the running server (WAL, single transaction, busy_timeout).
 *
 * Usage: node scripts/migrate-menu-data.js [--verify-only]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const APP_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(APP_ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'brew-and-bite.db');

// Read-only legacy source. Override with LEGACY_MENU_DIR if it moves.
const SRC_DIR = process.env.LEGACY_MENU_DIR
  || '/home/user/work/brew-menu/brew-and-bite-menu-main/bite-house-menu';
const MENU_JSON = path.join(SRC_DIR, 'menu-data.json');
const IMG_DIR = path.join(SRC_DIR, 'img');

const SETTINGS_TO_SET = {
  exchange_rate_syp_per_usd: '14000',
  phone: '0991854084', // local number as-is (old site had a wrong +966 prefix)
  opening_hours_ar: '11:00 صباحاً - 12:00 ليلاً',
  opening_hours_en: '11:00 AM - 12:00 AM',
  hero_image: '/uploads/hero-feast.webp',
};

const EXPECTED = { categories: 15, items: 126 };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Flatten the legacy {menu: {slug: {label, label_en, items[]}}} object into an
 *  ordered category list with per-item fields validated and normalized. */
function parseSource(data) {
  const menu = data && data.menu;
  const images = data && data.images;
  if (!menu || !images) {
    throw new Error('menu-data.json: expected top-level "menu" and "images" maps.');
  }

  const categories = Object.keys(menu).map((slug, catIndex) => {
    const src = menu[slug];
    const seenNames = new Set();
    const items = src.items.map((it, itemIndex) => {
      if (seenNames.has(it.name)) {
        throw new Error(`Duplicate item name "${it.name}" in category "${slug}".`);
      }
      seenNames.add(it.name);

      const mapped = images[it.key];
      if (!mapped) throw new Error(`Item "${it.key}" has no entry in the images map.`);
      if (!Number.isInteger(it.price) || it.price < 0) {
        throw new Error(`Item "${it.key}" has invalid price: ${JSON.stringify(it.price)}`);
      }

      return {
        key: it.key,
        name_ar: it.name,
        name_en: it.name_en || '',
        desc_ar: it.desc || '',
        desc_en: it.desc_en || '',
        price_syp: it.price,
        is_offer: it.offer ? 1 : 0,
        is_popular: it.popular ? 1 : 0, // field absent in legacy data → 0
        is_available: 1,                // no availability flag in legacy data
        is_hidden: it.hidden ? 1 : 0,
        image: `/uploads/${path.basename(mapped)}`,
        sort_order: itemIndex,
      };
    });

    return {
      slug,
      name_ar: src.label,
      name_en: src.label_en || '',
      sort_order: catIndex,
      // Card image = first item's image (hero is set via settings, not a card).
      card_image: items.length ? items[0].image : '',
      items,
    };
  });

  const catNames = new Set(categories.map((c) => c.name_ar));
  if (catNames.size !== categories.length) {
    throw new Error('Duplicate category name_ar in source — idempotent matching needs unique names.');
  }
  return categories;
}

/** Unique image basenames referenced by the parsed categories (item images). */
function referencedBasenames(categories) {
  const set = new Set();
  for (const cat of categories) {
    for (const item of cat.items) set.add(path.basename(item.image));
  }
  return [...set];
}

/** Copy every referenced image (plus the hero) into uploads/. Never touches
 *  the source; overwriting uploads is safe — this is the migration's namespace. */
function copyImages(basenames) {
  const wanted = new Set([...basenames, path.basename(SETTINGS_TO_SET.hero_image)]);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  let copied = 0;
  for (const name of wanted) {
    const src = path.join(IMG_DIR, name);
    const dst = path.join(UPLOADS_DIR, name);
    if (!fs.existsSync(src)) throw new Error(`Source image missing on disk: ${src}`);
    const before = fs.existsSync(dst) ? fs.statSync(dst).size : -1;
    fs.copyFileSync(src, dst);
    if (fs.statSync(dst).size !== before) copied += 1;
  }
  return { wanted: wanted.size, copied, skipped: wanted.size - copied };
}

function nowISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Migration (single transaction; match-by-key upserts, no duplicates)
// ---------------------------------------------------------------------------

function migrate(db, categories) {
  const tx = db.transaction(() => {
    const findCategory = db.prepare('SELECT id FROM categories WHERE name_ar = ?');
    const insertCategory = db.prepare(`
      INSERT INTO categories (name_ar, name_en, sort_order, card_image, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const updateCategory = db.prepare(`
      UPDATE categories SET name_en = ?, sort_order = ?, card_image = ?, updated_at = ?
      WHERE id = ?`);

    const findItem = db.prepare('SELECT id FROM items WHERE category_id = ? AND name_ar = ?');
    const insertItem = db.prepare(`
      INSERT INTO items (category_id, name_ar, name_en, desc_ar, desc_en, price_syp,
                         image, is_offer, is_popular, is_available, is_hidden, sort_order,
                         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const updateItem = db.prepare(`
      UPDATE items SET name_en = ?, desc_ar = ?, desc_en = ?, price_syp = ?, image = ?,
                       is_offer = ?, is_popular = ?, is_available = ?, is_hidden = ?,
                       sort_order = ?, updated_at = ?
      WHERE id = ?`);

    const upsertSetting = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

    const ts = nowISO();
    for (const cat of categories) {
      const existing = findCategory.get(cat.name_ar);
      const catId = existing
        ? (updateCategory.run(cat.name_en, cat.sort_order, cat.card_image, ts, existing.id), existing.id)
        : insertCategory.run(cat.name_ar, cat.name_en, cat.sort_order, cat.card_image, ts, ts).lastInsertRowid;

      for (const it of cat.items) {
        const itemRow = findItem.get(catId, it.name_ar);
        if (itemRow) {
          updateItem.run(it.name_en, it.desc_ar, it.desc_en, it.price_syp, it.image,
            it.is_offer, it.is_popular, it.is_available, it.is_hidden, it.sort_order, ts, itemRow.id);
        } else {
          insertItem.run(catId, it.name_ar, it.name_en, it.desc_ar, it.desc_en, it.price_syp,
            it.image, it.is_offer, it.is_popular, it.is_available, it.is_hidden,
            it.sort_order, ts, ts);
        }
      }
    }

    for (const [key, value] of Object.entries(SETTINGS_TO_SET)) upsertSetting.run(key, value);
  });
  return tx(); // execute the transaction — defining it alone writes nothing
}

// ---------------------------------------------------------------------------
// Verification — full compare of DB content against source, then a report
// ---------------------------------------------------------------------------

function verify(db, categories) {
  const problems = [];

  const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (catCount !== EXPECTED.categories) problems.push(`category count ${catCount} != ${EXPECTED.categories}`);
  if (itemCount !== EXPECTED.items) problems.push(`item count ${itemCount} != ${EXPECTED.items}`);

  const dbItems = db.prepare('SELECT * FROM items').all();
  const emptyImage = dbItems.filter((r) => !r.image).length;
  if (emptyImage) problems.push(`${emptyImage} items have an empty image field`);

  // Every DB-referenced image must exist in uploads/.
  const missingOnDisk = dbItems
    .filter((r) => !fs.existsSync(path.join(UPLOADS_DIR, path.basename(r.image))))
    .map((r) => r.image);
  if (missingOnDisk.length) problems.push(`${missingOnDisk.length} images missing from uploads: ${missingOnDisk.slice(0, 5).join(', ')}`);

  // Source-derived expectations keyed by category name + item name.
  const expectedItems = new Map();
  const findCat = db.prepare('SELECT id FROM categories WHERE name_ar = ?');
  for (const cat of categories) {
    const row = findCat.get(cat.name_ar);
    for (const it of cat.items) expectedItems.set(`${row.id}|${it.name_ar}`, { cat, it });
  }
  let mismatches = 0;
  for (const row of dbItems) {
    const exp = expectedItems.get(`${row.category_id}|${row.name_ar}`);
    if (!exp) { problems.push(`unexpected DB item: category ${row.category_id} / ${row.name_ar}`); continue; }
    const e = exp.it;
    const same = row.name_en === e.name_en && row.desc_ar === e.desc_ar && row.desc_en === e.desc_en
      && row.price_syp === e.price_syp && row.image === e.image
      && row.is_offer === e.is_offer && row.is_popular === e.is_popular
      && row.is_available === e.is_available && row.is_hidden === e.is_hidden
      && row.sort_order === e.sort_order;
    if (!same) { mismatches += 1; if (mismatches <= 5) problems.push(`field mismatch on "${row.name_ar}"`); }
  }

  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all()
    .map((r) => [r.key, r.value]));
  for (const [k, v] of Object.entries(SETTINGS_TO_SET)) {
    if (settings[k] !== v) problems.push(`settings.${k} = ${JSON.stringify(settings[k])} != ${JSON.stringify(v)}`);
  }

  // Spot-check rows for the report: one offer, one burger, one drink.
  const pick = (name) => {
    const row = dbItems.find((r) => r.name_en === name);
    if (!row) throw new Error(`spot-check: item "${name}" not found in DB`);
    const src = expectedItems.get(`${row.category_id}|${row.name_ar}`).it;
    return { db: row, src };
  };
  const spotChecks = ['Burger & Cola', 'Double Smash Burger', 'Cappuccino']
    .filter((name) => dbItems.some((r) => r.name_en === name))
    .map(pick);

  return { ok: problems.length === 0, problems, catCount, itemCount, emptyImage, missingOnDisk, spotChecks, settings };
}

function printSpotCheck(spotChecks) {
  console.log('\nSpot-check (DB vs menu-data.json):');
  console.log('| item (en) | DB name_ar | source name_ar | DB name_en | source name_en | DB price_syp | source price | match |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const { db: r, src } of spotChecks) {
    const match = r.name_ar === src.name_ar && r.name_en === src.name_en && r.price_syp === src.price_syp;
    console.log(`| ${r.name_en} | ${r.name_ar} | ${src.name_ar} | ${r.name_en} | ${src.name_en} | ${r.price_syp} | ${src.price_syp} | ${match ? '✅' : '❌'} |`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  for (const p of [MENU_JSON, IMG_DIR]) {
    if (!fs.existsSync(p)) throw new Error(`Source not found: ${p}`);
  }

  const raw = JSON.parse(fs.readFileSync(MENU_JSON, 'utf8'));
  const categories = parseSource(raw);
  const totalItems = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`Source parsed: ${categories.length} categories, ${totalItems} items.`);

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  try {
    const before = {
      categories: db.prepare('SELECT COUNT(*) AS n FROM categories').get().n,
      items: db.prepare('SELECT COUNT(*) AS n FROM items').get().n,
    };
    console.log(`DB before: ${before.categories} categories, ${before.items} items.`);

    if (!verifyOnly) {
      const img = copyImages(referencedBasenames(categories));
      console.log(`Images: ${img.wanted} unique files wanted → ${img.copied} copied, ${img.skipped} already present.`);
      migrate(db, categories);
      console.log('Migration transaction committed.');
    }

    const result = verify(db, categories);
    console.log(`\nDB after: ${result.catCount} categories, ${result.itemCount} items.`);
    console.log(`Items with empty image: ${result.emptyImage}`);
    console.log(`Referenced images missing from uploads: ${result.missingOnDisk.length}`);
    console.log(`Settings: ${JSON.stringify(result.settings, null, 2)}`);
    printSpotCheck(result.spotChecks);

    if (result.ok) {
      console.log('\n✅ VERIFICATION PASSED — all counts, images, settings, and full item fields match the source.');
    } else {
      console.error('\n❌ VERIFICATION FAILED:');
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main();
