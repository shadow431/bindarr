// How wide a binder page is drawn, in pockets.
//
// Pocket pages are sold in a handful of fixed layouts, and they are landscape
// more often than not: a 12-pocket page is 4 wide and 3 tall, an 8-pocket page
// 4 by 2. Rounding the square root of the capacity got the square ones right and
// the rest wrong — round(sqrt(12)) is 3, which drew a 12-pocket page as 3 by 4
// and had owners setting 13 per page just to get four columns (issue #90). So
// the known layouts are looked up, and only an odd capacity falls back to the
// nearest square.
const STANDARD_COLUMNS = {
  4: 2, // 2×2 toploader page
  6: 3, // 3×2
  8: 4, // 4×2
  9: 3, // 3×3, the classic binder page
  12: 4, // 4×3
  16: 4, // 4×4
  18: 6, // 6×3
  20: 5, // 5×4
  24: 6, // 6×4
  25: 5, // 5×5
  36: 6, // 6×6
};

// The widest a binder can be set to. Mirrors MAX_PAGE_COLUMNS in
// backend/src/routes/storage.js, which rejects anything past it.
export const MAX_PAGE_COLUMNS = 12;

// Choices for the "Columns per page" picker; the empty value is Auto.
export const PAGE_COLUMN_CHOICES = Array.from({ length: MAX_PAGE_COLUMNS }, (_, i) => i + 1);

export function defaultPageColumns(capacity) {
  const cap = Math.max(1, parseInt(capacity, 10) || 1);
  return STANDARD_COLUMNS[cap] || Math.max(1, Math.round(Math.sqrt(cap)));
}

// The binder's own setting wins when it is a usable number; null, undefined or
// anything out of range means automatic.
export function pageColumns(capacity, override) {
  const n = Number(override);
  if (override != null && override !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_PAGE_COLUMNS) return n;
  return defaultPageColumns(capacity);
}

// Columns and rows together, for labels like "4 × 3". Rows round up: a page whose
// capacity doesn't divide evenly still needs a row for the remainder.
export function pageGrid(capacity, override) {
  const cap = Math.max(1, parseInt(capacity, 10) || 1);
  const columns = pageColumns(cap, override);
  return { columns, rows: Math.ceil(cap / columns) };
}
