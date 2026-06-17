import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, CreditCard } from 'lucide-react';
import { expenseService, budgetService } from '../../services/budgetService';
import { programService } from '../../services/programService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import { formatCurrency, formatDate } from '../../utils/formatters';
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

export default function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '', type: '', status: '' });
  const [form, setForm] = useState({ type: '', title: '', description: '', amount: '', transactionDate: '', vendorName: '', budget: '', program: '' });
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

  const createMutation = useMutation({
    mutationFn: (d) => {
      const fd = new FormData();
      Object.entries(d).forEach(([k, v]) => { if (v) fd.append(k, v); });
      return expenseService.create(fd);
    },
    onSuccess: () => { toast.success('Expense recorded'); queryClient.invalidateQueries(['expenses']); setShowModal(false); setForm({ type: '', title: '', description: '', amount: '', transactionDate: '', vendorName: '', budget: '', program: '' }); },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => expenseService.approve(id),
    onSuccess: () => { toast.success('Expense approved'); queryClient.invalidateQueries(['expenses']); },
    onError: (e) => toast.error(e.message),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids) => expenseService.bulkApprove(ids),
    onSuccess: (res) => {
      const { approved, skipped } = res.data.data;
      toast.success(`${approved} expense${approved !== 1 ? 's' : ''} approved${skipped > 0 ? `, ${skipped} skipped` : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries(['expenses']);
    },
    onError: (e) => toast.error(e.message),
  });

  const canCreate = FINANCE_STAFF.includes(user?.role);
  const canApprove = REPORTERS.includes(user?.role);

  const handleRecordExpense = async () => {
    if (!form.type) return toast.error('Please select an expense type');
    if (!form.title.trim()) return toast.error('Expense title is required');
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Amount must be greater than zero');
    if (!form.transactionDate) return toast.error('Transaction date is required');
    const result = await confirm.financial({ title: 'Record Expense?', text: `You are about to record an expense of ${formatCurrency(parseFloat(form.amount))}.` });
    if (result.isConfirmed) {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      createMutation.mutate(fd);
    }
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

  const allPageIds = (data?.data || []).map((r) => r._id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));

  const columns = [
    {
      key: '__select',
      width: '40px',
      header: (
        <input type="checkbox" checked={allPageSelected}
          onChange={() => setSelectedIds((prev) => {
            const next = new Set(prev);
            if (allPageSelected) allPageIds.forEach((id) => next.delete(id));
            else allPageIds.forEach((id) => next.add(id));
            return next;
          })}
          className="w-4 h-4 accent-navy-700 rounded border-gray-300" />
      ),
      render: (_, row) => (
        <input type="checkbox" checked={selectedIds.has(row._id)}
          onChange={() => setSelectedIds((prev) => {
            const next = new Set(prev);
            next.has(row._id) ? next.delete(row._id) : next.add(row._id);
            return next;
          })}
          className="w-4 h-4 accent-navy-700 rounded border-gray-300" />
      ),
    },
    { key: 'referenceNumber', header: 'Reference', render: (v) => <span className="font-mono text-xs font-semibold text-navy-700">{v}</span> },
    { key: 'title', header: 'Expense Title', render: (v, row) => <div><p className="font-medium text-gray-900 dark:text-white text-sm">{v}</p><p className="text-xs text-gray-400 dark:text-gray-500">{row.type?.replace(/_/g, ' ')}</p></div> },
    { key: 'program', header: 'Program', render: (v) => v?.title || '—' },
    { key: 'amount', header: 'Amount', render: (v) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(v)}</span> },
    { key: 'transactionDate', header: 'Date', render: (v) => formatDate(v) },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        row.status === 'pending' && canApprove ? (
          <button onClick={() => handleApproveExpense(id)}
            className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors">
            Approve
          </button>
        ) : null
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Track all financial transactions</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Plus size={16} />Record Expense
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          {(summary.byType || []).slice(0, 4).map((t) => (
            <div key={t._id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{t._id?.replace(/_/g, ' ')}</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(t.total)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{t.count} transactions</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2">
          <Search size={14} className="text-gray-400 dark:text-gray-500" />
          <input type="text" placeholder="Search expenses..." value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="bg-transparent text-sm outline-none flex-1 text-gray-600 dark:text-gray-300" />
        </div>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Types</option>
          {EXPENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Statuses</option>
          {['pending', 'approved', 'rejected', 'liquidated'].map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      {canApprove && selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-navy-50 dark:bg-navy-900/20 border border-navy-200 dark:border-navy-800 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-navy-700 dark:text-navy-300">{selectedIds.size} expense{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-700 transition-colors">
              Clear
            </button>
            <button onClick={handleBulkApprove} disabled={bulkApproveMutation.isPending}
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 font-semibold transition-colors">
              {bulkApproveMutation.isPending ? 'Approving...' : `Approve ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data?.data} loading={isLoading}
        pagination={data?.meta} onPageChange={(p) => setFilters({ ...filters, page: p })} />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Record New Expense" size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleRecordExpense} disabled={createMutation.isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {createMutation.isPending ? 'Saving...' : 'Record Expense'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="form-label">Expense Type *</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">Select type...</option>
              {EXPENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {[['title', 'Title', 'text'], ['amount', 'Amount (₱)', 'number'], ['transactionDate', 'Transaction Date', 'date'], ['vendorName', 'Vendor Name', 'text']].map(([key, label, type]) => (
            <div key={key}>
              <label className="form-label">{label}</label>
              <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
          ))}
          <div>
            <label className="form-label">Budget</label>
            <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => (
                <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Program</label>
            <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">No program linked</option>
              {(programsData || []).map((p) => (
                <option key={p._id} value={p._id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
