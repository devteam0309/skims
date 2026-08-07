import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Banknote, TrendingUp, TrendingDown, RotateCcw, Trash2, Pencil } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatCurrency } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { FINANCE_STAFF, ADMIN_ROLES, PROGRAM_CATEGORIES } from '../../utils/constants';

const emptyForm = () => ({
  title: '',
  fiscalYear: new Date().getFullYear(),
  totalBudget: '',
  notes: '',
  allocations: [],
});

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
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '' });
  const [form, setForm] = useState(emptyForm());

  const { data, isLoading } = useQuery({
    queryKey: ['budgets', filters],
    queryFn: () => budgetService.getAll(filters).then((r) => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ['budget-summary'],
    queryFn: () => budgetService.getSummary().then((r) => r.data.data),
  });

  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const createMutation = useMutation({
    mutationFn: (d) => budgetService.create(d),
    onSuccess: () => { toast.success('Budget created'); queryClient.invalidateQueries(['budgets']); closeModal(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }) => budgetService.update(id, d),
    onSuccess: () => {
      toast.success('Budget updated');
      queryClient.invalidateQueries(['budgets']);
      queryClient.invalidateQueries(['budget-summary']);
      closeModal();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => budgetService.approve(id),
    onSuccess: () => { toast.success('Budget approved'); queryClient.invalidateQueries(['budgets']); },
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
    const payload = { ...form, totalBudget: parseFloat(form.totalBudget), allocations };

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

  const handleReopenBudget = async (id) => {
    const result = await confirm.save({ title: 'Reopen Budget?', text: 'This will reset the budget back to draft status for revision.' });
    if (result.isConfirmed) reopenMutation.mutate(id);
  };

  const canCreate = FINANCE_STAFF.includes(user?.role);
  const canApprove = [...ADMIN_ROLES, 'dilg_representative'].includes(user?.role);

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
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || '—' },
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
            <button
              type="button"
              onClick={() => handleApproveBudget(id)}
              disabled={approveMutation.isPending}
              aria-label={`Approve ${row.title}`}
              className="rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
            >
              Approve
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
          <p className="page-subtitle">Track and manage SK budgets</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Plus size={16} aria-hidden="true" />New Budget
          </button>
        )}
      </div>

      {/* Summary cards. Three fixed columns left each figure a few characters wide on a phone. */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            // The API returns totalBudget/totalDisbursed/totalRemaining (see
            // budgetController.getBudgetSummary). These read summary.total/.disbursed/.remaining,
            // which are undefined, so every card rendered a confident ₱0.00 next to a table
            // showing real money — the worst possible failure for a finance screen.
            { label: 'Total Approved Budget', value: formatCurrency(summary.totalBudget), icon: Banknote },
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

      <section aria-label="Search budgets" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {/* Bound straight to the query key, this fired one request per keystroke. */}
        <SearchInput
          id="budget-search"
          label="Search budgets"
          placeholder="Search budgets..."
          value={filters.search}
          onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
        />
      </section>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={filters.search ? 'No budgets match this search' : 'No budgets yet'}
        emptyAction={filters.search ? (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, search: '', page: 1 }))}
            className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
          >
            Clear search
          </button>
        ) : null}
      />

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
