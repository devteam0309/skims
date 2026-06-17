import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ClipboardList, Search } from 'lucide-react';
import { liquidationService } from '../../services/budgetService';
import { budgetService } from '../../services/budgetService';
import { programService } from '../../services/programService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import Modal from '../../components/shared/Modal';
import { confirm } from '../../utils/confirm';
import { FINANCE_STAFF, ADMIN_ROLES } from '../../utils/constants';

const EMPTY_FORM = { title: '', program: '', budget: '', totalAmount: '', liquidatedAmount: '', dueDate: '', remarks: '' };

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

  const createMutation = useMutation({
    mutationFn: (data) => {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => { if (v) fd.append(k, v); });
      return liquidationService.create(fd);
    },
    onSuccess: () => {
      toast.success('Liquidation report created');
      queryClient.invalidateQueries(['liquidations']);
      setShowModal(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => liquidationService.approve(id),
    onSuccess: () => { toast.success('Liquidation approved'); queryClient.invalidateQueries(['liquidations']); },
    onError: (e) => toast.error(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (id) => liquidationService.submit(id),
    onSuccess: () => { toast.success('Liquidation submitted for review'); queryClient.invalidateQueries(['liquidations']); },
    onError: (e) => toast.error(e.message),
  });

  const canCreate = FINANCE_STAFF.includes(user?.role);
  const canApprove = [...ADMIN_ROLES, 'dilg_representative'].includes(user?.role);

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error('Title is required');
    if (!form.program) return toast.error('Please select a program');
    if (!form.totalAmount || parseFloat(form.totalAmount) <= 0) return toast.error('Total amount must be greater than zero');
    if (form.liquidatedAmount && parseFloat(form.liquidatedAmount) > parseFloat(form.totalAmount)) {
      return toast.error('Liquidated amount cannot exceed total amount');
    }
    const result = await confirm.financial({ title: 'Create Liquidation Report?', text: `Total amount: ${formatCurrency(parseFloat(form.totalAmount))}` });
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

  const columns = [
    { key: 'referenceNumber', header: 'Reference', render: (v) => <span className="font-mono text-xs font-bold text-navy-700">{v}</span> },
    { key: 'title', header: 'Title', render: (v, row) => <div><p className="font-medium text-sm text-gray-900 dark:text-white">{v}</p><p className="text-xs text-gray-400 dark:text-gray-500">{row.program?.title}</p></div> },
    { key: 'totalAmount', header: 'Amount', render: (v) => <span className="font-semibold">{formatCurrency(v)}</span> },
    { key: 'liquidatedAmount', header: 'Liquidated', render: (v) => <span className="text-green-600">{formatCurrency(v)}</span> },
    { key: 'variance', header: 'Variance', render: (v) => <span className={v > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(Math.abs(v))}</span> },
    { key: 'dueDate', header: 'Due Date', render: (v) => v ? <span className={new Date(v) < new Date() ? 'text-red-600 font-medium' : ''}>{formatDate(v)}</span> : '—' },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex gap-2">
          {row.status === 'draft' && canCreate && (
            <button onClick={() => handleSubmitLiquidation(id)} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">Submit</button>
          )}
          {row.status === 'submitted' && canApprove && (
            <button onClick={() => handleApproveLiquidation(id)} className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100">Approve</button>
          )}
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Liquidations</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage program fund liquidation reports</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Plus size={16} />New Liquidation
          </button>
        )}
      </div>

      {/* Workflow guide */}
      <div className="bg-navy-50 dark:bg-navy-900/20 border border-navy-200 dark:border-navy-800 rounded-xl p-4">
        <p className="text-sm font-semibold text-navy-800 dark:text-navy-300 mb-2">Financial Workflow</p>
        <div className="flex items-center gap-2 flex-wrap text-xs text-navy-600 dark:text-navy-400">
          {['Purchase Request', 'Purchase Order', 'Delivery Receipt', 'Inspection Report', 'Sales Invoice', 'Disbursement Voucher', 'Official Receipt', 'Liquidation'].map((step, i) => (
            <span key={step} className="flex items-center gap-1">
              <span className="bg-navy-200 dark:bg-navy-800 text-navy-800 dark:text-navy-200 px-2 py-0.5 rounded font-medium">{step}</span>
              {i < 7 && <span className="text-navy-400">→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm rounded-xl p-4">
        <Search size={14} className="text-gray-400 dark:text-gray-500 ml-1" />
        <input type="text" placeholder="Search liquidations..." value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
          className="flex-1 text-sm outline-none text-gray-600 dark:text-gray-300" />
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {['', 'draft', 'submitted', 'under_review', 'approved', 'rejected'].map((s) => (
          <button key={s} onClick={() => setFilters({ ...filters, status: s })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filters.status === s ? 'bg-navy-900 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'All'}
          </button>
        ))}
      </div>

      <DataTable columns={columns} data={data?.data} loading={isLoading}
        pagination={data?.meta} onPageChange={(p) => setFilters({ ...filters, page: p })} />

      {/* Create Liquidation Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New Liquidation Report" size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleCreate} disabled={createMutation.isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {createMutation.isPending ? 'Creating...' : 'Create Report'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="form-label">Title *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Q1 2026 Program Liquidation"
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700" />
          </div>
          <div>
            <label className="form-label">Program *</label>
            <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">Select program...</option>
              {(programsData || []).map((p) => <option key={p._id} value={p._id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Linked Budget</label>
            <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Total Amount (₱) *</label>
              <input type="number" min="0" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
            <div>
              <label className="form-label">Liquidated Amount (₱)</label>
              <input type="number" min="0" value={form.liquidatedAmount} onChange={(e) => setForm({ ...form, liquidatedAmount: e.target.value })}
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
          </div>
          <div>
            <label className="form-label">Due Date</label>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
          </div>
          <div>
            <label className="form-label">Remarks</label>
            <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
