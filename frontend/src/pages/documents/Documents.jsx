import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Upload, Search, FolderOpen, Download, Archive, ArchiveRestore, Trash2, File, FileText, Image, RefreshCw, History } from 'lucide-react';
import { documentService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import { formatDate, formatFileSize } from '../../utils/formatters';
import { DOCUMENT_CATEGORIES } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { DOC_UPLOADERS, DOC_EDITORS, ADMIN_ROLES } from '../../utils/constants';

const FILE_ICONS = {
  'application/pdf': FileText,
  'image/jpeg': Image,
  'image/png': Image,
  default: File,
};

export default function Documents() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canUpload = DOC_UPLOADERS.includes(user?.role);
  const canEdit = DOC_EDITORS.includes(user?.role);
  const canDelete = ADMIN_ROLES.includes(user?.role);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '', category: '', isArchived: false });
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', category: '', isPublic: false });
  const [file, setFile] = useState(null);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [replaceFile, setReplaceFile] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const fileRef = useRef();
  const replaceFileRef = useRef();

  useEffect(() => { setSelectedIds(new Set()); }, [filters]);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', filters],
    queryFn: () => documentService.getAll(filters).then((r) => r.data),
  });

  const uploadMutation = useMutation({
    mutationFn: (fd) => documentService.upload(fd),
    onSuccess: () => { toast.success('Document uploaded'); queryClient.invalidateQueries(['documents']); setShowModal(false); setFile(null); setUploadForm({ title: '', description: '', category: '', isPublic: false }); },
    onError: (e) => toast.error(e.message || 'Upload failed'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => documentService.archive(id),
    onSuccess: () => { toast.success('Document archived'); queryClient.invalidateQueries(['documents']); },
    onError: (e) => toast.error(e.message),
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id) => documentService.unarchive(id),
    onSuccess: () => { toast.success('Document restored from archive'); queryClient.invalidateQueries(['documents']); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => documentService.delete(id),
    onSuccess: () => { toast.success('Document deleted'); queryClient.invalidateQueries(['documents']); },
    onError: (e) => toast.error(e.message),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids) => documentService.bulkArchive(ids),
    onSuccess: (res) => {
      const { archived, skipped } = res.data.data;
      toast.success(`${archived} document${archived !== 1 ? 's' : ''} archived${skipped > 0 ? `, ${skipped} skipped` : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries(['documents']);
    },
    onError: (e) => toast.error(e.message),
  });

  const replaceMutation = useMutation({
    mutationFn: ({ id, fd }) => documentService.replaceFile(id, fd),
    onSuccess: () => {
      toast.success('Document file replaced');
      queryClient.invalidateQueries(['documents']);
      setReplaceTarget(null);
      setReplaceFile(null);
    },
    onError: (e) => toast.error(e.message || 'Replace failed'),
  });

  const handleUpload = async () => {
    if (!file || !uploadForm.category) return toast.error('File and category are required');
    const result = await confirm.upload({ text: `Upload "${file.name}" to the document repository?` });
    if (!result.isConfirmed) return;
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(uploadForm).forEach(([k, v]) => fd.append(k, v));
    uploadMutation.mutate(fd);
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

  const handleReplaceFile = async () => {
    if (!replaceFile) return toast.error('Please select a replacement file');
    const result = await confirm.upload({ text: `Replace the file for "${replaceTarget.title}"? The current file will be saved to version history.` });
    if (!result.isConfirmed) return;
    const fd = new FormData();
    fd.append('file', replaceFile);
    replaceMutation.mutate({ id: replaceTarget._id, fd });
  };

  const handleBulkArchive = async () => {
    const count = selectedIds.size;
    const result = await confirm.archive({ text: `${count} document${count !== 1 ? 's' : ''} will be archived and removed from the active list.` });
    if (result.isConfirmed) bulkArchiveMutation.mutate([...selectedIds]);
  };

  const handleDownload = async (doc) => {
    try {
      const res = await documentService.serve(doc._id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.originalName || doc.fileName || doc.title;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download document');
    }
  };

  const handleDownloadVersion = async (pv, doc) => {
    try {
      const res = await documentService.serveVersion(doc._id, pv.version);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = pv.fileName?.split('/').pop() || `${doc.title}_v${pv.version}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download version');
    }
  };

  const allPageIds = (data?.data || []).map((r) => r._id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));

  const columns = [
    ...(canEdit && !filters.isArchived ? [{
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
    }] : []),
    {
      key: 'title', header: 'Document', render: (v, row) => {
        const Icon = FILE_ICONS[row.fileType] || FILE_ICONS.default;
        return (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-navy-50 dark:bg-navy-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon size={16} className="text-navy-700" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-sm text-gray-900 dark:text-white">{v}</p>
                {row.version > 1 && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium">v{row.version}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">{formatFileSize(row.fileSize)}</p>
            </div>
          </div>
        );
      }
    },
    { key: 'category', header: 'Category', render: (v) => <span className="text-xs capitalize">{v?.replace(/_/g, ' ')}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || 'All' },
    { key: 'uploadedBy', header: 'Uploaded By', render: (v) => `${v?.firstName} ${v?.lastName}` },
    { key: 'createdAt', header: 'Date', render: (v) => formatDate(v) },
    { key: 'downloadCount', header: 'Downloads', render: (v) => <span className="text-xs font-medium">{v || 0}</span> },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => handleDownload(row)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-navy-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors" title="Download">
            <Download size={14} />
          </button>
          {row.previousVersions?.length > 0 && (
            <button onClick={() => setHistoryTarget(row)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors" title="Version history">
              <History size={14} />
            </button>
          )}
          {canEdit && !row.isArchived && (
            <button onClick={() => { setReplaceTarget(row); setReplaceFile(null); }} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors" title="Replace file">
              <RefreshCw size={14} />
            </button>
          )}
          {canEdit && !row.isArchived && (
            <button onClick={() => handleArchive(id, row.title)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors" title="Archive">
              <Archive size={14} />
            </button>
          )}
          {canEdit && row.isArchived && (
            <button onClick={() => handleUnarchive(id, row.title)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors" title="Restore from archive">
              <ArchiveRestore size={14} />
            </button>
          )}
          {canDelete && (
            <button onClick={() => handleDelete(id, row.title)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors" title="Delete">
              <Trash2 size={14} />
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Document Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Central repository for all SK documents</p>
        </div>
        {canUpload && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Upload size={16} />Upload Document
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-1 min-w-48 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2">
          <Search size={14} className="text-gray-400 dark:text-gray-500" />
          <input type="text" placeholder="Search documents..." value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="bg-transparent text-sm outline-none flex-1 text-gray-600 dark:text-gray-300" />
        </div>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Categories</option>
          {DOCUMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button
          onClick={() => setFilters({ ...filters, isArchived: !filters.isArchived })}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${filters.isArchived ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
          {filters.isArchived ? 'Showing Archived' : 'Show Archived'}
        </button>
      </div>

      {canEdit && !filters.isArchived && selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-navy-50 dark:bg-navy-900/20 border border-navy-200 dark:border-navy-800 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-navy-700 dark:text-navy-300">{selectedIds.size} document{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-700 transition-colors">
              Clear
            </button>
            <button onClick={handleBulkArchive} disabled={bulkArchiveMutation.isPending}
              className="text-xs px-3 py-1.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-60 font-semibold transition-colors flex items-center gap-1.5">
              <Archive size={13} />
              {bulkArchiveMutation.isPending ? 'Archiving...' : `Archive ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data?.data} loading={isLoading}
        pagination={data?.meta} onPageChange={(p) => setFilters({ ...filters, page: p })} />

      {/* Version History Modal */}
      <Modal isOpen={!!historyTarget} onClose={() => setHistoryTarget(null)} title="Version History" size="md"
        footer={<div className="flex justify-end"><button onClick={() => setHistoryTarget(null)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Close</button></div>}>
        {historyTarget && (
          <div className="space-y-3">
            {/* Current version */}
            <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded">v{historyTarget.version} — Current</span>
                </div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{historyTarget.originalName || historyTarget.fileName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(historyTarget.updatedAt)}</p>
              </div>
              <button onClick={() => handleDownload(historyTarget)} className="flex items-center gap-1.5 text-xs text-navy-700 hover:text-navy-900 font-medium px-3 py-1.5 border border-navy-200 dark:border-navy-700 rounded-lg hover:bg-navy-50 dark:hover:bg-navy-900/20 transition-colors">
                <Download size={13} /> Download
              </button>
            </div>
            {/* Previous versions (newest first) */}
            {[...historyTarget.previousVersions].reverse().map((pv) => (
              <div key={pv.version} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700 rounded-xl">
                <div>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">v{pv.version}</span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{pv.fileName?.split('/').pop() || `Version ${pv.version}`}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{formatDate(pv.uploadedAt)}</p>
                </div>
                <button onClick={() => handleDownloadVersion(pv, historyTarget)}
                  className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-navy-700 font-medium px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <Download size={13} /> Download
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Replace File Modal */}
      <Modal isOpen={!!replaceTarget} onClose={() => { setReplaceTarget(null); setReplaceFile(null); }} title="Replace Document File" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => { setReplaceTarget(null); setReplaceFile(null); }} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleReplaceFile} disabled={replaceMutation.isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {replaceMutation.isPending ? 'Replacing...' : 'Replace File'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Current: <span className="font-medium text-gray-700 dark:text-gray-200">{replaceTarget?.originalName || replaceTarget?.title}</span>
            <span className="ml-2 text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">v{replaceTarget?.version || 1}</span>
          </p>
          <div onClick={() => replaceFileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-navy-400 hover:bg-navy-50 dark:hover:bg-navy-900/20 transition-colors">
            <RefreshCw size={24} className="mx-auto text-gray-400 dark:text-gray-500 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{replaceFile ? replaceFile.name : 'Click to select replacement file'}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">The old file will be saved to version history</p>
            <input ref={replaceFileRef} type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              onChange={(e) => setReplaceFile(e.target.files[0])} />
          </div>
        </div>
      </Modal>

      {/* Upload Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Upload Document" size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleUpload} disabled={uploadMutation.isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-navy-400 hover:bg-navy-50 dark:hover:bg-navy-900/20 transition-colors"
          >
            <Upload size={28} className="mx-auto text-gray-400 dark:text-gray-500 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{file ? file.name : 'Click to select or drag & drop'}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PDF, DOCX, XLSX, Images (max 10MB)</p>
            <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files[0])} />
          </div>

          {[['title', 'Document Title', 'text'], ['description', 'Description', 'textarea']].map(([key, label, type]) => (
            <div key={key}>
              <label className="form-label">{label}</label>
              {type === 'textarea' ? (
                <textarea value={uploadForm[key]} onChange={(e) => setUploadForm({ ...uploadForm, [key]: e.target.value })} rows={2}
                  className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none" />
              ) : (
                <input type={type} value={uploadForm[key]} onChange={(e) => setUploadForm({ ...uploadForm, [key]: e.target.value })}
                  className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700" />
              )}
            </div>
          ))}

          <div>
            <label className="form-label">Category *</label>
            <select value={uploadForm.category} onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">Select category...</option>
              {DOCUMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="isPublic" checked={uploadForm.isPublic}
              onChange={(e) => setUploadForm({ ...uploadForm, isPublic: e.target.checked })}
              className="w-4 h-4 text-navy-700 rounded" />
            <label htmlFor="isPublic" className="text-sm text-gray-700 dark:text-gray-300">Make publicly accessible</label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
