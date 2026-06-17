import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Shield } from 'lucide-react';
import api from '../../services/api';
import DataTable from '../../components/shared/DataTable';
import { formatDatetime } from '../../utils/formatters';

const auditService = {
  getAll: (params) => api.get('/audit-logs', { params }),
};

const ACTION_COLORS = {
  LOGIN: 'bg-green-100 text-green-700',
  LOGOUT: 'bg-gray-100 text-gray-600',
  CREATE: 'bg-blue-100 text-blue-700',
  UPDATE: 'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
  APPROVE: 'bg-emerald-100 text-emerald-700',
  REJECT: 'bg-orange-100 text-orange-700',
  UPLOAD: 'bg-purple-100 text-purple-700',
  ARCHIVE: 'bg-amber-100 text-amber-700',
  UNARCHIVE: 'bg-teal-100 text-teal-700',
  SUBMIT: 'bg-indigo-100 text-indigo-700',
  ROLE_CHANGE: 'bg-rose-100 text-rose-700',
  REOPEN: 'bg-cyan-100 text-cyan-700',
};

export default function AuditLogs() {
  const [filters, setFilters] = useState({ page: 1, limit: 20, action: '', resource: '', startDate: '', endDate: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => auditService.getAll(filters).then((r) => r.data),
  });

  const cls = 'px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-navy-700 text-gray-700 dark:text-gray-300';

  const columns = [
    {
      key: 'createdAt', header: 'Timestamp', width: 160,
      render: (v) => <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{formatDatetime(v)}</span>,
    },
    {
      key: 'user', header: 'User',
      render: (v) => v ? (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{v.firstName} {v.lastName}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{v.role?.replace(/_/g, ' ')}</p>
        </div>
      ) : <span className="text-xs text-gray-400 dark:text-gray-500">System</span>,
    },
    {
      key: 'action', header: 'Action',
      render: (v) => (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ACTION_COLORS[v] || 'bg-gray-100 text-gray-600'}`}>{v}</span>
      ),
    },
    { key: 'resource', header: 'Resource', render: (v) => <span className="text-xs capitalize text-gray-600 dark:text-gray-400">{v}</span> },
    {
      key: 'details', header: 'Details',
      render: (v) => {
        if (!v || !Object.keys(v).length) return <span className="text-gray-300 dark:text-gray-600">—</span>;
        const parts = Object.entries(v).map(([k, val]) => {
          const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
          const display = Array.isArray(val) ? val.join(', ') : val === null ? 'none' : String(val);
          return `${label}: ${display}`;
        });
        return (
          <span className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {parts.map((p, i) => (
              <span key={i} className="inline-block mr-2 whitespace-nowrap">{p}</span>
            ))}
          </span>
        );
      },
    },
    { key: 'ipAddress', header: 'IP', render: (v) => <span className="text-xs font-mono text-gray-400 dark:text-gray-500">{v || '—'}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => <span className="text-xs text-gray-500 dark:text-gray-400">{v?.name || '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-navy-100 rounded-xl flex items-center justify-center">
          <Shield size={18} className="text-navy-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit Logs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Complete record of all system actions</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })} className={cls}>
          <option value="">All Actions</option>
          {Object.keys(ACTION_COLORS).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filters.resource} onChange={(e) => setFilters({ ...filters, resource: e.target.value, page: 1 })} className={cls}>
          <option value="">All Resources</option>
          {['auth', 'user', 'program', 'budget', 'expense', 'liquidation', 'document', 'youth', 'announcement'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">From</label>
          <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value, page: 1 })} className={cls} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">To</label>
          <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value, page: 1 })} className={cls} />
        </div>
        <button onClick={() => setFilters({ page: 1, limit: 20, action: '', resource: '', startDate: '', endDate: '' })}
          className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Clear
        </button>
      </div>

      {data?.meta && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{data.meta.total.toLocaleString()} total log entries</p>
      )}

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage="No audit log entries found"
      />
    </div>
  );
}
