import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Banknote, TrendingUp, TrendingDown, RotateCcw, Trash2, Pencil, Landmark, Layers } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import { municipalityService } from '../../services/documentService';
import RecycleBinTable from '../../components/shared/RecycleBinTable';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatCurrency } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { refreshAll } from '../../utils/queryRefresh';
import {
  FINANCE_EDITORS, PROGRAM_CATEGORIES, BUDGET_APPROVERS, BARANGAY_BOUND_ROLES, FINANCE_MONITORS,
} from '../../utils/constants';

/*
 * `level` is the October 2026 split: the MUNICIPAL budget (the municipality's total SK budget for
 * the year) or a BARANGAY allocation carved out of it. Only accounts that are not tied to one
 * barangay choose; a barangay treasurer's budget is always their own barangay's — the server
 * forces it either way.
 */
const emptyForm = () => ({
  title: '',
  fiscalYear: new Date().getFullYear(),
  totalBudget: '',
  notes: '',
  allocations: [],
  level: 'barangay',
  barangay: '',
  municipality: '',
});

const CROSS_MUNICIPALITY_WRITERS = ['super_admin', 'provincial_admin'];
const FIRST_FILTERS = { page: 1, limit: 10, search: '', barangay: '', level: '' };

const emptyAllocation = () => ({ category: '', amount: '', description: '' });

/**
 * Per-category spending caps. The backend enforces these in `expenseController.createExpense`
 * (category matched case-insensitively against the linked program's category), but until now
 * there was no way to set them outside the seeder.
 */
