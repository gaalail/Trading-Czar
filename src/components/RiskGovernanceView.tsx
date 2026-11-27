import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { RiskEvent, RiskLimits } from '../engine/types';

export interface AlpacaBridgeStatus {
  configured: boolean;
  paperOnlyLocked: boolean;
  feed: string;
  accountConnected?: boolean;
  accountStatus?: string;
  equity?: number;
  buyingPower?: number;
  error?: string;
}

interface RiskGovernanceViewProps {
  limits: RiskLimits;
  riskEvents: RiskEvent[];
  alpacaStatus: AlpacaBridgeStatus;
  onUpdateLimits: (patch: Partial<RiskLimits>) => void;
}

export const RiskGovernanceView: React.FC<RiskGovernanceViewProps> = ({
  limits,
  riskEvents,
  alpacaStatus,
  onUpdateLimits,
}) => {
  const blockedCount = riskEvents.filter((e) => e.status === 'BLOCKED').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Fail-Closed Risk Gateway
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Independent boundary enforced before every AI and manual order
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUpdateLimits({ halted: !limits.halted })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                limits.halted
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-rose-600 text-white hover:bg-rose-700'
              }`}
            >
              {limits.halted ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Resume Gateway
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Emergency Halt
                </>
              )}
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-3 text-xs border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Execution Mode</div>
                <div className="mt-1 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  PAPER_ONLY (Locked)
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Gateway Status</div>
                <div
                  className={`mt-1 font-mono font-semibold ${
                    limits.halted
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {limits.halted ? 'HALTED (All Orders Blocked)' : 'ACTIVE (Enforcing)'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Short Selling &amp; Margin</div>
                <div className="mt-1 font-mono font-medium text-slate-900 dark:text-slate-100">
                  Prohibited
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Asset Universe</div>
                <div className="mt-1 font-mono font-medium text-slate-900 dark:text-slate-100">
                  US Equities &amp; ETFs
                </div>
              </div>
              <div className="col-span-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <div className="text-slate-500 dark:text-slate-400">Alpaca Paper Bridge</div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-mono">
                  <span
                    className={
                      alpacaStatus.accountConnected
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : alpacaStatus.configured
                          ? 'font-semibold text-amber-600 dark:text-amber-400'
                          : 'text-slate-600 dark:text-slate-300'
                    }
                  >
                    {alpacaStatus.accountConnected
                      ? `Verified Paper Account (${alpacaStatus.accountStatus ?? 'ACTIVE'})`
                      : alpacaStatus.configured
                        ? alpacaStatus.error || 'Keys Present — Checking Paper Account'
                        : 'Not Configured — Using Local Simulator'}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {alpacaStatus.paperOnlyLocked ? 'PAPER_ONLY URL' : 'URL Blocked'} · Feed{' '}
                    {alpacaStatus.feed.toUpperCase()}
                  </span>
                </div>
                {alpacaStatus.accountConnected && typeof alpacaStatus.equity === 'number' && (
                  <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    Paper Equity ${alpacaStatus.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {typeof alpacaStatus.buyingPower === 'number' &&
                      ` · Buying Power $${alpacaStatus.buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Enforce Regular US Market Hours
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Reject orders outside 09:30–16:00 ET session
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateLimits({ enforceMarketHours: !limits.enforceMarketHours })
                }
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  limits.enforceMarketHours
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800'
                }`}
              >
                {limits.enforceMarketHours ? 'Enforced' : 'Bypassed'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Pre-Close EOD Flatten Guard
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Blocks new buys after 15:40 ET and flattens open longs at 15:45 ET to prevent overnight gap risk
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateLimits({ flattenBeforeClose: !limits.flattenBeforeClose })
                }
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  limits.flattenBeforeClose
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800'
                }`}
              >
                {limits.flattenBeforeClose ? 'Enabled' : 'Off'}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="stale-cap" className="font-medium text-slate-700 dark:text-slate-300">
                  Live Feed Stale-Bar Guard
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {limits.maxBarAgeMinutes} min
                </span>
              </div>
              <input
                id="stale-cap"
                type="range"
                min={15}
                max={120}
                step={5}
                value={limits.maxBarAgeMinutes}
                onChange={(e) =>
                  onUpdateLimits({ maxBarAgeMinutes: Number(e.target.value) })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Blocks new live buys if Alpaca&apos;s newest bar timestamp lags behind wall clock beyond limit
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="exp-cap" className="font-medium text-slate-700 dark:text-slate-300">
                  Max Gross Portfolio Exposure
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(limits.maxPortfolioExposurePct * 100).toFixed(0)}%
                </span>
              </div>
              <input
                id="exp-cap"
                type="range"
                min={25}
                max={95}
                step={5}
                value={Math.round(limits.maxPortfolioExposurePct * 100)}
                onChange={(e) =>
                  onUpdateLimits({ maxPortfolioExposurePct: Number(e.target.value) / 100 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="pos-cap" className="font-medium text-slate-700 dark:text-slate-300">
                  Max Single-Symbol Concentration
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(limits.maxSinglePositionPct * 100).toFixed(0)}%
                </span>
              </div>
              <input
                id="pos-cap"
                type="range"
                min={10}
                max={60}
                step={5}
                value={Math.round(limits.maxSinglePositionPct * 100)}
                onChange={(e) =>
                  onUpdateLimits({ maxSinglePositionPct: Number(e.target.value) / 100 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="corr-cap" className="font-medium text-slate-700 dark:text-slate-300">
                  Max Correlated SPY-Beta Cluster
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(limits.maxCorrelatedExposurePct * 100).toFixed(0)}%
                </span>
              </div>
              <input
                id="corr-cap"
                type="range"
                min={25}
                max={85}
                step={5}
                value={Math.round(limits.maxCorrelatedExposurePct * 100)}
                onChange={(e) =>
                  onUpdateLimits({ maxCorrelatedExposurePct: Number(e.target.value) / 100 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Caps combined exposure across stocks with &ge; 0.65 rolling correlation to SPY
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="ord-cap" className="font-medium text-slate-700 dark:text-slate-300">
                  Max Single Order Notional
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  ${limits.maxOrderNotional.toLocaleString()}
                </span>
              </div>
              <input
                id="ord-cap"
                type="range"
                min={5000}
                max={60000}
                step={2500}
                value={limits.maxOrderNotional}
                onChange={(e) =>
                  onUpdateLimits({ maxOrderNotional: Number(e.target.value) })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="vol-cap" className="font-medium text-slate-700 dark:text-slate-300">
                  Max Bar Liquidity Participation
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(limits.maxBarVolumePct * 100).toFixed(1)}%
                </span>
              </div>
              <input
                id="vol-cap"
                type="range"
                min={5}
                max={100}
                step={5}
                value={Math.round(limits.maxBarVolumePct * 1000)}
                onChange={(e) =>
                  onUpdateLimits({ maxBarVolumePct: Number(e.target.value) / 1000 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Risk &amp; Audit Event Log
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {riskEvents.length} gateway evaluations · {blockedCount} orders blocked
            </p>
          </div>

          {riskEvents.length === 0 ? (
            <div className="py-16 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No order checks recorded yet. Step the market or place a manual order to audit Risk Gateway decisions.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Time</th>
                    <th className="py-2.5 px-4">Symbol</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Rule</th>
                    <th className="py-2.5 px-4">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                  {riskEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {ev.timestamp}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {ev.symbol} · {ev.side}
                      </td>
                      <td
                        className={`py-2.5 px-4 font-mono font-semibold whitespace-nowrap ${
                          ev.status === 'APPROVED'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {ev.status}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {ev.rule}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                        {ev.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
