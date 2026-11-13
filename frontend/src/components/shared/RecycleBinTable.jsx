import { RotateCcw, Trash2 } from 'lucide-react';
import DataTable from './DataTable';
import { formatDate } from '../../utils/formatters';

/**
 * The recycle bin for a finance record type — budgets, expenses or liquidation reports.
 *
 * The server scopes the list exactly like the live one, so an SK officer's bin holds their own
 * barangay's records only, and says per row whether the caller may destroy it (`canPermanentlyDelete`).
 * Restoring is offered to whoever can see the bin; the server re-checks both on every request.
 */
export default function RecycleBinTable({
  data, loading, onPageChange, onRestore, onPermanentDelete, restoring, destroying,
  describe, emptyMessage = 'The recycle bin is empty',
}) {
  const columns = [
    {
      key: '_id',
      header: 'Record',
      render: (_, row) => {
        const { title, detail } = describe(row);
        return (
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
            {detail && <p className="meta-text">{detail}</p>}
          </div>
        );
      },
    },
    { key: 'barangay', header: 'Barangay', render: (v) => v?.name || <span className="meta-text">Municipality level</span> },
    {
      key: 'deletedAt',
      header: 'Deleted',
      render: (v, row) => (
        <div>
          <p className="text-xs text-gray-700 dark:text-gray-300">{formatDate(v)}</p>
          {row.deletedBy && <p className="meta-text">by {row.deletedBy.firstName} {row.deletedBy.lastName}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (_, row) => {
        const { title } = describe(row);
        return (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onRestore(row)}
              disabled={restoring}
              aria-label={`Restore ${title}`}
              className="flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-60 dark:bg-emerald-500/15 dark:text-emerald-300"
            >
              <RotateCcw size={12} aria-hidden="true" />Restore
            </button>
            {row.canPermanentlyDelete && (
              <button
                type="button"
                onClick={() => onPermanentDelete(row)}
                disabled={destroying}
                aria-label={`Delete ${title} permanently`}
                className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 dark:bg-red-500/15 dark:text-red-300"
              >
                <Trash2 size={12} aria-hidden="true" />Delete permanently
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <section aria-label="Recycle bin" className="space-y-3">
      <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
        Deleted records stay here, with their history and attachments, until they are restored or an
        administrator deletes them permanently.
      </p>
      <DataTable
        columns={columns}
        data={data?.data}
        loading={loading}
        pagination={data?.meta}
        onPageChange={onPageChange}
        emptyMessage={emptyMessage}
      />
    </section>
  );
}
