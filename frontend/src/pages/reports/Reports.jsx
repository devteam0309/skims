import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, BarChart3, Users, Banknote } from 'lucide-react';
import { reportService } from '../../services/documentService';
import { toast } from '../../components/ui/toaster';

const REPORT_TYPES = [
  { id: 'programs', icon: BarChart3, title: 'Program Accomplishment Report', description: 'Comprehensive report on all programs including status, budget, and completion rates', formats: ['json', 'pdf', 'excel'], color: 'navy' },
  { id: 'financial', icon: Banknote, title: 'Financial Report', description: 'Budget allocation, expenses, and liquidation summary in COA-ready format', formats: ['json', 'excel'], color: 'green' },
  { id: 'youth', icon: Users, title: 'Youth Engagement Report', description: 'Demographics, program participation, and engagement statistics', formats: ['json'], color: 'purple' },
];

const TEMPLATES = [
  { name: 'ABYIP Template', key: 'abyip', desc: 'Annual Barangay Youth Investment Program format' },
  { name: 'CBYDP Template', key: 'cbydp', desc: 'Comprehensive Barangay Youth Development Program' },
  { name: 'SK Accomplishment Report', key: 'sk-accomplishment', desc: 'Standard DILG accomplishment report format' },
  { name: 'COA Liquidation Form', key: 'coa-liquidation', desc: 'Commission on Audit standard liquidation report' },
];

export default function Reports() {
  const [generating, setGenerating] = useState({});
  const [downloadingTemplate, setDownloadingTemplate] = useState({});
  const currentYear = new Date().getFullYear();
  const FISCAL_YEARS = Array.from({ length: currentYear - 2022 }, (_, i) => 2023 + i);
  const [filters, setFilters] = useState({ format: 'pdf', fiscalYear: currentYear.toString() });

  const downloadTemplate = async (key) => {
    setDownloadingTemplate((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await reportService.downloadTemplate(key);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skims-template-${key}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Template downloaded');
    } catch {
      toast.error('Failed to download template');
    } finally {
      setDownloadingTemplate((prev) => ({ ...prev, [key]: false }));
    }
  };

  const generateReport = async (type, format) => {
    setGenerating({ ...generating, [`${type}-${format}`]: true });
    try {
      const params = { format, fiscalYear: filters.fiscalYear };
      let res;
      if (type === 'programs') res = await reportService.generatePrograms(params);
      else if (type === 'financial') res = await reportService.generateFinancial(params);
      else res = await reportService.generateYouth(params);

      let blob, ext;
      if (format === 'pdf') {
        blob = new Blob([res.data], { type: 'application/pdf' });
        ext = 'pdf';
      } else if (format === 'excel') {
        blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        ext = 'xlsx';
      } else {
        const payload = res.data?.data ?? res.data;
        blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        ext = 'json';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skims-${type}-report-${filters.fiscalYear}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error('Failed to generate report');
    } finally {
      setGenerating({ ...generating, [`${type}-${format}`]: false });
    }
  };

  const COLORS = {
    navy: 'border-navy-200 bg-navy-50 dark:border-navy-800 dark:bg-navy-900/20',
    green: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20',
    purple: 'border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20',
  };

  const ICON_COLORS = {
    navy: 'bg-navy-100 text-navy-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Report Generation</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Generate standardized reports for compliance and transparency</p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4">
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Fiscal Year</label>
          <select value={filters.fiscalYear} onChange={(e) => setFilters({ ...filters, fiscalYear: e.target.value })}
            className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
            {FISCAL_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        {REPORT_TYPES.map((report, i) => (
          <motion.div key={report.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
            className={`bg-white dark:bg-gray-800 rounded-xl border ${COLORS[report.color]} shadow-sm p-5 hover:shadow-md transition-shadow`}>
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ICON_COLORS[report.color]}`}>
                <report.icon size={18} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{report.title}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{report.description}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {report.formats.map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => generateReport(report.id, fmt)}
                  disabled={generating[`${report.id}-${fmt}`]}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-navy-400 hover:text-navy-700 hover:bg-navy-50 dark:hover:bg-navy-900/20 disabled:opacity-60 transition-all"
                >
                  <Download size={12} />
                  {generating[`${report.id}-${fmt}`] ? 'Generating...' : fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      {/* DILG compliance templates */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">DILG Compliance Templates</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Pre-formatted Excel templates ready to fill in and submit</p>
        <div className="grid md:grid-cols-2 gap-3">
          {TEMPLATES.map((template) => (
            <div key={template.key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-100 dark:border-gray-600">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{template.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{template.desc}</p>
              </div>
              <button
                onClick={() => downloadTemplate(template.key)}
                disabled={downloadingTemplate[template.key]}
                title="Download Excel template"
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-navy-700 hover:bg-navy-50 dark:hover:bg-navy-900/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <Download size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
