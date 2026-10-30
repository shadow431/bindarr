// An admin can prefer Cardmarket EUR over TCGplayer USD for Magic prices (#93).
//
// Scryfall quotes most printings in both currencies. The default reads USD first
// and falls back to EUR (the behaviour before the setting existed); 'cardmarket'
// is the mirror image. Either way one row is ONE currency, normal and foil alike.
// Switching re-prices owned cards and must not draw the switch as a price move in
// price_history. Scryfall is stubbed: no request leaves the process.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

process.env.SCRYFALL_GAP_SCALE = '0';
const tmpDb = path.join(os.tmpdir(), `bindarr-mtgpricesource-${process.pid}.db`);
process.env.DB_PATH = tmpDb;

const express = require('express');
const db = require('../src/db');
const scryfall = require('../src/scryfallApi');
const { recordPrice } = require('../src/utils/priceHelpers');

let server;
async function cleanup() {
  if (server && server.listening) await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => { try { db.dbConnection.close(() => resolve()); } catch { resolve(); } });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch { /* already gone */ }
  }
}

// A Scryfall card shaped like the real /cards responses, with only `prices`
// varying between cases.
const UUID = '00000000-0000-4000-8000-0000000000b1';
const card = (prices, id = UUID) => ({
  id, lang: 'en', name: 'Lightning Bolt', set: 'm11', set_name: 'Magic 2011',
  collector_number: '149', rarity: 'common',
  image_uris: { normal: 'https://cards.scryfall.io/bolt.jpg' }, prices,
});
const BOTH = { usd: '2.00', usd_foil: '5.00', eur: '1.50', eur_foil: '4.00' };

function normalization() {
  // Default: TCGplayer, exactly as before the setting existed.
  assert.strictEqual(scryfall.getPriceSource(), 'tcgplayer', 'default source is TCGplayer');
  let n = scryfall.normalizeCard(card(BOTH));
  assert.strictEqual(n.price_currency, 'USD');
  assert.strictEqual(n.price_normal, 2);
  assert.strictEqual(n.price_holofoil, 5, 'foil comes from the same currency as normal');
  assert.strictEqual(n.price_trend, 2);

  // Default with only EUR quoted still falls back to EUR (the pre-#93 rule).
  n = scryfall.normalizeCard(card({ eur: '1.50', eur_foil: '4.00' }));
  assert.strictEqual(n.price_currency, 'EUR');
  assert.strictEqual(n.price_normal, 1.5);

  // Cardmarket preferred: EUR first, both columns.
  assert.strictEqual(scryfall.setPriceSource('cardmarket'), 'cardmarket');
  n = scryfall.normalizeCard(card(BOTH));
  assert.strictEqual(n.price_currency, 'EUR');
  assert.strictEqual(n.price_normal, 1.5);
  assert.strictEqual(n.price_holofoil, 4, 'foil stays in EUR alongside normal');
  assert.strictEqual(n.price_trend, 1.5);

  // EUR preferred but only USD quoted: falls back to USD, never leaves it unpriced.
  n = scryfall.normalizeCard(card({ usd: '2.00', usd_foil: '5.00' }));
  assert.strictEqual(n.price_currency, 'USD');
  assert.strictEqual(n.price_normal, 2);
  assert.strictEqual(n.price_holofoil, 5);

  // Never a mix: a EUR foil-only quote wins the whole row over a USD normal one,
  // leaving normal empty rather than filling it with a dollar figure.
  n = scryfall.normalizeCard(card({ usd: '2.00', eur_foil: '4.00' }));
  assert.strictEqual(n.price_currency, 'EUR');
  assert.strictEqual(n.price_normal, null, 'no USD number lands in a EUR row');
  assert.strictEqual(n.price_holofoil, 4);
  assert.strictEqual(n.price_trend, 4);

  // No quote at all: unpriced, labelled with the preferred currency.
  n = scryfall.normalizeCard(card({}));
  assert.strictEqual(n.price_currency, 'EUR');
  assert.strictEqual(n.price_normal, null);
  assert.strictEqual(n.price_trend, 0);

  // Unknown values fall back to the default rather than to anything surprising.
  assert.strictEqual(scryfall.setPriceSource('bogus'), 'tcgplayer');
}

