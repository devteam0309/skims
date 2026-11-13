import { useRef } from 'react';
import { Eye, Download, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react';
import ComboInput from './ComboInput';
import { formatDate, formatFileSize } from '../../utils/formatters';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif';
const MAX_BYTES = 10 * 1024 * 1024;

const prettify = (v) => (v ? String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');

/**
 * The proof attached to a record, each openable in place.
 *
 * Reviewers asked to inspect receipts and ids BEFORE deciding, inside the screen they decide on —
 * so every row offers Preview (in-app, through the authorised route) as well as Download.
 */
export function AttachmentList({ attachments = [], onPreview, onDownload, emptyText = 'No supporting documents attached.' }) {
  if (!attachments.length) {
    return (
      <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
      {attachments.map((a) => {
        const Icon = (a.fileType || '').startsWith('image/') ? ImageIcon : FileText;
        const name = a.originalName || a.fileName || 'Attachment';
        return (
          <li key={a._id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <Icon size={16} aria-hidden="true" className="shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{name}</p>
              <p className="meta-text">
                {[prettify(a.documentType), a.fileSize ? formatFileSize(a.fileSize) : null, a.uploadedAt ? formatDate(a.uploadedAt) : null]
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
            {onPreview && (
              <button
                type="button"
                onClick={() => onPreview(a)}
                aria-label={`Preview ${name}`}
                className="flex items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-navy-100 dark:bg-navy-500/15 dark:text-navy-200"
              >
                <Eye size={12} aria-hidden="true" />Preview
              </button>
            )}
            {onDownload && (
              <button
                type="button"
                onClick={() => onDownload(a)}
                aria-label={`Download ${name}`}
                className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
              >
                <Download size={12} aria-hidden="true" />Download
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Choose files and say what each one is.
 *
 * `value` is `[{ file, type }]`. `typeOptions` are suggestions; `freeText` lets the user type a kind
 * the list does not name (receipts), while `freeText={false}` restricts it to the list (identity
 * documents, where the server accepts exactly three kinds). Size and type are checked here so a file
 * the server will refuse is never uploaded first.
 */
export function ProofPicker({ id, value = [], onChange, typeOptions = [], freeText = true, max = 10, onReject }) {
  const inputRef = useRef(null);

  const add = (fileList) => {
    const next = [...value];
    for (const file of Array.from(fileList || [])) {
      if (next.length >= max) { onReject?.(`At most ${max} files`); break; }
      if (file.size > MAX_BYTES) { onReject?.(`${file.name} is larger than 10 MB`); continue; }
      next.push({ file, type: freeText ? '' : (typeOptions[0]?.value || '') });
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((item, i) => (
            <li key={`${item.file.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 p-2 dark:border-gray-600">
              <Paperclip size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100">
                {item.file.name} <span className="meta-text">· {formatFileSize(item.file.size)}</span>
              </span>
              <label htmlFor={`${id}-type-${i}`} className="sr-only">What is {item.file.name}?</label>
              {freeText ? (
                <div className="w-52">
                  <ComboInput
                    id={`${id}-type-${i}`}
                    options={typeOptions}
                    value={item.type}
                    placeholder="What is this file?"
                    onChange={(e) => onChange(value.map((v, j) => (j === i ? { ...v, type: e.target.value } : v)))}
                    className="!mt-0 !py-1.5"
                  />
                </div>
              ) : (
                <select
                  id={`${id}-type-${i}`}
                  value={item.type}
                  onChange={(e) => onChange(value.map((v, j) => (j === i ? { ...v, type: e.target.value } : v)))}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Remove ${item.file.name}`}
                className="rounded-lg p-1.5 text-gray-400 hover:text-red-600"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={(e) => add(e.target.files)}
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-navy-700 hover:file:bg-navy-100 dark:text-gray-300"
      />
      <p className="field-hint">PDF, Word, Excel or an image (JPG, PNG, GIF), up to 10 MB each.</p>
    </div>
  );
}

/**
 * The display value of a typed proof kind, turned into the value the server normalises anyway:
 * "Official Receipt" → "Official Receipt" (the server stores official_receipt).
 */
export const proofTypeOf = (typed, options = []) => {
  const match = options.find((o) => o.label.toLowerCase() === String(typed).trim().toLowerCase());
  return match ? match.value : String(typed || '').trim();
};

/** Append picked proof to a FormData under `field`, with its kinds in `documentTypes`. */
export const appendProof = (fd, picked, field, options = []) => {
  picked.forEach(({ file, type }) => {
    fd.append(field, file);
    fd.append('documentTypes', proofTypeOf(type, options) || 'supporting_document');
  });
  return fd;
};

export default AttachmentList;
