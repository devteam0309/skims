import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, BarChart3, Users, Banknote } from 'lucide-react';
import { reportService } from '../../services/documentService';
import { toast } from '../../components/ui/toaster';

const REPORT_TYPES = [
  {
    id: 'programs',
    icon: BarChart3,
    title: 'Program Accomplishment Report',
    description: 'Comprehensive report on all programs including status, budget, and completion rates',
    formats: ['json', 'pdf', 'excel'],
  },
  {
    id: 'financial',
    icon: Banknote,
    title: 'Financial Report',
    description: 'Budget allocation, expenses, and liquidation summary in COA-ready format',
    formats: ['json', 'excel'],
  },
  {
    id: 'youth',
    icon: Users,
    title: 'Youth Engagement Report',
    description: 'Demographics, program participation, and engagement statistics',
    formats: ['json'],
  },
];

const TEMPLATES = [
  { name: 'ABYIP Template', key: 'abyip', desc: 'Annual Barangay Youth Investment Program format' },
  { name: 'CBYDP Template', key: 'cbydp', desc: 'Comprehensive Barangay Youth Development Program' },
  { name: 'SK Accomplishment Report', key: 'sk-accomplishment', desc: 'Standard DILG accomplishment report format' },
  { name: 'COA Liquidation Form', key: 'coa-liquidation', desc: 'Commission on Audit standard liquidation report' },
];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Anchors must be in the document before being clicked — a detached one is ignored by Firefox,
 * and revoking the object URL in the same tick can cancel the transfer. This mirrors what the
 * documents page already does; the reports page did neither.
 */
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export default function Reports() {
  const [generating, setGenerating] = useState({});
  const [downloadingTemplate, setDownloadingTemplate] = useState({});
  const reduceMotion = useReducedMotion();

  const currentYear = new Date().getFullYear();
  // Guard the length: before 2023 this produced an empty list and a select with no options.
  const FISCAL_YEARS = Array.from({ length: Math.max(1, currentYear - 2022) }, (_, i) => 2023 + i);
  const [fiscalYear, setFiscalYear] = useState(currentYear.toString());

  const downloadTemplate = async (key, name) => {
    setDownloadingTemplate((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await reportService.downloadTemplate(key);
      saveBlob(new Blob([res.data], { type: XLSX_MIME }), `skims-template-${key}.xlsx`);
      toast.success(`${name} downloaded`);
    } catch (err) {
      toast.error(err.message || 'Failed to download template');
    } finally {
      setDownloadingTemplate((prev) => ({ ...prev, [key]: false }));
    }
  };

  const generateReport = async (type, format) => {
    const key = `${type}-${format}`;
    /*
     * Functional updates, because `generating` is captured at render.
     *
     * Both writes previously spread the value from the render that created the handler, so
     * starting a second report while the first was still running reset the first one's flag back
     * to false, and whichever finished first cleared the other's "Generating..." label. The
     * template list next to it already did this correctly.
     */
    setGenerating((prev) => ({ ...prev, [key]: true }));

    try {
      const params = { format, fiscalYear };
      let res;
      if (type === 'programs') res = await reportService.generatePrograms(params);
      else if (type === 'financial') res = await reportService.generateFinancial(params);
      else res = await reportService.generateYouth(params);

      let blob;
      let ext;
      if (format === 'pdf') {
        blob = new Blob([res.data], { type: 'application/pdf' });
        ext = 'pdf';
      } else if (format === 'excel') {
        blob = new Blob([res.data], { type: XLSX_MIME });
        ext = 'xlsx';
      } else {
        const payload = res.data?.data ?? res.data;
        blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        ext = 'json';
      }

      saveBlob(blob, `skims-${type}-report-${fiscalYear}.${ext}`);
      toast.success('Report downloaded');
    } catch (err) {
      // The reason was discarded, so a permission problem and a server fault looked identical.
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setGenerating((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Report Generation</h1>
        <p className="page-subtitle">Generate standardized reports for compliance and transparency</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <label htmlFor="fiscal-year" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Fiscal Year
        </label>
        <select
          id="fiscal-year"
          value={fiscalYear}
          onChange={(e) => setFiscalYear(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
        >
          {FISCAL_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <p className="field-hint">Applies to every report generated below.</p>
      </div>

      {/*
        The three cards were tinted navy, green and purple. The colours encoded nothing — they
        were not report status, urgency or category — and purple belongs to no tone in the
        vocabulary. Identical cards let the titles do the distinguishing.
      */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {REPORT_TYPES.map((report, i) => (
          <motion.section
            key={report.id}
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { delay: i * 0.1 }}
            className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-100 text-navy-700 dark:bg-navy-500/20 dark:text-navy-300">
                <report.icon size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{report.title}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{report.description}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {report.formats.map((fmt) => {
                const busy = generating[`${report.id}-${fmt}`];
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => generateReport(report.id, fmt)}
                    disabled={busy}
                    // Was "PDF" alone, repeated across three cards — nine buttons whose names
                    // gave no clue which report they produced.
                    aria-label={`Download ${report.title} as ${fmt.toUpperCase()} for fiscal year ${fiscalYear}`}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-navy-400 hover:bg-navy-50 hover:text-navy-700 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-navy-900/20"
                  >
                    <Download size={12} aria-hidden="true" />
                    {busy ? 'Generating...' : fmt.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </motion.section>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="section-heading mb-1">DILG Compliance Templates</h2>
        <p className="meta-text mb-4">Pre-formatted Excel templates ready to fill in and submit</p>
        <ul className="grid gap-3 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <li key={template.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{template.name}</p>
                <p className="meta-text">{template.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => downloadTemplate(template.key, template.name)}
                disabled={downloadingTemplate[template.key]}
                aria-label={`Download ${template.name} as Excel`}
                title={`Download ${template.name}`}
                className="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-navy-50 hover:text-navy-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-navy-900/20 dark:hover:text-navy-300"
              >
                <Download size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
