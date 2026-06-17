import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MapPin, Target, Banknote, Users, FileText, Megaphone, Download, Calendar, TrendingUp, ChevronDown } from 'lucide-react';
import { publicService } from '../../services/documentService';
import { formatCurrency, formatDate } from '../../utils/formatters';
import StatusBadge from '../../components/shared/StatusBadge';

export default function PublicPortal() {
  const [programLimit, setProgramLimit] = useState(6);
  const [docLimit, setDocLimit] = useState(6);
  const [announcementLimit, setAnnouncementLimit] = useState(5);

  const { data: stats } = useQuery({ queryKey: ['public-stats'], queryFn: () => publicService.getStats().then((r) => r.data.data) });
  const { data: programs } = useQuery({ queryKey: ['public-programs', programLimit], queryFn: () => publicService.getPrograms({ limit: programLimit }).then((r) => r.data) });
  const { data: announcements } = useQuery({ queryKey: ['public-announcements', announcementLimit], queryFn: () => publicService.getAnnouncements({ limit: announcementLimit }).then((r) => r.data) });
  const { data: budgets } = useQuery({ queryKey: ['public-budget'], queryFn: () => publicService.getBudgetSummary().then((r) => r.data.data) });
  const { data: docs } = useQuery({ queryKey: ['public-docs', docLimit], queryFn: () => publicService.getDocuments({ limit: docLimit, isPublic: true }).then((r) => r.data) });

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-950 text-white py-20 px-4">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-2 bg-gold-500/20 border border-gold-500/30 text-gold-400 text-sm font-medium px-4 py-2 rounded-full mb-6">
              <MapPin size={14} />Marinduque, Philippines
            </div>
            <h1 className="text-4xl md:text-5xl font-black mb-4 leading-tight">
              Sangguniang Kabataan<br /><span className="text-gold-500">Transparency Portal</span>
            </h1>
            <p className="text-navy-300 text-lg max-w-2xl mx-auto">
              Empowering youth governance through transparency. Track programs, budgets, and activities of SK offices in Marinduque.
            </p>
          </motion.div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-6 mt-12 max-w-lg mx-auto">
              {[
                { label: 'Total Programs', value: stats.totalPrograms, icon: Target },
                { label: 'Completed', value: stats.completedPrograms, icon: TrendingUp },
                { label: 'Municipalities', value: stats.totalMunicipalities, icon: MapPin },
              ].map((s) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                  className="text-center">
                  <p className="text-3xl font-black text-white">{s.value}</p>
                  <p className="text-navy-400 text-sm">{s.label}</p>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 py-12 space-y-16">
        {/* Announcements */}
        {announcements?.data?.length > 0 && (
          <section id="announcements">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-navy-100 rounded-lg flex items-center justify-center">
                <Megaphone size={16} className="text-navy-700" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Latest Announcements</h2>
            </div>
            <div className="space-y-3">
              {announcements.data.map((a) => (
                <motion.div key={a._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className={`bg-white rounded-xl border p-4 shadow-sm ${a.isPinned ? 'border-gold-300 bg-gold-50/30' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {a.isPinned && <span className="text-xs bg-gold-100 text-gold-700 px-2 py-0.5 rounded-full font-medium">📌 Pinned</span>}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${a.type === 'event' ? 'bg-blue-100 text-blue-700' : a.type === 'deadline' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                          {a.type?.charAt(0).toUpperCase() + a.type?.slice(1)}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900">{a.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{a.content}</p>
                      {a.eventDate && (
                        <p className="text-xs text-navy-600 font-medium mt-2 flex items-center gap-1">
                          <Calendar size={12} /> Event: {formatDate(a.eventDate)} {a.eventLocation && `· ${a.eventLocation}`}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0">{formatDate(a.createdAt)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            {announcements?.meta?.total > announcementLimit && (
              <div className="text-center mt-4">
                <button onClick={() => setAnnouncementLimit((l) => l + 5)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-navy-200 text-navy-700 rounded-xl text-sm font-medium hover:bg-navy-50 transition-colors">
                  <ChevronDown size={16} />Load More Announcements
                </button>
              </div>
            )}
          </section>
        )}

        {/* Programs */}
        <section id="programs">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-navy-100 rounded-lg flex items-center justify-center">
              <Target size={16} className="text-navy-700" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Youth Programs</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {programs?.data?.map((p) => (
              <motion.div key={p._id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <StatusBadge status={p.status} />
                  <span className="text-xs text-gray-400 capitalize">{p.category?.replace(/_/g, ' ')}</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{p.title}</h3>
                <p className="text-xs text-gray-500 line-clamp-2 mb-3">{p.description}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Banknote size={10} />{formatCurrency(p.budget)}</span>
                  <span className="flex items-center gap-1"><Users size={10} />{p.actualParticipants}/{p.targetParticipants}</span>
                  <span className="flex items-center gap-1"><MapPin size={10} />{p.municipality?.name}</span>
                  <span className="flex items-center gap-1"><Calendar size={10} />{formatDate(p.endDate)}</span>
                </div>
                <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-navy-700 rounded-full" style={{ width: `${p.completionRate || 0}%` }} />
                </div>
                <p className="text-xs text-right text-gray-400 mt-1">{p.completionRate || 0}% complete</p>
              </motion.div>
            ))}
          </div>
          {programs?.meta?.total > programLimit && (
            <div className="text-center mt-6">
              <button onClick={() => setProgramLimit((l) => l + 6)}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-navy-200 text-navy-700 rounded-xl text-sm font-medium hover:bg-navy-50 transition-colors">
                <ChevronDown size={16} />Load More Programs
              </button>
            </div>
          )}
        </section>

        {/* Budget transparency */}
        {budgets?.length > 0 && (
          <section id="budget">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-navy-100 rounded-lg flex items-center justify-center">
                <Banknote size={16} className="text-navy-700" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Budget Transparency</h2>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {budgets.map((b) => (
                <div key={b._id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="font-semibold text-gray-900 mb-3">{b.municipality?.name}</p>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs"><span className="text-gray-500">Total Budget</span><span className="font-semibold">{formatCurrency(b.totalBudget)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-500">Disbursed</span><span className="font-semibold text-green-600">{formatCurrency(b.disbursed)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-500">Remaining</span><span className="font-semibold text-blue-600">{formatCurrency(b.remaining)}</span></div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full mt-3 overflow-hidden">
                    <div className="h-full bg-navy-700 rounded-full" style={{ width: `${b.totalBudget ? (b.disbursed / b.totalBudget * 100).toFixed(0) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Public documents */}
        {docs?.data?.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-navy-100 rounded-lg flex items-center justify-center">
                <FileText size={16} className="text-navy-700" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Public Documents</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {docs.data.map((d) => (
                <div key={d._id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{d.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 capitalize">{d.category?.replace(/_/g, ' ')} · {formatDate(d.createdAt)}</p>
                  </div>
                  <a href={`/api/public/documents/${d._id}/download`}
                    className="p-2 text-navy-700 hover:bg-navy-50 rounded-lg transition-colors">
                    <Download size={16} />
                  </a>
                </div>
              ))}
            </div>
            {docs?.meta?.total > docLimit && (
              <div className="text-center mt-4">
                <button onClick={() => setDocLimit((l) => l + 6)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-navy-200 text-navy-700 rounded-xl text-sm font-medium hover:bg-navy-50 transition-colors">
                  <ChevronDown size={16} />Load More Documents
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
