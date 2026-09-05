import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Target, Calendar, Banknote, Users,
  Eye, Edit, Trash2, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { programService } from '../../services/programService';
import StatusBadge from '../../components/shared/StatusBadge';
import { PaginationBtn } from '../../components/shared/DataTable';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { PROGRAM_CATEGORIES, PROGRAM_EDITORS } from '../../utils/constants';
import { municipalityService } from '../../services/documentService';
import { toast } from '../../components/ui/toaster';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';

const STATUSES = ['planned', 'ongoing', 'delayed', 'completed', 'cancelled'];
const APPROVAL_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

// Province-wide roles only. Everyone else is already pinned to their own municipality by the
// server, so offering them the filter would imply a choice they do not have.
const CROSS_MUNICIPALITY_ROLES = ['super_admin', 'provincial_admin'];

export default function Programs() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 12, search: '', status: '', approvalStatus: '', category: '', municipality: '' });

  /*
   * The search box is bound to local state and only pushed into the query key after a pause.
   * Previously every keystroke changed the query key and fired a request, so typing
   * "livelihood" issued ten requests, raced their responses, and counted ten hits against the
   * API rate limiter. The input stays fully responsive because it renders from local state.
   */
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput, page: 1 }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['programs', filters],
    queryFn: () => programService.getAll(filters).then((r) => r.data),
  });

  // Server-side aggregated counts — independent of the current page / active filters
  const { data: stats } = useQuery({
    // Keyed on municipality so the headline count matches the list an admin is actually looking
    // at; otherwise filtering to Mogpog left a province-wide total above Mogpog's programs.
    queryKey: ['program-stats', filters.municipality],
    queryFn: () => programService.getStats(
      filters.municipality ? { municipality: filters.municipality } : undefined
    ).then((r) => r.data.data),
  });
  const statusCounts = Object.fromEntries((stats?.byStatus || []).map((s) => [s._id, s.count]));

  /*
   * Built from the categories that actually exist in the data rather than the fixed constant.
   * Categories are free text now, so a municipality that typed its own would otherwise have no way
   * to filter by it — the dropdown would list ten options that its programs do not use.
   */
  const categoryOptions = (stats?.byCategory || [])
    .filter((c) => c._id)
    .map((c) => ({
      value: c._id,
      label: PROGRAM_CATEGORIES.find((p) => p.value === c._id)?.label
        || c._id.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
    }));

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
  const isCrossMunicipality = CROSS_MUNICIPALITY_ROLES.includes(user?.role);
  const hasFilters = Boolean(
    filters.search || filters.status || filters.approvalStatus || filters.category || filters.municipality
  );

  // Only fetched for the roles that can act on it.
  const { data: municipalities = [] } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
    enabled: isCrossMunicipality,
  });

  const clearFilters = () => {
    setSearchInput('');
    setFilters({ page: 1, limit: 12, search: '', status: '', approvalStatus: '', category: '', municipality: '' });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Programs</h1>
          {/* The completed total was only reachable by reading one chip out of five. Stated here
              because "how many have we finished" is the question the page is usually opened for. */}
          <p className="page-subtitle">
            <span className="numeric font-semibold text-gray-700 dark:text-gray-200">{stats?.completed ?? 0}</span>
            {' of '}
            <span className="numeric font-semibold text-gray-700 dark:text-gray-200">{stats?.total ?? 0}</span>
            {' programs completed'}
            {isCrossMunicipality && !filters.municipality && ' across all municipalities'}
          </p>
        </div>
        {canCreate && (
          <Link
            to="/programs/new"
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Plus size={16} aria-hidden="true" />
            New Program
          </Link>
        )}
      </div>

      <section aria-label="Filter programs" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-navy-700 dark:border-gray-600 dark:bg-gray-700">
            <Search size={15} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
            <label htmlFor="program-search" className="sr-only">Search programs</label>
            <input
              id="program-search"
              type="search"
              placeholder="Search programs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none dark:text-gray-200"
            />
          </div>

          {/* Selects previously had no accessible name at all — a screen reader announced only
              the current value, giving no clue what it filtered. */}
          <div>
            <label htmlFor="filter-status" className="sr-only">Filter by status</label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="filter-category" className="sr-only">Filter by category</label>
            <select
              id="filter-category"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Categories</option>
              {categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="filter-approval" className="sr-only">Filter by approval state</label>
            <select
              id="filter-approval"
              value={filters.approvalStatus}
              onChange={(e) => setFilters({ ...filters, approvalStatus: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Approvals</option>
              {APPROVAL_STATUSES.map((a) => (
                <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Programs are municipality-isolated on the server for every other role, so this only
              appears for the two that genuinely see more than one. */}
          {isCrossMunicipality && (
            <div>
              <label htmlFor="filter-municipality" className="sr-only">Filter by municipality</label>
              <select
                id="filter-municipality"
                value={filters.municipality}
                onChange={(e) => setFilters({ ...filters, municipality: e.target.value, page: 1 })}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="">All Municipalities</option>
                {municipalities.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
            </div>
          )}

          {/* There was no way out of a filter combination that returned nothing. */}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <X size={14} aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Counts double as status filters. aria-pressed makes that toggle behaviour available to
          assistive tech, which previously saw five unlabelled buttons of unclear purpose. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {STATUSES.map((s) => {
          const active = filters.status === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => setFilters({ ...filters, status: active ? '' : s, page: 1 })}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                active
                  ? 'border-navy-700 bg-navy-50 dark:border-navy-400 dark:bg-navy-900/40'
                  : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
              }`}
            >
              <StatusBadge status={s} />
              <span className="numeric text-base font-semibold text-gray-900 dark:text-white">
                {statusCounts[s] || 0}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        // Skeletons in the real grid shape, so the page does not collapse and re-expand.
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="skeleton h-5 w-20 rounded-full" />
              <div className="skeleton mt-3 h-4 w-3/4" />
              <div className="skeleton mt-2 h-3 w-full" />
              <div className="skeleton mt-4 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : data?.data?.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center dark:border-gray-700 dark:bg-gray-800">
          <Target size={24} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No programs found</p>
          {/* Distinguishes "nothing matches your filters" from "nothing exists yet" — the two
              need completely different next actions. */}
          {hasFilters ? (
            <button type="button" onClick={clearFilters} className="mt-3 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300">
              Clear filters
            </button>
          ) : canCreate && (
            <Link to="/programs/new" className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline dark:text-navy-300">
              Create the first program
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data?.data?.map((program) => (
              <li
                key={program._id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={program.status} />
                    {/* Lifecycle and approval are different facts. A program can be approved and
                        ongoing at once, so both chips show rather than one standing in for the
                        other. Approved is the unremarkable case and stays quiet. */}
                    {program.approvalStatus && program.approvalStatus !== 'approved' && (
                      <StatusBadge status={program.approvalStatus} />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {/* Icon-only controls previously announced as bare "link" / "button".
                        Names include the program title so they are unambiguous in a list. */}
                    <IconAction as={Link} to={`/programs/${program._id}`} label={`View ${program.title}`}>
                      <Eye size={14} aria-hidden="true" />
                    </IconAction>
                    {canCreate && (
                      <>
                        <IconAction as={Link} to={`/programs/${program._id}/edit`} label={`Edit ${program.title}`} hover="hover:text-blue-600">
                          <Edit size={14} aria-hidden="true" />
                        </IconAction>
                        <IconAction onClick={() => handleDelete(program._id, program.title)} label={`Delete ${program.title}`} hover="hover:text-red-600">
                          <Trash2 size={14} aria-hidden="true" />
                        </IconAction>
                      </>
                    )}
                  </div>
                </div>

                <h2 className="mb-1 line-clamp-2 font-semibold text-gray-900 dark:text-white">
                  <Link to={`/programs/${program._id}`} className="hover:text-navy-700 dark:hover:text-navy-300">
                    {program.title}
                  </Link>
                </h2>
                <p className="mb-4 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">{program.description}</p>

                <dl className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <Fact icon={Banknote} label="Budget"><span className="numeric">{formatCurrency(program.budget)}</span></Fact>
                  <Fact icon={Users} label="Participants">
                    <span className="numeric">{program.actualParticipants}/{program.targetParticipants}</span>
                  </Fact>
                  <Fact icon={Calendar} label="Start date">{formatDate(program.startDate)}</Fact>
                  <Fact icon={Target} label="Category">
                    <span className="capitalize">{program.category?.replace(/_/g, ' ')}</span>
                  </Fact>
                </dl>

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">Completion</span>
                    <span className="numeric font-medium text-gray-900 dark:text-white">{program.completionRate || 0}%</span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700"
                    role="progressbar"
                    aria-valuenow={program.completionRate || 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${program.title} completion`}
                  >
                    <div
                      className={`h-full rounded-full ${program.status === 'delayed' ? 'bg-red-500' : 'bg-navy-700 dark:bg-navy-400'}`}
                      style={{ width: `${Math.min(program.completionRate || 0, 100)}%` }}
                    />
                  </div>
                </div>

                {program.municipality && (
                  <p className="meta-text mt-3">{program.municipality.name}</p>
                )}
              </li>
            ))}
          </ul>

          {/*
            Previously one button per page, which runs off the screen once the dataset grows and
            matched nothing else in the app. This mirrors the DataTable control used on every
            other list page, so pagination behaves the same wherever you meet it.
          */}
          {data?.meta && data.meta.pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
              <span className="meta-text">
                Page <span className="numeric font-medium text-gray-700 dark:text-gray-300">{data.meta.page}</span> of{' '}
                <span className="numeric font-medium text-gray-700 dark:text-gray-300">{data.meta.pages}</span>
                <span className="hidden sm:inline"> · {data.meta.total} programs</span>
              </span>
              <div className="flex items-center gap-1">
                <PaginationBtn onClick={() => setFilters({ ...filters, page: filters.page - 1 })} disabled={data.meta.page <= 1} label="Previous page">
                  <ChevronLeft size={14} aria-hidden="true" />
                </PaginationBtn>
                <PaginationBtn onClick={() => setFilters({ ...filters, page: filters.page + 1 })} disabled={data.meta.page >= data.meta.pages} label="Next page">
                  <ChevronRight size={14} aria-hidden="true" />
                </PaginationBtn>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
      <dt className="sr-only">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function IconAction({ as: Tag = 'button', label, hover = 'hover:text-gray-700', children, ...rest }) {
  return (
    <Tag
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
      aria-label={label}
      title={label}
      className={`rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700 ${hover}`}
    >
      {children}
    </Tag>
  );
}
