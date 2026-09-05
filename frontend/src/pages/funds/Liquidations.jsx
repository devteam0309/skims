import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { liquidationService, budgetService } from '../../services/budgetService';
import { programService } from '../../services/programService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toFormData } from '../../utils/formData';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { FINANCE_STAFF, FINANCE_APPROVERS } from '../../utils/constants';

const EMPTY_FORM = { title: '', program: '', budget: '', totalAmount: '', liquidatedAmount: '', dueDate: '', remarks: '' };

const STATUS_FILTERS = ['', 'draft', 'submitted', 'under_review', 'approved', 'rejected'];

/** The DILG document chain a liquidation sits at the end of. */
const WORKFLOW = [
  'Purchase Request', 'Purchase Order', 'Delivery Receipt', 'Inspection Report',
  'Sales Invoice', 'Disbursement Voucher', 'Official Receipt', 'Liquidation',
];

/** Statuses past which a due date no longer demands anything of anyone. */
const SETTLED = ['approved', 'liquidated'];

export default function Liquidations() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 10, status: '', search: '' });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['liquidations', filters],
    queryFn: () => liquidationService.getAll(filters).then((r) => r.data),
  });

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
    enabled: showModal,
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs-active'],
    queryFn: () => programService.getAll({ status: 'ongoing', limit: 100 }).then((r) => r.data.data),
    enabled: showModal,
  });

  const closeModal = () => { setShowModal(false); setForm(EMPTY_FORM); };

  const createMutation = useMutation({
    mutationFn: (values) => liquidationService.create(toFormData(values)),
    onSuccess: () => {
      toast.success('Liquidation report created');
      queryClient.invalidateQueries(['liquidations']);
      closeModal();
    },
    onError: (e) => toast.error(e.message || 'Failed to create liquidation'),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => liquidationService.approve(id),
    onSuccess: () => { toast.success('Liquidation approved'); queryClient.invalidateQueries(['liquidations']); },
    onError: (e) => toast.error(e.message || 'Approval failed'),
  });

  const submitMutation = useMutation({
    mutationFn: (id) => liquidationService.submit(id),
    onSuccess: () => { toast.success('Liquidation submitted for review'); queryClient.invalidateQueries(['liquidations']); },
    onError: (e) => toast.error(e.message || 'Submission failed'),
  });

  const canCreate = FINANCE_STAFF.includes(user?.role);
  // DILG is provincial oversight and observes rather than decides — see constants.js.
  const canApprove = FINANCE_APPROVERS.includes(user?.role);

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error('Title is required');
    if (!form.program) return toast.error('Please select a program');
    if (!form.totalAmount || parseFloat(form.totalAmount) <= 0) return toast.error('Total amount must be greater than zero');
    if (form.liquidatedAmount && parseFloat(form.liquidatedAmount) > parseFloat(form.totalAmount)) {
      return toast.error('Liquidated amount cannot exceed total amount');
    }
    const result = await confirm.financial({
      title: 'Create Liquidation Report?',
      text: `Total amount: ${formatCurrency(parseFloat(form.totalAmount))}`,
    });
    if (result.isConfirmed) createMutation.mutate(form);
  };

  const handleSubmitLiquidation = async (id) => {
    const result = await confirm.submit({ title: 'Submit Liquidation?', text: 'The liquidation report will be sent for review.' });
    if (result.isConfirmed) submitMutation.mutate(id);
  };

  const handleApproveLiquidation = async (id) => {
    const result = await confirm.approve({ title: 'Approve Liquidation?', text: 'This liquidation report will be marked as approved.' });
    if (result.isConfirmed) approveMutation.mutate(id);
  };

  const hasFilters = Boolean(filters.search || filters.status);

  const columns = [
    {
      key: 'referenceNumber',
      header: 'Reference',
      render: (v) => <span className="font-mono text-xs font-bold text-navy-700 dark:text-navy-300">{v}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (v, row) => (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{v}</p>
          <p className="meta-text">{row.program?.title || '—'}</p>
        </div>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Amount',
      className: 'cell-numeric',
      render: (v) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(v)}</span>,
    },
    {
      key: 'liquidatedAmount',
      header: 'Liquidated',
      className: 'cell-numeric',
      render: (v) => formatCurrency(v),
    },
    {
      /*
       * The model computes variance as totalAmount − liquidatedAmount and forbids liquidating
       * more than the total, so it is never negative: any positive figure is money not yet
       * accounted for. The column showed a bare coloured amount with no indication of which
       * direction it ran, and Math.abs() hid a sign that cannot occur anyway.
       */
      key: 'variance',
      header: 'Unliquidated',
      className: 'cell-numeric',
      render: (v) => (v > 0
        ? <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(v)}</span>
        : <span className="text-gray-500 dark:text-gray-400">Fully liquidated</span>),
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      render: (v, row) => {
        if (!v) return '—';
        // An approved report that happens to sit past its due date is finished business; it was
        // still painted red, so settled rows competed for attention with genuinely late ones.
        const overdue = new Date(v) < new Date() && !SETTLED.includes(row.status);
        return overdue ? (
          <span className="font-medium text-red-600 dark:text-red-400">
            {formatDate(v)} <span className="meta-text text-red-600 dark:text-red-400">· overdue</span>
          </span>
        ) : formatDate(v);
      },
    },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id',
      header: 'Actions',
      render: (id, row) => (
        <div className="flex gap-2">
          {row.status === 'draft' && canCreate && (
            <button
              type="button"
              onClick={() => handleSubmitLiquidation(id)}
              disabled={submitMutation.isPending}
              aria-label={`Submit ${row.title}`}
              className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
            >
              Submit
            </button>
          )}
          {row.status === 'submitted' && canApprove && (
            <button
              type="button"
              onClick={() => handleApproveLiquidation(id)}
              disabled={approveMutation.isPending}
              aria-label={`Approve ${row.title}`}
              className="rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
            >
              Approve
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Liquidations</h1>
          <p className="page-subtitle">Manage program fund liquidation reports</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Plus size={16} aria-hidden="true" />
            New Liquidation
          </button>
        )}
      </div>

      {/* An ordered sequence, so it is marked up as one rather than as a row of loose spans.
          The arrows are decorative — the list order already carries the meaning. */}
      <section aria-label="Financial workflow" className="rounded-xl border border-navy-200 bg-navy-50 p-4 dark:border-navy-800 dark:bg-navy-900/20">
        <h2 className="mb-2 text-sm font-semibold text-navy-800 dark:text-navy-300">Financial Workflow</h2>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-navy-600 dark:text-navy-400">
          {WORKFLOW.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded bg-navy-200 px-2 py-0.5 font-medium text-navy-800 dark:bg-navy-800 dark:text-navy-200">{step}</span>
              {i < WORKFLOW.length - 1 && <span aria-hidden="true" className="text-navy-400">→</span>}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Filter liquidations" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SearchInput
          id="liquidation-search"
          label="Search liquidations"
          placeholder="Search liquidations..."
          value={filters.search}
          onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
        />

        {/* Six filters overflowed the viewport on a phone with no way to reach the last two. */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {STATUS_FILTERS.map((s) => {
            const active = filters.status === s;
            return (
              <button
                key={s || 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => setFilters({ ...filters, status: s, page: 1 })}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-navy-900 text-white dark:bg-navy-600'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'All'}
              </button>
            );
          })}
        </div>
      </section>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={hasFilters ? 'No liquidations match these filters' : 'No liquidation reports yet'}
        emptyAction={hasFilters ? (
          <button
            type="button"
            onClick={() => setFilters({ page: 1, limit: 10, status: '', search: '' })}
            className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
          >
            Clear filters
          </button>
        ) : null}
      />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="New Liquidation Report"
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Report'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <RequiredNote />

          <Field id="liq-title" label="Title" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Q1 2026 Program Liquidation"
              className={control}
            />
          </Field>

          <Field id="liq-program" label="Program" required>
            <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className={control}>
              <option value="">Select program...</option>
              {(programsData || []).map((p) => <option key={p._id} value={p._id}>{p.title}</option>)}
            </select>
          </Field>

          <Field id="liq-budget" label="Linked Budget" optional>
            <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={control}>
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>)}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="liq-total" label="Total Amount (₱)" required>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.totalAmount}
                onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                placeholder="0.00"
                className={`${control} numeric`}
              />
            </Field>
            <Field
              id="liq-liquidated"
              label="Liquidated Amount (₱)"
              optional
              hint="Cannot exceed the total."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.liquidatedAmount}
                onChange={(e) => setForm({ ...form, liquidatedAmount: e.target.value })}
                placeholder="0.00"
                className={`${control} numeric`}
              />
            </Field>
          </div>

          {/* The remaining figure was only discoverable by saving and reading it back off the
              table. It is the number the report exists to explain, so it is shown while typing. */}
          {form.totalAmount > 0 && (
            <p className="meta-text">
              Unliquidated:{' '}
              <span className="numeric font-medium text-gray-700 dark:text-gray-300">
                {formatCurrency(Math.max(0, parseFloat(form.totalAmount || 0) - parseFloat(form.liquidatedAmount || 0)))}
              </span>
            </p>
          )}

          <Field id="liq-due" label="Due Date" optional>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className={control}
            />
          </Field>

          <Field id="liq-remarks" label="Remarks" optional>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              rows={2}
              className={`${control} resize-y`}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
