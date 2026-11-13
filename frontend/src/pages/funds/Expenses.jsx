import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Paperclip, Trash2 } from 'lucide-react';
import { expenseService, budgetService } from '../../services/budgetService';
import { programService } from '../../services/programService';
import { municipalityService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import SelectAllCheckbox from '../../components/shared/SelectAllCheckbox';
import RecycleBinTable from '../../components/shared/RecycleBinTable';
import { ProofPicker, appendProof } from '../../components/shared/Attachments';
import ExpenseReview from '../../components/finance/ExpenseReview';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toFormData } from '../../utils/formData';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { refreshAll } from '../../utils/queryRefresh';
import {
  FINANCE_EDITORS, FINANCE_APPROVERS, ADMIN_ROLES, BARANGAY_BOUND_ROLES, PROOF_TYPES,
} from '../../utils/constants';

const EXPENSE_TYPES = [
  { value: 'purchase_request', label: 'Purchase Request' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'delivery_receipt', label: 'Delivery Receipt' },
  { value: 'inspection_acceptance_report', label: 'Inspection & Acceptance Report' },
  { value: 'sales_invoice', label: 'Sales Invoice' },
  { value: 'disbursement_voucher', label: 'Disbursement Voucher' },
  { value: 'official_receipt', label: 'Official Receipt' },
];

// `returned` is a request for correction; `rejected` is final (October 2026).
const EXPENSE_STATUSES = ['draft', 'pending', 'returned', 'approved', 'rejected', 'liquidated'];
const CROSS_MUNICIPALITY_ROLES = ['super_admin', 'provincial_admin', 'dilg_representative'];

const emptyForm = () => ({
  type: '', title: '', description: '', amount: '',
  transactionDate: '', vendorName: '', budget: '', program: '',
});
const FIRST_FILTERS = { page: 1, limit: 10, search: '', type: '', status: '', barangay: '' };

