import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, Target, Calendar, Banknote, Users, MoreVertical, Eye, Edit, Trash2 } from 'lucide-react';
import { programService } from '../../services/programService';
import StatusBadge from '../../components/shared/StatusBadge';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { formatCurrency, formatDate, truncate } from '../../utils/formatters';
import { PROGRAM_CATEGORIES, PROGRAM_EDITORS } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';

const STATUSES = ['planned', 'ongoing', 'delayed', 'completed', 'cancelled'];

export default function Programs() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 12, search: '', status: '', category: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['programs', filters],
    queryFn: () => programService.getAll(filters).then((r) => r.data),
  });

  // Server-side aggregated counts — independent of the current page / active filters
  const { data: stats } = useQuery({
    queryKey: ['program-stats'],
    queryFn: () => programService.getStats().then((r) => r.data.data),
  });
  const statusCounts = Object.fromEntries((stats?.byStatus || []).map((s) => [s._id, s.count]));

  const deleteMutation = useMutation({
    mutationFn: (id) => programService.delete(id),
    onSuccess: () => { toast.success('Program deleted'); queryClient.invalidateQueries(['programs']); },
    onError: (err) => toast.error(err.message || 'Delete failed'),
  });

  const handleDelete = async (id, title) => {
    const result = await confirm.delete({ text: `"${title}" will be permanently removed.` });
    if (result.isConfirmed) deleteMutation.mutate(id);
  };

  const canCreate = PROGRAM_EDITORS.includes(user?.role);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Programs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage and track youth programs</p>
        </div>
        {canCreate && (
          <Link to="/programs/new"
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Plus size={16} />
            New Program
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-48 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2">
            <Search size={15} className="text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search programs..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
              className="bg-transparent text-sm outline-none flex-1 text-gray-600 dark:text-gray-300"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
            className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-navy-700"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}
            className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-navy-700"
          >
            <option value="">All Categories</option>
            {PROGRAM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Stats summary — counts reflect the full dataset, not just the current page */}
      <div className="grid grid-cols-5 gap-3">
        {STATUSES.map((s) => {
          const count = statusCounts[s] || 0;
          return (
            <button
              key={s}
              onClick={() => setFilters({ ...filters, status: filters.status === s ? '' : s, page: 1 })}
              className={`p-3 rounded-xl border text-center transition-all ${filters.status === s ? 'border-navy-700 bg-navy-50 dark:bg-navy-900/30' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              <StatusBadge status={s} />
              <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Programs grid */}
      {isLoading ? <PageLoader /> : (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data?.data?.map((program, i) => (
              <motion.div
                key={program._id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <StatusBadge status={program.status} />
                    <div className="flex items-center gap-1">
                      <Link to={`/programs/${program._id}`} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <Eye size={14} />
                      </Link>
                      {canCreate && (
                        <>
                          <Link to={`/programs/${program._id}/edit`} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-blue-600 transition-colors">
                            <Edit size={14} />
                          </Link>
                          <button onClick={() => handleDelete(program._id, program.title)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-red-600 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <Link to={`/programs/${program._id}`}>
                    <h3 className="font-semibold text-gray-900 dark:text-white hover:text-navy-700 transition-colors line-clamp-2 mb-1">
                      {program.title}
                    </h3>
                  </Link>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{program.description}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                      <Banknote size={12} />
                      <span>{formatCurrency(program.budget)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                      <Users size={12} />
                      <span>{program.actualParticipants}/{program.targetParticipants}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                      <Calendar size={12} />
                      <span>{formatDate(program.startDate)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                      <Target size={12} />
                      <span className="capitalize">{program.category?.replace(/_/g, ' ')}</span>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                      <span>Completion</span>
                      <span className="font-medium text-navy-700">{program.completionRate || 0}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full">
                      <div
                        className={`h-full rounded-full transition-all ${program.status === 'delayed' ? 'bg-red-500' : 'bg-navy-700'}`}
                        style={{ width: `${program.completionRate || 0}%` }}
                      />
                    </div>
                  </div>

                  {program.municipality && (
                    <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">{program.municipality.name}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {data?.data?.length === 0 && (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <Target size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No programs found</p>
              {canCreate && <Link to="/programs/new" className="mt-3 inline-block text-navy-700 text-sm font-medium hover:underline">Create the first program</Link>}
            </div>
          )}

          {/* Pagination */}
          {data?.meta && data.meta.pages > 1 && (
            <div className="flex justify-center gap-2">
              {Array.from({ length: data.meta.pages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setFilters({ ...filters, page: p })}
                  className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${p === filters.page ? 'bg-navy-900 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}

    </div>
  );
}
