// Issue #88: a 'type' sort on Magic cards must order and file them by card type
// (Creature, Instant, Land...), not by colour, while Pokémon keeps its energy
// order. Also covers the compartment assignments written before the change,
// which name colours, so a page assigned "Red" keeps taking red cards.
// No framework — plain node + assert. Run: `node test/mtgtypesort.test.js`.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Point the db module at a throwaway file BEFORE requiring it (db.js reads
// DB_PATH at import time).
const tmpDb = path.join(os.tmpdir(), `bindarr-mtgtypesort-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
// initDb only seeds the 'admin' user when this is set; the rows below need user 1.
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const db = require('../src/db');
const { sortCards, getSortCategory, mtgTypeCategory, recommendSlot } = require('../src/utils/compartmentSort');

// Shaped like scryfallApi.normalizeCard: colours in `types`, type-line words in `subtypes`.
const mtg = (name, typeLine, colors = []) => ({
  name, game: 'mtg', supertype: 'MTG', types: colors,
  subtypes: typeLine.split(/[^A-Za-z]+/).filter(Boolean),
});

function testPick() {
  assert.strictEqual(mtgTypeCategory(['Legendary', 'Artifact', 'Creature', 'Elf', 'Druid']), 'Creature');
  assert.strictEqual(mtgTypeCategory(['Artifact', 'Land']), 'Land', 'an Artifact Land files with the lands');
  assert.strictEqual(mtgTypeCategory(['Kindred', 'Sorcery', 'Goblin']), 'Sorcery');
  assert.strictEqual(mtgTypeCategory('["Scheme"]'), 'Other', 'JSON-string subtypes are parsed; no card type is Other');
  console.log('PASS: MTG card-type category picks one type from the type line');
}

function testSortAndGroup() {
  const cards = [
    mtg('Forest', 'Basic Land — Forest'),
    mtg('Lightning Bolt', 'Instant', ['Red']),
    mtg('Shock', 'Instant', ['Red']),
    mtg('Steel Overseer', 'Artifact Creature — Construct'),
    { ...mtg('Grizzly Bears', 'Creature — Bear', ['Green']), subtypes: '["Creature","Bear"]' },
  ];
  assert.deepStrictEqual(
    sortCards(cards, 'type-name', 'normals_first').map(c => c.name),
    ['Grizzly Bears', 'Steel Overseer', 'Lightning Bolt', 'Shock', 'Forest'],
    'MTG type sort: creatures, then instants, then lands'
  );
  assert.strictEqual(getSortCategory(cards[3], 'type-name'), 'Creature', 'an Artifact Creature groups as Creature');
  assert.strictEqual(getSortCategory(cards[1], [{ by: 'type', divider: true }]), 'Instant');
  // A row selected without the game column is still recognised by supertype.
  assert.strictEqual(getSortCategory({ supertype: 'MTG', types: '["Red"]', subtypes: '["Instant"]' }, 'type-name'), 'Instant');
  console.log('PASS: MTG type sort and grouping read card type, not colour');

  const pokemon = [
    { name: 'Squirtle', game: 'pokemon', supertype: 'Pokémon', types: '["Water"]', subtypes: '["Basic"]' },
    { name: 'Charmander', game: 'pokemon', supertype: 'Pokémon', types: ['Fire'], subtypes: ['Basic'] },
    { name: 'Bulbasaur', game: 'pokemon', supertype: 'Pokémon', types: ['Grass'], subtypes: ['Basic'] },
  ];
  assert.deepStrictEqual(
    sortCards(pokemon, 'type-name', 'normals_first').map(c => c.name),
    ['Bulbasaur', 'Charmander', 'Squirtle'],
    'Pokémon type sort keeps the energy-type order'
  );
  assert.strictEqual(getSortCategory(pokemon[0], 'type-name'), 'Water');
  assert.strictEqual(getSortCategory({ game: 'lorcana', supertype: 'Character', types: ['Amber'], subtypes: ['Storyborn'] }, 'type-name'), 'Amber',
    'Lorcana still groups by ink');
  console.log('PASS: Pokémon and Lorcana type grouping unchanged');
}

function cleanup() {
  try { db.dbConnection.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch { /* not present */ }
  }
}

// Filing on a type-sorted MTG box: rows assigned a card type take that type,
// and a row assigned a colour back when 'type' meant colour still takes it.
async function testAssignments() {
  await db.initDb();
  const userId = 1;
  const loc = await db.run(
    `INSERT INTO locations (name, type, sort_order, foil_sorting, rule_type, game, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Magic Box', 'Box', 'type-name', 'normals_first', 'any', 'mtg', userId]
  );
  const rows = [];
  for (const idx of [1, 2, 3]) {
    rows.push((await db.run(`INSERT INTO compartments (location_id, idx, capacity) VALUES (?, ?, ?)`, [loc.lastID, idx, 10])).lastID);
  }
  await db.run(`INSERT INTO compartment_assignments (compartment_id, filter_value) VALUES (?, ?)`, [rows[0], 'Red']);
  await db.run(`INSERT INTO compartment_assignments (compartment_id, filter_value) VALUES (?, ?)`, [rows[1], 'Creature']);
  const location = await db.get(`SELECT * FROM locations WHERE id = ?`, [loc.lastID]);

  const file = (card) => recommendSlot(db, location, { ...card, set_name: 'Alpha', number: '1', printing: 'Normal', price_trend: 1 });

  const bolt = await file(mtg('Lightning Bolt', 'Instant', ['Red']));
  assert.strictEqual(bolt && bolt.compartment_id, rows[0], 'a row assigned "Red" before #88 still takes red cards');
  const bears = await file(mtg('Grizzly Bears', 'Creature — Bear', ['Green']));
  assert.strictEqual(bears && bears.compartment_id, rows[1], 'a row assigned "Creature" takes creatures');
  const island = await file(mtg('Island', 'Basic Land — Island'));
  assert.strictEqual(island && island.compartment_id, rows[2], 'a card matching no assignment goes to the unassigned row');
  console.log('PASS: type-sorted MTG filing honours card-type and legacy colour assignments');
}

async function main() {
  testPick();
  testSortAndGroup();
  await testAssignments();
}

main()
  .then(() => { cleanup(); process.exit(0); })
  .catch(err => { console.error('FAIL:', err.stack || err.message); cleanup(); process.exit(1); });
