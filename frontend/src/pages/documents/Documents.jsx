import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Download, Archive, ArchiveRestore, Trash2,
  File, FileText, Image as ImageIcon, RefreshCw, History,
} from 'lucide-react';
import { documentService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import SelectAllCheckbox from '../../components/shared/SelectAllCheckbox';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatDate, formatFileSize } from '../../utils/formatters';
import { toFormData } from '../../utils/formData';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import ComboInput from '../../components/shared/ComboInput';
import { DOCUMENT_CATEGORIES, DOC_UPLOADERS, DOC_EDITORS, ADMIN_ROLES } from '../../utils/constants';

const FILE_ICONS = {
  'application/pdf': FileText,
  'image/jpeg': ImageIcon,
  'image/png': ImageIcon,
  'image/gif': ImageIcon,
  default: File,
};

/*
 * Kept in step with backend/src/middleware/fileUpload.js, which rejects anything else. The
 * picker previously omitted .gif even though the server accepts it, and nothing checked the size
 * before uploading — so an oversized file was transferred in full, only to be refused on arrival.
 */
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const emptyUploadForm = () => ({ title: '', description: '', category: '', isPublic: false });

export default function Documents() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canUpload = DOC_UPLOADERS.includes(user?.role);
  const canEdit = DOC_EDITORS.includes(user?.role);
  const canDelete = ADMIN_ROLES.includes(user?.role);

  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '', category: '', isArchived: false });
  const [uploadForm, setUploadForm] = useState(emptyUploadForm());
  const [file, setFile] = useState(null);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [replaceFile, setReplaceFile] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => { setSelectedIds(new Set()); }, [filters]);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', filters],
    queryFn: () => documentService.getAll(filters).then((r) => r.data),
  });

  const closeUpload = () => { setShowModal(false); setFile(null); setUploadForm(emptyUploadForm()); };
  const closeReplace = () => { setReplaceTarget(null); setReplaceFile(null); };

  const uploadMutation = useMutation({
    mutationFn: (fd) => documentService.upload(fd),
    onSuccess: () => { toast.success('Document uploaded'); queryClient.invalidateQueries(['documents']); closeUpload(); },
    onError: (e) => toast.error(e.message || 'Upload failed'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => documentService.archive(id),
    onSuccess: () => { toast.success('Document archived'); queryClient.invalidateQueries(['documents']); },
    onError: (e) => toast.error(e.message || 'Archive failed'),
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id) => documentService.unarchive(id),
    onSuccess: () => { toast.success('Document restored from archive'); queryClient.invalidateQueries(['documents']); },
    onError: (e) => toast.error(e.message || 'Restore failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => documentService.delete(id),
    onSuccess: () => { toast.success('Document deleted'); queryClient.invalidateQueries(['documents']); },
    onError: (e) => toast.error(e.message || 'Delete failed'),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids) => documentService.bulkArchive(ids),
    onSuccess: (res) => {
      const { archived, skipped } = res.data.data;
      toast.success(`${archived} document${archived !== 1 ? 's' : ''} archived${skipped > 0 ? `, ${skipped} skipped` : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries(['documents']);
    },
    onError: (e) => toast.error(e.message || 'Bulk archive failed'),
  });

  const replaceMutation = useMutation({
    mutationFn: ({ id, fd }) => documentService.replaceFile(id, fd),
    onSuccess: () => { toast.success('Document file replaced'); queryClient.invalidateQueries(['documents']); closeReplace(); },
    onError: (e) => toast.error(e.message || 'Replace failed'),
  });

  const handleUpload = async () => {
    if (!file) return toast.error('Please select a file to upload');
    if (!uploadForm.category) return toast.error('Please choose a category');

    const result = await confirm.upload({ text: `Upload "${file.name}" to the document repository?` });
    if (!result.isConfirmed) return;

    // Fields were previously appended unfiltered, so blank inputs went up as empty strings and
    // the checkbox as the literal "false". The server absorbs both, but there is no reason to
    // send them.
    const fd = toFormData(uploadForm);
    fd.append('file', file);
    uploadMutation.mutate(fd);
  };

  const handleReplaceFile = async () => {
    if (!replaceFile) return toast.error('Please select a replacement file');
    const result = await confirm.upload({ text: `Replace the file for "${replaceTarget.title}"? The current file will be saved to version history.` });
    if (!result.isConfirmed) return;
    const fd = new FormData();
    fd.append('file', replaceFile);
    replaceMutation.mutate({ id: replaceTarget._id, fd });
  };

  const handleArchive = async (id, title) => {
    const result = await confirm.archive({ text: `"${title}" will be archived and removed from the active list.` });
    if (result.isConfirmed) archiveMutation.mutate(id);
  };

  const handleUnarchive = async (id, title) => {
    const result = await confirm.save({ title: 'Restore Document?', text: `"${title}" will be restored to the active document list.` });
    if (result.isConfirmed) unarchiveMutation.mutate(id);
  };

  const handleDelete = async (id, title) => {
    const result = await confirm.delete({ text: `"${title}" will be permanently deleted.` });
    if (result.isConfirmed) deleteMutation.mutate(id);
  };

  const handleBulkArchive = async () => {
    const count = selectedIds.size;
    const result = await confirm.archive({ text: `${count} document${count !== 1 ? 's' : ''} will be archived and removed from the active list.` });
    if (result.isConfirmed) bulkArchiveMutation.mutate([...selectedIds]);
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownload = async (doc) => {
    try {
      const res = await documentService.serve(doc._id);
      downloadBlob(res.data, doc.originalName || doc.fileName || doc.title);
    } catch {
      toast.error('Failed to download document');
    }
  };

  const handleDownloadVersion = async (pv, doc) => {
    try {
      const res = await documentService.serveVersion(doc._id, pv.version);
      downloadBlob(res.data, pv.fileName?.split('/').pop() || `${doc.title}_v${pv.version}`);
    } catch {
      toast.error('Failed to download version');
    }
  };

  const rows = data?.data || [];
  const allPageIds = rows.map((r) => r._id);
  const selectedOnPage = allPageIds.filter((id) => selectedIds.has(id)).length;
  const allPageSelected = allPageIds.length > 0 && selectedOnPage === allPageIds.length;
  const showSelection = canEdit && !filters.isArchived;

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

  const hasFilters = Boolean(filters.search || filters.category);

  const columns = [
    ...(showSelection ? [{
      key: '__select',
      width: '40px',
      header: (
        <SelectAllCheckbox
          checked={allPageSelected}
          indeterminate={selectedOnPage > 0 && !allPageSelected}
          onChange={toggleAll}
          disabled={allPageIds.length === 0}
          label="Select all documents on this page"
        />
      ),
      render: (_, row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onChange={() => toggleOne(row._id)}
          aria-label={`Select ${row.title}`}
          className="h-4 w-4 rounded border-gray-300 accent-navy-700"
        />
      ),
    }] : []),
    {
      key: 'title',
      header: 'Document',
      render: (v, row) => {
        const Icon = FILE_ICONS[row.fileType] || FILE_ICONS.default;
        return (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 dark:bg-navy-900/30">
              <Icon size={16} className="text-navy-700 dark:text-navy-300" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{v}</p>
                {row.version > 1 && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                    v{row.version}
                  </span>
                )}
              </div>
              <p className="meta-text">{formatFileSize(row.fileSize)}</p>
            </div>
          </div>
        );
      },
    },
    { key: 'category', header: 'Category', render: (v) => <span className="text-xs capitalize">{v?.replace(/_/g, ' ')}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || 'All' },
    {
      key: 'uploadedBy',
      header: 'Uploaded By',
      render: (v) => (v ? `${v.firstName} ${v.lastName}` : 'Unknown'),
    },
    { key: 'createdAt', header: 'Date', render: (v) => formatDate(v) },
    {
      key: 'downloadCount',
      header: 'Downloads',
      className: 'cell-numeric',
      render: (v) => <span className="text-xs font-medium">{v || 0}</span>,
    },
    {
      key: '_id',
      header: 'Actions',
      render: (id, row) => (
        <div className="flex items-center gap-1">
          {/* These carried a `title` tooltip but no accessible name, so each announced as a bare
              "button" — seven identical ones per row. */}
          <IconButton onClick={() => handleDownload(row)} label={`Download ${row.title}`} hover="hover:text-navy-700 dark:hover:text-navy-300">
            <Download size={14} aria-hidden="true" />
          </IconButton>
          {row.previousVersions?.length > 0 && (
            <IconButton onClick={() => setHistoryTarget(row)} label={`Version history for ${row.title}`} hover="hover:text-blue-600 dark:hover:text-blue-400">
              <History size={14} aria-hidden="true" />
            </IconButton>
          )}
          {canEdit && !row.isArchived && (
            <IconButton onClick={() => { setReplaceTarget(row); setReplaceFile(null); }} label={`Replace file for ${row.title}`} hover="hover:text-blue-600 dark:hover:text-blue-400">
              <RefreshCw size={14} aria-hidden="true" />
            </IconButton>
          )}
          {canEdit && !row.isArchived && (
            <IconButton onClick={() => handleArchive(id, row.title)} label={`Archive ${row.title}`} hover="hover:text-amber-600 dark:hover:text-amber-400">
              <Archive size={14} aria-hidden="true" />
            </IconButton>
          )}
          {canEdit && row.isArchived && (
            <IconButton onClick={() => handleUnarchive(id, row.title)} label={`Restore ${row.title} from archive`} hover="hover:text-green-600 dark:hover:text-emerald-400">
              <ArchiveRestore size={14} aria-hidden="true" />
            </IconButton>
          )}
          {canDelete && (
            <IconButton onClick={() => handleDelete(id, row.title)} label={`Delete ${row.title}`} hover="hover:text-red-600 dark:hover:text-red-400">
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Document Management</h1>
          <p className="page-subtitle">Central repository for all SK documents</p>
        </div>
        {canUpload && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Upload size={16} aria-hidden="true" />Upload Document
          </button>
        )}
      </div>

      <section aria-label="Filter documents" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap gap-3">
          <SearchInput
            id="document-search"
            label="Search documents"
            placeholder="Search documents..."
            value={filters.search}
            // Every filter here now resets to page 1. Changing one while on page 5 previously
            // kept you on page 5 of a shorter result set, which usually renders as empty.
            onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
          />

          <div className="w-52">
            <label htmlFor="filter-category" className="sr-only">Filter by category</label>
            {/* Type-or-pick, matching the upload form. A fixed list here would let an office file a
                custom category and then never be able to filter for it — the server canonicalises
                whatever is typed, so "Barangay Assembly" finds records stored as
                `barangay_assembly`. */}
            <ComboInput
              id="filter-category"
              options={DOCUMENT_CATEGORIES}
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}
              placeholder="All categories"
              className="!mt-0 !py-2"
            />
          </div>

          <button
            type="button"
            aria-pressed={filters.isArchived}
            onClick={() => setFilters({ ...filters, isArchived: !filters.isArchived, page: 1 })}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              filters.isArchived
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {filters.isArchived ? 'Showing Archived' : 'Show Archived'}
          </button>
        </div>
      </section>

      {showSelection && selectedIds.size > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-200 bg-navy-50 px-4 py-3 dark:border-navy-800 dark:bg-navy-900/20">
          <span className="text-sm font-medium text-navy-700 dark:text-navy-300">
            <span className="numeric">{selectedIds.size}</span> document{selectedIds.size !== 1 ? 's' : ''} selected
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
              onClick={handleBulkArchive}
              disabled={bulkArchiveMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              <Archive size={13} aria-hidden="true" />
              {bulkArchiveMutation.isPending ? 'Archiving...' : `Archive ${selectedIds.size}`}
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
        emptyMessage={
          hasFilters
            ? 'No documents match these filters'
            : filters.isArchived ? 'No archived documents' : 'No documents uploaded yet'
        }
        emptyAction={hasFilters ? (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, search: '', category: '', page: 1 }))}
            className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
          >
            Clear filters
          </button>
        ) : null}
      />

      <Modal
        isOpen={!!historyTarget}
        onClose={() => setHistoryTarget(null)}
        title="Version History"
        size="md"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setHistoryTarget(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        }
      >
        {historyTarget && (
          <ol className="space-y-3">
            <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-900/20">
              <div className="min-w-0">
                <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
                  v{historyTarget.version} — Current
                </span>
                <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">
                  {historyTarget.originalName || historyTarget.fileName}
                </p>
                <p className="meta-text">{formatDate(historyTarget.updatedAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(historyTarget)}
                className="flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:border-navy-700 dark:text-navy-300 dark:hover:bg-navy-900/20"
              >
                <Download size={13} aria-hidden="true" /> Download
              </button>
            </li>

            {[...historyTarget.previousVersions].reverse().map((pv) => (
              <li key={pv.version} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-700/50">
                <div className="min-w-0">
                  <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-600 dark:text-gray-300">
                    v{pv.version}
                  </span>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {pv.fileName?.split('/').pop() || `Version ${pv.version}`}
                  </p>
                  <p className="meta-text">{formatDate(pv.uploadedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadVersion(pv, historyTarget)}
                  aria-label={`Download version ${pv.version}`}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-navy-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <Download size={13} aria-hidden="true" /> Download
                </button>
              </li>
            ))}
          </ol>
        )}
      </Modal>

      <Modal
        isOpen={!!replaceTarget}
        onClose={closeReplace}
        title="Replace Document File"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeReplace}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReplaceFile}
              disabled={replaceMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {replaceMutation.isPending ? 'Replacing...' : 'Replace File'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Current: <span className="font-medium text-gray-700 dark:text-gray-200">{replaceTarget?.originalName || replaceTarget?.title}</span>
            <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700 dark:text-gray-300">v{replaceTarget?.version || 1}</span>
          </p>
          <FileDropzone
            id="replace-file"
            file={replaceFile}
            onSelect={setReplaceFile}
            icon={RefreshCw}
            label="Select replacement file"
            hint="The old file will be saved to version history"
          />
        </div>
      </Modal>

      <Modal
        isOpen={showModal}
        onClose={closeUpload}
        title="Upload Document"
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeUpload}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <RequiredNote />

          <FileDropzone
            id="upload-file"
            file={file}
            onSelect={setFile}
            label="Select a document to upload"
            hint="PDF, DOCX, XLSX, images — max 10MB"
          />

          <Field id="doc-title" label="Document Title" optional hint="Defaults to the file name if left blank.">
            <input
              type="text"
              value={uploadForm.title}
              onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
              className={control}
            />
          </Field>

          <Field id="doc-description" label="Description" optional>
            <textarea
              value={uploadForm.description}
              onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
              rows={2}
              className={`${control} resize-y`}
            />
          </Field>

          <Field id="doc-category" label="Category" required>
            {/* Free text with suggestions — an office filing something the list does not name
                records what it is rather than choosing "Other". */}
            <ComboInput
              options={DOCUMENT_CATEGORIES}
              value={uploadForm.category}
              onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
              placeholder="Select or type a category..."
            />
          </Field>

          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="isPublic"
              checked={uploadForm.isPublic}
              onChange={(e) => setUploadForm({ ...uploadForm, isPublic: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy-700"
            />
            <div>
              <label htmlFor="isPublic" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Make publicly accessible
              </label>
              {/* This publishes the file itself to a portal anyone can read without signing in —
                  a consequence the bare checkbox label never stated. */}
              <p className="field-hint">Downloadable from the public portal without signing in.</p>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * File picker with a real drop target.
 *
 * The old zone was a plain <div onClick>: unreachable by keyboard, announced as nothing in
 * particular, and — despite the words "drag & drop" printed inside it — carried no drag handlers
 * at all, so dropping a file onto it made the browser navigate away to that file and lose the
 * half-filled form. It now handles drops, takes focus, and responds to Enter/Space.
 *
 * Size and type are checked here rather than only on the server, which had let a user wait out
 * the upload of an oversized file before being told.
 */
function FileDropzone({ id, file, onSelect, icon: Icon = Upload, label, hint }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const accept = (candidate) => {
    if (!candidate) return;
    const ext = `.${candidate.name.split('.').pop()?.toLowerCase()}`;
    if (!ACCEPT.split(',').includes(ext)) {
      return toast.error(`${ext} files are not accepted. Allowed: ${ACCEPT}`);
    }
    if (candidate.size > MAX_FILE_BYTES) {
      return toast.error(`"${candidate.name}" is ${formatFileSize(candidate.size)} — the limit is ${formatFileSize(MAX_FILE_BYTES)}.`);
    }
    onSelect(candidate);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files?.[0]); }}
        aria-label={label}
        className={`w-full rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-navy-500 bg-navy-50 dark:bg-navy-900/30'
            : 'border-gray-200 hover:border-navy-400 hover:bg-navy-50 dark:border-gray-600 dark:hover:bg-navy-900/20'
        }`}
      >
        {/* Spans rather than paragraphs: a <button> may only contain phrasing content. */}
        <Icon size={24} className="mx-auto mb-2 text-gray-400 dark:text-gray-500" aria-hidden="true" />
        <span className="block text-sm text-gray-600 dark:text-gray-300">
          {file ? file.name : 'Click to select, or drag a file here'}
        </span>
        {file
          ? <span className="meta-text mt-1 block">{formatFileSize(file.size)} — click to choose a different file</span>
          : hint && <span className="meta-text mt-1 block">{hint}</span>}
      </button>
      {/*
        `hidden` rather than `sr-only`: the button above is the labelled control, and the input is
        only ever opened through it. Left visible to assistive tech it would surface as a second,
        unnamed file control sitting next to the named one.
      */}
      <input
        id={id}
        ref={inputRef}
        type="file"
        hidden
        accept={ACCEPT}
        onChange={(e) => accept(e.target.files?.[0])}
      />
    </div>
  );
}

function IconButton({ onClick, label, hover, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700 ${hover}`}
    >
      {children}
    </button>
  );
}
