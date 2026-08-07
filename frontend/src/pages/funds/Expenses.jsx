import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { expenseService, budgetService } from '../../services/budgetService';
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
import { FINANCE_STAFF, REPORTERS } from '../../utils/constants';

const EXPENSE_TYPES = [
  { value: 'purchase_request', label: 'Purchase Request' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'delivery_receipt', label: 'Delivery Receipt' },
  { value: 'inspection_acceptance_report', label: 'Inspection & Acceptance Report' },
  { value: 'sales_invoice', label: 'Sales Invoice' },
  { value: 'disbursement_voucher', label: 'Disbursement Voucher' },
  { value: 'official_receipt', label: 'Official Receipt' },
];

const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'liquidated'];

const emptyForm = () => ({
  type: '', title: '', description: '', amount: '',
  transactionDate: '', vendorName: '', budget: '', program: '',
});

export default function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '', type: '', status: '' });
  const [form, setForm] = useState(emptyForm());
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => { setSelectedIds(new Set()); }, [filters]);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => expenseService.getAll(filters).then((r) => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ['expense-summary'],
    queryFn: () => expenseService.getSummary().then((r) => r.data.data),
  });

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs-active'],
    queryFn: () => programService.getAll({ status: 'ongoing', limit: 100 }).then((r) => r.data.data),
  });

  const closeModal = () => { setShowModal(false); setForm(emptyForm()); };

  /*
   * The submit handler used to build a FormData and pass *that* in, while this mutationFn ran
   * `Object.entries()` over it to build another — and a FormData has no own enumerable
   * properties, so that yields []. Every field was dropped and the request went out with an empty
   * body. The server rejected it on `type`, `title`, `amount` and `transactionDate`, so the user
   * filled the form in full, confirmed an amount, and was told the fields they had just filled in
   * were required. Recording an expense could not succeed at all.
   *
   * toFormData is idempotent, so neither shape of argument can resurrect this.
   */
  const createMutation = useMutation({
    mutationFn: (values) => expenseService.create(toFormData(values)),
    onSuccess: () => {
      toast.success('Expense recorded');
      queryClient.invalidateQueries(['expenses']);
      queryClient.invalidateQueries(['expense-summary']);
      closeModal();
    },
    onError: (e) => toast.error(e.message || 'Failed to record expense'),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => expenseService.approve(id),
    onSuccess: () => {
      toast.success('Expense approved');
      queryClient.invalidateQueries(['expenses']);
      queryClient.invalidateQueries(['expense-summary']);
    },
    onError: (e) => toast.error(e.message || 'Approval failed'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids) => expenseService.bulkApprove(ids),
    onSuccess: (res) => {
      const { approved, skipped } = res.data.data;
      toast.success(`${approved} expense${approved !== 1 ? 's' : ''} approved${skipped > 0 ? `, ${skipped} skipped` : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries(['expenses']);
      queryClient.invalidateQueries(['expense-summary']);
    },
    onError: (e) => toast.error(e.message || 'Bulk approval failed'),
  });

  const canCreate = FINANCE_STAFF.includes(user?.role);
  const canApprove = REPORTERS.includes(user?.role);

  const handleRecordExpense = async () => {
    if (!form.type) return toast.error('Please select an expense type');
    if (!form.title.trim()) return toast.error('Expense title is required');
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Amount must be greater than zero');
    if (!form.transactionDate) return toast.error('Transaction date is required');

    const result = await confirm.financial({
      title: 'Record Expense?',
      text: `You are about to record an expense of ${formatCurrency(parseFloat(form.amount))}.`,
    });
    if (result.isConfirmed) createMutation.mutate(form);
  };

  const handleApproveExpense = async (id) => {
    const result = await confirm.approve({ title: 'Approve Expense?', text: 'This expense will be marked as approved and deducted from the budget.' });
    if (result.isConfirmed) approveMutation.mutate(id);
  };

  const handleBulkApprove = async () => {
    const count = selectedIds.size;
    const result = await confirm.approve({
      title: `Approve ${count} Expense${count !== 1 ? 's' : ''}?`,
      text: 'Selected pending expenses will be marked as approved and deducted from the budget.',
    });
    if (result.isConfirmed) bulkApproveMutation.mutate([...selectedIds]);
  };

  const rows = data?.data || [];
  const allPageIds = rows.map((r) => r._id);
  const selectedOnPage = allPageIds.filter((id) => selectedIds.has(id)).length;
  const allPageSelected = allPageIds.length > 0 && selectedOnPage === allPageIds.length;

  const toggleAll = () => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (allPageSelected) allPageIds.forEach((id) => next.delete(id));
    else allPageIds.forEach((id) => next.add(id));
    return next;
  });

  const toggleOne = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const hasFilters = Boolean(filters.search || filters.type || filters.status);
  const clearFilters = () => setFilters({ page: 1, limit: 10, search: '', type: '', status: '' });

  const columns = [
    // The bulk-select column only earns its width for someone who can actually approve.
    ...(canApprove ? [{
      key: '__select',
      width: '40px',
      header: (
        <SelectAllCheckbox
          checked={allPageSelected}
          indeterminate={selectedOnPage > 0 && !allPageSelected}
          onChange={toggleAll}
          disabled={allPageIds.length === 0}
        />
      ),
      render: (_, row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onChange={() => toggleOne(row._id)}
          // Row checkboxes announced as bare "checkbox" with no indication of which record
          // they governed — on a control that approves money.
          aria-label={`Select ${row.title}`}
          className="h-4 w-4 rounded border-gray-300 accent-navy-700"
        />
      ),
    }] : []),
    {
      key: 'referenceNumber',
      header: 'Reference',
      render: (v) => <span className="font-mono text-xs font-semibold text-navy-700 dark:text-navy-300">{v}</span>,
    },
    {
      key: 'title',
      header: 'Expense Title',
      render: (v, row) => (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{v}</p>
          <p className="meta-text capitalize">{row.type?.replace(/_/g, ' ')}</p>
        </div>
      ),
    },
    { key: 'program', header: 'Program', render: (v) => v?.title || '—' },
    {
      key: 'amount',
      header: 'Amount',
      className: 'cell-numeric',
      render: (v) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(v)}</span>,
    },
    { key: 'transactionDate', header: 'Date', render: (v) => formatDate(v) },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id',
      header: 'Actions',
      render: (id, row) => (
        row.status === 'pending' && canApprove ? (
          <button
            type="button"
            onClick={() => handleApproveExpense(id)}
            disabled={approveMutation.isPending}
            aria-label={`Approve ${row.title}`}
            className="rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
          >
            Approve
          </button>
        ) : null
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">Track all financial transactions</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Plus size={16} aria-hidden="true" />
            Record Expense
          </button>
        )}
      </div>

      {/* Four fixed columns squeezed each figure to a couple of characters on a phone. */}
      {summary?.byType?.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.byType.slice(0, 4).map((t) => (
            <div key={t._id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <dt className="meta-text capitalize">{t._id?.replace(/_/g, ' ')}</dt>
              <dd>
                <p className="numeric mt-1 text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(t.total)}</p>
                <p className="meta-text">
                  <span className="numeric">{t.count}</span> transaction{t.count !== 1 ? 's' : ''}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-label="Filter expenses" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap gap-3">
          <SearchInput
            id="expense-search"
            label="Search expenses"
            placeholder="Search expenses..."
            value={filters.search}
            // Searching from page 3 previously kept you on page 3 of the new result set, which
            // is frequently past its end — so a matching search looked like it found nothing.
            onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
          />

          <div>
            <label htmlFor="filter-type" className="sr-only">Filter by expense type</label>
            <select
              id="filter-type"
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Types</option>
              {EXPENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="sr-only">Filter by status</label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Statuses</option>
              {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {canApprove && selectedIds.size > 0 && (
        <div
          // Announced, because the bar appears well away from the checkbox that summoned it.
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-200 bg-navy-50 px-4 py-3 dark:border-navy-800 dark:bg-navy-900/20"
        >
          <span className="text-sm font-medium text-navy-700 dark:text-navy-300">
            <span className="numeric">{selectedIds.size}</span> expense{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-white hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={bulkApproveMutation.isPending}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
            >
              {bulkApproveMutation.isPending ? 'Approving...' : `Approve ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={hasFilters ? 'No expenses match these filters' : 'No expenses recorded yet'}
        emptyAction={hasFilters ? (
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300">
            Clear filters
          </button>
        ) : null}
      />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Record New Expense"
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
              onClick={handleRecordExpense}
              disabled={createMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Saving...' : 'Record Expense'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <RequiredNote />

          <Field id="expense-type" label="Expense Type" required>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={control}
            >
              <option value="">Select type...</option>
              {EXPENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          <Field id="expense-title" label="Title" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., Tarpaulin printing for youth summit"
              className={control}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="expense-amount" label="Amount (₱)" required>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className={`${control} numeric`}
              />
            </Field>
            <Field id="expense-date" label="Transaction Date" required>
              <input
                type="date"
                value={form.transactionDate}
                onChange={(e) => setForm({ ...form, transactionDate: e.target.value })}
                className={control}
              />
            </Field>
          </div>

          <Field id="expense-vendor" label="Vendor Name" optional>
            <input
              type="text"
              value={form.vendorName}
              onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
              className={control}
            />
          </Field>

          <Field id="expense-budget" label="Budget" optional hint="Only approved budgets can be charged.">
            <select
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className={control}
            >
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => (
                <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>
              ))}
            </select>
          </Field>

          <Field
            id="expense-program"
            label="Program"
            optional
            hint="The program's category is checked against the budget's per-category cap."
          >
            <select
              value={form.program}
              onChange={(e) => setForm({ ...form, program: e.target.value })}
              className={control}
            >
              <option value="">No program linked</option>
              {(programsData || []).map((p) => <option key={p._id} value={p._id}>{p.title}</option>)}
            </select>
          </Field>

          <Field id="expense-description" label="Description" optional>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className={`${control} resize-y`}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Header checkbox for bulk selection.
 *
 * `indeterminate` is a DOM property with no HTML attribute, so it can only be set through a ref.
 * Without it the header box read as fully unchecked while a subset of the page was selected —
 * and clicking it then selected everything rather than clearing, which on a bulk-approve control
 * over money is the wrong default to guess at.
 */
function SelectAllCheckbox({ checked, indeterminate, onChange, disabled }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label="Select all expenses on this page"
      className="h-4 w-4 rounded border-gray-300 accent-navy-700 disabled:opacity-40"
    />
  );
}
