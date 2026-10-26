// Self-check for the 'type' sort/grouping (issue #88): Magic cards order and
// group by card type (Creature, Instant, Land...), not by colour; Pokémon and
// Lorcana keep their type/ink order.
// Run: `node src/utils/cardSort.test.js`
import assert from 'node:assert';
import { register } from 'node:module';

// cardSort.js imports the shared order tables as plain `.json` modules, which
// Vite bundles but bare Node refuses without an import attribute (and ESLint 8
// cannot parse one). Serve those files to this test as `export default {...}`
// so it reads the real shared tables rather than a copy that could drift.
const jsonAsModule = `
import { readFile } from 'node:fs/promises';
export async function load(url, context, next) {
  if (!url.endsWith('.json')) return next(url, context);
  const source = await readFile(new URL(url), 'utf8');
  return { format: 'module', source: 'export default ' + source, shortCircuit: true };
}`;
register('data:text/javascript,' + encodeURIComponent(jsonAsModule), import.meta.url);

const { sortCardsByOrder, cardTypeCategory, mtgTypeCategory } = await import('./cardSort.js');

const mtg = (name, typeLine, colors = []) => ({
  name, game: 'mtg', supertype: 'MTG', types: colors,
  subtypes: typeLine.split(/[^A-Za-z]+/).filter(Boolean),
});

// --- Picking one category from a type line -----------------------------------
assert.strictEqual(mtgTypeCategory(['Legendary', 'Artifact', 'Creature', 'Elf', 'Druid']), 'Creature',
  'an Artifact Creature files as a creature');
assert.strictEqual(mtgTypeCategory(['Enchantment', 'Creature', 'God']), 'Creature');
assert.strictEqual(mtgTypeCategory(['Artifact', 'Land']), 'Land', 'an Artifact Land files with the lands');
assert.strictEqual(mtgTypeCategory(['Kindred', 'Instant', 'Elf']), 'Instant', 'Kindred only qualifies another type');
assert.strictEqual(mtgTypeCategory(['Legendary', 'Planeswalker', 'Jace']), 'Planeswalker');
assert.strictEqual(mtgTypeCategory(['Conspiracy']), 'Other');
assert.strictEqual(mtgTypeCategory('["Basic","Land","Forest"]'), 'Land', 'subtypes straight from a SQL row are a JSON string');
assert.strictEqual(mtgTypeCategory(undefined), 'Other');

// --- Grouping reads card type for MTG, colour list for everything else -------
assert.strictEqual(cardTypeCategory(mtg('Llanowar Elves', 'Creature — Elf Druid', ['Green'])), 'Creature');
assert.strictEqual(cardTypeCategory({ supertype: 'MTG', subtypes: ['Instant'], types: ['Red'] }), 'Instant',
  'a row selected without the game column is still recognised as Magic');
assert.strictEqual(cardTypeCategory({ game: 'pokemon', supertype: 'Pokémon', subtypes: ['Basic'], types: ['Fire'] }), 'Fire');
assert.strictEqual(cardTypeCategory({ game: 'lorcana', supertype: 'Character', subtypes: ['Storyborn'], types: ['Amber'] }), 'Amber');

// --- Sorting ------------------------------------------------------------------
const magic = [
  mtg('Forest', 'Basic Land — Forest', []),
  mtg('Lightning Bolt', 'Instant', ['Red']),
  mtg('Sol Ring', 'Artifact', []),
  mtg('Grizzly Bears', 'Creature — Bear', ['Green']),
  mtg('Steel Overseer', 'Artifact Creature — Construct', []),
  mtg('Counterspell', 'Instant', ['Blue']),
];
assert.deepStrictEqual(
  sortCardsByOrder(magic, 'type-name').map(c => c.name),
  ['Grizzly Bears', 'Steel Overseer', 'Counterspell', 'Lightning Bolt', 'Sol Ring', 'Forest'],
  'MTG type sort: creatures, then instants, then artifacts, then lands, by name within each'
);

const pokemon = [
  { name: 'Squirtle', game: 'pokemon', supertype: 'Pokémon', types: ['Water'], subtypes: ['Basic'] },
  { name: 'Potion', game: 'pokemon', supertype: 'Trainer', types: [], subtypes: ['Item'] },
  { name: 'Charmander', game: 'pokemon', supertype: 'Pokémon', types: ['Fire'], subtypes: ['Basic'] },
  { name: 'Bulbasaur', game: 'pokemon', supertype: 'Pokémon', types: ['Grass'], subtypes: ['Basic'] },
];
assert.deepStrictEqual(
  sortCardsByOrder(pokemon, 'type-name').map(c => c.name),
  ['Bulbasaur', 'Charmander', 'Squirtle', 'Potion'],
  'Pokémon type sort keeps the energy-type order'
);

console.log('PASS: cardSort type sort and grouping');
