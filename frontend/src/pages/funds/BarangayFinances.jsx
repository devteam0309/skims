import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { budgetService, expenseService } from '../../services/budgetService';
import { municipalityService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import ExpenseReview from '../../components/finance/ExpenseReview';
import { formatCurrency, formatDate } from '../../utils/formatters';
import useAuthStore from '../../store/authStore';

const CROSS_MUNICIPALITY_ROLES = ['super_admin', 'provincial_admin', 'dilg_representative'];

/**
 * Every barangay's money in one table (panel item 7.3): what each was allocated and approved, what
 * it has actually spent and had deducted, what is left, what is still waiting for review, and which
 * liquidations are done. Figures come from recorded transactions in their current state — pending,
 * returned and rejected expenses are shown separately and never counted as spent.
 *
 * Choosing a barangay opens its own records, and any expense there opens the review dialog, so a
 * reviewer can check the receipts behind a figure without leaving the page.
 */
export default function BarangayFinances() {
  const { user } = useAuthStore();
  const isCross = CROSS_MUNICIPALITY_ROLES.includes(user?.role);
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [municipality, setMunicipality] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [reviewId, setReviewId] = useState(null);

  const { data: municipalities = [] } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
    enabled: isCross,
  });

  const params = { fiscalYear, ...(isCross ? { municipality } : {}) };
  const { data, isLoading, error } = useQuery({
    queryKey: ['barangay-performance', params],
    queryFn: () => budgetService.getBarangayPerformance(params).then((r) => r.data.data),
    enabled: !isCross || Boolean(municipality),
  });

  const { data: barangayExpenses } = useQuery({
    queryKey: ['expenses', 'barangay-detail', selected?.id],
    queryFn: () => expenseService.getAll({ barangay: selected.id, limit: 50 }).then((r) => r.data.data),
    enabled: Boolean(selected),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.barangays || [])
      .filter((r) => !q || r.barangay.name.toLowerCase().includes(q))
      .map((r) => ({ ...r, _id: r.barangay._id }));
  }, [data, search]);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + 1 - i);
  const t = data?.totals;

  const columns = [
    {
      key: 'barangay',
      header: 'Barangay',
      render: (v, row) => (
        <button type="button" onClick={() => setSelected({ id: v._id, name: v.name, row })} className="text-left">
          <span className="text-sm font-medium text-navy-800 hover:underline dark:text-navy-200">{v.name}</span>
          <span className="block">{row.budget ? <StatusBadge status={row.budget.status} /> : <span className="meta-text">No budget yet</span>}</span>
        </button>
      ),
    },
    { key: 'allocated', header: 'Allocated', className: 'cell-numeric', render: (v) => formatCurrency(v) },
    { key: 'approvedAllocation', header: 'Approved', className: 'cell-numeric', render: (v) => formatCurrency(v) },
    { key: 'approvedExpenses', header: 'Approved expenses', className: 'cell-numeric', render: (v) => `${formatCurrency(v.amount)} (${v.count})` },
    {
      key: 'utilized',
      header: 'Utilized',
      className: 'cell-numeric',
      render: (v, row) => (
        <span>
          {formatCurrency(v)}
          <span className="meta-text block">{row.utilizationRate}%</span>
        </span>
      ),
    },
    {
      key: 'remaining',
      header: 'Remaining',
      className: 'cell-numeric',
      render: (v) => <span className={v < 0 ? 'font-semibold text-red-600' : 'font-semibold'}>{formatCurrency(v)}</span>,
    },
    {
      key: 'pendingExpenses',
      header: 'Awaiting review',
      className: 'cell-numeric',
      render: (v) => (v.count ? <span className="text-amber-700 dark:text-amber-300">{formatCurrency(v.amount)} ({v.count})</span> : '—'),
    },
    {
      key: 'liquidations',
      header: 'Liquidations',
      render: (v) => <span className="text-xs">{v.approved.count} approved · {v.awaitingReview.count} awaiting</span>,
    },
    {
      key: 'withoutProof',
      header: 'Checks',
      render: (v, row) => (
        <span className="text-xs">
          {v ? <span className="block text-amber-700 dark:text-amber-300">{v} without proof</span> : null}
          {row.unchargedApproved ? <span className="block text-amber-700 dark:text-amber-300">{formatCurrency(row.unchargedApproved)} not charged to its budget</span> : null}
          {!v && !row.unchargedApproved ? <span className="meta-text">Consistent</span> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Barangay Finances</h1>
        <p className="page-subtitle">Each barangay&rsquo;s allocation, spending and remaining balance, from approved transactions</p>
      </div>

      <section aria-label="Choose the period" className="flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <label className="text-sm">
          <span className="meta-text block">Fiscal year</span>
          <select value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {isCross && (
          <label className="text-sm">
            <span className="meta-text block">Municipality</span>
            <select value={municipality} onChange={(e) => setMunicipality(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700">
              <option value="">Choose…</option>
              {municipalities.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="meta-text block">Find a barangay</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Barangay name…" className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700" />
        </label>
      </section>

      {error && <p role="alert" className="text-sm text-red-600">{error.message}</p>}

      {t && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Municipal SK budget', formatCurrency(t.municipalBudget)],
            ['Allocated to barangays', formatCurrency(t.allocatedToBarangays)],
            ['Utilized', formatCurrency(t.utilized)],
            ['Remaining', formatCurrency(t.remaining)],
            ['Awaiting review', `${formatCurrency(t.pendingExpenses.amount)} (${t.pendingExpenses.count})`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <dt className="meta-text">{k}</dt>
              <dd className="numeric mt-1 text-lg font-semibold text-gray-900 dark:text-white">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading && (!isCross || Boolean(municipality))}
        emptyMessage={isCross && !municipality ? 'Choose a municipality' : 'No barangays found'}
      />

      <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `Barangay ${selected.name} — FY ${fiscalYear}` : ''} size="xl">
        {selected && (
          <div className="space-y-4">
            <p className="text-sm">
              Allocated {formatCurrency(selected.row.allocated)} · utilized {formatCurrency(selected.row.utilized)} · remaining{' '}
              <strong>{formatCurrency(selected.row.remaining)}</strong>
            </p>
            <h3 className="section-heading">Expenses</h3>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {(barangayExpenses || []).map((e) => (
                <li key={e._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <button type="button" onClick={() => setReviewId(e._id)} className="text-left text-sm font-medium text-navy-800 hover:underline dark:text-navy-200">
                    {e.referenceNumber} · {e.title}
                  </button>
                  <span className="flex items-center gap-2 text-sm">
                    {formatCurrency(e.amount)} · {formatDate(e.transactionDate)} <StatusBadge status={e.status} />
                  </span>
                </li>
              ))}
              {!barangayExpenses?.length && <li className="meta-text px-3 py-2">No expenses recorded.</li>}
            </ul>
          </div>
        )}
      </Modal>

      <ExpenseReview expenseId={reviewId} onClose={() => setReviewId(null)} />
    </div>
  );
}
