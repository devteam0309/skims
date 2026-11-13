import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Paperclip, Trash2 } from 'lucide-react';
import { liquidationService, budgetService, expenseService } from '../../services/budgetService';
import { programService } from '../../services/programService';
import { documentService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import RecycleBinTable from '../../components/shared/RecycleBinTable';
import { ProofPicker, appendProof } from '../../components/shared/Attachments';
import LiquidationReview from '../../components/finance/LiquidationReview';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toFormData } from '../../utils/formData';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { FINANCE_EDITORS, FINANCE_APPROVERS, BARANGAY_BOUND_ROLES, PROOF_TYPES } from '../../utils/constants';

// supportingDocuments holds ids of documents ALREADY in Document Management; expenses the ids of
// approved expenses this report accounts for.
const EMPTY_FORM = { title: '', program: '', budget: '', totalAmount: '', liquidatedAmount: '', dueDate: '', remarks: '', supportingDocuments: [], expenses: [] };

const STATUS_FILTERS = ['', 'draft', 'submitted', 'returned', 'approved', 'rejected'];

/** The DILG document chain a liquidation sits at the end of. */
const WORKFLOW = [
  'Purchase Request', 'Purchase Order', 'Delivery Receipt', 'Inspection Report',
  'Sales Invoice', 'Disbursement Voucher', 'Official Receipt', 'Liquidation',
];

/** Statuses past which a due date no longer demands anything of anyone. */
const SETTLED = ['approved', 'liquidated', 'rejected'];

