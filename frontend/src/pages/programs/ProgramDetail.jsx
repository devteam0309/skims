import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, Edit, Trash2, Calendar, Banknote, Users, Target,
  CheckCircle2, Clock, AlertCircle, Link2,
} from 'lucide-react';
import { programService } from '../../services/programService';
import StatusBadge from '../../components/shared/StatusBadge';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { PROGRAM_EDITORS } from '../../utils/constants';

const STATUSES = ['planned', 'ongoing', 'delayed', 'completed', 'cancelled'];

export default function ProgramDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const reduceMotion = useReducedMotion();

  const { data: program, isLoading } = useQuery({
    queryKey: ['program', id],
    queryFn: () => programService.getById(id).then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: () => programService.delete(id),
    onSuccess: () => { toast.success('Program deleted'); navigate('/programs'); queryClient.invalidateQueries(['programs']); },
    onError: (e) => toast.error(e.message || 'Delete failed'),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => programService.updateStatus(id, status),
    onSuccess: () => { toast.success('Status updated'); queryClient.invalidateQueries(['program', id]); },
    onError: (e) => toast.error(e.message || 'Status update failed'),
  });

  const handleDelete = async () => {
    const result = await confirm.delete({ text: `"${program.title}" will be permanently removed.` });
    if (result.isConfirmed) deleteMutation.mutate();
  };

  const handleStatusChange = async (newStatus) => {
    const result = await confirm.statusChange({ text: `Change status to "${newStatus}"?` });
    if (result.isConfirmed) statusMutation.mutate(newStatus);
  };

  if (isLoading) return <PageLoader />;

  // Previously a bare centred line of grey text — a dead end with no way onward, reached by
  // following a link to a program someone else had just deleted.
  if (!program) {
    return (
      <div className="mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white py-16 text-center dark:border-gray-700 dark:bg-gray-800">
        <Target size={24} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" aria-hidden="true" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Program not found</p>
        <p className="meta-text mt-1">It may have been deleted.</p>
        <Link to="/programs" className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline dark:text-navy-300">
          Back to programs
        </Link>
      </div>
    );
  }

  const canEdit = PROGRAM_EDITORS.includes(user?.role);
  const completion = program.completionRate || 0;

  /*
   * Budget figures are derived once, with the zero-budget case handled explicitly.
   * `(spent / budget) * 100` was computed inline in two places against a budget that can legally
   * be 0 (an unfunded program), which rendered "Infinity%" in the bar width and the literal text
   * "NaN% utilized" underneath it.
   */
  const allocated = program.budget || 0;
  const spent = program.actualExpenses || 0;
  const remaining = allocated - spent;
  const overBudget = remaining < 0;
  const utilization = allocated > 0 ? Math.round((spent / allocated) * 100) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="mt-0.5 shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title">{program.title}</h1>
              <StatusBadge status={program.status} />
            </div>
            <p className="page-subtitle">
              {program.municipality?.name}
              {program.barangay ? ` · ${program.barangay.name}` : ''}
              {' · '}
              <span className="capitalize">{program.category?.replace(/_/g, ' ')}</span>
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            {/* The select carried no accessible name — a screen reader announced only the current
                status, with no indication that changing it rewrites the program's state. */}
            <label htmlFor="program-status" className="sr-only">Change program status</label>
            <select
              id="program-status"
              value={program.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={statusMutation.isPending}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-navy-700 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <Link
              to={`/programs/${id}/edit`}
              aria-label={`Edit ${program.title}`}
              title="Edit program"
              className="rounded-lg border border-gray-300 p-2 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <Edit size={16} aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              aria-label={`Delete ${program.title}`}
              title="Delete program"
              className="rounded-lg border border-red-200 p-2 text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Figures carry .numeric so amounts and counts align on the digit rather than drifting
          with proportional glyph widths. */}
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={Banknote} label="Budget" value={formatCurrency(allocated)} sub={`${formatCurrency(spent)} spent`} />
        <Stat icon={Calendar} label="Start Date" value={formatDate(program.startDate)} sub={`Ends ${formatDate(program.endDate)}`} />
        <Stat
          icon={Users}
          label="Participants"
          value={String(program.actualParticipants || 0)}
          sub={`of ${program.targetParticipants || 0} target`}
        />
        <Stat
          icon={Target}
          label="Completion"
          value={`${completion}%`}
          sub={`${program.milestones?.length || 0} milestones`}
        />
      </dl>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">Overall Completion</span>
          <span className="numeric font-semibold text-navy-700 dark:text-navy-300">{completion}%</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
          role="progressbar"
          aria-valuenow={completion}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall completion"
        >
          {/*
            Framer animates in JavaScript, so the global `prefers-reduced-motion` CSS override in
            index.css does not reach it — a one-second sweep still played for users who asked the
            OS for no motion. useReducedMotion lets the bar simply appear at its final width.
          */}
          <motion.div
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${Math.min(completion, 100)}%` }}
            transition={reduceMotion ? { duration: 0 } : { duration: 1, ease: 'easeOut' }}
            className={`h-full rounded-full ${
              program.status === 'delayed'
                ? 'bg-red-500'
                : program.status === 'completed'
                ? 'bg-green-500'
                : 'bg-navy-700 dark:bg-navy-400'
            }`}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="section-heading mb-3">Description</h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{program.description}</p>

            {program.objectives?.length > 0 && (
              <>
                <h3 className="section-heading mb-2 mt-5">Objectives</h3>
                <ol className="space-y-1.5">
                  {program.objectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      {/* The counter had no dark variant, so navy-on-navy-100 stayed a pale chip
                          on the dark surface. */}
                      <span
                        aria-hidden="true"
                        className="numeric mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-medium text-navy-700 dark:bg-navy-500/20 dark:text-navy-300"
                      >
                        {i + 1}
                      </span>
                      {obj}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>

          {program.milestones?.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="section-heading mb-4">Milestones</h2>
              <ul className="space-y-3">
                {program.milestones.map((m) => (
                  <li key={m._id} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <MilestoneIcon status={m.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{m.title}</p>
                      {m.targetDate && <p className="meta-text">Target: {formatDate(m.targetDate)}</p>}
                      {m.notes && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{m.notes}</p>}
                    </div>
                    <StatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="section-heading mb-4">Details</h2>
            <dl className="space-y-3 text-sm">
              {[
                ['Created By', program.createdBy ? `${program.createdBy.firstName} ${program.createdBy.lastName}` : 'Unknown'],
                ['Municipality', program.municipality?.name || 'N/A'],
                ['Barangay', program.barangay?.name || 'All Barangays'],
                ['Visibility', program.isPublic ? 'Public' : 'Internal'],
              ].map(([label, val]) => (
                <div key={label}>
                  <dt className="meta-text">{label}</dt>
                  <dd className="font-medium text-gray-800 dark:text-gray-200">{val}</dd>
                </div>
              ))}
              {program.budgetRef && (
                <div>
                  <dt className="meta-text">Linked Budget</dt>
                  <dd>
                    <Link
                      to={`/budgets/${program.budgetRef._id}`}
                      className="flex items-center gap-1 font-medium text-navy-700 hover:underline dark:text-navy-300"
                    >
                      <Link2 size={12} aria-hidden="true" className="shrink-0" />
                      {program.budgetRef.title} (FY {program.budgetRef.fiscalYear})
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {program.budgetRef && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="section-heading mb-3 flex items-center gap-2">
                <Link2 size={14} aria-hidden="true" className="text-gray-400 dark:text-gray-500" />
                Budget Utilization
              </h2>
              <dl className="space-y-2 text-sm">
                <Row label="Allocated" value={formatCurrency(allocated)} />
                {/*
                  "Spent" was red. Spending an allocated budget is the program working as
                  intended, not a fault — colouring it as one made every healthy program look
                  like it had a problem. Red is now reserved for the case that genuinely needs
                  intervention: spending past the allocation.
                */}
                <Row label="Spent" value={formatCurrency(spent)} />
                <div className="flex justify-between border-t border-gray-200 pt-2 dark:border-gray-700">
                  <dt className="text-gray-500 dark:text-gray-400">{overBudget ? 'Over budget by' : 'Remaining'}</dt>
                  <dd className={`numeric font-semibold ${overBudget ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-emerald-400'}`}>
                    {formatCurrency(Math.abs(remaining))}
                  </dd>
                </div>
              </dl>

              <div className="mt-3">
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
                  role="progressbar"
                  aria-valuenow={utilization ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Budget utilization"
                >
                  <div
                    className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : 'bg-navy-700 dark:bg-navy-400'}`}
                    style={{ width: `${Math.min(100, utilization ?? 0)}%` }}
                  />
                </div>
                <p className="meta-text mt-1 text-right">
                  {utilization === null ? 'No budget allocated' : `${utilization}% utilized`}
                </p>
              </div>
            </section>
          )}

          {program.assignedOfficers?.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="section-heading mb-3">Assigned Officers</h2>
              <ul className="space-y-2">
                {program.assignedOfficers.map((o) => (
                  <li key={o._id} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-bold text-navy-700 dark:bg-navy-500/20 dark:text-navy-300"
                    >
                      {o.firstName?.[0]}{o.lastName?.[0]}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{o.firstName} {o.lastName}</p>
                      <p className="meta-text capitalize">{o.role?.replace(/_/g, ' ')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={16} aria-hidden="true" className="text-gray-400 dark:text-gray-500" />
        <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      </div>
      <dd>
        <p className="numeric text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
        <p className="meta-text mt-0.5">{sub}</p>
      </dd>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="numeric font-medium text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

/** Milestone state icon. Each tone previously had a light-mode background only. */
function MilestoneIcon({ status }) {
  const map = {
    completed: ['bg-green-100 dark:bg-emerald-500/15', 'text-green-600 dark:text-emerald-400', CheckCircle2],
    delayed: ['bg-red-100 dark:bg-red-500/15', 'text-red-600 dark:text-red-400', AlertCircle],
  };
  const [bg, fg, Icon] = map[status] || ['bg-blue-100 dark:bg-blue-500/15', 'text-blue-600 dark:text-blue-300', Clock];

  return (
    <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${bg}`}>
      <Icon size={14} className={fg} />
    </span>
  );
}
