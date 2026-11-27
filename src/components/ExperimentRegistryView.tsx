import React, { useMemo, useState } from 'react';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import type { ExperimentRecord, ExperimentVerdict } from '../engine/types';

interface ExperimentRegistryViewProps {
  experiments: ExperimentRecord[];
  onUpdateExperiment: (id: string, patch: Partial<ExperimentRecord>) => void;
  onDeleteExperiment: (id: string) => void;
  onSnapshotActiveSleeve: () => void;
}

const VERDICT_OPTIONS: ExperimentVerdict[] = [
  'Pending Review',
  'Validated',
  'Inconclusive',
  'Rejected',
];

export const ExperimentRegistryView: React.FC<ExperimentRegistryViewProps> = ({
  experiments,
  onUpdateExperiment,
  onDeleteExperiment,
  onSnapshotActiveSleeve,
}) => {
  const [query, setQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | ExperimentVerdict>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return experiments.filter((exp) => {
      if (verdictFilter !== 'ALL' && exp.verdict !== verdictFilter) return false;
      if (
        q &&
        !exp.title.toLowerCase().includes(q) &&
        !exp.hypothesis.toLowerCase().includes(q) &&
        !exp.strategyName.toLowerCase().includes(q) &&
        !exp.symbol.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [experiments, query, verdictFilter]);

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'trading-czar-experiments.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="desk-surface rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Experiment Registry
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {experiments.length} saved runs persisted to knowledge/experiments/registry.json &amp; browser cache
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hypothesis or symbol..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-[#070B12] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
              />
            </div>

            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value as 'ALL' | ExperimentVerdict)}
              aria-label="Filter by verdict"
              className="px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#070B12] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="ALL">All Verdicts</option>
              {VERDICT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleExportJson}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </button>

            <button
              type="button"
              onClick={onSnapshotActiveSleeve}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 rounded-md hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Snapshot Active Sleeve
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No experiment records saved yet
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              Capture a live strategy sleeve snapshot here or click Log Run on any row in the Walk-Forward Backtest Matrix.
            </p>
            <button
              type="button"
              onClick={onSnapshotActiveSleeve}
              className="mt-4 px-4 py-2 text-xs font-medium bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 rounded-md hover:opacity-90 cursor-pointer"
            >
              Snapshot Active Sleeve
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((exp) => (
              <div key={exp.id} className="p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {exp.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                      {exp.strategyName} · v{exp.strategyVersion} · {exp.symbol} · {exp.datasetFingerprint} · {exp.feeBps}bps
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <select
                      value={exp.verdict}
                      onChange={(e) =>
                        onUpdateExperiment(exp.id, {
                          verdict: e.target.value as ExperimentVerdict,
                        })
                      }
                      aria-label={`Verdict for ${exp.title}`}
                      className={`px-2.5 py-1 text-xs font-mono font-medium rounded border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 cursor-pointer ${
                        exp.verdict === 'Validated'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : exp.verdict === 'Rejected'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {VERDICT_OPTIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => onDeleteExperiment(exp.id)}
                      aria-label={`Delete ${exp.title}`}
                      className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 py-3 border-y border-slate-100 dark:border-slate-800/80 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">OOS Return</div>
                    <div
                      className={`mt-0.5 font-mono font-semibold ${
                        exp.metrics.outOfSampleReturnPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {exp.metrics.outOfSampleReturnPct >= 0 ? '+' : ''}
                      {exp.metrics.outOfSampleReturnPct.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">IS Return</div>
                    <div className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                      {exp.metrics.inSampleReturnPct >= 0 ? '+' : ''}
                      {exp.metrics.inSampleReturnPct.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Sharpe</div>
                    <div className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                      {exp.metrics.sharpeRatio.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Max Drawdown</div>
                    <div className="mt-0.5 font-mono text-rose-600 dark:text-rose-400">
                      -{exp.metrics.maxDrawdownPct.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Win Rate</div>
                    <div className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                      {exp.metrics.winRatePct.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Closed Trades</div>
                    <div className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                      {exp.metrics.tradeCount}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Hypothesis
                    </label>
                    <textarea
                      rows={2}
                      value={exp.hypothesis}
                      onChange={(e) =>
                        onUpdateExperiment(exp.id, { hypothesis: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-[#070B12] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Observed Limitations &amp; Notes
                    </label>
                    <textarea
                      rows={2}
                      value={exp.limitations}
                      onChange={(e) =>
                        onUpdateExperiment(exp.id, { limitations: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-[#070B12] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
