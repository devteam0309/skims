import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Copy, X } from 'lucide-react';
import Modal from '../../components/shared/Modal';
import { youthService } from '../../services/documentService';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';

/**
 * Excel import for the Youth Registry: choose a file, read what will happen, then confirm.
 *
 * The preview is the point. An import that simply reported "42 rows imported" would leave the user
 * with no way to know which three were skipped or why, and no way to fix them — so nothing is written
 * until they have seen the rows, and every rejected row is named with its own spreadsheet line
 * number and the reason.
 *
 * The FILE is what gets sent on confirmation, not the previewed rows. The server re-parses and
 * re-validates; this component holds no authority over what is imported, which is why a tampered
 * preview would achieve nothing.
 */

const STATUS_STYLES = {
  valid: 'bg-green-50 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  invalid: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  duplicate: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

const STATUS_LABELS = { valid: 'Will import', invalid: 'Has errors', duplicate: 'Already listed' };

export default function YouthImportModal({ isOpen, onClose, onImported, barangayName }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const previewMutation = useMutation({
    mutationFn: (chosen) => youthService.importPreview(chosen).then((r) => r.data.data),
    onSuccess: (data) => setPreview(data),
    onError: (e) => {
      // The server's message names the missing column or the unreadable file; it is more use than
      // any generic wording this component could substitute.
      toast.error(e.message || 'That file could not be read');
      setPreview(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: (chosen) => youthService.importConfirm(chosen).then((r) => r.data.data),
    onSuccess: (data) => {
      const failed = data.failed?.length || 0;
      toast.success(
        `Imported ${data.imported} member${data.imported === 1 ? '' : 's'}`
        + (data.skippedInvalid ? `, ${data.skippedInvalid} with errors skipped` : '')
        + (data.skippedDuplicate ? `, ${data.skippedDuplicate} already listed` : '')
        + (failed ? `, ${failed} could not be saved` : '')
      );
      onImported?.();
      close();
    },
    onError: (e) => toast.error(e.message || 'The import failed'),
  });

  const chooseFile = (chosen) => {
    if (!chosen) return;
    // Checked here for a quick answer; the upload middleware checks extension against MIME as well,
    // so a renamed file never reaches the parser.
    if (!/\.xlsx?$/i.test(chosen.name)) {
      return toast.error('Choose an Excel file (.xlsx)');
    }
    setFile(chosen);
    setPreview(null);
    previewMutation.mutate(chosen);
  };

  const handleImport = async () => {
    if (!preview?.totals?.valid) return;
    const result = await confirm.create({
      title: `Import ${preview.totals.valid} member${preview.totals.valid === 1 ? '' : 's'}?`,
      text: barangayName
        ? `They will be added to the Barangay ${barangayName} registry as unverified records.`
        : 'They will be added to your municipality’s registry as unverified records.',
      confirmText: 'Import them',
    });
    if (result.isConfirmed) importMutation.mutate(file);
  };

  const totals = preview?.totals;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Import youth from a spreadsheet"
      size="lg"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="meta-text">
            {totals
              ? `${totals.rows} row${totals.rows === 1 ? '' : 's'} read from ${preview.fileName}`
              : 'Nothing imported until you confirm.'}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={close}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!totals?.valid || importMutation.isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {importMutation.isPending
                ? 'Importing…'
                : totals?.valid
                  ? `Import ${totals.valid} member${totals.valid === 1 ? '' : 's'}`
                  : 'Import'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {/* What the sheet needs, said before the upload rather than as an error afterwards. */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-700/40">
          <p className="font-medium text-gray-900 dark:text-white">What the spreadsheet needs</p>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            A header row containing <strong>First Name</strong>, <strong>Last Name</strong>,{' '}
            <strong>Birth Date</strong> and <strong>Gender</strong>. Email, Contact Number, Address,
            Educational Attainment, Occupation and Registered Voter are read when present.
          </p>
          <p className="field-hint mt-2">
            Birth dates: a real date cell, or text as YYYY-MM-DD (05/04/2008 is read as 5 April).
            Members must be 15–30. Common spellings of the headings are recognised — Surname, Date of
            Birth, Sex.
            {barangayName
              ? ` Every member is filed under Barangay ${barangayName}, from your account.`
              : ''}
          </p>
        </div>

        <label
          htmlFor="youth-import-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-4 py-8 text-center transition-colors hover:border-navy-400 hover:bg-navy-50/40 dark:border-gray-600 dark:hover:border-navy-400 dark:hover:bg-navy-500/10"
        >
          {file ? <FileSpreadsheet size={22} className="text-navy-700 dark:text-navy-300" aria-hidden="true" />
            : <Upload size={22} className="text-gray-400" aria-hidden="true" />}
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {file ? file.name : 'Choose an .xlsx file'}
          </span>
          <span className="field-hint">
            {previewMutation.isPending ? 'Reading the spreadsheet…' : 'Nothing is saved until you confirm'}
          </span>
          <input
            id="youth-import-file"
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
        </label>

        {totals && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Tally icon={CheckCircle2} tone="valid" count={totals.valid} label="will import" />
              <Tally icon={AlertTriangle} tone="invalid" count={totals.invalid} label="have errors" />
              <Tally icon={Copy} tone="duplicate" count={totals.duplicates} label="already listed" />
            </div>

            {totals.valid === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                Nothing in this file can be imported yet. Correct the rows below in your spreadsheet
                and choose the file again.
              </p>
            )}

            {/*
              * Every row, in the order they appear in the user's own file, with its spreadsheet line
              * number — so a reported problem can be found and fixed where it actually lives.
              */}
            <div className="max-h-72 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="data-table w-full min-w-[40rem]">
                <caption className="sr-only">Rows read from the spreadsheet, with what will happen to each</caption>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th scope="col" className="w-16">Row</th>
                    <th scope="col">Name</th>
                    <th scope="col">Birth date</th>
                    <th scope="col">Gender</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line}>
                      <td className="numeric text-xs text-gray-500 dark:text-gray-400">{row.line}</td>
                      <td className="text-sm">
                        {`${row.firstName || ''} ${row.lastName || ''}`.trim() || <span className="meta-text">(no name)</span>}
                      </td>
                      <td className="whitespace-nowrap text-xs">{row.birthDate || '—'}</td>
                      <td className="text-xs">{row.gender || '—'}</td>
                      <td>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                          {STATUS_LABELS[row.status]}
                        </span>
                        {row.errors?.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {row.errors.map((err) => (
                              <li key={err} className="text-xs text-red-600 dark:text-red-300">{err}</li>
                            ))}
                          </ul>
                        )}
                        {row.duplicateOf && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                            Same as row {row.duplicateOf} in this file
                          </p>
                        )}
                        {row.alreadyRegistered && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                            Already in the registry
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
            >
              <X size={14} aria-hidden="true" />
              Choose a different file
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function Tally({ icon: Icon, tone, count, label }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${STATUS_STYLES[tone]}`}>
      <Icon size={16} aria-hidden="true" />
      <p className="text-sm">
        <span className="numeric font-semibold">{count}</span> {label}
      </p>
    </div>
  );
}
