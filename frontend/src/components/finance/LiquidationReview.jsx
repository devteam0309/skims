import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { liquidationService, expenseService } from '../../services/budgetService';
import { documentService } from '../../services/documentService';
import Modal from '../shared/Modal';
import StatusBadge from '../shared/StatusBadge';
import FilePreview, { saveBlob } from '../shared/FilePreview';
import { AttachmentList, ProofPicker, appendProof } from '../shared/Attachments';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { confirm } from '../../utils/confirm';
import { refreshAll } from '../../utils/queryRefresh';
import { toast } from '../ui/toaster';
import useAuthStore from '../../store/authStore';
import { FINANCE_EDITORS, FINANCE_APPROVERS, PROOF_TYPES } from '../../utils/constants';

const person = (u) => (u ? `${u.firstName} ${u.lastName}` : null);

/**
 * A liquidation report, laid out for the decision (panel items 6.4, 7.5): what was spent and on
 * which programme, the expenses it accounts for — each with its own receipts — and the evidence
 * filed with the report. Every file opens here. The reviewer approves, returns it for more
 * documents, or rejects it; the treasurer attaches what was asked for and resubmits.
 */
export default function LiquidationReview({ liquidationId, onClose }) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [preview, setPreview] = useState(null);
  const [extraProof, setExtraProof] = useState([]);

  const { data: liq, isLoading } = useQuery({
    queryKey: ['liquidation', liquidationId],
    queryFn: () => liquidationService.getById(liquidationId).then((r) => r.data.data),
    enabled: Boolean(liquidationId),
  });

  const refresh = () => refreshAll(queryClient);
  const act = (fn, done) => ({
    mutationFn: fn,
    onSuccess: () => { toast.success(done); refresh(); },
    onError: (e) => toast.error(e.message || 'The action failed'),
  });
  const approve = useMutation(act(() => liquidationService.approve(liquidationId), 'Liquidation approved'));
  const giveBack = useMutation(act((reason) => liquidationService.returnForCorrection(liquidationId, reason), 'Report returned for correction'));
  const reject = useMutation(act((reason) => liquidationService.reject(liquidationId, reason), 'Report rejected'));
  const submit = useMutation(act(() => liquidationService.submit(liquidationId), 'Report submitted for review'));
  const remove = useMutation({
    mutationFn: () => liquidationService.delete(liquidationId),
    onSuccess: () => { toast.success('Report moved to the recycle bin'); refresh(); onClose(); },
    onError: (e) => toast.error(e.message || 'Could not delete the report'),
  });
  const attach = useMutation({
    mutationFn: () => liquidationService.addAttachments(liquidationId, appendProof(new FormData(), extraProof, 'documents', PROOF_TYPES)),
    onSuccess: () => { toast.success('Documents attached'); setExtraProof([]); refresh(); },
    onError: (e) => toast.error(e.message || 'Could not attach the files'),
  });

  const isReviewer = FINANCE_APPROVERS.includes(user?.role);
  const isAuthorRole = FINANCE_EDITORS.includes(user?.role);
  const own = liq && (liq.submittedBy?._id || liq.submittedBy) === user?._id;
  const status = liq?.status;
  const evidence = (liq?.documents?.length || 0) + (liq?.supportingDocuments?.length || 0);
  const busy = approve.isPending || giveBack.isPending || reject.isPending || submit.isPending || remove.isPending;

  const withReason = async (mutation, title, inputLabel, confirmText) => {
    const result = await confirm.rejectWithReason({ title, inputLabel, confirmText, text: `${liq.title} — ${formatCurrency(liq.totalAmount)}` });
    if (result.isConfirmed) mutation.mutate(result.value);
  };

  /*
   * Three kinds of file can be opened from here, each through its own authorised route: the
   * report's attachments, the receipts on the expenses it covers, and the registered documents
   * linked to it.
   */
  const loadPreview = () => {
    if (preview.kind === 'report') return liquidationService.attachment(liquidationId, preview.file._id, { inline: true });
    if (preview.kind === 'expense') return expenseService.attachment(preview.expenseId, preview.file._id, { inline: true });
    return documentService.serve(preview.file._id, { inline: true });
  };
  const download = async (kind, file, expenseId) => {
    try {
      const res = kind === 'report'
        ? await liquidationService.attachment(liquidationId, file._id)
        : kind === 'expense' ? await expenseService.attachment(expenseId, file._id) : await documentService.serve(file._id);
      saveBlob(res.data, file.originalName || file.title);
    } catch (e) {
      toast.error(e.message || 'Could not download the file');
    }
  };

  return (
    <>
      <Modal
        isOpen={Boolean(liquidationId)}
        onClose={onClose}
        title={liq ? `Liquidation ${liq.referenceNumber}` : 'Liquidation report'}
        size="xl"
        footer={liq && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {isAuthorRole && ['draft', 'returned', 'rejected'].includes(status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const r = await confirm.archive({ title: 'Move to the recycle bin?', text: `${liq.title} can be restored from the recycle bin.`, confirmText: 'Move to recycle bin' });
                    if (r.isConfirmed) remove.mutate();
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {isAuthorRole && ['draft', 'returned'].includes(status) && (
                <button type="button" disabled={busy || !evidence} onClick={() => submit.mutate()}
                  className="rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
                  {status === 'returned' ? 'Resubmit for review' : 'Submit for review'}
                </button>
              )}
              {isReviewer && ['submitted', 'under_review'].includes(status) && !own && (
                <>
                  <button type="button" disabled={busy} onClick={() => withReason(reject, 'Reject this report?', 'Reason for rejecting it', 'Reject')}
                    className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300">
                    Reject
                  </button>
                  <button type="button" disabled={busy} onClick={() => withReason(giveBack, 'Return for correction?', 'Which documents are missing, or what has to change', 'Return with remarks')}
                    className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300">
                    Return for correction
                  </button>
                  <button
                    type="button"
                    disabled={busy || !evidence}
                    onClick={async () => {
                      const r = await confirm.approve({ title: 'Approve this liquidation?', text: 'Its expenses will be marked liquidated. Check the receipts first.' });
                      if (r.isConfirmed) approve.mutate();
                    }}
                    className="rounded-xl bg-green-700 px-5 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      >
        {isLoading || !liq ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner className="text-navy-700" /></div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{liq.title}</h3>
              <StatusBadge status={status} />
              {isReviewer && own && ['submitted', 'under_review'].includes(status) && (
                <span className="meta-text">You filed this report, so another reviewer must decide on it.</span>
              )}
            </div>

            {(status === 'returned' || status === 'rejected') && (
              <p role="status" className={`rounded-xl border p-3 text-sm ${status === 'rejected' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'}`}>
                <strong>{status === 'rejected' ? 'Rejected' : 'Returned for correction'}</strong>
                {' by '}{person(status === 'rejected' ? liq.rejectedBy : liq.returnedBy) || 'the reviewer'}
                {' on '}{formatDate(status === 'rejected' ? liq.rejectedAt : liq.returnedAt)}: {status === 'rejected' ? liq.rejectionReason : liq.returnReason}
              </p>
            )}

            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Programme', liq.program?.title || '—'],
                ['Barangay', liq.barangay?.name || 'Municipality level'],
                ['Budget', liq.budget?.title || 'None linked'],
                ['Total amount', formatCurrency(liq.totalAmount)],
                ['Liquidated', formatCurrency(liq.liquidatedAmount)],
                ['Unliquidated', formatCurrency(liq.variance)],
                ['Filed by', person(liq.submittedBy) || '—'],
                ['Submitted', liq.submittedAt ? formatDate(liq.submittedAt) : 'Not yet'],
                ['Due', liq.dueDate ? formatDate(liq.dueDate) : '—'],
                ...(liq.approvedBy ? [['Approved', `${person(liq.approvedBy)} · ${formatDate(liq.approvedAt)}`]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="meta-text">{k}</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">{v}</dd>
                </div>
              ))}
            </dl>
            {liq.remarks && <p className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-200">{liq.remarks}</p>}

            <section aria-labelledby="liq-evidence">
              <h4 id="liq-evidence" className="section-heading mb-2">Evidence filed with the report</h4>
              <AttachmentList
                attachments={liq.documents}
                onPreview={(file) => setPreview({ kind: 'report', file })}
                onDownload={(file) => download('report', file)}
                emptyText={liq.supportingDocuments?.length ? 'No files uploaded with the report — see the linked documents below.' : 'No supporting documents. A report cannot be submitted or approved without them.'}
              />
              {isAuthorRole && ['draft', 'returned'].includes(status) && (
                <div className="mt-3 space-y-2 rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-600">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Attach more documents</p>
                  <ProofPicker id="liq-more-proof" value={extraProof} onChange={setExtraProof} typeOptions={PROOF_TYPES} onReject={(m) => toast.error(m)} />
                  {extraProof.length > 0 && (
                    <button type="button" onClick={() => attach.mutate()} disabled={attach.isPending}
                      className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
                      {attach.isPending ? 'Uploading…' : `Upload ${extraProof.length} file${extraProof.length === 1 ? '' : 's'}`}
                    </button>
                  )}
                </div>
              )}
            </section>

            {liq.supportingDocuments?.length > 0 && (
              <section aria-labelledby="liq-linked">
                <h4 id="liq-linked" className="section-heading mb-2">Linked registered documents</h4>
                <AttachmentList
                  attachments={liq.supportingDocuments.map((d) => ({ ...d, documentType: d.category }))}
                  onPreview={(file) => setPreview({ kind: 'document', file })}
                  onDownload={(file) => download('document', file)}
                />
              </section>
            )}

            <section aria-labelledby="liq-expenses">
              <h4 id="liq-expenses" className="section-heading mb-2">Expenses accounted for</h4>
              {liq.expenses?.length ? (
                <ul className="space-y-3">
                  {liq.expenses.map((e) => (
                    <li key={e._id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          <span className="font-mono text-xs text-navy-700 dark:text-navy-300">{e.referenceNumber}</span> · {e.title}
                        </p>
                        <span className="flex items-center gap-2">
                          <span className="numeric text-sm font-semibold">{formatCurrency(e.amount)}</span>
                          <StatusBadge status={e.status} />
                        </span>
                      </div>
                      <AttachmentList
                        attachments={e.attachments}
                        onPreview={(file) => setPreview({ kind: 'expense', expenseId: e._id, file })}
                        onDownload={(file) => download('expense', file, e._id)}
                        emptyText="This expense carries no proof."
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta-text">No expenses linked to this report.</p>
              )}
            </section>
          </div>
        )}
      </Modal>

      <FilePreview
        file={preview ? { key: `${preview.kind}-${preview.file._id}`, name: preview.file.originalName || preview.file.title, type: preview.file.fileType } : null}
        load={loadPreview}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
