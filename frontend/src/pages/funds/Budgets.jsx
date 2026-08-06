import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Banknote, TrendingUp, TrendingDown, Search, RotateCcw, Trash2, Pencil } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import { formatCurrency, formatDate } from '../../utils/formatters';
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="form-label">Category Allocations <span className="text-gray-400 font-normal">(optional)</span></label>
        <button type="button" onClick={() => onChange([...allocations, emptyAllocation()])}
          className="text-xs px-2 py-1 bg-navy-50 text-navy-800 rounded-lg hover:bg-navy-100 flex items-center gap-1">
          <Plus size={12} />Add
        </button>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
        Caps spending per program category. Leave empty for no per-category limit.
      </p>

      {allocations.length > 0 && (
        <div className="mt-3 space-y-2">
          {allocations.map((a, i) => (
            <div key={i} className="flex gap-2 items-start">
              <select value={a.category} onChange={(e) => update(i, 'category', e.target.value)}
                className="w-40 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-navy-700">
                <option value="">Category…</option>
                {PROGRAM_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}
                    disabled={c.value !== a.category && usedCategories.includes(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input type="number" min="0" placeholder="Amount" value={a.amount}
                onChange={(e) => update(i, 'amount', e.target.value)}
                className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              <input type="text" placeholder="Description (optional)" value={a.description}
                onChange={(e) => update(i, 'description', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              <button type="button" onClick={() => onChange(allocations.filter((_, idx) => idx !== i))}
                className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove allocation">
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className={`flex justify-between text-xs pt-2 border-t ${overAllocated ? 'text-red-600 border-red-200' : 'text-gray-500 border-gray-100'}`}>
            <span>Allocated: <strong>{formatCurrency(allocated)}</strong></span>
            <span>
              {overAllocated
                ? `Over budget by ${formatCurrency(Math.abs(unallocated))}`
                : `Unallocated: ${formatCurrency(unallocated)}`}
            </span>
          </div>
        </div>
      )}
    </div>
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
    { key: 'totalBudget', header: 'Total Budget', render: (v) => <span className="font-semibold">{formatCurrency(v)}</span> },
    { key: 'disbursedAmount', header: 'Disbursed', render: (v) => <span className="text-green-600">{formatCurrency(v)}</span> },
    { key: 'remainingBalance', header: 'Remaining', render: (v) => <span className="text-blue-600">{formatCurrency(v)}</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex gap-2">
          {['draft', 'rejected'].includes(row.status) && canCreate && (
            <button onClick={() => openEdit(row)}
              className="text-xs px-2 py-1 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 flex items-center gap-1">
              <Pencil size={11} />Edit
            </button>
          )}
          {row.status === 'draft' && canCreate && (
            <button onClick={() => handleSubmitBudget(id)}
              className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">Submit</button>
          )}
          {row.status === 'pending_approval' && canApprove && (
            <button onClick={() => handleApproveBudget(id)}
              className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100">Approve</button>
          )}
          {row.status === 'rejected' && canCreate && (
            <button onClick={() => handleReopenBudget(id)}
              className="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 flex items-center gap-1">
              <RotateCcw size={11} />Reopen
            </button>
          )}
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Budget Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Track and manage SK budgets</p>
        </div>
        {canCreate && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Plus size={16} />New Budget
          </button>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
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

      <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm rounded-xl p-4">
        <Search size={14} className="text-gray-400 dark:text-gray-500 ml-1" />
        <input type="text" placeholder="Search budgets..." value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
          className="flex-1 text-sm outline-none text-gray-600 dark:text-gray-300" />
      </div>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage="No budgets found"
      />

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Budget' : 'Create New Budget'} size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : editing ? 'Save Changes' : 'Create Budget'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          {[['title', 'Budget Title', 'text'], ['fiscalYear', 'Fiscal Year', 'number'], ['totalBudget', 'Total Budget (₱)', 'number']].map(([key, label, type]) => (
            <div key={key}>
              <label className="form-label">{label}</label>
              <input type={type} value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
          ))}
          <AllocationsEditor
            allocations={form.allocations}
            totalBudget={form.totalBudget}
            onChange={(allocations) => setForm({ ...form, allocations })}
          />

          <div>
            <label className="form-label">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