export default function Liquidations() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 10, status: '', search: '' });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [proof, setProof] = useState([]);
  const [reviewId, setReviewId] = useState(null);
  const [showBin, setShowBin] = useState(false);
  const [binPage, setBinPage] = useState(1);

  const canCreate = FINANCE_EDITORS.includes(user?.role);
  const canApprove = FINANCE_APPROVERS.includes(user?.role);
  const isBound = BARANGAY_BOUND_ROLES.includes(user?.role) && Boolean(user?.barangay);

  /*
   * Documents that can back this report. Loaded only while the form is open, and only the active,
   * unarchived ones — the server also refuses anything outside the caller's own scope, so this list
   * can never offer a document the request would then be rejected for naming.
   */
  const { data: documentOptions } = useQuery({
    queryKey: ['documents', 'for-liquidation'],
    queryFn: () => documentService.getAll({ limit: 100, isArchived: false }).then((r) => r.data.data),
    enabled: showModal,
  });

  // Approved expenses not yet liquidated: what a report can account for.
  const { data: expenseOptions } = useQuery({
    queryKey: ['expenses', 'for-liquidation'],
    queryFn: () => expenseService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
    enabled: showModal,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['liquidations', filters],
    queryFn: () => liquidationService.getAll(filters).then((r) => r.data),
    enabled: !showBin,
  });

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
    enabled: showModal,
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs-for-liquidation'],
    queryFn: () => programService.getAll({ limit: 100 }).then((r) => r.data.data),
    enabled: showModal,
  });

  const { data: binData, isLoading: binLoading } = useQuery({
    queryKey: ['liquidations', 'recycle-bin', binPage],
    queryFn: () => liquidationService.getDeleted({ page: binPage, limit: 10 }).then((r) => r.data),
    enabled: showBin && canCreate,
  });

  const closeModal = () => { setShowModal(false); setForm(EMPTY_FORM); setProof([]); };
  const invalidate = () => queryClient.invalidateQueries(['liquidations']);

  const createMutation = useMutation({
    mutationFn: (values) => liquidationService.create(appendProof(toFormData(values), proof, 'documents', PROOF_TYPES)),
    onSuccess: () => {
      toast.success('Liquidation report created');
      invalidate();
      closeModal();
    },
    onError: (e) => toast.error(e.message || 'Failed to create liquidation'),
  });
  const restoreMutation = useMutation({
    mutationFn: (id) => liquidationService.restore(id),
    onSuccess: () => { toast.success('Report restored'); invalidate(); },
    onError: (e) => toast.error(e.message || 'Restore failed'),
  });
  const purgeMutation = useMutation({
    mutationFn: (id) => liquidationService.permanentDelete(id),
    onSuccess: () => { toast.success('Report permanently deleted'); invalidate(); },
    onError: (e) => toast.error(e.message || 'Permanent delete failed'),
  });

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error('Title is required');
    if (!form.program) return toast.error('Please select a program');
    if (!form.totalAmount || parseFloat(form.totalAmount) <= 0) return toast.error('Total amount must be greater than zero');
    if (form.liquidatedAmount && parseFloat(form.liquidatedAmount) > parseFloat(form.totalAmount)) {
      return toast.error('Liquidated amount cannot exceed total amount');
    }
    // The same rule the server applies: a report is the evidence that money was spent.
    if (proof.length === 0 && form.supportingDocuments.length === 0) {
      return toast.error('Attach the receipts or invoices — upload them here, or tick documents already filed.');
    }
    const result = await confirm.financial({
      title: 'Create Liquidation Report?',
      text: `Total amount: ${formatCurrency(parseFloat(form.totalAmount))}, with ${proof.length + form.supportingDocuments.length} supporting document(s).`,
    });
    if (result.isConfirmed) createMutation.mutate(form);
  };

  const toggleIn = (key, id) => setForm((f) => ({
    ...f,
    [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
  }));

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
        <button type="button" onClick={() => setReviewId(row._id)} className="text-left" aria-label={`Open liquidation report ${v}`}>
          <p className="text-sm font-medium text-navy-800 hover:underline dark:text-navy-200">{v}</p>
          <p className="meta-text">{row.program?.title || '—'}</p>
        </button>
      ),
    },
    ...(!isBound ? [{
      key: 'barangay',
      header: 'Barangay',
      render: (v) => v?.name || <span className="meta-text">Municipality level</span>,
    }] : []),
    {
      key: 'totalAmount',
      header: 'Amount',
      className: 'cell-numeric',
      render: (v) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(v)}</span>,
    },
    {
      /*
       * The model computes variance as totalAmount − liquidatedAmount and forbids liquidating
       * more than the total, so it is never negative: any positive figure is money not yet
       * accounted for.
       */
      key: 'variance',
      header: 'Unliquidated',
      className: 'cell-numeric',
      render: (v) => (v > 0
        ? <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(v)}</span>
        : <span className="text-gray-500 dark:text-gray-400">Fully liquidated</span>),
    },
    {
      key: 'documents',
      header: 'Proof',
      render: (v, row) => {
        const n = (v?.length || 0) + (row.supportingDocuments?.length || 0);
        return n
          ? <span className="flex items-center gap-1 text-xs"><Paperclip size={12} aria-hidden="true" />{n}</span>
          : <span className="text-xs font-medium text-amber-700 dark:text-amber-300">None</span>;
      },
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      render: (v, row) => {
        if (!v) return '—';
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
      header: <span className="sr-only">Actions</span>,
      render: (id, row) => (
        <button
          type="button"
          onClick={() => setReviewId(id)}
          className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
            canApprove && ['submitted', 'under_review'].includes(row.status)
              ? 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
          }`}
        >
          {canApprove && ['submitted', 'under_review'].includes(row.status) ? 'Review' : 'Open'}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Liquidations</h1>
          <p className="page-subtitle">Liquidation reports, each with the receipts and invoices behind it</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <button
              type="button"
              aria-pressed={showBin}
              onClick={() => { setShowBin((v) => !v); setBinPage(1); }}
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
            >
              <Trash2 size={16} aria-hidden="true" />{showBin ? 'Back to reports' : 'Recycle bin'}
            </button>
          )}
          {canCreate && !showBin && (
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
      </div>

      {showBin ? (
        <RecycleBinTable
          data={binData}
          loading={binLoading}
          onPageChange={setBinPage}
          restoring={restoreMutation.isPending}
          destroying={purgeMutation.isPending}
          describe={(row) => ({ title: row.title, detail: `${row.referenceNumber} · ${formatCurrency(row.totalAmount)} · ${row.status}` })}
          onRestore={async (row) => {
            const r = await confirm.save({ title: 'Restore this report?', text: `${row.title} returns to the list as ${row.status}.`, confirmText: 'Restore' });
            if (r.isConfirmed) restoreMutation.mutate(row._id);
          }}
          onPermanentDelete={async (row) => {
            const r = await confirm.delete({ title: 'Delete permanently?', text: `${row.title} and its attachments will be destroyed. The audit log keeps a copy of the record.`, confirmText: 'Delete permanently' });
            if (r.isConfirmed) purgeMutation.mutate(row._id);
          }}
        />
      ) : (
      <>
      {/* An ordered sequence, so it is marked up as one rather than as a row of loose spans. */}
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
      </>
      )}

      <LiquidationReview liquidationId={reviewId} onClose={() => setReviewId(null)} />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="New Liquidation Report"
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
              {(programsData || []).map((p) => <option key={p._id} value={p._id}>{p.title}{p.barangay?.name ? ` — ${p.barangay.name}` : ''}</option>)}
            </select>
          </Field>

          <Field id="liq-budget" label="Linked Budget" optional>
            <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={control}>
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => (
                <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear} · {b.barangay?.name ? `Barangay ${b.barangay.name}` : 'Municipal'}</option>
              ))}
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
            <Field id="liq-liquidated" label="Liquidated Amount (₱)" optional hint="Cannot exceed the total.">
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

          {form.totalAmount > 0 && (
            <p className="meta-text">
              Unliquidated:{' '}
              <span className="numeric font-medium text-gray-700 dark:text-gray-300">
                {formatCurrency(Math.max(0, parseFloat(form.totalAmount || 0) - parseFloat(form.liquidatedAmount || 0)))}
              </span>
            </p>
          )}

          <Field id="liq-due" label="Due Date" optional>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={control} />
          </Field>

          <Field id="liq-remarks" label="Remarks" optional>
            <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} className={`${control} resize-y`} />
          </Field>

          <fieldset>
            <legend className="form-label">
              Supporting documents <span className="text-red-600" aria-hidden="true">*</span>
              <span className="sr-only"> (at least one required)</span>
            </legend>
            <p className="field-hint mb-2">
              Upload the official receipts, sales invoices, acknowledgment receipts or disbursement vouchers —
              or tick documents already filed below. At least one is required.
            </p>
            <ProofPicker id="liq-proof" value={proof} onChange={setProof} typeOptions={PROOF_TYPES} max={20} onReject={(m) => toast.error(m)} />
          </fieldset>

          {/*
            * Approved expenses this report accounts for. Approving the report marks them liquidated —
            * the deduction already happened when each expense was approved, so nothing is deducted twice.
            */}
          <Field id="liq-expenses" label="Expenses accounted for" optional hint="Approved expenses only. Each can belong to one report.">
            {expenseOptions?.length ? (
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-600">
                {expenseOptions.map((e) => (
                  <label key={e._id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <input type="checkbox" checked={form.expenses.includes(e._id)} onChange={() => toggleIn('expenses', e._id)} className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-navy-700" />
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-800 dark:text-gray-100">{e.title} · {formatCurrency(e.amount)}</span>
                      <span className="meta-text">{e.referenceNumber} · {formatDate(e.transactionDate)}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="field-hint mt-1">No approved expenses waiting to be liquidated.</p>
            )}
          </Field>

          <Field id="liq-documents" label="Documents already filed" optional hint="Documents in Document Management this report is evidenced by.">
            {documentOptions?.length ? (
              <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-600">
                {documentOptions.map((doc) => (
                  <label key={doc._id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <input type="checkbox" checked={form.supportingDocuments.includes(doc._id)} onChange={() => toggleIn('supportingDocuments', doc._id)} className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-navy-700" />
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-800 dark:text-gray-100">{doc.title}</span>
                      <span className="meta-text capitalize">{doc.category?.replace(/_/g, ' ')}{doc.originalName ? ` · ${doc.originalName}` : ''}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="field-hint mt-1">No documents available to link yet.</p>
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
