import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  MapPin, Target, Banknote, Users, FileText, Megaphone, Download,
  Calendar, ChevronDown, Pin, AlertCircle,
} from 'lucide-react';
import { publicService } from '../../services/documentService';
import { formatCurrency, formatDate } from '../../utils/formatters';
import StatusBadge from '../../components/shared/StatusBadge';

/*
 * This page is deliberately light-only: PublicLayout carries no dark variants, and the portal is
 * the province's public face rather than part of the signed-in app.
 */
export default function PublicPortal() {
  const [programLimit, setProgramLimit] = useState(6);
  const [docLimit, setDocLimit] = useState(6);
  const [announcementLimit, setAnnouncementLimit] = useState(5);
  const reduceMotion = useReducedMotion();

  const statsQuery = useQuery({ queryKey: ['public-stats'], queryFn: () => publicService.getStats().then((r) => r.data.data) });
  const programsQuery = useQuery({ queryKey: ['public-programs', programLimit], queryFn: () => publicService.getPrograms({ limit: programLimit }).then((r) => r.data) });
  const announcementsQuery = useQuery({ queryKey: ['public-announcements', announcementLimit], queryFn: () => publicService.getAnnouncements({ limit: announcementLimit }).then((r) => r.data) });
  const budgetsQuery = useQuery({ queryKey: ['public-budget'], queryFn: () => publicService.getBudgetSummary().then((r) => r.data.data) });
  const docsQuery = useQuery({ queryKey: ['public-docs', docLimit], queryFn: () => publicService.getDocuments({ limit: docLimit }).then((r) => r.data) });

  const stats = statsQuery.data;
  const programs = programsQuery.data;
  const announcements = announcementsQuery.data;
  const budgets = budgetsQuery.data;
  const docs = docsQuery.data;

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

  return (
    <div>
      <section className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-950 px-4 py-20 text-white">
        <div className="mx-auto max-w-5xl text-center">
          <motion.div initial={reduceMotion ? false : { opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/20 px-4 py-2 text-sm font-medium text-gold-400">
              <MapPin size={14} aria-hidden="true" />Marinduque, Philippines
            </p>
            <h1 className="mb-4 text-4xl font-black leading-tight md:text-5xl">
              Sangguniang Kabataan<br /><span className="text-gold-500">Transparency Portal</span>
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-navy-300">
              Empowering youth governance through transparency. Track programs, budgets, and
              activities of SK offices in Marinduque.
            </p>
          </motion.div>

          {/* Three columns at any width squeezed the figures on a phone, which is most of this
              page's audience. */}
          <dl className="mx-auto mt-12 grid max-w-lg grid-cols-1 gap-6 sm:grid-cols-3">
            {statsQuery.isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="text-center">
                  <div className="mx-auto h-9 w-16 animate-pulse rounded bg-white/10" />
                  <div className="mx-auto mt-2 h-4 w-24 animate-pulse rounded bg-white/10" />
                </div>
              ))
              : stats && [
                { label: 'Total Programs', value: stats.totalPrograms },
                { label: 'Completed', value: stats.completedPrograms },
                { label: 'Municipalities', value: stats.totalMunicipalities },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <dd className="numeric text-3xl font-black text-white">{s.value ?? '—'}</dd>
                  <dt className="text-sm text-navy-300">{s.label}</dt>
                </div>
              ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12">
        <PortalSection
          id="announcements"
          icon={Megaphone}
          title="Latest Announcements"
          query={announcementsQuery}
          isEmpty={!announcements?.data?.length}
          emptyText="No announcements have been published yet."
          skeletonRows={3}
        >
          <div className="space-y-3">
            {announcements?.data?.map((a) => (
              <motion.article
                key={a._id}
                {...fade}
                className={`rounded-xl border p-4 shadow-sm ${a.isPinned ? 'border-gold-300 bg-gold-50/30' : 'border-gray-200 bg-white'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {a.isPinned && (
                        // Was a 📌 emoji, which renders differently on every platform and matches
                        // nothing else in the app — the same reason it was removed from DataTable.
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-xs font-medium text-gold-700">
                          <Pin size={10} aria-hidden="true" />Pinned
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.type === 'deadline' ? 'bg-amber-100 text-amber-800'
                          : a.type === 'alert' ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-700'
                      }`}>
                        {a.type?.charAt(0).toUpperCase() + a.type?.slice(1)}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900">{a.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{a.content}</p>
                    {a.eventDate && (
                      <p className="mt-2 flex items-center gap-1 text-xs font-medium text-navy-700">
                        <Calendar size={12} aria-hidden="true" /> Event: {formatDate(a.eventDate)}
                        {a.eventLocation && ` · ${a.eventLocation}`}
                      </p>
                    )}
                  </div>
                  <p className="meta-text shrink-0">{formatDate(a.createdAt)}</p>
                </div>
              </motion.article>
            ))}
          </div>

          <LoadMore
            query={announcementsQuery}
            shown={announcements?.data?.length}
            total={announcements?.meta?.total}
            onClick={() => setAnnouncementLimit((l) => l + 5)}
            label="Announcements"
          />
        </PortalSection>

        <PortalSection
          id="programs"
          icon={Target}
          title="Youth Programs"
          query={programsQuery}
          isEmpty={!programs?.data?.length}
          emptyText="No programs have been published yet."
          skeletonRows={6}
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {programs?.data?.map((p) => (
              <motion.article key={p._id} {...fade} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <StatusBadge status={p.status} />
                  <span className="text-xs capitalize text-gray-500">{p.category?.replace(/_/g, ' ')}</span>
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{p.title}</h3>
                <p className="mb-3 line-clamp-2 text-xs text-gray-600">{p.description}</p>

                <dl className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <Fact icon={Banknote} label="Budget"><span className="numeric">{formatCurrency(p.budget)}</span></Fact>
                  <Fact icon={Users} label="Participants">
                    <span className="numeric">{p.actualParticipants ?? 0}/{p.targetParticipants ?? 0}</span>
                  </Fact>
                  <Fact icon={MapPin} label="Municipality">{p.municipality?.name || '—'}</Fact>
                  <Fact icon={Calendar} label="Ends">{formatDate(p.endDate)}</Fact>
                </dl>

                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100"
                  role="progressbar"
                  aria-valuenow={p.completionRate || 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${p.title} completion`}
                >
                  <div className="h-full rounded-full bg-navy-700" style={{ width: `${Math.min(p.completionRate || 0, 100)}%` }} />
                </div>
                <p className="meta-text mt-1 text-right"><span className="numeric">{p.completionRate || 0}</span>% complete</p>
              </motion.article>
            ))}
          </div>

          <LoadMore
            query={programsQuery}
            shown={programs?.data?.length}
            total={programs?.meta?.total}
            onClick={() => setProgramLimit((l) => l + 6)}
            label="Programs"
          />
        </PortalSection>

        <PortalSection
          id="budget"
          icon={Banknote}
          title="Budget Transparency"
          query={budgetsQuery}
          isEmpty={!budgets?.length}
          emptyText="No budget figures have been published yet."
          skeletonRows={4}
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {budgets?.map((b) => {
              const utilization = b.totalBudget > 0 ? Math.round((b.disbursed / b.totalBudget) * 100) : null;
              return (
                <div key={b._id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-3 font-semibold text-gray-900">{b.municipality?.name}</p>
                  {/* One quantity split three ways. Disbursed was green and Remaining blue,
                      implying a status difference that does not exist — the same correction
                      already made on the internal budgets table. */}
                  <dl className="space-y-2 text-xs">
                    <BudgetRow label="Total Budget" value={formatCurrency(b.totalBudget)} />
                    <BudgetRow label="Disbursed" value={formatCurrency(b.disbursed)} />
                    <BudgetRow label="Remaining" value={formatCurrency(b.remaining)} />
                  </dl>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"
                    role="progressbar"
                    aria-valuenow={utilization ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${b.municipality?.name || 'Municipality'} budget utilization`}
                  >
                    <div className="h-full rounded-full bg-navy-700" style={{ width: `${Math.min(utilization ?? 0, 100)}%` }} />
                  </div>
                  <p className="meta-text mt-1 text-right">
                    {utilization === null ? 'No budget recorded' : `${utilization}% disbursed`}
                  </p>
                </div>
              );
            })}
          </div>
        </PortalSection>

        <PortalSection
          icon={FileText}
          title="Public Documents"
          query={docsQuery}
          isEmpty={!docs?.data?.length}
          emptyText="No documents have been published yet."
          skeletonRows={4}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {docs?.data?.map((d) => (
              <div key={d._id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{d.title}</p>
                  <p className="meta-text mt-0.5 capitalize">
                    {d.category?.replace(/_/g, ' ')} · {formatDate(d.createdAt)}
                  </p>
                </div>
                {/* An icon-only link with no text announced as just "link", repeated down the
                    whole list with no way to tell which document each one fetched. */}
                <a
                  href={`/api/public/documents/${d._id}/download`}
                  aria-label={`Download ${d.title}`}
                  title={`Download ${d.title}`}
                  className="shrink-0 rounded-lg p-2 text-navy-700 transition-colors hover:bg-navy-50"
                >
                  <Download size={16} aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>

          <LoadMore
            query={docsQuery}
            shown={docs?.data?.length}
            total={docs?.meta?.total}
            onClick={() => setDocLimit((l) => l + 6)}
            label="Documents"
          />
        </PortalSection>
      </div>
    </div>
  );
}

/**
 * One section of the portal, including what to show while it is loading and when it fails.
 *
 * Every section previously rendered only on `data?.length > 0`, so during loading — and after any
 * error — it simply was not there. A visitor on a slow connection got a hero banner above an
 * empty page, with nothing to say whether the province had published nothing or the site was
 * broken. The programs section was the reverse: its heading always rendered, above an empty grid.
 */
function PortalSection({ id, icon: Icon, title, query, isEmpty, emptyText, skeletonRows = 3, children }) {
  return (
    <section id={id}>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-100">
          <Icon size={16} className="text-navy-700" aria-hidden="true" />
        </span>
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
      </div>

      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading {title}…</span>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
              <div className="mt-3 h-3 w-full animate-pulse rounded bg-gray-100" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-amber-800">This section could not be loaded.</p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-1 text-sm font-medium text-amber-800 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      ) : isEmpty ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          {emptyText}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function LoadMore({ query, shown, total, onClick, label }) {
  if (!total || !shown || shown >= total) return null;
  return (
    <div className="mt-6 text-center">
      <button
        type="button"
        onClick={onClick}
        // Refetching gave no sign it was working, so a slow connection invited repeat clicks.
        disabled={query.isFetching}
        className="inline-flex items-center gap-2 rounded-xl border border-navy-200 px-5 py-2.5 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 disabled:opacity-60"
      >
        <ChevronDown size={16} aria-hidden="true" />
        {query.isFetching ? 'Loading…' : `Load More ${label}`}
      </button>
      <p className="meta-text mt-2">
        Showing <span className="numeric">{shown}</span> of <span className="numeric">{total}</span>
      </p>
    </div>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-1">
      <Icon size={10} aria-hidden="true" className="shrink-0 text-gray-400" />
      <dt className="sr-only">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function BudgetRow({ label, value }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="numeric font-semibold text-gray-900">{value}</dd>
    </div>
  );
}
