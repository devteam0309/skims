import { useState, useEffect, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Target, FolderOpen, Loader2 } from 'lucide-react';
import { programService } from '../../services/programService';
import { documentService } from '../../services/documentService';

/**
 * The search box in the app header.
 *
 * It said "Search programs, documents…" and did nothing at all — no value, no change handler, no
 * submit — for as long as it has existed. It looked like the system's main search while being the
 * one search that never worked, which is worse than not having it: seven list pages have their own
 * working search, and this box sent people looking in the wrong place.
 *
 * It now does what the placeholder always claimed. Both queries are the ordinary list endpoints,
 * so results are municipality-scoped by the server exactly like the pages they link to — a Boac
 * chairperson sees Boac records here and nowhere else, and this adds no read that the role did not
 * already have.
 */
const MAX_PER_GROUP = 5;

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const listId = `${useId()}-results`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  /*
   * Debounced, like SearchInput. Bound straight to the query key, every keystroke would fire two
   * requests and count against the API rate limiter — the exact problem the list pages already
   * had to fix. Two characters is the floor: one matches most of the database and is never useful.
   */
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const enabled = term.length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', term],
    enabled,
    // Results are a navigation aid, not a record view — a short cache keeps repeat keystrokes and
    // the reopening of a recent search off the network.
    staleTime: 30_000,
    queryFn: async () => {
      const [programs, documents] = await Promise.all([
        programService.getAll({ search: term, limit: MAX_PER_GROUP }).then((r) => r.data.data).catch(() => []),
        documentService.getAll({ search: term, limit: MAX_PER_GROUP }).then((r) => r.data.data).catch(() => []),
      ]);
      return { programs: programs || [], documents: documents || [] };
    },
  });

  const results = [
    ...(data?.programs || []).map((p) => ({
      key: `p-${p._id}`, icon: Target, label: p.title,
      hint: p.municipality?.name || 'Programme', to: `/programs/${p._id}`,
    })),
    ...(data?.documents || []).map((d) => ({
      key: `d-${d._id}`, icon: FolderOpen, label: d.title,
      hint: d.municipality?.name || 'Document', to: '/documents',
    })),
  ];

  useEffect(() => { setActive(-1); }, [term]);

  const close = () => { setOpen(false); setActive(-1); };

  const choose = (item) => {
    if (!item) return;
    close();
    setText('');
    setTerm('');
    navigate(item.to);
  };

  /*
   * Both refs are checked before closing, per the rule the barangay picker had to learn: a click
   * on a result must not count as "outside", or the list unmounts on mousedown and the item's own
   * handler never runs. The panel is a child here rather than portaled, so one ref covers both —
   * kept explicit so it stays correct if it is ever moved into a portal.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { close(); inputRef.current?.blur(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % results.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (i <= 0 ? results.length - 1 : i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[active] ?? results[0]); }
  };

  const showPanel = open && enabled;

  return (
    <div ref={rootRef} className="relative hidden w-72 md:block">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-navy-700 dark:border-gray-600 dark:bg-gray-700">
        {isFetching
          ? <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" aria-hidden="true" />
          : <Search size={16} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />}
        <label htmlFor="global-search" className="sr-only">Search programs and documents</label>
        <input
          ref={inputRef}
          id="global-search"
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search programs, documents..."
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-200"
        />
        {text && (
          <button
            type="button"
            onClick={() => { setText(''); setTerm(''); close(); inputRef.current?.focus(); }}
            aria-label="Clear search"
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <ul id={listId} role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto py-1">
            {results.map((item, i) => (
              <li key={item.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => choose(item)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                    i === active ? 'bg-gray-100 dark:bg-gray-700' : ''
                  }`}
                >
                  <item.icon size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800 dark:text-gray-100">{item.label}</span>
                    <span className="block truncate text-xs text-gray-400 dark:text-gray-500">{item.hint}</span>
                  </span>
                </button>
              </li>
            ))}
            {!results.length && (
              <li className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                {isFetching ? 'Searching…' : `Nothing matches “${term}”`}
              </li>
            )}
          </ul>
        </div>
      )}
      {/* Announced without stealing focus, so a keyboard or screen-reader user knows the list changed. */}
      <p className="sr-only" role="status" aria-live="polite">
        {showPanel && !isFetching ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}
      </p>
    </div>
  );
}
