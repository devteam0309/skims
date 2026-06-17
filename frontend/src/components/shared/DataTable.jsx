import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PageLoader } from './LoadingSpinner';

export default function DataTable({ columns, data, loading, pagination, onPageChange, emptyMessage = 'No data found' }) {
  if (loading) return <PageLoader />;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width }} className={col.className}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-16 text-center text-gray-400 dark:text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-4xl">📭</span>
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data?.map((row, i) => (
                <tr key={row._id || i}>
                  {columns.map((col) => (
                    <td key={col.key}>
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
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} results
          </span>
          <div className="flex items-center gap-1">
            <PaginationBtn onClick={() => onPageChange(1)} disabled={pagination.page === 1}><ChevronsLeft size={14} /></PaginationBtn>
            <PaginationBtn onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1}><ChevronLeft size={14} /></PaginationBtn>
            <span className="px-3 py-1 text-gray-700 dark:text-gray-300 font-medium">
              {pagination.page} / {pagination.pages}
            </span>
            <PaginationBtn onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.pages}><ChevronRight size={14} /></PaginationBtn>
            <PaginationBtn onClick={() => onPageChange(pagination.pages)} disabled={pagination.page === pagination.pages}><ChevronsRight size={14} /></PaginationBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function PaginationBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
