import React, { useMemo, useState } from 'react';
import { HelpCircle, RefreshCw } from 'lucide-react';
import type { RankedDiscoveryMover } from '../engine/intelligence/discovery';

type RadarFilter = 'passed' | 'high-rvol' | 'all';

interface DiscoveryRadarPanelProps {
  movers: RankedDiscoveryMover[];
  sourceSummary: string;
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
  inspectedSymbol: string | null;
  inspectingLoading: boolean;
  onRefresh: () => void;
  onInspectTicker: (mover: RankedDiscoveryMover) => void;
}

function formatCompactVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(0)}K`;
  return String(Math.round(volume));
}

export const DiscoveryRadarPanel: React.FC<DiscoveryRadarPanelProps> = ({
  movers,
  sourceSummary,
  fetchedAt,
  loading,
  error,
  inspectedSymbol,
  inspectingLoading,
  onRefresh,
  onInspectTicker,
}) => {
  const [filter, setFilter] = useState<RadarFilter>('passed');
  const [showExplain, setShowExplain] = useState(false);

  const filteredMovers = useMemo(() => {
    if (filter === 'passed') {
      return movers.filter((m) => m.passedLiquidityGate);
    }
    if (filter === 'high-rvol') {
      return movers.filter((m) => m.passedLiquidityGate && m.rvol >= 1.2);
    }
    return movers;
  }, [movers, filter]);

  const passedCount = useMemo(
    () => movers.filter((m) => m.passedLiquidityGate).length,
    [movers]
  );

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Market-Wide Movers &amp; Discovery Radar
            </h2>
            <button
              type="button"
              onClick={() => setShowExplain((v) => !v)}
              aria-label="Explain how market-wide discovery works"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
            <span>{sourceSummary || 'External US equities & ETFs outside the 6-ticker core sleeve'}</span>
            {fetchedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {passedCount}/{movers.length} passed liquidity gate
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(
              [
                { id: 'passed', label: 'Liquid Only' },
                { id: 'high-rvol', label: 'RVOL >= 1.2x' },
                { id: 'all', label: 'All Candidates' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Scanning...' : 'Scan Market'}
          </button>
        </div>
      </div>

      {showExplain && (
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <strong className="text-slate-900 dark:text-slate-100">How discovery works:</strong>{' '}
          The server queries market-wide <strong>Top Movers</strong> (% gainers/movers) and{' '}
          <strong>Most Actives</strong> (highest share volume), strips out your 6 core sleeve tickers,
          and screens every candidate through a <strong>Liquidity Gate</strong> (price &ge; $10.00 and daily volume &ge; 500K shares)
          to avoid thin penny stocks. Click <strong>Inspect</strong> on any ticker to preview its 15m chart and AI signal breakdown read-only without affecting your paper sleeves.
        </div>
      )}

      {error && (
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {loading && movers.length === 0 ? (
        <div className="p-5 space-y-2.5">
          {[0, 1, 2, 3].map((rowIdx) => (
            <div
              key={rowIdx}
              className="h-9 rounded bg-slate-100 dark:bg-slate-800/60 animate-pulse"
            />
          ))}
        </div>
      ) : filteredMovers.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
            No external movers matched the current filter
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Switch to All Candidates or run Scan Market to refresh external snapshots.
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mt-3 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            Show All Candidates
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Ticker</th>
                <th className="py-2.5 px-4">Discovery Source</th>
                <th className="py-2.5 px-4 text-right">Last Price</th>
                <th className="py-2.5 px-4 text-right">Day Change</th>
                <th className="py-2.5 px-4 text-right">RVOL</th>
                <th className="py-2.5 px-4 text-right">Range %</th>
                <th className="py-2.5 px-4 text-right">Volume</th>
                <th className="py-2.5 px-4">Liquidity Gate</th>
                <th className="py-2.5 px-4 text-right">Radar Score</th>
                <th className="py-2.5 px-4 text-right">Chart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {filteredMovers.map((row) => {
                const isInspected = inspectedSymbol === row.symbol;
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => onInspectTicker(row)}
                    className={`cursor-pointer transition-colors ${
                      isInspected
                        ? 'bg-slate-100/90 dark:bg-slate-800/70'
                        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {row.symbol}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {row.sourceLabel}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      ${row.price.toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono font-medium tabular-nums whitespace-nowrap ${
                        row.changePct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {row.changePct >= 0 ? '+' : ''}
                      {row.changePct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {row.rvol.toFixed(2)}x
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {row.rangePct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCompactVolume(row.volume)}
                    </td>
                    <td
                      className={`py-2.5 px-4 whitespace-nowrap ${
                        row.passedLiquidityGate
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                      title={row.filterReason}
                    >
                      {row.passedLiquidityGate ? 'Pass' : 'Filtered'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {row.discoveryScore.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={inspectingLoading && isInspected}
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectTicker(row);
                        }}
                        className="font-medium text-slate-700 dark:text-slate-200 hover:underline cursor-pointer"
                      >
                        {isInspected
                          ? inspectingLoading
                            ? 'Loading...'
                            : 'Inspecting'
                          : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
