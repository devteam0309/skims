import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pin, Trash2, Edit2 } from 'lucide-react';
import { announcementService } from '../../services/announcementService';
import { ADMIN_ROLES, EDITOR_ROLES } from '../../utils/constants';
import DataTable from '../../components/shared/DataTable';
import Modal from '../../components/shared/Modal';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';
import useAuthStore from '../../store/authStore';

const TYPES = ['announcement', 'event', 'news', 'deadline', 'alert'];

const EMPTY_FORM = {
  title: '', content: '', type: 'announcement',
  isPublic: true, isPinned: false,
  eventDate: '', eventLocation: '', expiresAt: '',
};

/*
 * Type is a category, not a status, so most of these get one neutral chip rather than a hue each
 * to memorise. The two that genuinely carry urgency keep a tone, and it is the same tone the rest
 * of the app uses for that meaning: amber for "someone has to act by a date", red for "something
 * is wrong". Purple and yellow, which belonged to no tone at all, are gone.
 */
const TYPE_CHIPS = {
  deadline: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  alert: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
};
const TYPE_CHIP_DEFAULT = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';

export default function Announcements() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 10, type: '' });
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  /*
   * routes/announcements.js authorizes POST and PUT for EDITORS and DELETE for ADMINS. Only
   * delete was gated here, so an sk_treasurer or sk_kagawad saw "New Announcement", filled the
   * whole form and got a 403 on submit.
   */
  const canWrite = EDITOR_ROLES.includes(user?.role);
  const canDelete = ADMIN_ROLES.includes(user?.role);

  const { data, isLoading } = useQuery({
    queryKey: ['announcements', filters],
    queryFn: () => announcementService.getAll(filters).then((r) => r.data),
  });

  const closeModal = () => { setShowModal(false); setEditTarget(null); setForm(EMPTY_FORM); };

  const createMutation = useMutation({
    mutationFn: (d) => announcementService.create(d),
    onSuccess: () => { toast.success('Announcement created'); queryClient.invalidateQueries(['announcements']); closeModal(); },
    onError: (e) => toast.error(e.message || 'Failed to create announcement'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data: payload }) => announcementService.update(id, payload),
    onSuccess: () => { toast.success('Announcement updated'); queryClient.invalidateQueries(['announcements']); closeModal(); },
    onError: (e) => toast.error(e.message || 'Failed to update announcement'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => announcementService.delete(id),
    onSuccess: () => { toast.success('Announcement deleted'); queryClient.invalidateQueries(['announcements']); },
    onError: (e) => toast.error(e.message || 'Failed to delete announcement'),
  });

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowModal(true); };

  const openEdit = (ann) => {
    setEditTarget(ann);
    setForm({
      title: ann.title,
      content: ann.content,
      type: ann.type,
      isPublic: ann.isPublic,
      isPinned: ann.isPinned,
      eventDate: ann.eventDate ? ann.eventDate.slice(0, 10) : '',
      eventLocation: ann.eventLocation || '',
      expiresAt: ann.expiresAt ? ann.expiresAt.slice(0, 10) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) return toast.error('Title and content are required');
    if (form.expiresAt && form.eventDate && form.expiresAt < form.eventDate) {
      return toast.error('The announcement expires before the event it describes');
    }

    // Publishing to a page anyone on the internet can read is worth one deliberate step,
    // matching how every other create in the app behaves.
    const result = editTarget
      ? await confirm.save({ text: `Save changes to "${form.title}"?` })
      : await confirm.create({
        title: 'Publish Announcement?',
        text: form.isPublic
          ? 'This will be visible on the public transparency portal.'
          : 'This will be visible to signed-in staff only.',
      });
    if (!result.isConfirmed) return;

    if (editTarget) updateMutation.mutate({ id: editTarget._id, data: form });
    else createMutation.mutate(form);
  };

  const handleDelete = async (id, title) => {
    const result = await confirm.delete({ text: `"${title}" will be permanently deleted.` });
    if (result.isConfirmed) deleteMutation.mutate(id);
  };

  const columns = [
    {
      key: 'title',
      header: 'Announcement',
      render: (v, row) => (
        <div className="flex items-start gap-2">
          {row.isPinned && (
            <>
              <Pin size={12} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
              <span className="sr-only">Pinned.</span>
            </>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{v}</p>
            <p className="meta-text mt-0.5 line-clamp-1">{row.content}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (v) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TYPE_CHIPS[v] || TYPE_CHIP_DEFAULT}`}>
          {v}
        </span>
      ),
    },
    { key: 'municipality', header: 'Scope', render: (v) => v?.name || 'All Municipalities' },
    {
      key: 'isPublic',
      header: 'Visibility',
      render: (v) => (
        <span className={`text-xs font-medium ${v ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
          {v ? 'Public' : 'Internal'}
        </span>
      ),
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      render: (v) => {
        if (!v) return <span className="meta-text">Never</span>;
        // A past date was tinted red and otherwise left to the reader to interpret.
        const expired = new Date(v) < new Date();
        return expired
          ? <span className="text-xs font-medium text-red-600 dark:text-red-400">{formatDate(v)} · expired</span>
          : <span className="meta-text">{formatDate(v)}</span>;
      },
    },
    { key: 'createdAt', header: 'Posted', render: (v) => <span className="meta-text">{formatDate(v)}</span> },
    ...(canWrite || canDelete ? [{
      key: '_id',
      header: <span className="sr-only">Actions</span>,
      render: (id, row) => (
        <div className="flex gap-1">
          {canWrite && (
            <button
              type="button"
              onClick={() => openEdit(row)}
              aria-label={`Edit ${row.title}`}
              title="Edit"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-navy-300"
            >
              <Edit2 size={14} aria-hidden="true" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => handleDelete(id, row.title)}
              disabled={deleteMutation.isPending}
              aria-label={`Delete ${row.title}`}
              title="Delete"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ),
    }] : []),
  ];

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">Manage public announcements, events, and alerts</p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Plus size={16} aria-hidden="true" />New Announcement
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {['', ...TYPES].map((t) => (
          <button
            key={t || 'all'}
            type="button"
            aria-pressed={filters.type === t}
            // Changing the filter kept the current page, so switching type while on page 3 of
            // announcements usually landed past the end of the new list.
            onClick={() => setFilters({ ...filters, type: t, page: 1 })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              filters.type === t
                ? 'bg-navy-900 text-white dark:bg-navy-600'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {t || 'All'}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={filters.type ? `No ${filters.type} announcements` : 'No announcements yet'}
        emptyAction={filters.type ? (
          <button
            type="button"
            onClick={() => setFilters({ ...filters, type: '', page: 1 })}
            className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
          >
            Show all types
          </button>
        ) : null}
      />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editTarget ? 'Edit Announcement' : 'New Announcement'}
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
              onClick={handleSave}
              disabled={isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {isPending ? 'Saving...' : editTarget ? 'Save Changes' : 'Publish'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <RequiredNote />

          <Field id="ann-title" label="Title" required>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={control} />
          </Field>

          <Field id="ann-content" label="Content" required>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={4}
              className={`${control} resize-y`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ann-type" label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={control}>
                {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </Field>
            <Field id="ann-expires" label="Expires" optional hint="Leave blank to keep it up indefinitely.">
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className={control}
              />
            </Field>
          </div>

          {form.type === 'event' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ann-eventDate" label="Event Date" optional>
                <input
                  type="date"
                  value={form.eventDate}
                  onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
                  className={control}
                />
              </Field>
              <Field id="ann-eventLocation" label="Location" optional>
                <input
                  value={form.eventLocation}
                  onChange={(e) => setForm({ ...form, eventLocation: e.target.value })}
                  className={control}
                />
              </Field>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="ann-isPublic"
                checked={form.isPublic}
                onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy-700"
              />
              <div>
                <label htmlFor="ann-isPublic" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Show on Public Portal
                </label>
                {/* This defaults to on, and publishes to a page that needs no sign-in. Neither
                    fact was stated anywhere on the form. */}
                <p className="field-hint">Readable by anyone on the internet, without signing in.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="ann-isPinned"
                checked={form.isPinned}
                onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy-700"
              />
              <div>
                <label htmlFor="ann-isPinned" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Pin to top
                </label>
                <p className="field-hint">Keeps it above other announcements in every list.</p>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
