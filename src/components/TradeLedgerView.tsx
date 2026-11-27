import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { TradeFill } from '../engine/types';

interface TradeLedgerViewProps {
  trades: TradeFill[];
  onStepMarket: () => void;
}

export const TradeLedgerView: React.FC<TradeLedgerViewProps> = ({ trades, onStepMarket }) => {
  const [query, setQuery] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [originFilter, setOriginFilter] = useState<'ALL' | 'AI' | 'MANUAL'>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trades.filter((t) => {
      if (sideFilter !== 'ALL' && t.side !== sideFilter) return false;
      if (originFilter !== 'ALL' && t.origin !== originFilter) return false;
      if (
        q &&
        !t.symbol.toLowerCase().includes(q) &&
        !t.reason.toLowerCase().includes(q) &&
        !t.timestamp.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [trades, query, sideFilter, originFilter]);

  const handleExportCsv = () => {
    const header = [
      'ID',
      'Timestamp',
      'Symbol',
      'Side',
      'Origin',
      'Quantity',
      'FillPrice',
      'Fee',
      'ImpactBps',
      'RealizedPnL',
      'Confidence',
      'Rationale',
    ];
    const rows = filtered.map((t) => [
      t.id,
      t.timestamp,
      t.symbol,
      t.side,
      t.origin,
      t.quantity,
      t.price.toFixed(4),
      t.fee.toFixed(2),
      t.impactBps.toFixed(2),
      t.realizedPnl !== null ? t.realizedPnl.toFixed(2) : '',
      t.confidence !== null ? `${(t.confidence * 100).toFixed(1)}%` : '',
      `"${t.reason.replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'trading-czar-ledger.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="desk-surface rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800/80">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Execution Ledger
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {filtered.length} recorded fills · Realized fees and slippage included
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbol or rationale..."
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-[#070B12] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
            />
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#070B12] border border-slate-200/70 dark:border-slate-800 rounded-md">
            {(['ALL', 'BUY', 'SELL'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setSideFilter(side)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sideFilter === side
                    ? 'bg-white dark:bg-slate-800/90 text-slate-900 dark:text-sky-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {side === 'ALL' ? 'All Sides' : side}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#070B12] border border-slate-200/70 dark:border-slate-800 rounded-md">
            {(['ALL', 'AI', 'MANUAL'] as const).map((orig) => (
              <button
                key={orig}
                type="button"
                onClick={() => setOriginFilter(orig)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  originFilter === orig
                    ? 'bg-white dark:bg-slate-800/90 text-slate-900 dark:text-sky-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {orig === 'ALL' ? 'All Origins' : orig === 'AI' ? 'AI Engine' : 'Manual'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 px-6 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            No executions match the current filter
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Advance the market clock or start the AI Trader to generate order fills across watched symbols.
          </p>
          <button
            type="button"
            onClick={onStepMarket}
            className="mt-4 px-4 py-2 text-xs font-medium bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 rounded-md hover:opacity-90 transition-opacity cursor-pointer"
          >
            Advance 1 Market Bar
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Symbol</th>
                <th className="py-2.5 px-4">Side</th>
                <th className="py-2.5 px-4">Source</th>
                <th className="py-2.5 px-4 text-right">Qty</th>
                <th className="py-2.5 px-4 text-right">Fill Price</th>
                <th className="py-2.5 px-4 text-right">Fee</th>
                <th className="py-2.5 px-4 text-right">Impact</th>
                <th className="py-2.5 px-4 text-right">Realized P&amp;L</th>
                <th className="py-2.5 px-4">Decision Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {t.timestamp}
                  </td>
                  <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {t.symbol}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono font-semibold whitespace-nowrap ${
                      t.side === 'BUY'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {t.side}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {t.origin === 'AI' ? 'AI Engine' : 'Manual'}
                    {t.confidence !== null ? ` · ${(t.confidence * 100).toFixed(0)}%` : ''}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-900 dark:text-slate-100">
                    {t.quantity}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-900 dark:text-slate-100">
                    ${t.price.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-500 dark:text-slate-400">
                    ${t.fee.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-500 dark:text-slate-400">
                    {t.impactBps.toFixed(1)}bp
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-mono font-medium whitespace-nowrap ${
                      t.realizedPnl === null
                        ? 'text-slate-400'
                        : t.realizedPnl >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {t.realizedPnl === null
                      ? 'Open'
                      : `${t.realizedPnl >= 0 ? '+' : ''}$${t.realizedPnl.toFixed(2)}`}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 max-w-md truncate">
                    {t.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
