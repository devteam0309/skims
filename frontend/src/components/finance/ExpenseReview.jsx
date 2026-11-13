import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseService } from '../../services/budgetService';
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

const label = (v) => (v ? String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const person = (u) => (u ? `${u.firstName} ${u.lastName}` : null);

/**
 * One expense, everything a reviewer needs to decide on it (panel items 7.4, 7.5): the amount, date,
 * purpose and vendor; the programme, barangay and budget it belongs to; who recorded it; and the
 * proof — each file openable here before anything is decided. The decisions sit underneath:
 * approve, return for correction, reject, or reverse an approval. Authors get their own actions on
 * the same record — attach more proof, submit, or move it to the recycle bin.
 *
 * The buttons follow the role and the record's state, but the server decides: every action is
 * re-checked there, including that nobody approves their own expense.
 */
export default function ExpenseReview({ expenseId, onClose }) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [preview, setPreview] = useState(null);
  const [extraProof, setExtraProof] = useState([]);

  const { data: expense, isLoading } = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => expenseService.getById(expenseId).then((r) => r.data.data),
    enabled: Boolean(expenseId),
  });

  const refresh = () => refreshAll(queryClient);
  const act = (fn, done) => ({
    mutationFn: fn,
    onSuccess: () => { toast.success(done); refresh(); },
    onError: (e) => toast.error(e.message || 'The action failed'),
  });

  const approve = useMutation(act(() => expenseService.approve(expenseId), 'Expense approved and deducted from its budget'));
  const giveBack = useMutation(act((reason) => expenseService.returnForCorrection(expenseId, reason), 'Expense returned for correction'));
  const reject = useMutation(act((reason) => expenseService.reject(expenseId, reason), 'Expense rejected'));
  const reverse = useMutation(act((reason) => expenseService.reverse(expenseId, reason), 'Approval reversed and the amount returned to the budget'));
  const submit = useMutation(act(() => expenseService.submit(expenseId), 'Expense submitted for review'));
  const remove = useMutation({
    mutationFn: () => expenseService.delete(expenseId),
    onSuccess: () => { toast.success('Expense moved to the recycle bin'); refresh(); onClose(); },
    onError: (e) => toast.error(e.message || 'Could not delete the expense'),
  });
  const attach = useMutation({
    mutationFn: () => expenseService.addAttachments(expenseId, appendProof(new FormData(), extraProof, 'attachments', PROOF_TYPES)),
    onSuccess: () => { toast.success('Proof attached'); setExtraProof([]); refresh(); },
    onError: (e) => toast.error(e.message || 'Could not attach the files'),
  });

  const isReviewer = FINANCE_APPROVERS.includes(user?.role);
  const isAuthorRole = FINANCE_EDITORS.includes(user?.role);
  const own = expense && (expense.createdBy?._id || expense.createdBy) === user?._id;
  const status = expense?.status;
  const hasProof = (expense?.attachments?.length || 0) > 0;
  const busy = approve.isPending || giveBack.isPending || reject.isPending || reverse.isPending || submit.isPending || remove.isPending;

  const decideWithReason = async (mutation, title, inputLabel, confirmText) => {
    const result = await confirm.rejectWithReason({
      title, inputLabel, confirmText,
      text: `${expense.title} — ${formatCurrency(expense.amount)}`,
    });
    if (result.isConfirmed) mutation.mutate(result.value);
  };

  const onApprove = async () => {
    const result = await confirm.approve({
      title: 'Approve this expense?',
      text: `${formatCurrency(expense.amount)} will be deducted from ${expense.budget?.title || 'its budget'}. Check the attached proof first.`,
    });
    if (result.isConfirmed) approve.mutate();
  };

  const download = async (a) => {
    try {
      const res = await expenseService.attachment(expenseId, a._id);
      saveBlob(res.data, a.originalName);
    } catch (e) {
      toast.error(e.message || 'Could not download the file');
    }
  };

  const rows = expense ? [
    ['Reference', <span key="ref" className="font-mono">{expense.referenceNumber}</span>],
    ['Type', label(expense.type)],
    ['Amount', <span key="amt" className="numeric font-semibold">{formatCurrency(expense.amount)}</span>],
    ['Transaction date', formatDate(expense.transactionDate)],
    ['Barangay', expense.barangay?.name || 'Municipality level'],
    ['Municipality', expense.municipality?.name || '—'],
    ['Programme / activity', expense.program?.title || 'None linked'],
    ['Charged to', expense.budget
      ? `${expense.budget.title} — ${formatCurrency(expense.budget.remainingBalance)} left`
      : 'No budget linked'],
    ['Vendor', [expense.vendor?.name, expense.vendor?.address].filter(Boolean).join(', ') || '—'],
    ['Recorded by', person(expense.createdBy) || '—'],
    ['Submitted', expense.submittedAt ? formatDate(expense.submittedAt) : (status === 'draft' ? 'Not yet' : '—')],
    ...(expense.approvedBy ? [['Approved', `${person(expense.approvedBy)} · ${formatDate(expense.approvedAt)}`]] : []),
  ] : [];

  return (
    <>
      <Modal
        isOpen={Boolean(expenseId)}
        onClose={onClose}
        title={expense ? `Expense ${expense.referenceNumber}` : 'Expense'}
        size="xl"
        footer={expense && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {isAuthorRole && !['approved', 'liquidated'].includes(status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const r = await confirm.archive({ title: 'Move to the recycle bin?', text: `${expense.title} can be restored from the recycle bin.`, confirmText: 'Move to recycle bin' });
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
                <button
                  type="button"
                  disabled={busy || !hasProof}
                  title={hasProof ? undefined : 'Attach proof first'}
                  onClick={() => submit.mutate()}
                  className="rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                >
                  {status === 'returned' ? 'Resubmit for review' : 'Submit for review'}
                </button>
              )}
              {isReviewer && status === 'pending' && !own && (
                <>
                  <button type="button" disabled={busy} onClick={() => decideWithReason(reject, 'Reject this expense?', 'Reason for rejecting it', 'Reject')}
                    className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300">
                    Reject
                  </button>
                  <button type="button" disabled={busy} onClick={() => decideWithReason(giveBack, 'Return for correction?', 'What has to change, or which proof is missing', 'Return with remarks')}
                    className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300">
                    Return for correction
                  </button>
                  <button type="button" disabled={busy || !hasProof} onClick={onApprove}
                    className="rounded-xl bg-green-700 px-5 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
                    Approve
                  </button>
                </>
              )}
              {isReviewer && status === 'approved' && (
                <button type="button" disabled={busy} onClick={() => decideWithReason(reverse, 'Reverse this approval?', 'Why the approval is being reversed', 'Reverse and refund')}
                  className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300">
                  Reverse approval
                </button>
              )}
            </div>
          </div>
        )}
      >
        {isLoading || !expense ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner className="text-navy-700" /></div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{expense.title}</h3>
              <StatusBadge status={status} />
              {isReviewer && status === 'pending' && own && <span className="meta-text">You recorded this expense, so another reviewer must decide on it.</span>}
            </div>

            {(status === 'returned' || status === 'rejected') && (
              <p role="status" className={`rounded-xl border p-3 text-sm ${status === 'rejected' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'}`}>
                <strong>{status === 'rejected' ? 'Rejected' : 'Returned for correction'}</strong>
                {' by '}{person(status === 'rejected' ? expense.rejectedBy : expense.returnedBy) || 'the reviewer'}
                {' on '}{formatDate(status === 'rejected' ? expense.rejectedAt : expense.returnedAt)}: {status === 'rejected' ? expense.rejectionReason : expense.returnReason}
              </p>
            )}

            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="meta-text">{k}</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">{v}</dd>
                </div>
              ))}
            </dl>

            {expense.description && (
              <div>
                <h4 className="meta-text mb-1">Description and purpose</h4>
                <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-100">{expense.description}</p>
              </div>
            )}

            <section aria-labelledby="expense-proof">
              <h4 id="expense-proof" className="section-heading mb-2">Supporting documents</h4>
              <AttachmentList
                attachments={expense.attachments}
                onPreview={(a) => setPreview(a)}
                onDownload={download}
                emptyText="No proof attached. An expense cannot be submitted or approved until a receipt, invoice or voucher is attached."
              />
              {isAuthorRole && ['draft', 'pending', 'returned'].includes(status) && (
                <div className="mt-3 space-y-2 rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-600">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Attach more proof</p>
                  <ProofPicker id="expense-more-proof" value={extraProof} onChange={setExtraProof} typeOptions={PROOF_TYPES} onReject={(m) => toast.error(m)} />
                  {extraProof.length > 0 && (
                    <button type="button" onClick={() => attach.mutate()} disabled={attach.isPending}
                      className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
                      {attach.isPending ? 'Uploading…' : `Upload ${extraProof.length} file${extraProof.length === 1 ? '' : 's'}`}
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <FilePreview
        file={preview ? { key: preview._id, name: preview.originalName, type: preview.fileType } : null}
        load={() => expenseService.attachment(expenseId, preview._id, { inline: true })}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
