import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Swal from 'sweetalert2';
import { Users } from 'lucide-react';
import { programService } from '../../services/programService';
import StatusBadge from './StatusBadge';
import { toast } from '../ui/toaster';
import { confirm } from '../../utils/confirm';

/*
 * The staff side of joining: youth ask, an SK officer decides.
 *
 * Places are counted from confirmed participants only — a request is not a slot — which is the
 * same rule the server applies when it refuses a confirmation past `targetParticipants`. The
 * count is shown against the target so an officer can see how much room is left before deciding,
 * rather than discovering it in an error.
 */
export default function ParticipantRequests({ programId, canDecide }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['program-participants', programId],
    queryFn: () => programService.getParticipants(programId).then((r) => r.data.data),
    enabled: canDecide,
  });

  const decideMutation = useMutation({
    mutationFn: ({ youthId, decision, reason }) =>
      programService.decideParticipant(programId, youthId, decision, reason),
    onSuccess: (_, { decision }) => {
      toast.success(decision === 'confirmed' ? 'Participant confirmed' : 'Request declined');
      queryClient.invalidateQueries({ queryKey: ['program-participants', programId] });
      queryClient.invalidateQueries({ queryKey: ['program', programId] });
    },
    onError: (e) => toast.error(e.message || 'Could not record that decision'),
  });

  if (!canDecide || isLoading) return null;

  const participants = data?.participants || [];
  if (participants.length === 0) return null;

  const pending = participants.filter((p) => p.status === 'pending');
  const decided = participants.filter((p) => p.status !== 'pending');
  const target = data?.targetParticipants || 0;
  const full = target > 0 && data.confirmed >= target;

  const handleConfirm = async (p) => {
    const result = await confirm.approve({
      title: `Confirm ${p.firstName} ${p.lastName}?`,
      text: target > 0
        ? `This takes place ${data.confirmed + 1} of ${target}.`
        : 'They will be recorded as a participant.',
    });
    if (result.isConfirmed) decideMutation.mutate({ youthId: p._id, decision: 'confirmed' });
  };

  const handleDecline = async (p) => {
    const { isConfirmed, value } = await Swal.fire({
      title: `Decline ${p.firstName} ${p.lastName}?`,
      input: 'textarea',
      inputLabel: 'Reason',
      inputPlaceholder: 'They will see this, and may ask again later...',
      inputValidator: (v) => (!v || !v.trim() ? 'A reason is required' : undefined),
      showCancelButton: true,
      confirmButtonText: 'Decline',
      confirmButtonColor: '#dc2626',
    });
    if (isConfirmed) decideMutation.mutate({ youthId: p._id, decision: 'declined', reason: value });
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Users size={18} className="text-navy-700 dark:text-navy-300" aria-hidden="true" />
        <h2 className="section-heading">Participants</h2>
        <span className="meta-text ml-auto">
          <span className="numeric">{data.confirmed}</span>
          {target > 0 && <> of <span className="numeric">{target}</span></>} confirmed
          {pending.length > 0 && <> · <span className="numeric">{pending.length}</span> awaiting a decision</>}
        </span>
      </div>

      {full && pending.length > 0 && (
        /* Explains in advance why a confirmation will be refused, rather than letting the officer
           find out by clicking. */
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          All {target} places are taken. Withdraw or decline a confirmed participant to free one.
        </p>
      )}

      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {[...pending, ...decided].map((p) => (
          <li key={p._id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {p.firstName} {p.lastName}
                {p.age != null && <span className="meta-text"> · <span className="numeric">{p.age}</span> yrs</span>}
              </p>
              <p className="meta-text">
                {p.barangay?.name || 'No barangay'}
                {p.contactNumber ? ` · ${p.contactNumber}` : ''}
                {/* Worth surfacing here: an unconfirmed member is one nobody has vouched for. */}
                {p.verificationStatus === 'unverified' && ' · membership unconfirmed'}
              </p>
              {p.status === 'declined' && p.declineReason && (
                <p className="meta-text text-red-600 dark:text-red-400">Declined: {p.declineReason}</p>
              )}
            </div>

            {p.status === 'pending' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleConfirm(p)}
                  disabled={decideMutation.isPending || full}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => handleDecline(p)}
                  disabled={decideMutation.isPending}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  Decline
                </button>
              </div>
            ) : (
              <StatusBadge status={p.status === 'confirmed' ? 'approved' : 'rejected'} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
