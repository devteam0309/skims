import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Debounced search box.
 *
 * Every list page bound its search input straight to the query key, so typing "livelihood" issued
 * ten requests, raced their responses and counted ten hits against the API rate limiter. The
 * programs page was fixed with a local debounce; rather than copy that block onto three funds
 * pages, the behaviour lives here.
 *
 * The input renders from local state, so it stays responsive while the committed term — the one
 * that actually drives the query — lags behind by `delay`.
 */
export default function SearchInput({
  id,
  label = 'Search',
  placeholder = 'Search...',
  value = '',
  onSearch,
  delay = 300,
}) {
  const [text, setText] = useState(value);

  // Held in a ref so that a parent passing an inline arrow does not restart the timer on every
  // render — which would mean the debounce never elapses and the request never fires.
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  // An external reset (a "Clear filters" button) has to reach the box, otherwise the field goes on
  // showing a term that is no longer being applied to the results.
  useEffect(() => { setText(value); }, [value]);

  useEffect(() => {
    if (text === value) return undefined;
    const t = setTimeout(() => onSearchRef.current(text), delay);
    return () => clearTimeout(t);
  }, [text, value, delay]);

  return (
    <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-navy-700 dark:border-gray-600 dark:bg-gray-700">
      <Search size={15} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="search"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none dark:text-gray-200"
      />
      {text && (
        <button
          type="button"
          onClick={() => setText('')}
          aria-label="Clear search"
          className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
