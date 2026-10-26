import { PAGE_COLUMN_CHOICES, pageGrid } from '../utils/binderLayout';
import { useT } from '../utils/i18n';

// "Columns per page" for a binder: '' is Auto, otherwise a pocket count.
// Each option is labelled with the grid it would draw for `capacity`, Auto
// included, so the owner can see whether Auto already matches their pages
// before overriding it. With no single capacity (pages that differ) the labels
// fall back to the bare column count.
export default function PageColumnsSelect({ id, value, onChange, capacity, style }) {
  const { t } = useT();
  const cap = parseInt(capacity, 10);
  const known = cap > 0;
  const gridLabel = (override) => {
    const { columns, rows } = pageGrid(cap, override);
    return t('loc.pageGrid', { columns, rows });
  };

  return (
    <select id={id} className="select-control" value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="">{known ? t('loc.pageColumnsAuto', { layout: gridLabel(null) }) : t('loc.pageColumnsAutoPlain')}</option>
      {PAGE_COLUMN_CHOICES.map(n => (
        <option key={n} value={String(n)}>{known ? gridLabel(n) : n}</option>
      ))}
    </select>
  );
}
