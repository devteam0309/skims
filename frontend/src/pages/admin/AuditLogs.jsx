import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import DataTable from '../../components/shared/DataTable';
import { formatDatetime } from '../../utils/formatters';

const auditService = {
  getAll: (params) => api.get('/audit-logs', { params }),
};

/*
 * Actions grouped by what they mean to someone scanning the log, not one hue each.
 *
 * There were thirteen distinct colours here — purple for UPLOAD, teal for UNARCHIVE, rose for
 * ROLE_CHANGE, cyan for REOPEN — which is the same problem StatusBadge was rewritten to solve:
 * it asks the reader to memorise a colour per action, and the palette runs out before the
 * meanings do. What a reader actually wants from an audit log at a glance is which entries
 * removed something, and which changed someone's access. Those two stand out now; the rest are
 * quiet, and the action name is always spelled out.
 */
const ACTION_TONES = {
  DELETE: 'danger',
  REJECT: 'danger',
  ROLE_CHANGE: 'warning',
  APPROVE: 'success',
  LOGIN: 'neutral',
  LOGOUT: 'neutral',
};
const DEFAULT_TONE = 'info';

const TONE_CLASSES = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  success: 'bg-green-100 text-green-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
};

const ACTIONS = [
  'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT',
  'UPLOAD', 'ARCHIVE', 'UNARCHIVE', 'SUBMIT', 'ROLE_CHANGE', 'REOPEN',
];

const RESOURCES = ['auth', 'user', 'program', 'budget', 'expense', 'liquidation', 'document', 'youth', 'announcement'];

const EMPTY_FILTERS = { page: 1, limit: 20, action: '', resource: '', startDate: '', endDate: '' };

export default function AuditLogs() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // A reversed range returns nothing, which looked identical to "nothing was logged".
  const rangeInverted = Boolean(filters.startDate && filters.endDate && filters.startDate > filters.endDate);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => auditService.getAll(filters).then((r) => r.data),
    enabled: !rangeInverted,
  });

  const controlClass =
    'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200';

  const hasFilters = Boolean(filters.action || filters.resource || filters.startDate || filters.endDate);

  const columns = [
    {
      key: 'createdAt',
      header: 'Timestamp',
      width: 160,
      render: (v) => <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{formatDatetime(v)}</span>,
    },
    {
      key: 'user',
      header: 'User',
      render: (v) => (v ? (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{v.firstName} {v.lastName}</p>
          <p className="meta-text capitalize">{v.role?.replace(/_/g, ' ')}</p>
        </div>
      ) : <span className="meta-text">System</span>),
    },
    {
      key: 'action',
      header: 'Action',
      render: (v) => (
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[ACTION_TONES[v] || DEFAULT_TONE]}`}>
          {v}
        </span>
      ),
    },
    { key: 'resource', header: 'Resource', render: (v) => <span className="text-xs capitalize text-gray-600 dark:text-gray-400">{v}</span> },
    {
      key: 'details',
      header: 'Details',
      render: (v) => {
        if (!v || !Object.keys(v).length) return <span className="text-gray-300 dark:text-gray-600">—</span>;
        return (
          <span className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {Object.entries(v).map(([k, val]) => {
              const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
              const display = Array.isArray(val) ? val.join(', ') : val === null ? 'none' : String(val);
              return (
                <span key={k} className="mr-2 inline-block whitespace-nowrap">{label}: {display}</span>
              );
            })}
          </span>
        );
      },
    },
    { key: 'ipAddress', header: 'IP', render: (v) => <span className="font-mono text-xs text-gray-400 dark:text-gray-500">{v || '—'}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => <span className="meta-text">{v?.name || '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-100 dark:bg-navy-500/20">
          <Shield size={18} className="text-navy-700 dark:text-navy-300" aria-hidden="true" />
        </span>
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-subtitle">Complete record of all system actions</p>
        </div>
      </div>

      <section aria-label="Filter audit logs" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="filter-action" className="sr-only">Filter by action</label>
            <select
              id="filter-action"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })}
              className={controlClass}
            >
              <option value="">All Actions</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="filter-resource" className="sr-only">Filter by resource</label>
            <select
              id="filter-resource"
              value={filters.resource}
              onChange={(e) => setFilters({ ...filters, resource: e.target.value, page: 1 })}
              className={controlClass}
            >
              <option value="">All Resources</option>
              {RESOURCES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* These two labels sat next to their inputs without being attached to them, so
              clicking "From" did nothing and neither field had a name of its own. */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter-start" className="text-xs text-gray-500 dark:text-gray-400">From</label>
            <input
              id="filter-start"
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value, page: 1 })}
              className={controlClass}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="filter-end" className="text-xs text-gray-500 dark:text-gray-400">To</label>
            <input
              id="filter-end"
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value, page: 1 })}
              className={controlClass}
            />
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>

        {rangeInverted && (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
            The start date is after the end date, so no entries can match.
          </p>
        )}
      </section>

      {data?.meta && !rangeInverted && (
        <p className="meta-text">
          <span className="numeric">{data.meta.total.toLocaleString()}</span> log entries
          {hasFilters ? ' match these filters' : ' recorded'}
        </p>
      )}

      <DataTable
        columns={columns}
        data={rangeInverted ? [] : data?.data}
        loading={isLoading && !rangeInverted}
        pagination={rangeInverted ? undefined : data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={
          rangeInverted ? 'Fix the date range to see entries'
            : hasFilters ? 'No entries match these filters'
              : 'No audit log entries yet'
        }
        emptyAction={hasFilters && !rangeInverted ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
          >
            Clear filters
          </button>
        ) : null}
      />
    </div>
  );
}