export default function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState(FIRST_FILTERS);
  const [form, setForm] = useState(emptyForm());
  const [proof, setProof] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [reviewId, setReviewId] = useState(null);
  const [showBin, setShowBin] = useState(false);
  const [binPage, setBinPage] = useState(1);

  useEffect(() => { setSelectedIds(new Set()); }, [filters]);

  const canCreate = FINANCE_EDITORS.includes(user?.role);
  const canApprove = FINANCE_APPROVERS.includes(user?.role);
  const isBound = BARANGAY_BOUND_ROLES.includes(user?.role) && Boolean(user?.barangay);
  const isCross = CROSS_MUNICIPALITY_ROLES.includes(user?.role);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => expenseService.getAll(filters).then((r) => r.data),
    enabled: !showBin,
  });

  const { data: summary } = useQuery({
    queryKey: ['expense-summary', filters.barangay],
    queryFn: () => expenseService.getSummary(filters.barangay ? { barangay: filters.barangay } : undefined).then((r) => r.data.data),
  });

  // Approved budgets the caller may charge: a barangay officer's list holds only their own
  // barangay's allocation, so the server's rule shows up as the only sensible choice.
  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
    enabled: canCreate,
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs-active'],
    queryFn: () => programService.getAll({ status: 'ongoing', limit: 100 }).then((r) => r.data.data),
    enabled: canCreate,
  });

  // The barangay filter, for the reviewers who see more than one barangay.
  const ownMunicipality = user?.municipality?._id || user?.municipality;
  const { data: barangayOptions = [] } = useQuery({
    queryKey: ['barangays', ownMunicipality || 'province'],
    queryFn: () => (ownMunicipality && !isCross
      ? municipalityService.getBarangays(ownMunicipality)
      : municipalityService.getAllBarangays()).then((r) => r.data.data),
    enabled: !isBound,
  });

  const { data: binData, isLoading: binLoading } = useQuery({
    queryKey: ['expenses', 'recycle-bin', binPage],
    queryFn: () => expenseService.getDeleted({ page: binPage, limit: 10 }).then((r) => r.data),
    enabled: showBin && canCreate,
  });

  // A treasurer with exactly one approved allocation — the usual case — gets it pre-selected.
  useEffect(() => {
    if (showModal && !form.budget && isBound && budgetsData?.length === 1) {
      setForm((f) => ({ ...f, budget: budgetsData[0]._id }));
    }
  }, [showModal, budgetsData, isBound, form.budget]);

  const invalidate = () => refreshAll(queryClient);
  const closeModal = () => { setShowModal(false); setForm(emptyForm()); setProof([]); };

  /*
   * One multipart body: the fields, then each proof file with what it is. toFormData is idempotent,
   * and the proof is appended to the body it returns.
   */
  const createMutation = useMutation({
    mutationFn: (values) => expenseService.create(appendProof(toFormData(values), proof, 'attachments', PROOF_TYPES)),
    onSuccess: (res) => {
      toast.success(res.data.data.status === 'draft' ? 'Draft saved' : 'Expense submitted for review');
      invalidate();
      closeModal();
    },
    onError: (e) => toast.error(e.message || 'Failed to record expense'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids) => expenseService.bulkApprove(ids),
    onSuccess: (res) => {
      const { approved, skipped } = res.data.data;
      toast.success(`${approved} expense${approved !== 1 ? 's' : ''} approved${skipped > 0 ? `, ${skipped} skipped` : ''}`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e) => toast.error(e.message || 'Bulk approval failed'),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => expenseService.restore(id),
    onSuccess: () => { toast.success('Expense restored'); invalidate(); },
    onError: (e) => toast.error(e.message || 'Restore failed'),
  });
  const purgeMutation = useMutation({
    mutationFn: (id) => expenseService.permanentDelete(id),
    onSuccess: () => { toast.success('Expense permanently deleted'); invalidate(); },
    onError: (e) => toast.error(e.message || 'Permanent delete failed'),
  });

  /*
   * \`asDraft\` decides whether the record goes straight into review or is kept back for the author to
   * finish. Review needs proof attached; a draft may wait for it.
   */
  const handleRecordExpense = async (asDraft = false) => {
    if (!form.type) return toast.error('Please select an expense type');
    if (!form.title.trim()) return toast.error('Expense title is required');
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Amount must be greater than zero');
    if (!form.transactionDate) return toast.error('Transaction date is required');
    if (!asDraft && proof.length === 0) {
      return toast.error('Attach the receipt, invoice or voucher before submitting — or save it as a draft.');
    }

    const amount = formatCurrency(parseFloat(form.amount));
    const result = await confirm.financial({
      title: asDraft ? 'Save as draft?' : 'Submit for review?',
      text: asDraft
        ? `${amount} will be saved as a draft. Nobody reviews it until you submit it.`
        : `${amount} with ${proof.length} supporting document${proof.length === 1 ? '' : 's'} goes to the municipal administrator for approval. Nothing is deducted until it is approved.`,
      confirmText: asDraft ? 'Save draft' : 'Submit',
    });
    if (result.isConfirmed) createMutation.mutate({ ...form, saveAsDraft: asDraft });
  };

  const handleBulkApprove = async () => {
    const count = selectedIds.size;
    const result = await confirm.approve({
      title: `Approve ${count} Expense${count !== 1 ? 's' : ''}?`,
      text: 'Each is approved exactly as if opened one by one: those without proof, or recorded by you, are skipped.',
    });
    if (result.isConfirmed) bulkApproveMutation.mutate([...selectedIds]);
  };

  const rows = data?.data || [];
  const allPageIds = rows.filter((r) => r.status === 'pending').map((r) => r._id);
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

  const hasFilters = Boolean(filters.search || filters.type || filters.status || filters.barangay);
  const clearFilters = () => setFilters(FIRST_FILTERS);

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
          label="Select all pending expenses on this page"
        />
      ),
      render: (_, row) => (row.status === 'pending' ? (
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onChange={() => toggleOne(row._id)}
          aria-label={`Select ${row.title}`}
          className="h-4 w-4 rounded border-gray-300 accent-navy-700"
        />
      ) : null),
    }] : []),
    {
      key: 'referenceNumber',
      header: 'Reference',
      render: (v) => <span className="font-mono text-xs font-semibold text-navy-700 dark:text-navy-300">{v}</span>,
    },
    {
      key: 'title',
      header: 'Expense',
      render: (v, row) => (
        <button type="button" onClick={() => setReviewId(row._id)} className="text-left" aria-label={`Open expense ${v}`}>
          <p className="text-sm font-medium text-navy-800 hover:underline dark:text-navy-200">{v}</p>
          <p className="meta-text capitalize">{row.type?.replace(/_/g, ' ')}{row.program?.title ? ` · ${row.program.title}` : ''}</p>
        </button>
      ),
    },
    ...(!isBound ? [{
      key: 'barangay',
      header: 'Barangay',
      render: (v) => v?.name || <span className="meta-text">Municipality level</span>,
    }] : []),
    {
      key: 'amount',
      header: 'Amount',
      className: 'cell-numeric',
      render: (v) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(v)}</span>,
    },
    { key: 'transactionDate', header: 'Date', render: (v) => formatDate(v) },
    {
      key: 'attachments',
      header: 'Proof',
      render: (v) => (v?.length
        ? <span className="flex items-center gap-1 text-xs"><Paperclip size={12} aria-hidden="true" />{v.length}</span>
        : <span className="text-xs font-medium text-amber-700 dark:text-amber-300">None</span>),
    },
    {
      key: 'status',
      header: 'Status',
      // A returned or rejected expense carries its reason with it.
      render: (v, row) => (
        <div>
          <StatusBadge status={v} />
          {v === 'returned' && row.returnReason && <p className="meta-text mt-1 max-w-[16rem] whitespace-normal">{row.returnReason}</p>}
          {v === 'rejected' && row.rejectionReason && <p className="meta-text mt-1 max-w-[16rem] whitespace-normal">{row.rejectionReason}</p>}
        </div>
      ),
    },
    {
      key: '_id',
      header: <span className="sr-only">Actions</span>,
      render: (id, row) => (
        <button
          type="button"
          onClick={() => setReviewId(id)}
          className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
            canApprove && row.status === 'pending'
              ? 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
          }`}
        >
          {canApprove && row.status === 'pending' ? 'Review' : 'Open'}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            {isBound ? `Barangay ${user.barangay?.name || ''} expenses` : 'Every barangay\'s expenses, with their proof'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <button
              type="button"
              aria-pressed={showBin}
              onClick={() => { setShowBin((v) => !v); setBinPage(1); }}
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
            >
              <Trash2 size={16} aria-hidden="true" />{showBin ? 'Back to expenses' : 'Recycle bin'}
            </button>
          )}
          {canCreate && !showBin && (
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
      </div>

      {showBin ? (
        <RecycleBinTable
          data={binData}
          loading={binLoading}
          onPageChange={setBinPage}
          restoring={restoreMutation.isPending}
          destroying={purgeMutation.isPending}
          describe={(row) => ({ title: row.title, detail: `${row.referenceNumber} · ${formatCurrency(row.amount)} · ${row.status}` })}
          onRestore={async (row) => {
            const r = await confirm.save({ title: 'Restore this expense?', text: `${row.title} returns to the list as ${row.status}.`, confirmText: 'Restore' });
            if (r.isConfirmed) restoreMutation.mutate(row._id);
          }}
          onPermanentDelete={async (row) => {
            const r = await confirm.delete({ title: 'Delete permanently?', text: `${row.title} and its attachments will be destroyed. The audit log keeps a copy of the record.`, confirmText: 'Delete permanently' });
            if (r.isConfirmed) purgeMutation.mutate(row._id);
          }}
        />
      ) : (
      <>
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

          {!isBound && (
            <div>
              <label htmlFor="filter-barangay" className="sr-only">Filter by barangay</label>
              <select
                id="filter-barangay"
                value={filters.barangay}
                onChange={(e) => setFilters({ ...filters, barangay: e.target.value, page: 1 })}
                className="max-w-[14rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="">All barangays</option>
                <option value="none">Municipality level only</option>
                {barangayOptions.map((b) => (
                  <option key={b._id} value={b._id}>{b.name}{isCross && b.municipality?.name ? ` (${b.municipality.name})` : ''}</option>
                ))}
              </select>
            </div>
          )}

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
      </>
      )}

      <ExpenseReview expenseId={reviewId} onClose={() => setReviewId(null)} />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Record New Expense"
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            {/* Two ways out of the form: keep working on it, or send it up for review. */}
            <button
              type="button"
              onClick={() => handleRecordExpense(true)}
              disabled={createMutation.isPending}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Save as draft
            </button>
            <button
              type="button"
              onClick={() => handleRecordExpense(false)}
              disabled={createMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Saving...' : 'Submit for review'}
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

          <Field
            id="expense-budget"
            label="Charged to"
            optional
            hint={isBound
              ? 'Your barangay spends from its own allocation only — never the municipal budget.'
              : 'A barangay expense is charged to that barangay\'s allocation; a municipality-level one to the municipal budget.'}
          >
            <select
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className={control}
            >
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => (
                <option key={b._id} value={b._id}>
                  {b.title} — FY {b.fiscalYear} · {b.barangay?.name ? `Barangay ${b.barangay.name}` : 'Municipal'} · {formatCurrency((b.totalBudget || 0) - (b.disbursedAmount || 0))} left
                </option>
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

          <Field id="expense-description" label="Description and purpose" optional>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className={`${control} resize-y`}
            />
          </Field>

          <fieldset>
            <legend className="form-label">
              Supporting documents <span className="text-red-600" aria-hidden="true">*</span>
              <span className="sr-only"> (required to submit)</span>
            </legend>
            <p className="field-hint mb-2">
              Official receipt, sales invoice, voucher or other proof. Required to submit for review; a
              draft can be saved without it.
            </p>
            <ProofPicker id="expense-proof" value={proof} onChange={setProof} typeOptions={PROOF_TYPES} onReject={(m) => toast.error(m)} />
          </fieldset>

          {ADMIN_ROLES.includes(user?.role) && (
            <p className="meta-text">You cannot approve an expense you record yourself — another administrator reviews it.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
