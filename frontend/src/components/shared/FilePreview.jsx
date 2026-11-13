import { useEffect, useState } from 'react';
import { Download, FileWarning } from 'lucide-react';
import Modal from './Modal';
import { LoadingSpinner } from './LoadingSpinner';

/**
 * Save a Blob under a filename. Anchors must be in the document before being clicked — a detached one
 * is ignored by Firefox — and revoking the URL in the same tick can cancel the transfer.
 */
export const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'file';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const isPdf = (type) => /pdf/i.test(type || '');
const isImage = (type) => /^image\//i.test(type || '');

/**
 * View a stored file inside the app, then download it if wanted.
 *
 * Every attachment in SKIMS is private: the server checks the caller's role and barangay, then
 * streams the bytes. So a preview cannot be a link to the file — it fetches through the authorised
 * route (`load`, which resolves to a blob response) and shows the result from a local object URL.
 * The same bytes back the Download button, so nothing is fetched twice.
 *
 * `file` is `{ name, type }` while open, null while closed.
 */
export default function FilePreview({ file, load, onClose }) {
  const [state, setState] = useState({ url: null, blob: null, error: null, loading: false });

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    let objectUrl = null;
    setState({ url: null, blob: null, error: null, loading: true });
    load()
      .then((res) => {
        if (cancelled) return;
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: file.type });
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, blob, error: null, loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ url: null, blob: null, error: err?.message || 'The file could not be opened', loading: false });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `load` is recreated on every parent render; the file identity is what decides a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.key || file?.name]);

  const type = file?.type || state.blob?.type;

  return (
    <Modal
      isOpen={Boolean(file)}
      onClose={onClose}
      title={file?.name || 'File'}
      size="xl"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="meta-text">Opened through your account. The file is not public.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!state.blob}
              onClick={() => saveBlob(state.blob, file?.name)}
              className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
            >
              <Download size={14} aria-hidden="true" />
              Download
            </button>
          </div>
        </div>
      )}
    >
      {state.loading && (
        <div className="flex h-64 items-center justify-center"><LoadingSpinner className="text-navy-700 dark:text-navy-300" /></div>
      )}
      {state.error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <FileWarning size={18} aria-hidden="true" className="shrink-0" />
          {state.error}
        </div>
      )}
      {state.url && isPdf(type) && (
        <iframe title={`Preview of ${file?.name}`} src={state.url} className="h-[70vh] w-full rounded-lg border border-gray-200 dark:border-gray-700" />
      )}
      {state.url && isImage(type) && (
        <img src={state.url} alt={file?.name} className="mx-auto max-h-[70vh] rounded-lg" />
      )}
      {state.url && !isPdf(type) && !isImage(type) && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          This kind of file cannot be shown in the browser. Download it to open it.
        </p>
      )}
    </Modal>
  );
}
