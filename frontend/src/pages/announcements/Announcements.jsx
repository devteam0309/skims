import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Megaphone, Pin, Trash2, Edit2 } from 'lucide-react';
import api from '../../services/api';
import { ADMIN_ROLES } from '../../utils/constants';
import DataTable from '../../components/shared/DataTable';
import Modal from '../../components/shared/Modal';
import StatusBadge from '../../components/shared/StatusBadge';
import { formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';
import useAuthStore from '../../store/authStore';

const announcementService = {
  getAll: (params) => api.get('/announcements', { params }),
  create: (data) => api.post('/announcements', data),
  update: (id, data) => api.put(`/announcements/${id}`, data),
  delete: (id) => api.delete(`/announcements/${id}`),
};

const TYPES = ['announcement', 'event', 'news', 'deadline', 'alert'];
const EMPTY_FORM = { title: '', content: '', type: 'announcement', isPublic: true, isPinned: false, eventDate: '', eventLocation: '', expiresAt: '' };

export default function Announcements() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 10, type: '' });
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canDelete = ADMIN_ROLES.includes(user?.role);

  const { data, isLoading } = useQuery({
    queryKey: ['announcements', filters],
    queryFn: () => announcementService.getAll(filters).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (d) => announcementService.create(d),
    onSuccess: () => { toast.success('Announcement created'); queryClient.invalidateQueries(['announcements']); closeModal(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => announcementService.update(id, data),
    onSuccess: () => { toast.success('Announcement updated'); queryClient.invalidateQueries(['announcements']); closeModal(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => announcementService.delete(id),
    onSuccess: () => { toast.success('Announcement deleted'); queryClient.invalidateQueries(['announcements']); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (ann) => { setEditTarget(ann); setForm({ title: ann.title, content: ann.content, type: ann.type, isPublic: ann.isPublic, isPinned: ann.isPinned, eventDate: ann.eventDate ? ann.eventDate.slice(0, 10) : '', eventLocation: ann.eventLocation || '', expiresAt: ann.expiresAt ? ann.expiresAt.slice(0, 10) : '' }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditTarget(null); setForm(EMPTY_FORM); };

  const handleSave = () => {
    if (!form.title || !form.content) return toast.error('Title and content are required');
    if (editTarget) {
      updateMutation.mutate({ id: editTarget._id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleDelete = async (id, title) => {
    const result = await confirm.delete({ text: `"${title}" will be permanently deleted.` });
    if (result.isConfirmed) deleteMutation.mutate(id);
  };

  const TYPE_COLORS = { announcement: 'bg-blue-50 text-blue-700', event: 'bg-purple-50 text-purple-700', news: 'bg-green-50 text-green-700', deadline: 'bg-red-50 text-red-700', alert: 'bg-yellow-50 text-yellow-700' };

  const columns = [
    {
      key: 'title', header: 'Announcement', render: (v, row) => (
        <div className="flex items-start gap-2">
          {row.isPinned && <Pin size={12} className="text-gold-600 mt-0.5 flex-shrink-0" />}
          <div>
            <p className="font-medium text-sm text-gray-900 dark:text-white">{v}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1">{row.content}</p>
          </div>
        </div>
      )
    },
    { key: 'type', header: 'Type', render: (v) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${TYPE_COLORS[v] || 'bg-gray-100 text-gray-600'}`}>{v}</span> },
    { key: 'municipality', header: 'Scope', render: (v) => v?.name || 'All Municipalities' },
    { key: 'isPublic', header: 'Visibility', render: (v) => <span className={`text-xs font-medium ${v ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}>{v ? 'Public' : 'Internal'}</span> },
    { key: 'expiresAt', header: 'Expires', render: (v) => v ? <span className={new Date(v) < new Date() ? 'text-red-500 text-xs' : 'text-xs text-gray-500 dark:text-gray-400'}>{formatDate(v)}</span> : <span className="text-xs text-gray-400 dark:text-gray-500">Never</span> },
    { key: 'createdAt', header: 'Posted', render: (v) => <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(v)}</span> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex gap-1">
          <button onClick={() => openEdit(row)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-navy-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors" title="Edit">
            <Edit2 size={14} />
          </button>
          {canDelete && (
            <button onClick={() => handleDelete(id, row.title)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors" title="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )
    },
  ];

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage public announcements, events, and alerts</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
          <Plus size={16} />New Announcement
        </button>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        {['', ...TYPES].map((t) => (
          <button key={t} onClick={() => setFilters({ ...filters, type: t })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${filters.type === t ? 'bg-navy-900 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {t || 'All'}
          </button>
        ))}
      </div>

      <DataTable columns={columns} data={data?.data} loading={isLoading}
        pagination={data?.meta} onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage="No announcements found" />

      <Modal isOpen={showModal} onClose={closeModal} title={editTarget ? 'Edit Announcement' : 'New Announcement'} size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleSave} disabled={isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {isPending ? 'Saving...' : editTarget ? 'Save Changes' : 'Publish'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="form-label">Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
          </div>
          <div>
            <label className="form-label">Content *</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
                {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Expires</label>
              <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
          </div>
          {form.type === 'event' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Event Date</label>
                <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
                  className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              </div>
              <div>
                <label className="form-label">Location</label>
                <input value={form.eventLocation} onChange={(e) => setForm({ ...form, eventLocation: e.target.value })}
                  className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} className="w-4 h-4 text-navy-700 rounded" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Show on Public Portal</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm({ ...form, isPinned: e.target.checked })} className="w-4 h-4 text-navy-700 rounded" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Pin to top</span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
