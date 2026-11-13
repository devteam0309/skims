import { useMemo, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';

/**
 * Pick a barangay from a municipality's list, each with its figures.
 *
 * Built for the municipal administrator, who oversees every barangay at once — sixty-one of them in
 * Boac. A long list needs a way in, so the panel searches by name, can hide barangays with nothing
 * recorded, and scrolls inside itself rather than pushing the table it filters off the screen.
 * Choosing a barangay calls `onSelect(id)`; the municipality-wide bucket is `'none'`, and "all" is ''.
 *
 * `rows`: `[{ id, name, primary, primaryLabel, detail, tone }]` — `primary` is the headline number.
 */
export default function BarangayPanel({
  title, rows = [], municipalityWide = null, selected = '', onSelect, hint = null, formatPrimary = (v) => v,
}) {
  const [query, setQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!onlyActive || r.primary));
  }, [rows, query, onlyActive]);

  const chosen = selected === 'none' ? 'Municipality-wide' : rows.find((r) => r.id === selected)?.name;

  const card = (key, active, onClick, name, primary, primaryLabel, detail, tone) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`flex w-full items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
          active
            ? 'border-navy-700 bg-navy-50 dark:border-navy-400 dark:bg-navy-900/40'
            : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{name}</span>
          {detail && <span className={`block truncate text-xs ${tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>{detail}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="numeric block text-sm font-semibold text-gray-900 dark:text-white">{formatPrimary(primary)}</span>
          {primaryLabel && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{primaryLabel}</span>}
        </span>
      </button>
    </li>
  );

  return (
    <section aria-label={title} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <MapPin size={16} aria-hidden="true" className="text-navy-600 dark:text-navy-300" />
          {title}
          <span className="meta-text font-normal">· {rows.length} barangay{rows.length === 1 ? '' : 's'}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <label htmlFor={`${title}-barangay-search`} className="sr-only">Find a barangay</label>
            <input
              id={`${title}-barangay-search`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a barangay…"
              className="w-48 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="h-3.5 w-3.5 accent-navy-700" />
            Hide empty
          </label>
          {selected && (
            <button
              type="button"
              onClick={() => onSelect('')}
              className="flex items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-navy-100 dark:bg-navy-500/15 dark:text-navy-200"
            >
              <X size={12} aria-hidden="true" />Showing {chosen || 'one barangay'} — show all
            </button>
          )}
        </div>
      </div>
      {hint && <p className="meta-text mb-2">{hint}</p>}
      <ul className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {municipalityWide && card('none', selected === 'none', () => onSelect(selected === 'none' ? '' : 'none'),
          'Municipality-wide', municipalityWide.primary, municipalityWide.primaryLabel, municipalityWide.detail || 'No single barangay', municipalityWide.tone)}
        {visible.map((r) => card(r.id, selected === r.id, () => onSelect(selected === r.id ? '' : r.id),
          r.name, r.primary, r.primaryLabel, r.detail, r.tone))}
        {!visible.length && (
          <li className="meta-text col-span-full py-3 text-center">No barangay matches “{query}”.</li>
        )}
      </ul>
    </section>
  );
}
