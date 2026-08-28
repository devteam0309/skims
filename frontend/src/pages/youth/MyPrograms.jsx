import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MapPin, Users, Target } from 'lucide-react';
import { programService } from '../../services/programService';
import { youthService } from '../../services/documentService';
import StatusBadge from '../../components/shared/StatusBadge';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';

/*
 * What a youth member sees when they sign in.
 *
 * The list is whatever GET /api/programs returns for them, which the server already scopes to
 * their own municipality — this page does no filtering of its own, so it cannot drift out of step
 * with the boundary the API enforces. Only approved programmes that are still running can be
 * joined, and joining is a request an SK officer decides, not an enrolment.
 */
export default function MyPrograms() {
  const queryClient = useQueryClient();

  const { data: programs, isLoading } = useQuery({
    queryKey: ['youth-programs'],
    queryFn: () => programService.getAll({ approvalStatus: 'approved', limit: 100 }).then((r) => r.data.data),
  });

  const { data: me } = useQuery({
    queryKey: ['youth-me'],
    queryFn: () => youthService.getMine().then((r) => r.data.data),
  });

  const requestsByProgram = Object.fromEntries(
    (me?.programParticipations || []).map((p) => [p.program?._id || p.program, p])
  );

  const joinMutation = useMutation({
    mutationFn: (id) => programService.join(id),
    onSuccess: () => {
      toast.success('Request sent — your SK office will review it');
      queryClient.invalidateQueries({ queryKey: ['youth-me'] });
      queryClient.invalidateQueries({ queryKey: ['youth-programs'] });
    },
    onError: (e) => toast.error(e.message || 'Could not send your request'),
  });

  const withdrawMutation = useMutation({
    mutationFn: (id) => programService.withdraw(id),
    onSuccess: () => {
      toast.success('Request withdrawn');
      queryClient.invalidateQueries({ queryKey: ['youth-me'] });
      queryClient.invalidateQueries({ queryKey: ['youth-programs'] });
    },
    onError: (e) => toast.error(e.message || 'Could not withdraw your request'),
  });

  const handleWithdraw = async (program) => {
    const result = await confirm.delete({
      title: 'Withdraw from this program?',
      text: `You will be removed from "${program.title}". You can ask to join again later.`,
      confirmButtonText: 'Withdraw',
    });
    if (result.isConfirmed) withdrawMutation.mutate(program._id);
  };

  if (isLoading) return <PageLoader />;

  const joinable = (p) => !['completed', 'cancelled'].includes(p.status);
  const pending = (programs || []).filter((p) => requestsByProgram[p._id]?.status === 'pending');
  const confirmed = (programs || []).filter((p) => requestsByProgram[p._id]?.status === 'confirmed');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Programs</h1>
        <p className="page-subtitle">
          {me?.municipality?.name
            ? `Programs run by SK ${me.municipality.name}`
            : 'Programs run by your SK office'}
          {confirmed.length > 0 && ` · you are in ${confirmed.length}`}
          {pending.length > 0 && ` · ${pending.length} awaiting a decision`}
        </p>
      </div>

      {me?.verificationStatus === 'unverified' && (
        /* Said plainly rather than left as a silent flag: it explains why an officer may follow
           up, and makes clear it is not blocking anything they are trying to do. */
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Your membership has not been confirmed by your SK office yet. You can still browse and
            ask to join programs while that happens.
          </p>
        </div>
      )}

      {(programs || []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center dark:border-gray-700 dark:bg-gray-800">
          <Target size={24} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No programs yet</p>
          <p className="meta-text mt-1">
            Approved programs from your municipality will appear here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {programs.map((program) => {
            const request = requestsByProgram[program._id];
            const full = program.targetParticipants > 0
              && (program.actualParticipants || 0) >= program.targetParticipants;
            const busy = joinMutation.isPending || withdrawMutation.isPending;

            return (
              <li
                key={program._id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={program.status} />
                  {request && request.status !== 'declined' && <StatusBadge status={request.status} />}
                </div>

                <h2 className="mb-1 font-semibold text-gray-900 dark:text-white">{program.title}</h2>
                <p className="mb-3 line-clamp-3 text-sm text-gray-600 dark:text-gray-300">{program.description}</p>

                <dl className="mb-4 space-y-1.5 text-sm text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} aria-hidden="true" />
                    <dt className="sr-only">Runs</dt>
                    <dd>{formatDate(program.startDate)} – {formatDate(program.endDate)}</dd>
                  </div>
                  {program.barangay?.name && (
                    <div className="flex items-center gap-2">
                      <MapPin size={14} aria-hidden="true" />
                      <dt className="sr-only">Location</dt>
                      <dd>{program.barangay.name}</dd>
                    </div>
                  )}
                  {program.targetParticipants > 0 && (
                    <div className="flex items-center gap-2">
                      <Users size={14} aria-hidden="true" />
                      <dt className="sr-only">Places</dt>
                      <dd className="numeric">
                        {program.actualParticipants || 0} of {program.targetParticipants} places taken
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-auto">
                  {request?.status === 'declined' && (
                    <p className="mb-2 text-sm text-red-700 dark:text-red-300">
                      Your last request was declined{request.declineReason ? `: ${request.declineReason}` : ''}.
                    </p>
                  )}

                  {request && request.status !== 'declined' ? (
                    <button
                      type="button"
                      onClick={() => handleWithdraw(program)}
                      disabled={busy}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      {request.status === 'confirmed' ? 'Withdraw from this program' : 'Cancel my request'}
                    </button>
                  ) : !joinable(program) ? (
                    <p className="meta-text">This program is {program.status}.</p>
                  ) : full ? (
                    // Stated rather than shown as a dead button, so the reason is visible.
                    <p className="meta-text">All places have been taken.</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => joinMutation.mutate(program._id)}
                      disabled={busy}
                      className="w-full rounded-lg bg-navy-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
                    >
                      Ask to join
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