function AllocationsEditor({ allocations, totalBudget, onChange }) {
  const allocated = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const total = parseFloat(totalBudget) || 0;
  const unallocated = total - allocated;
  const overAllocated = allocated > total;

  const usedCategories = allocations.map((a) => a.category).filter(Boolean);

  const update = (i, key, value) =>
    onChange(allocations.map((a, idx) => (idx === i ? { ...a, [key]: value } : a)));

  // The row inputs are small and repeat down the column, so each needs its own name rather than
  // borrowing the group legend. Placeholders were doing that job, and a placeholder disappears
  // the moment the field has a value.
  const rowControl =
    'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-navy-700 focus:ring-2 focus:ring-navy-700/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

  return (
    <fieldset>
      <div className="flex items-center justify-between">
        <legend className="form-label">
          Category Allocations <span className="font-normal text-gray-500">(optional)</span>
        </legend>
        <button
          type="button"
          onClick={() => onChange([...allocations, emptyAllocation()])}
          className="flex items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-xs font-medium text-navy-800 transition-colors hover:bg-navy-100 dark:bg-navy-500/20 dark:text-navy-200 dark:hover:bg-navy-500/30"
        >
          <Plus size={12} aria-hidden="true" />Add
        </button>
      </div>
      <p className="field-hint">
        Caps spending per program category. Leave empty for no per-category limit.
      </p>

      {allocations.length > 0 && (
        <div className="mt-3 space-y-2">
          {allocations.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <label htmlFor={`alloc-category-${i}`} className="sr-only">Allocation {i + 1} category</label>
              <select
                id={`alloc-category-${i}`}
                value={a.category}
                onChange={(e) => update(i, 'category', e.target.value)}
                className={`${rowControl} w-40`}
              >
                <option value="">Category…</option>
                {PROGRAM_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}
                    disabled={c.value !== a.category && usedCategories.includes(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>

              <label htmlFor={`alloc-amount-${i}`} className="sr-only">Allocation {i + 1} amount</label>
              <input
                id={`alloc-amount-${i}`}
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={a.amount}
                onChange={(e) => update(i, 'amount', e.target.value)}
                className={`${rowControl} numeric w-32`}
              />

              <label htmlFor={`alloc-description-${i}`} className="sr-only">Allocation {i + 1} description</label>
              <input
                id={`alloc-description-${i}`}
                type="text"
                placeholder="Description (optional)"
                value={a.description}
                onChange={(e) => update(i, 'description', e.target.value)}
                className={`${rowControl} flex-1`}
              />

              <button
                type="button"
                onClick={() => onChange(allocations.filter((_, idx) => idx !== i))}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                aria-label={`Remove allocation ${i + 1}`}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}

          {/*
            Over-allocation is a blocking condition — handleSave refuses to submit it — so it is
            announced rather than left as a colour change the user may not be looking at.
          */}
          <div
            role={overAllocated ? 'alert' : undefined}
            className={`flex justify-between border-t pt-2 text-xs ${
              overAllocated
                ? 'border-red-200 text-red-600 dark:border-red-500/40 dark:text-red-400'
                : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            <span>Allocated: <strong className="numeric">{formatCurrency(allocated)}</strong></span>
            <span className="numeric">
              {overAllocated
                ? `Over budget by ${formatCurrency(Math.abs(unallocated))}`
                : `Unallocated: ${formatCurrency(unallocated)}`}
            </span>
          </div>
        </div>
      )}
    </fieldset>
  );
}

export default function Budgets() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState(FIRST_FILTERS);
  const [form, setForm] = useState(emptyForm());
  const [showBin, setShowBin] = useState(false);
  const [binPage, setBinPage] = useState(1);

  const isBound = BARANGAY_BOUND_ROLES.includes(user?.role) && Boolean(user?.barangay);
  const isCrossWriter = CROSS_MUNICIPALITY_WRITERS.includes(user?.role);
  const ownMunicipality = user?.municipality?._id || user?.municipality;

  const { data, isLoading } = useQuery({
    queryKey: ['budgets', filters],
    queryFn: () => budgetService.getAll(filters).then((r) => r.data),
    enabled: !showBin,
  });

  const { data: summary } = useQuery({
    queryKey: ['budget-summary', filters.barangay],
    queryFn: () => budgetService.getSummary(filters.barangay ? { barangay: filters.barangay } : undefined).then((r) => r.data.data),
  });

  const { data: binData, isLoading: binLoading } = useQuery({
    queryKey: ['budgets', 'recycle-bin', binPage],
    queryFn: () => budgetService.getDeleted({ page: binPage, limit: 10 }).then((r) => r.data),
    enabled: showBin && FINANCE_EDITORS.includes(user?.role),
  });

  // The province-wide writers pick the municipality a new budget belongs to.
  const { data: municipalities = [] } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
    enabled: isCrossWriter,
  });

  /*
   * Barangays for the filter and for the allocation form: the caller's own municipality's, or —
   * for a province-wide writer — the municipality chosen in the form (and every barangay, grouped
   * by municipality, for the filter).
   */
  const formMunicipality = isCrossWriter ? form.municipality : ownMunicipality;
  const { data: formBarangays = [] } = useQuery({
    queryKey: ['barangays', formMunicipality],
    queryFn: () => municipalityService.getBarangays(formMunicipality).then((r) => r.data.data),
    enabled: showModal && !isBound && Boolean(formMunicipality),
  });
  const { data: filterBarangays = [] } = useQuery({
    queryKey: ['barangays', ownMunicipality || 'province'],
    queryFn: () => (ownMunicipality && !isCrossWriter
      ? municipalityService.getBarangays(ownMunicipality)
      : municipalityService.getAllBarangays()).then((r) => r.data.data),
    enabled: !isBound,
  });

  const invalidate = () => refreshAll(queryClient);

  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const createMutation = useMutation({
    mutationFn: (d) => budgetService.create(d),
    onSuccess: () => { toast.success('Budget created'); invalidate(); closeModal(); },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => budgetService.reject(id, reason),
    onSuccess: () => { toast.success('Budget rejected'); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => budgetService.delete(id),
    onSuccess: () => { toast.success('Budget moved to the recycle bin'); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => budgetService.restore(id),
    onSuccess: () => { toast.success('Budget restored'); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const purgeMutation = useMutation({
    mutationFn: (id) => budgetService.permanentDelete(id),
    onSuccess: () => { toast.success('Budget permanently deleted'); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }) => budgetService.update(id, d),
    onSuccess: () => {
      toast.success('Budget updated');
      invalidate();
      closeModal();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => budgetService.approve(id),
    onSuccess: () => { toast.success('Budget approved'); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const reopenMutation = useMutation({
    mutationFn: (id) => budgetService.reopen(id),
    onSuccess: () => { toast.success('Budget reopened for revision'); queryClient.invalidateQueries(['budgets']); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };

  const openEdit = (row) => {
    const all = row.allocations || [];
    setEditing({
      id: row._id,
      // The editor only manages category-level caps; program-linked allocations are preserved
      // untouched so editing a budget can't silently drop them.
      programAllocations: all.filter((a) => a.program),
    });
    setForm({
      title: row.title || '',
      fiscalYear: row.fiscalYear || new Date().getFullYear(),
      totalBudget: row.totalBudget ?? '',
      notes: row.notes || '',
      allocations: all
        .filter((a) => !a.program)
        .map((a) => ({ category: a.category || '', amount: a.amount ?? '', description: a.description || '' })),
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error('Budget title is required');
    if (!form.fiscalYear || parseInt(form.fiscalYear) < 2020) return toast.error('Please enter a valid fiscal year');
    if (!form.totalBudget || parseFloat(form.totalBudget) <= 0) return toast.error('Total budget must be greater than zero');

    const rows = form.allocations.filter((a) => a.category || a.amount);
    if (rows.some((a) => !a.category)) return toast.error('Every allocation needs a category');
    if (rows.some((a) => !(parseFloat(a.amount) > 0))) return toast.error('Every allocation needs an amount greater than zero');

    const categories = rows.map((a) => a.category);
    if (new Set(categories).size !== categories.length) return toast.error('Each category can only be allocated once');

    const allocated = rows.reduce((s, a) => s + parseFloat(a.amount), 0);
    if (allocated > parseFloat(form.totalBudget)) {
      return toast.error(`Allocations (${formatCurrency(allocated)}) exceed the total budget`);
    }

    const allocations = [
      ...rows.map((a) => ({
        category: a.category,
        amount: parseFloat(a.amount),
        ...(a.description?.trim() ? { description: a.description.trim() } : {}),
      })),
      ...(editing?.programAllocations || []),
    ];
    // Only a new budget chooses its level and barangay; both are fixed once it exists.
    const { level, barangay, municipality, ...rest } = form;
    if (!editing && !isBound && level === 'barangay' && !barangay) {
      return toast.error('Choose the barangay this allocation is for');
    }
    if (!editing && isCrossWriter && !municipality) return toast.error('Choose the municipality');
    const payload = {
      ...rest,
      totalBudget: parseFloat(form.totalBudget),
      allocations,
      ...(!editing && !isBound && level === 'barangay' ? { barangay } : {}),
      ...(!editing && isCrossWriter ? { municipality } : {}),
    };

    if (editing) {
      const result = await confirm.save({ title: 'Save Changes?', text: 'This will update the budget record and its allocations.' });
      if (result.isConfirmed) updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      const result = await confirm.create({ title: 'Create Budget?', text: 'You are about to create a new budget record.' });
      if (result.isConfirmed) createMutation.mutate(payload);
    }
  };

  const handleSubmitBudget = async (id) => {
    const result = await confirm.submit({ title: 'Submit Budget for Approval?', text: 'The budget will be sent for review and approval.' });
    if (result.isConfirmed) budgetService.submit(id).then(() => { toast.success('Submitted'); queryClient.invalidateQueries(['budgets']); }).catch((e) => toast.error(e.message));
  };

  const handleApproveBudget = async (id) => {
    const result = await confirm.approve({ title: 'Approve Budget?', text: 'Approving this budget will make it active for disbursement.' });
    if (result.isConfirmed) approveMutation.mutate(id);
  };

  const handleRejectBudget = async (row) => {
    const result = await confirm.rejectWithReason({
      title: 'Reject this budget?',
      text: `${row.title} — ${formatCurrency(row.totalBudget)}`,
      inputLabel: 'Reason for rejecting it',
      confirmText: 'Reject with this reason',
    });
    if (result.isConfirmed) rejectMutation.mutate({ id: row._id, reason: result.value });
  };

  const handleDeleteBudget = async (row) => {
    const result = await confirm.archive({
      title: 'Move to the recycle bin?',
      text: `${row.title} leaves the list. It can be restored from the recycle bin.`,
      confirmText: 'Move to recycle bin',
    });
    if (result.isConfirmed) deleteMutation.mutate(row._id);
  };

  const handleReopenBudget = async (id) => {
    const result = await confirm.save({ title: 'Reopen Budget?', text: 'This will reset the budget back to draft status for revision.' });
    if (result.isConfirmed) reopenMutation.mutate(id);
  };

  const canCreate = FINANCE_EDITORS.includes(user?.role);
  // DILG is provincial oversight and observes rather than decides — see constants.js.
  const canApprove = BUDGET_APPROVERS.includes(user?.role);

  const columns = [
    {
      key: 'title', header: 'Budget Title', render: (v, row) => (
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{v}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            FY {row.fiscalYear}
            {row.allocations?.length > 0 && ` · ${row.allocations.length} allocation${row.allocations.length > 1 ? 's' : ''}`}
          </p>
        </div>
      )
    },
    {
      key: 'barangay',
      header: 'Level',
      // The municipal budget is the whole; a barangay allocation is a part of it.
      render: (v, row) => (
        <div className="text-xs">
          {v?.name
            ? <span className="font-medium text-gray-800 dark:text-gray-100">Barangay {v.name}</span>
            : <span className="font-medium text-navy-800 dark:text-navy-200">Municipal budget</span>}
          {row.municipality?.name && <p className="meta-text">{row.municipality.name}</p>}
        </div>
      ),
    },
    /*
     * These three are one quantity split three ways, not three kinds of thing. Painting
     * Disbursed green and Remaining blue implied a status distinction that does not exist —
     * the same reasoning already applied to the summary cards above. Red is kept for the one
     * case that genuinely needs attention: a balance that has gone negative.
     */
    {
      key: 'totalBudget',
      header: 'Total Budget',
      className: 'cell-numeric',
      render: (v) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(v)}</span>,
    },
    { key: 'disbursedAmount', header: 'Disbursed', className: 'cell-numeric', render: (v) => formatCurrency(v) },
    {
      // Money promised to approved programs but not yet spent. Shown next to Disbursed because
      // the two together are what has actually been claimed against the budget — Remaining alone
      // overstates what a municipality can still commit.
      key: 'committedAmount',
      header: 'Committed',
      className: 'cell-numeric',
      render: (v) => (v > 0
        ? formatCurrency(v)
        : <span className="text-gray-400 dark:text-gray-500">—</span>),
    },
    {
      key: 'remainingBalance',
      header: 'Remaining',
      className: 'cell-numeric',
      render: (v) => (v < 0
        ? <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(v)}</span>
        : formatCurrency(v)),
    },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex gap-2">
          {['draft', 'rejected'].includes(row.status) && canCreate && (
            <button
              type="button"
              onClick={() => openEdit(row)}
              aria-label={`Edit ${row.title}`}
              className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              <Pencil size={11} aria-hidden="true" />Edit
            </button>
          )}
          {row.status === 'draft' && canCreate && (
            <button
              type="button"
              onClick={() => handleSubmitBudget(id)}
              aria-label={`Submit ${row.title} for approval`}
              className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
            >
              Submit
            </button>
          )}
          {row.status === 'pending_approval' && canApprove && (
            <>
              <button
                type="button"
                onClick={() => handleApproveBudget(id)}
                disabled={approveMutation.isPending}
                aria-label={`Approve ${row.title}`}
                className="rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleRejectBudget(row)}
                disabled={rejectMutation.isPending}
                aria-label={`Reject ${row.title}`}
                className="rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:bg-red-500/15 dark:text-red-300"
              >
                Reject
              </button>
            </>
          )}
          {row.status !== 'approved' && canCreate && (
            <button
              type="button"
              onClick={() => handleDeleteBudget(row)}
              disabled={deleteMutation.isPending}
              aria-label={`Delete ${row.title}`}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:text-red-600 disabled:opacity-60"
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
          {row.status === 'rejected' && canCreate && (
            <button
              type="button"
              onClick={() => handleReopenBudget(id)}
              disabled={reopenMutation.isPending}
              aria-label={`Reopen ${row.title} for revision`}
              className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
            >
              <RotateCcw size={11} aria-hidden="true" />Reopen
            </button>
          )}
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Budget Management</h1>
          <p className="page-subtitle">
            {isBound
              ? `Barangay ${user.barangay?.name || ''}'s own budget allocation`
              : 'The municipal SK budget and each barangay\'s allocation from it'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FINANCE_MONITORS.includes(user?.role) && (
            <Link
              to="/finance/barangays"
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
            >
              <Landmark size={16} aria-hidden="true" />Barangay finances
            </Link>
          )}
          {canCreate && (
            <button
              type="button"
              aria-pressed={showBin}
              onClick={() => { setShowBin((v) => !v); setBinPage(1); }}
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
            >
              <Trash2 size={16} aria-hidden="true" />{showBin ? 'Back to budgets' : 'Recycle bin'}
            </button>
          )}
          {canCreate && !showBin && (
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
            >
              <Plus size={16} aria-hidden="true" />New Budget
            </button>
          )}
        </div>
      </div>

      {showBin && (
        <RecycleBinTable
          data={binData}
          loading={binLoading}
          onPageChange={setBinPage}
          restoring={restoreMutation.isPending}
          destroying={purgeMutation.isPending}
          describe={(row) => ({ title: row.title, detail: `FY ${row.fiscalYear} · ${formatCurrency(row.totalBudget)} · ${row.status}` })}
          onRestore={async (row) => {
            const r = await confirm.save({ title: 'Restore this budget?', text: `${row.title} returns to the list as ${row.status}.`, confirmText: 'Restore' });
            if (r.isConfirmed) restoreMutation.mutate(row._id);
          }}
          onPermanentDelete={async (row) => {
            const r = await confirm.delete({ title: 'Delete permanently?', text: `${row.title} will be destroyed. The audit log keeps a copy of the record.`, confirmText: 'Delete permanently' });
            if (r.isConfirmed) purgeMutation.mutate(row._id);
          }}
        />
      )}

      {/* Summary cards. Fixed columns left each figure a few characters wide on a phone. */}
      {summary && !showBin && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            /*
             * Counted once: a barangay allocation is part of the municipal budget, not added to it
             * (backend utils/budgetTotals.js). A barangay officer's figures are their own allocation.
             */
            { label: isBound ? 'Allocated to your barangay' : 'Total SK budget (approved)', value: formatCurrency(summary.totalBudget), icon: Banknote },
            ...(!isBound ? [{ label: 'Allocated to barangays', value: formatCurrency(summary.allocatedToBarangays), icon: Layers }] : []),
            { label: 'Total Disbursed', value: formatCurrency(summary.totalDisbursed), icon: TrendingUp },
            { label: 'Total Remaining', value: formatCurrency(summary.totalRemaining), icon: TrendingDown },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 flex items-center gap-2">
                <s.icon size={15} className="text-gray-400 dark:text-gray-500" aria-hidden="true" />
                <span className="meta-text">{s.label}</span>
              </div>
              {/* Uniform colour: these three are one quantity split three ways, so colouring them
                  differently implied a status distinction that does not exist. */}
              <p className="numeric text-xl font-semibold text-gray-900 dark:text-white">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {!showBin && (
      <>
      <section aria-label="Search budgets" className="flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {/* Bound straight to the query key, this fired one request per keystroke. A barangay's name
            is searched too, so "Agot" finds Agot's allocation. */}
        <SearchInput
          id="budget-search"
          label="Search budgets"
          placeholder="Search budgets or barangays..."
          value={filters.search}
          onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
        />
        {!isBound && (
          <>
            <div>
              <label htmlFor="budget-level" className="sr-only">Budget level</label>
              <select
                id="budget-level"
                value={filters.level}
                onChange={(e) => setFilters({ ...filters, level: e.target.value, barangay: '', page: 1 })}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="">Municipal and barangay</option>
                <option value="municipal">Municipal budget only</option>
                <option value="barangay">Barangay allocations only</option>
              </select>
            </div>
            <div>
              <label htmlFor="budget-barangay" className="sr-only">Filter by barangay</label>
              <select
                id="budget-barangay"
                value={filters.barangay}
                onChange={(e) => setFilters({ ...filters, barangay: e.target.value, level: '', page: 1 })}
                className="max-w-[14rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="">All barangays</option>
                {filterBarangays.map((b) => (
                  <option key={b._id} value={b._id}>{b.name}{isCrossWriter && b.municipality?.name ? ` (${b.municipality.name})` : ''}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </section>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={filters.search || filters.barangay || filters.level
          ? 'No budgets match these filters'
          : (isBound ? 'Your barangay has no budget allocation yet' : 'No budgets yet')}
        emptyAction={filters.search || filters.barangay || filters.level ? (
          <button
            type="button"
            onClick={() => setFilters(FIRST_FILTERS)}
            className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
          >
            Clear filters
          </button>
        ) : null}
      />
      </>
      )}

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Budget' : 'Create New Budget'} size="lg"
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
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : editing ? 'Save Changes' : 'Create Budget'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <RequiredNote />

          {!editing && isCrossWriter && (
            <Field id="budget-municipality" label="Municipality" required>
              <select
                value={form.municipality}
                onChange={(e) => setForm({ ...form, municipality: e.target.value, barangay: '' })}
                className={control}
              >
                <option value="">Select municipality...</option>
                {municipalities.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
            </Field>
          )}

          {!editing && !isBound && (
            <fieldset>
              <legend className="form-label">Budget level</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {[
                  ['municipal', 'Municipal budget', 'The municipality\'s total SK budget for the year.'],
                  ['barangay', 'Barangay allocation', 'One barangay\'s share, carved out of the municipal budget.'],
                ].map(([value, title, hint]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${form.level === value ? 'border-navy-700 bg-navy-50 dark:border-navy-400 dark:bg-navy-900/30' : 'border-gray-200 dark:border-gray-600'}`}
                  >
                    <input
                      type="radio"
                      name="budget-level"
                      value={value}
                      checked={form.level === value}
                      onChange={() => setForm({ ...form, level: value })}
                      className="mt-1 accent-navy-700"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">{title}</span>
                      <span className="meta-text">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {!editing && !isBound && form.level === 'barangay' && (
            <Field
              id="budget-barangay-choice"
              label="Barangay"
              required
              hint="It can be approved only if it fits what the municipal budget has not already allocated or spent."
            >
              <select
                value={form.barangay}
                onChange={(e) => setForm({ ...form, barangay: e.target.value })}
                disabled={!formMunicipality}
                className={control}
              >
                <option value="">{formMunicipality ? 'Select barangay...' : 'Select a municipality first'}</option>
                {formBarangays.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </Field>
          )}

          {!editing && isBound && (
            <p className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              This budget is filed for <strong>Barangay {user.barangay?.name}</strong>. It is reviewed by the
              municipal administrator, and must fit within the municipal budget to be approved.
            </p>
          )}

          <Field id="budget-title" label="Budget Title" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., FY 2026 Annual Youth Budget"
              className={control}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="budget-fiscal-year" label="Fiscal Year" required>
              <input
                type="number"
                min="2020"
                step="1"
                value={form.fiscalYear}
                onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
                className={`${control} numeric`}
              />
            </Field>
            <Field id="budget-total" label="Total Budget (₱)" required>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.totalBudget}
                onChange={(e) => setForm({ ...form, totalBudget: e.target.value })}
                placeholder="0.00"
                className={`${control} numeric`}
              />
            </Field>
          </div>

          <AllocationsEditor
            allocations={form.allocations}
            totalBudget={form.totalBudget}
            onChange={(allocations) => setForm({ ...form, allocations })}
          />

          <Field id="budget-notes" label="Notes" optional>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className={`${control} resize-y`}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