async function settingsRoute() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, role: req.headers['x-test-role'] || 'admin' }; next(); });
  app.use('/api/settings', require('../src/routes/settings'));
  const base = await new Promise(resolve => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
  const put = async (body, role) => {
    const res = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const stored = async () => (await db.get(`SELECT mtg_price_source s FROM app_settings WHERE id = 1`)).s;

  // Observe the background re-price without running it here (its own test is below).
  const realReprice = scryfall.repriceForSourceChange;
  let reprices = 0;
  scryfall.repriceForSourceChange = async () => { reprices++; };
  try {
    let res = await (await fetch(base + '/api/settings')).json();
    assert.strictEqual(res.mtg_price_source, 'tcgplayer', 'GET reports the default');

    res = await put({ mtg_price_source: 'cardmarket' }, 'member');
    assert.strictEqual(res.status, 403, 'members cannot change it');
    assert.strictEqual(await stored(), 'tcgplayer');

    res = await put({ mtg_price_source: 'eur' });
    assert.strictEqual(res.status, 400, 'an unknown value is rejected, not coerced');
    res = await put({ mtg_price_source: 'eur', price_refresh_days: 7 });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await db.get(`SELECT price_refresh_days d FROM app_settings`)).d, 1,
      'a rejected source leaves the rest of the same save unapplied');
    assert.strictEqual(await stored(), 'tcgplayer');
    assert.strictEqual(reprices, 0);

    res = await put({ mtg_price_source: 'cardmarket' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mtg_price_source, 'cardmarket');
    assert.strictEqual(await stored(), 'cardmarket', 'persisted');
    assert.strictEqual(scryfall.getPriceSource(), 'cardmarket', 'takes effect without a restart');
    assert.strictEqual(reprices, 1, 'a change re-prices cached cards');

    res = await put({ mtg_price_source: 'cardmarket' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(reprices, 1, 'saving the same value again does not re-price');

    // What boot does: the stored value is what normalizeCard uses after a restart.
    scryfall.setPriceSource('tcgplayer');
    assert.strictEqual(await scryfall.loadPriceSource(), 'cardmarket');
  } finally {
    scryfall.repriceForSourceChange = realReprice;
    await new Promise(resolve => server.close(resolve));
  }
}

async function repriceAndHistory() {
  const OWNED = `mtg-${UUID}`;
  const UNOWNED = 'mtg-00000000-0000-4000-8000-0000000000b2';
  scryfall.setPriceSource('tcgplayer');
  await scryfall.cacheCards([scryfall.normalizeCard(card(BOTH)), scryfall.normalizeCard(card(BOTH, UNOWNED.slice(4)))]);
  const user = (await db.run(
    `INSERT INTO users (username, password_hash, role, share_token) VALUES ('eu', ?, 'member', ?)`,
    [db.hashPassword('x'), `share-eu-${process.pid}`]
  )).lastID;
  await db.run(`INSERT INTO collection (card_id, user_id, game) VALUES (?, ?, 'mtg')`, [OWNED, user]);
  assert.strictEqual(await recordPrice(OWNED, 2), true);

  // The sweep's bulk lookup, answering like /cards/collection.
  scryfall.client.post = async (url, body) => {
    assert.strictEqual(url, '/cards/collection');
    return { data: { data: body.identifiers.map(i => card(BOTH, i.id)), not_found: [] } };
  };

  scryfall.setPriceSource('cardmarket');
  await scryfall.repriceForSourceChange();

  const owned = await db.get(`SELECT price_currency, price_normal, price_holofoil FROM card_cache WHERE id = ?`, [OWNED]);
  assert.deepStrictEqual(owned, { price_currency: 'EUR', price_normal: 1.5, price_holofoil: 4 }, 'owned card switched currency');
  const unowned = await db.get(`SELECT price_currency, last_updated FROM card_cache WHERE id = ?`, [UNOWNED]);
  assert.strictEqual(unowned.price_currency, 'USD', 'unowned rows are not re-fetched in bulk');
  assert.ok(unowned.last_updated.startsWith('1970'), 'but are marked stale so the next search re-prices them');

  // The switch is recorded as a new EUR point, not compared against the USD one.
  const points = await db.all(`SELECT price, currency FROM price_history WHERE card_id = ? ORDER BY recorded_at`, [OWNED]);
  assert.deepStrictEqual(points.map(p => [p.price, p.currency]), [[2, 'USD'], [1.5, 'EUR']]);
  // The same number in a different currency is still a new point.
  await db.run(`UPDATE card_cache SET price_currency = 'USD' WHERE id = ?`, [OWNED]);
  assert.strictEqual(await recordPrice(OWNED, 1.5), true, 'same number, new currency: recorded');
  assert.strictEqual(await recordPrice(OWNED, 1.5), false, 'same number, same currency: not');
  await db.run(`UPDATE card_cache SET price_currency = 'EUR' WHERE id = ?`, [OWNED]);

  // Readers only draw the card's current currency, so the chart shows no fake move.
  const app = express();
  app.use((req, res, next) => { req.user = { id: user, role: 'member' }; next(); });
  app.use('/api', require('../src/routes/stats'));
  const base = await new Promise(resolve => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
  const hist = await (await fetch(`${base}/api/cards/${OWNED}/price-history?range=all`)).json();
  assert.deepStrictEqual(hist.data.filter(p => p.source === 'recorded').map(p => p.price), [1.5],
    'only the EUR series is drawn');
}

async function main() {
  await db.initDb();
  normalization();
  await settingsRoute();
  await repriceAndHistory();
  console.log('mtgpricesource.test.js: all assertions passed');
}

main()
  .then(async () => { await cleanup(); process.exit(0); })
  .catch(async (err) => { console.error(err); await cleanup(); process.exit(1); });
