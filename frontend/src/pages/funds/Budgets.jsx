import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Banknote, TrendingUp, TrendingDown, Search, RotateCcw } from 'lucide-react';
import { budgetService } from '../../services/budgetService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { FINANCE_STAFF, ADMIN_ROLES } from '../../utils/constants';

export default function Budgets() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '' });
  const [form, setForm] = useState({ title: '', fiscalYear: new Date().getFullYear(), totalBudget: '', notes: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['budgets', filters],
    queryFn: () => budgetService.getAll(filters).then((r) => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ['budget-summary'],
    queryFn: () => budgetService.getSummary().then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (d) => budgetService.create(d),
    onSuccess: () => { toast.success('Budget created'); queryClient.invalidateQueries(['budgets']); setShowModal(false); },
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

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error('Budget title is required');
    if (!form.fiscalYear || parseInt(form.fiscalYear) < 2020) return toast.error('Please enter a valid fiscal year');
    if (!form.totalBudget || parseFloat(form.totalBudget) <= 0) return toast.error('Total budget must be greater than zero');
    const result = await confirm.create({ title: 'Create Budget?', text: 'You are about to create a new budget record.' });
    if (result.isConfirmed) createMutation.mutate(form);
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
    { key: 'title', header: 'Budget Title', render: (v, row) => <div><p className="font-medium text-gray-900 dark:text-white">{v}</p><p className="text-xs text-gray-400 dark:text-gray-500">FY {row.fiscalYear}</p></div> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || '—' },
    { key: 'totalBudget', header: 'Total Budget', render: (v) => <span className="font-semibold">{formatCurrency(v)}</span> },
    { key: 'disbursedAmount', header: 'Disbursed', render: (v) => <span className="text-green-600">{formatCurrency(v)}</span> },
    { key: 'remainingBalance', header: 'Remaining', render: (v) => <span className="text-blue-600">{formatCurrency(v)}</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex gap-2">
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
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Plus size={16} />New Budget
          </button>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Approved Budget', value: formatCurrency(summary.total), icon: Banknote, color: 'text-navy-700' },
            { label: 'Total Disbursed', value: formatCurrency(summary.disbursed), icon: TrendingUp, color: 'text-green-600' },
            { label: 'Total Remaining', value: formatCurrency(summary.remaining), icon: TrendingDown, color: 'text-blue-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={16} className={s.color} />
                <span className="text-xs text-gray-500 dark:text-gray-400">{s.label}</span>
              </div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
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

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create New Budget" size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleCreate} disabled={createMutation.isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {createMutation.isPending ? 'Creating...' : 'Create Budget'}
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
