import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Edit, Trash2, Calendar, Banknote, Users, Target, MapPin, CheckCircle2, Clock, AlertCircle, Link2 } from 'lucide-react';
import { programService } from '../../services/programService';
import StatusBadge from '../../components/shared/StatusBadge';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { useState } from 'react';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';
import { PROGRAM_EDITORS } from '../../utils/constants';

export default function ProgramDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: program, isLoading } = useQuery({
    queryKey: ['program', id],
    queryFn: () => programService.getById(id).then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: () => programService.delete(id),
    onSuccess: () => { toast.success('Program deleted'); navigate('/programs'); queryClient.invalidateQueries(['programs']); },
    onError: (e) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => programService.updateStatus(id, status),
    onSuccess: () => { toast.success('Status updated'); queryClient.invalidateQueries(['program', id]); },
    onError: (e) => toast.error(e.message),
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
  if (!program) return <div className="text-center py-16 text-gray-400 dark:text-gray-500">Program not found</div>;

  const canEdit = PROGRAM_EDITORS.includes(user?.role);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(-1)} className="mt-1 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{program.title}</h1>
              <StatusBadge status={program.status} />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {program.municipality?.name} {program.barangay ? `· ${program.barangay.name}` : ''} · {program.category?.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <select
              value={program.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-navy-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              {['planned', 'ongoing', 'delayed', 'completed', 'cancelled'].map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <Link to={`/programs/${id}/edit`} className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
              <Edit size={16} />
            </Link>
            <button onClick={handleDelete} className="p-2 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition-colors">
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Banknote, label: 'Budget', value: formatCurrency(program.budget), sub: `${formatCurrency(program.actualExpenses || 0)} spent` },
          { icon: Calendar, label: 'Start Date', value: formatDate(program.startDate), sub: `Ends ${formatDate(program.endDate)}` },
          { icon: Users, label: 'Participants', value: `${program.actualParticipants || 0}`, sub: `of ${program.targetParticipants} target` },
          { icon: Target, label: 'Completion', value: `${program.completionRate || 0}%`, sub: `${program.milestones?.length || 0} milestones` },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <stat.icon size={16} className="text-gray-400 dark:text-gray-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</span>
            </div>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{stat.value}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-medium text-gray-700 dark:text-gray-300">Overall Completion</span>
          <span className="font-bold text-navy-700">{program.completionRate || 0}%</span>
        </div>
        <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${program.completionRate || 0}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className={`h-full rounded-full ${program.status === 'delayed' ? 'bg-red-500' : program.status === 'completed' ? 'bg-green-500' : 'bg-navy-700'}`}
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Description */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Description</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{program.description}</p>
            {program.objectives?.length > 0 && (
              <>
                <h3 className="font-semibold text-gray-800 dark:text-white mt-4 mb-2">Objectives</h3>
                <ul className="space-y-1">
                  {program.objectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <span className="w-5 h-5 bg-navy-100 text-navy-700 rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{i + 1}</span>
                      {obj}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Milestones */}
          {program.milestones?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Milestones</h2>
              <div className="space-y-3">
                {program.milestones.map((m) => (
                  <div key={m._id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${m.status === 'completed' ? 'bg-green-100' : m.status === 'delayed' ? 'bg-red-100' : 'bg-blue-100'}`}>
                      {m.status === 'completed' ? <CheckCircle2 size={14} className="text-green-600" /> :
                       m.status === 'delayed' ? <AlertCircle size={14} className="text-red-600" /> :
                       <Clock size={14} className="text-blue-600" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{m.title}</p>
                      {m.targetDate && <p className="text-xs text-gray-400 dark:text-gray-500">Target: {formatDate(m.targetDate)}</p>}
                      {m.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{m.notes}</p>}
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Details</h2>
            <dl className="space-y-3 text-sm">
              {[
                ['Created By', `${program.createdBy?.firstName} ${program.createdBy?.lastName}`],
                ['Municipality', program.municipality?.name || 'N/A'],
                ['Barangay', program.barangay?.name || 'All Barangays'],
                ['Visibility', program.isPublic ? 'Public' : 'Internal'],
              ].map(([label, val]) => (
                <div key={label}>
                  <dt className="text-gray-400 dark:text-gray-500 text-xs">{label}</dt>
                  <dd className="font-medium text-gray-800 dark:text-gray-200">{val}</dd>
                </div>
              ))}
              {program.budgetRef && (
                <div>
                  <dt className="text-gray-400 dark:text-gray-500 text-xs">Linked Budget</dt>
                  <dd className="font-medium text-navy-700">
                    <Link to={`/budgets/${program.budgetRef._id}`} className="flex items-center gap-1 hover:underline">
                      <Link2 size={12} />
                      {program.budgetRef.title} (FY {program.budgetRef.fiscalYear})
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {program.budgetRef && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Link2 size={14} className="text-gray-400 dark:text-gray-500" /> Budget Utilization
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Allocated</span>
                  <span className="font-medium">{formatCurrency(program.budget)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Spent</span>
                  <span className="font-medium text-red-600">{formatCurrency(program.actualExpenses || 0)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-2">
                  <span className="text-gray-500 dark:text-gray-400">Remaining</span>
                  <span className="font-semibold text-green-700">{formatCurrency(program.budget - (program.actualExpenses || 0))}</span>
                </div>
                <div className="mt-2">
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-navy-700 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((program.actualExpenses || 0) / program.budget) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">
                    {Math.round(((program.actualExpenses || 0) / program.budget) * 100)}% utilized
                  </p>
                </div>
              </div>
            </div>
          )}

          {program.assignedOfficers?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Assigned Officers</h2>
              <div className="space-y-2">
                {program.assignedOfficers.map((o) => (
                  <div key={o._id} className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-navy-100 rounded-full flex items-center justify-center">
                      <span className="text-navy-700 font-bold text-xs">{o.firstName?.[0]}{o.lastName?.[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{o.firstName} {o.lastName}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{o.role?.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
