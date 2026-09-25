import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Target, Eye, Edit, Trash2, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { programService } from '../../services/programService';
import StatusBadge from '../../components/shared/StatusBadge';
import SearchInput from '../../components/shared/SearchInput';
import { PaginationBtn } from '../../components/shared/DataTable';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { PROGRAM_CATEGORIES, PROGRAM_EDITORS, BARANGAY_BOUND_ROLES } from '../../utils/constants';
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
  const [filters, setFilters] = useState({ page: 1, limit: 12, search: '', status: '', approvalStatus: '', category: '', municipality: '', barangay: '' });

  // Debouncing lives in SearchInput now. This page had the original hand-rolled copy, written
  // before the behaviour was extracted for the funds pages; keeping it meant two implementations
  // of the same 300ms pause, and only one of them gained the clear button.

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
    filters.search || filters.status || filters.approvalStatus || filters.category || filters.municipality || filters.barangay
  );

  // Only fetched for the roles that can act on it.
  const { data: municipalities = [] } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
    enabled: isCrossMunicipality,
  });
  /*
   * Barangay filter options.
   *
   * Scoped to the municipality in play: a province-wide account gets the barangays of whichever
   * municipality it has filtered to (and every barangay in the province, grouped, when it has not),
   * while everyone else gets their own municipality's. Offering all 178 barangays of the province to
   * a Boac officer would be a list in which almost every choice returns nothing.
   *
   * An account already confined to one barangay is not offered the filter at all — the server pins
   * it, so a control whose every other option is silently discarded would be a lie.
   */
  const ownBarangayId = user?.barangay?._id || user?.barangay || null;
  const isBarangayBound = BARANGAY_BOUND_ROLES.includes(user?.role) && Boolean(ownBarangayId);
  const barangayMunicipalityId = isCrossMunicipality
    ? filters.municipality
    : (user?.municipality?._id || user?.municipality);

  const { data: barangayOptions = [] } = useQuery({
    queryKey: ['barangays', barangayMunicipalityId || 'province'],
    queryFn: () => (barangayMunicipalityId
      ? municipalityService.getBarangays(barangayMunicipalityId).then((r) => r.data.data)
      : municipalityService.getAllBarangays().then((r) => r.data.data)),
    enabled: !isBarangayBound,
  });

  // SearchInput mirrors `value`, so clearing the filter clears the box — no separate reset needed.
  const clearFilters = () => {
    setFilters({ page: 1, limit: 12, search: '', status: '', approvalStatus: '', category: '', municipality: '', barangay: '' });
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
          <SearchInput
            id="program-search"
            label="Search programs"
            placeholder="Search programs..."
            value={filters.search}
            onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
          />

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

          {/*
            * Barangay filter. Hidden for an account already confined to one — the server pins that
            * value, so every option but their own would be discarded without explanation.
            *
            * The options follow the municipality filter above: pick Mogpog and the list becomes
            * Mogpog's barangays. A province-wide account with no municipality chosen gets every
            * barangay in the province, grouped by municipality, because a flat list of 178 names
            * with four "Poblacion" entries in it cannot be read.
            */}
          {!isBarangayBound && (
            <div>
              <label htmlFor="filter-barangay" className="sr-only">Filter by barangay</label>
              <select
                id="filter-barangay"
                value={filters.barangay}
                onChange={(e) => setFilters({ ...filters, barangay: e.target.value, page: 1 })}
                className="max-w-[12rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="">All barangays</option>
                {barangayMunicipalityId || !isCrossMunicipality
                  ? barangayOptions.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)
                  : Object.entries(
                    barangayOptions.reduce((groups, b) => {
                      const name = b.municipality?.name || 'Other';
                      (groups[name] = groups[name] || []).push(b);
                      return groups;
                    }, {})
                  ).map(([municipalityName, list]) => (
                    <optgroup key={municipalityName} label={municipalityName}>
                      {list.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </optgroup>
                  ))}
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
          {/*
            * A table, not a grid of cards.
            *
            * Every programme carries the same eight facts, and as cards they were laid out as prose:
            * the municipality in small text at the bottom, the category behind an unlabelled icon,
            * dates and participants in a 2x2 block. Nothing lined up between cards, so the list could
            * not be scanned down a column — which is what someone comparing twelve programmes is
            * trying to do. The target barangay had no place at all, and it is now a column.
            *
            * The table scrolls inside its own container on a narrow screen; the page never scrolls
            * sideways. Progress keeps its bar, because a percentage is read faster as a length.
            */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="overflow-x-auto">
              <table className="data-table w-full min-w-[64rem]">
                <caption className="sr-only">
                  Programs, with municipality, target barangay, status, dates, budget and progress
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Program</th>
                    <th scope="col">Municipality</th>
                    <th scope="col">Barangay</th>
                    <th scope="col">Status</th>
                    <th scope="col">Dates</th>
                    <th scope="col" className="cell-numeric">Budget</th>
                    <th scope="col" className="cell-numeric">Participants</th>
                    <th scope="col">Progress</th>
                    <th scope="col">Created by</th>
                    <th scope="col" className="w-[6.5rem]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.map((program) => (
                    <tr key={program._id}>
                      <td className="max-w-[18rem]">
                        <Link
                          to={`/programs/${program._id}`}
                          className="text-sm font-medium text-gray-900 hover:text-navy-700 dark:text-white dark:hover:text-navy-300"
                        >
                          {program.title}
                        </Link>
                        <p className="meta-text capitalize">{program.category?.replace(/_/g, ' ')}</p>
                      </td>
                      <td className="whitespace-nowrap">{program.municipality?.name || '—'}</td>
                      {/*
                        * No barangay means municipality-wide, which is a real and common state — not
                        * missing data, so it is not shown as a dash.
                        */}
                      <td className="whitespace-nowrap">
                        {program.barangay?.name || <span className="meta-text">All barangays</span>}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={program.status} />
                          {/* Lifecycle and approval are different facts: a programme can be approved
                              and ongoing at once. Approved is unremarkable and stays quiet. */}
                          {program.approvalStatus && program.approvalStatus !== 'approved' && (
                            <StatusBadge status={program.approvalStatus} />
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {formatDate(program.startDate)}
                        <span className="meta-text"> to {formatDate(program.endDate)}</span>
                      </td>
                      <td className="cell-numeric">{formatCurrency(program.budget)}</td>
                      <td className="cell-numeric">
                        {program.actualParticipants}/{program.targetParticipants}
                      </td>
                      <td className="min-w-[7rem]">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 w-16 shrink-0 rounded-full bg-gray-100 dark:bg-gray-700"
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
                          <span className="numeric text-xs text-gray-700 dark:text-gray-300">{program.completionRate || 0}%</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {program.createdBy ? `${program.createdBy.firstName} ${program.createdBy.lastName}` : '—'}
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          {/* Names carry the programme title, so the controls are unambiguous in a
                              list read one row at a time by a screen reader. */}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
