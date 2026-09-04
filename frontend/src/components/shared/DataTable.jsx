import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox } from 'lucide-react';

/**
 * Shared table for every management page.
 *
 * Column API is unchanged — { key, header, render, width, className } — so no caller needs
 * touching. `className` on a column now also styles the matching <th>, which lets a caller
 * right-align a money column once instead of at every cell.
 */
export default function DataTable({
  columns,
  data,
  loading,
  pagination,
  onPageChange,
  emptyMessage = 'No data found',
  emptyAction = null,
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width }} className={col.className} scope="col">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={columns} />
            ) : data?.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center">
                  <EmptyState message={emptyMessage} action={emptyAction} />
                </td>
              </tr>
            ) : (
              data?.map((row, i) => (
                <tr key={row._id || i}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.className}>
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.pages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-gray-700"
        >
          <span className="meta-text">
            Showing{' '}
            <span className="numeric font-medium text-gray-700 dark:text-gray-300">
              {((pagination.page - 1) * pagination.limit) + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </span>{' '}
            of <span className="numeric font-medium text-gray-700 dark:text-gray-300">{pagination.total}</span>
          </span>
          <div className="flex items-center gap-1 self-end sm:self-auto">
            <PaginationBtn onClick={() => onPageChange(1)} disabled={pagination.page === 1} label="First page">
              <ChevronsLeft size={14} />
            </PaginationBtn>
            <PaginationBtn onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1} label="Previous page">
              <ChevronLeft size={14} />
            </PaginationBtn>
            <span className="numeric px-3 py-1 font-medium text-gray-700 dark:text-gray-300" aria-current="page">
              {pagination.page} / {pagination.pages}
            </span>
            <PaginationBtn onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.pages} label="Next page">
              <ChevronRight size={14} />
            </PaginationBtn>
            <PaginationBtn onClick={() => onPageChange(pagination.pages)} disabled={pagination.page === pagination.pages} label="Last page">
              <ChevronsRight size={14} />
            </PaginationBtn>
          </div>
        </nav>
      )}
    </div>
  );
}

/**
 * Loading previously replaced the entire table with a centred spinner, so the header row and
 * the container collapsed and the page height jumped on every filter change or page turn.
 * Holding the real structure and greying the cells keeps the layout still and lets the user
 * keep reading the column headers while data arrives.
 */
function SkeletonRows({ columns }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, r) => (
        <tr key={r} aria-hidden="true">
          {columns.map((col) => (
            <td key={col.key} className={col.className}>
              <div className="skeleton h-4" style={{ width: `${55 + ((r * 13 + col.key.length * 7) % 35)}%` }} />
            </td>
          ))}
        </tr>
      ))}
      <tr className="sr-only">
        <td colSpan={columns.length} aria-live="polite">Loading results…</td>
      </tr>
    </>
  );
}

/**
 * An empty table is a dead end unless it says what to do next. The emoji that stood here
 * rendered inconsistently across platforms and clashed with the Lucide set used everywhere else.
 */
function EmptyState({ message, action }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
      <Inbox size={22} className="text-gray-300 dark:text-gray-600" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{message}</p>
      {action}
    </div>
  );
}

/**
 * Exported because the programs page renders cards rather than a table and so cannot use
 * DataTable, but its pager must still look and behave like every other one.
 */
export function PaginationBtn({ children, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-md border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}
