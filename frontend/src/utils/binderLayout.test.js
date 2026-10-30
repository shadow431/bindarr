import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPageColumns, pageColumns, pageGrid, PAGE_COLUMN_CHOICES, MAX_PAGE_COLUMNS } from './binderLayout.js';

test('standard pocket pages get their real width', () => {
  const expected = { 4: 2, 6: 3, 8: 4, 9: 3, 12: 4, 16: 4, 18: 6, 20: 5, 24: 6, 25: 5, 36: 6 };
  for (const [cap, cols] of Object.entries(expected)) {
    assert.equal(defaultPageColumns(Number(cap)), cols, `${cap} pockets`);
  }
});

test('a 12-pocket page is 4 wide and 3 tall, not 3 by 4 (issue #90)', () => {
  assert.deepEqual(pageGrid(12), { columns: 4, rows: 3 });
});

test('an unlisted capacity falls back to the nearest square', () => {
  assert.equal(defaultPageColumns(13), 4);
  assert.equal(defaultPageColumns(2), 1);
  assert.equal(defaultPageColumns(49), 7);
});

test('missing or nonsense capacity still draws one column', () => {
  assert.equal(defaultPageColumns(0), 1);
  assert.equal(defaultPageColumns(undefined), 1);
  assert.equal(defaultPageColumns('abc'), 1);
});

test('the binder setting overrides the default', () => {
  assert.equal(pageColumns(12, 3), 3);
  assert.equal(pageColumns(9, '4'), 4);
  assert.deepEqual(pageGrid(12, 3), { columns: 3, rows: 4 });
});

test('rows round up when the capacity does not divide evenly', () => {
  assert.deepEqual(pageGrid(10, 4), { columns: 4, rows: 3 });
});

test('a null, empty or out-of-range setting means automatic', () => {
  for (const off of [null, undefined, '', 0, -2, MAX_PAGE_COLUMNS + 1, 2.5, 'x']) {
    assert.equal(pageColumns(12, off), 4, `override ${JSON.stringify(off)}`);
  }
});

test('the picker offers every width from 1 to the maximum', () => {
  assert.equal(PAGE_COLUMN_CHOICES.length, MAX_PAGE_COLUMNS);
  assert.equal(PAGE_COLUMN_CHOICES[0], 1);
  assert.equal(PAGE_COLUMN_CHOICES.at(-1), MAX_PAGE_COLUMNS);
});
