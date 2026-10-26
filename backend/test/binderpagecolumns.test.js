// Binder page columns (locations.page_columns, issue #90): a binder can say how
// many pockets wide its pages are, for layouts the client's automatic choice
// doesn't match. NULL is automatic.
//
// Runs the real storage and shared routes against a temp SQLite: the startup
// migration adds the column, create and update store and validate it, null puts
// it back to automatic, another user can't touch it, and the public shared
// container hands it to the page that draws the grid.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const tmpDb = path.join(os.tmpdir(), `bindarr-binderpagecolumns-${process.pid}.db`);
process.env.DB_PATH = tmpDb;

const express = require('express');
const db = require('../src/db');

let server;

async function cleanup() {
  if (server && server.listening) await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => { try { db.dbConnection.close(() => resolve()); } catch { resolve(); } });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch { /* already gone */ }
  }
}

// The acting user comes from a test header, so one server can play both owners.
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shared', require('../src/routes/shared'));
  app.use((req, res, next) => { req.user = { id: Number(req.get('x-test-user')), role: 'member' }; next(); });
  app.use('/api', require('../src/routes/storage'));
  return new Promise(resolve => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function main() {
  await db.initDb();
  const cols = await db.all(`PRAGMA table_info(locations)`);
  const col = cols.find(c => c.name === 'page_columns');
  assert.ok(col, 'the startup migration adds locations.page_columns');
  assert.strictEqual(col.dflt_value, null, 'with no default: existing binders stay automatic');
  await db.initDb();
  assert.strictEqual((await db.all(`PRAGMA table_info(locations)`)).filter(c => c.name === 'page_columns').length, 1,
    'running the migration again is a no-op');
  console.log('PASS: migration adds page_columns once');

  const mkUser = async (name) => (await db.run(
    `INSERT INTO users (username, password_hash, role, share_token, share_enabled, share_locations) VALUES (?, ?, 'member', ?, 1, 1)`,
    [name, db.hashPassword('x'), `share-${name}-${process.pid}`]
  )).lastID;
  const owner = await mkUser('cols-owner');
  const other = await mkUser('cols-other');

  const base = await startApp();
  const api = (userId, method, url, body) => fetch(`${base}/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(userId) }, body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, body: await r.json() }));
  const stored = async (id) => (await db.get(`SELECT page_columns FROM locations WHERE id = ?`, [id])).page_columns;

  const plan = { count: 2, capacity: 12 };
  const auto = await api(owner, 'POST', '/locations', { name: 'Auto Binder', type: 'Binder', compartmentPlan: plan });
  assert.strictEqual(auto.status, 200);
  assert.strictEqual(await stored(auto.body.id), null, 'a binder created without page_columns is automatic');

  const made = await api(owner, 'POST', '/locations', { name: 'Tall Binder', type: 'Binder', compartmentPlan: plan, page_columns: 3 });
  assert.strictEqual(made.status, 200);
  const locId = made.body.id;
  assert.strictEqual(await stored(locId), 3, 'create stores page_columns');

  for (const bad of [0, 13, -1, 2.5, 'four', true]) {
    const r = await api(owner, 'POST', '/locations', { name: `Bad ${bad}`, type: 'Binder', compartmentPlan: plan, page_columns: bad });
    assert.strictEqual(r.status, 400, `create refuses page_columns ${JSON.stringify(bad)}`);
  }
  assert.ok(!(await db.get(`SELECT id FROM locations WHERE name LIKE 'Bad %'`)), 'a refused create leaves no binder behind');
  console.log('PASS: create stores and validates page_columns');

  let r = await api(owner, 'PUT', `/locations/${locId}`, { page_columns: '4' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await stored(locId), 4, 'update stores page_columns, a numeric string included');

  r = await api(owner, 'PUT', `/locations/${locId}`, { name: 'Renamed Binder' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await stored(locId), 4, 'an update that leaves page_columns out keeps it');

  for (const bad of [0, 13, 1.5, 'x']) {
    r = await api(owner, 'PUT', `/locations/${locId}`, { page_columns: bad });
    assert.strictEqual(r.status, 400, `update refuses page_columns ${JSON.stringify(bad)}`);
  }
  assert.strictEqual(await stored(locId), 4, 'a refused update changes nothing');

  r = await api(owner, 'PUT', `/locations/${locId}`, { page_columns: 12 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await stored(locId), 12, 'twelve, the widest allowed, is accepted');

  r = await api(owner, 'PUT', `/locations/${locId}`, { page_columns: null });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await stored(locId), null, 'null puts the binder back on the automatic layout');
  console.log('PASS: update stores, keeps, validates and resets page_columns');

  await api(owner, 'PUT', `/locations/${locId}`, { page_columns: 5 });
  r = await api(other, 'PUT', `/locations/${locId}`, { page_columns: 2 });
  assert.strictEqual(r.status, 404, "another user's binder is not found");
  assert.strictEqual(await stored(locId), 5, "another user can't change page_columns");
  r = await api(other, 'GET', `/locations/${locId}`);
  assert.strictEqual(r.status, 404, "another user can't read it either");
  console.log('PASS: page_columns is scoped to the owner');

  r = await api(owner, 'GET', `/locations/${locId}`);
  assert.strictEqual(r.body.page_columns, 5, 'GET /locations/:id returns page_columns');
  r = await api(owner, 'GET', '/locations');
  assert.strictEqual(r.body.find(l => l.id === locId).page_columns, 5, 'GET /locations returns page_columns');

  const token = `share-cols-owner-${process.pid}`;
  const shared = await fetch(`${base}/api/shared/${token}/containers/${locId}`).then(res => res.json());
  assert.strictEqual(shared.location.page_columns, 5, 'the public shared container carries page_columns');
  console.log('PASS: page_columns reaches the owner and shared views');
}

main()
  .then(() => cleanup())
  .catch(async err => {
    console.error('FAIL:', err.stack || err.message);
    await cleanup();
    process.exitCode = 1;
  });
