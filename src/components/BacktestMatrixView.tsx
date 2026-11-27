import React, { useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Check, RefreshCw, Upload, X } from 'lucide-react';
import {
  generateSampleScenarioSeries,
  parseHistoricalOhlcvCsv,
  SYMBOL_LIST,
  type SampleScenarioId,
} from '../engine/data/marketData';
import {
  runPortfolioWalkForward,
  runWalkForwardMatrix,
  type CustomDatasetMap,
} from '../engine/portfolio';
import type {
  BacktestRow,
  PortfolioBacktestSummary,
  RawCandle,
  RiskLimits,
  StrategyConfig,
  StrategyId,
  SymbolId,
} from '../engine/types';

interface BacktestMatrixViewProps {
  initialCapital: number;
  alpacaConfigured: boolean;
  strategyConfigs: Record<StrategyId, StrategyConfig>;
  riskLimits: RiskLimits;
  onToggleGlobalFilter: (
    key:
      | 'useAtrSizingAndStops'
      | 'useBreadthFilter'
      | 'useTimeOfDayFilter'
      | 'useVwapAnchor'
      | 'useAdxRegimeGate'
  ) => void;
  onSelectStrategyAndSymbol: (strategyId: StrategyId, symbol: BacktestRow['symbol']) => void;
  onSaveExperiment: (row: BacktestRow) => void;
  onSavePortfolioExperiment: (summary: PortfolioBacktestSummary) => void;
}

type SortKey =
  | 'outOfSampleSharpe'
  | 'outOfSampleReturnPct'
  | 'inSampleReturnPct'
  | 'winRatePct'
  | 'maxDrawdownPct';

export const BacktestMatrixView: React.FC<BacktestMatrixViewProps> = ({
  initialCapital,
  alpacaConfigured,
  strategyConfigs,
  riskLimits,
  onToggleGlobalFilter,
  onSelectStrategyAndSymbol,
  onSaveExperiment,
  onSavePortfolioExperiment,
}) => {
  const [horizonBars, setHorizonBars] = useState<number>(240);
  const [inSamplePct, setInSamplePct] = useState<number>(65);
  const [feeBps, setFeeBps] = useState<number>(5);
  const [sortBy, setSortBy] = useState<SortKey>('outOfSampleSharpe');
  const [runVersion, setRunVersion] = useState(0);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const [csvTargetSymbol, setCsvTargetSymbol] = useState<SymbolId>('NVDA');
  const [customDatasets, setCustomDatasets] = useState<CustomDatasetMap>({});
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [loadingAlpaca, setLoadingAlpaca] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const portfolioSummaries = useMemo(() => {
    void runVersion;
    return runPortfolioWalkForward(
      initialCapital,
      horizonBars,
      inSamplePct,
      feeBps,
      customDatasets,
      strategyConfigs,
      riskLimits
    );
  }, [
    initialCapital,
    horizonBars,
    inSamplePct,
    feeBps,
    runVersion,
    customDatasets,
    strategyConfigs,
    riskLimits,
  ]);

  const rows = useMemo(() => {
    void runVersion;
    const raw = runWalkForwardMatrix(
      initialCapital,
      horizonBars,
      inSamplePct,
      feeBps,
      customDatasets,
      strategyConfigs,
      riskLimits
    );
    return [...raw].sort((a, b) => {
      if (sortBy === 'maxDrawdownPct') {
        return a.maxDrawdownPct - b.maxDrawdownPct;
      }
      return b[sortBy] - a[sortBy];
    });
  }, [
    initialCapital,
    horizonBars,
    inSamplePct,
    feeBps,
    sortBy,
    runVersion,
    customDatasets,
    strategyConfigs,
    riskLimits,
  ]);

  const bestRow = rows[0];
  const customCount = Object.values(customDatasets).filter(Boolean).length;

  const handleLog = (row: BacktestRow) => {
    onSaveExperiment(row);
    const key = `${row.strategyId}-${row.symbol}`;
    setSavedKey(key);
    window.setTimeout(() => {
      setSavedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  };

  const handleLogPortfolio = (summary: PortfolioBacktestSummary) => {
    onSavePortfolioExperiment(summary);
    const key = `port-${summary.strategyId}`;
    setSavedKey(key);
    window.setTimeout(() => {
      setSavedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  };

  const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseHistoricalOhlcvCsv(text, file.name);
      setCustomDatasets((prev) => ({
        ...prev,
        [csvTargetSymbol]: parsed,
      }));
      setDatasetError(null);
    } catch (err) {
      setDatasetError(err instanceof Error ? err.message : 'Unable to parse CSV file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleLoadSampleScenario = (scenario: SampleScenarioId) => {
    const sample = generateSampleScenarioSeries(scenario, csvTargetSymbol, horizonBars);
    setCustomDatasets((prev) => ({
      ...prev,
      [csvTargetSymbol]: sample,
    }));
    setDatasetError(null);
  };

  const handleLoadAlpacaBars = async () => {
    setLoadingAlpaca(true);
    setDatasetError(null);
    try {
      const resp = await fetch(
        `/api/alpaca/bars?symbol=${encodeURIComponent(csvTargetSymbol)}&limit=${horizonBars}`
      );
      const data = (await resp.json()) as {
        bars?: RawCandle[];
        fingerprint?: string;
        error?: string;
      };
      if (!resp.ok || !data.bars || data.bars.length < 60) {
        throw new Error(data.error || 'Insufficient historical bars returned from Alpaca.');
      }
      setCustomDatasets((prev) => ({
        ...prev,
        [csvTargetSymbol]: {
          rawCandles: data.bars!,
          fingerprint: data.fingerprint || `alpaca-${csvTargetSymbol.toLowerCase()}`,
        },
      }));
    } catch (err) {
      setDatasetError(err instanceof Error ? err.message : 'Failed to fetch Alpaca bars.');
    } finally {
      setLoadingAlpaca(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="desk-surface rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Walk-Forward Out-of-Sample Lab
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {inSamplePct}/{100 - inSamplePct} IS/OOS split · {feeBps} bps cost stress ·{' '}
              {customCount > 0 ? `${customCount} custom dataset(s) loaded` : 'Simulated series'} · Best OOS Sharpe:{' '}
              {bestRow
                ? `${bestRow.strategyName} on ${bestRow.symbol} (${bestRow.outOfSampleSharpe.toFixed(2)})`
                : '—'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#070B12] border border-slate-200/70 dark:border-slate-800 rounded-md">
              {[180, 240, 360].map((bars) => (
                <button
                  key={bars}
                  type="button"
                  onClick={() => setHorizonBars(bars)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    horizonBars === bars
                      ? 'bg-white dark:bg-slate-800/90 text-slate-900 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {bars} Bars
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#070B12] border border-slate-200/70 dark:border-slate-800 rounded-md">
              {[60, 65, 75].map((split) => (
                <button
                  key={split}
                  type="button"
                  onClick={() => setInSamplePct(split)}
                  className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inSamplePct === split
                      ? 'bg-white dark:bg-slate-800/90 text-slate-900 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {split}/{100 - split}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#070B12] border border-slate-200/70 dark:border-slate-800 rounded-md">
              {[5, 15, 30].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setFeeBps(bps)}
                  className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    feeBps === bps
                      ? 'bg-white dark:bg-slate-800/90 text-slate-900 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {bps}bps
                </button>
              ))}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Sort backtest matrix"
              className="px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#070B12] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="outOfSampleSharpe">Sort by OOS Sharpe</option>
              <option value="outOfSampleReturnPct">Sort by OOS Return</option>
              <option value="inSampleReturnPct">Sort by In-Sample Return</option>
              <option value="winRatePct">Sort by Win Rate</option>
              <option value="maxDrawdownPct">Sort by Lowest Drawdown</option>
            </select>

            <button
              type="button"
              onClick={() => setRunVersion((v) => v + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 rounded-md hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Recompute
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#070B12]/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Dataset Target:
            </span>
            <select
              value={csvTargetSymbol}
              onChange={(e) => setCsvTargetSymbol(e.target.value as SymbolId)}
              aria-label="Target symbol for dataset loading"
              className="px-2.5 py-1 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              {SYMBOL_LIST.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => handleLoadSampleScenario('sideways-chop')}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Sample: Choppy Range
            </button>
            <button
              type="button"
              onClick={() => handleLoadSampleScenario('tech-rally')}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Sample: Tech Rally
            </button>
            <button
              type="button"
              onClick={() => handleLoadSampleScenario('vol-selloff')}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Sample: Vol Selloff
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload CSV
            </button>

            {alpacaConfigured && (
              <button
                type="button"
                onClick={handleLoadAlpacaBars}
                disabled={loadingAlpaca}
                className="px-2.5 py-1 text-xs font-medium border border-emerald-600/40 rounded bg-emerald-950/30 text-emerald-400 hover:bg-emerald-950/50 disabled:opacity-50 cursor-pointer"
              >
                {loadingAlpaca ? 'Fetching Alpaca...' : 'Fetch Alpaca IEX'}
              </button>
            )}

            {customCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCustomDatasets({});
                  setDatasetError(null);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400 mr-1">Filters:</span>
            {(
              [
                { key: 'useAtrSizingAndStops', label: 'ATR Sizing/Stops' },
                { key: 'useBreadthFilter', label: 'Breadth Gate' },
                { key: 'useTimeOfDayFilter', label: 'Time-of-Day' },
                { key: 'useVwapAnchor', label: 'VWAP Anchor' },
                { key: 'useAdxRegimeGate', label: 'ADX Gate' },
              ] as const
            ).map((item) => {
              const allOn = Object.values(strategyConfigs).every((c) => c[item.key]);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onToggleGlobalFilter(item.key)}
                  className={`px-2 py-1 rounded border font-mono transition-colors cursor-pointer ${
                    allOn
                      ? 'bg-sky-500/12 text-sky-700 border-sky-500/35 dark:bg-sky-400/15 dark:text-sky-300 dark:border-sky-400/35'
                      : 'bg-white text-slate-600 border-slate-200 dark:bg-[#070B12] dark:text-slate-400 dark:border-slate-800'
                  }`}
                >
                  {item.label}: {allOn ? 'ON' : 'OFF'}
                </button>
              );
            })}
          </div>

          {datasetError && <div className="text-xs text-rose-500">{datasetError}</div>}
        </div>

        <div className="border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="px-5 py-3 bg-slate-50/50 dark:bg-[#070B12]/40 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Portfolio-Level Multi-Asset Contention (Shared $100,000 Cash Pool)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                All 6 core symbols compete for capital simultaneously under active Risk Gateway exposure and SPY-correlation limits
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Strategy Sleeve</th>
                  <th className="py-2.5 px-4">Validation</th>
                  <th className="py-2.5 px-4 text-right">IS Return</th>
                  <th className="py-2.5 px-4 text-right">OOS Return</th>
                  <th className="py-2.5 px-4 text-right">EW Bench</th>
                  <th className="py-2.5 px-4 text-right">OOS Sharpe / Sortino</th>
                  <th className="py-2.5 px-4 text-right">Max DD</th>
                  <th className="py-2.5 px-4 text-right">Closed / Blocks</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                {portfolioSummaries.map((s) => {
                  const isClean =
                    s.validationFlags.length === 1 && s.validationFlags[0] === 'Clean Pass';
                  const justSaved = savedKey === `port-${s.strategyId}`;
                  return (
                    <tr
                      key={s.strategyId}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {s.strategyName} · v{s.strategyVersion}
                      </td>
                      <td
                        className={`py-2.5 px-4 font-mono whitespace-nowrap ${
                          isClean
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {s.validationFlags.join(' · ')}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                          s.inSampleReturnPct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {s.inSampleReturnPct >= 0 ? '+' : ''}
                        {s.inSampleReturnPct.toFixed(2)}%
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                          s.outOfSampleReturnPct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {s.outOfSampleReturnPct >= 0 ? '+' : ''}
                        {s.outOfSampleReturnPct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {s.benchmarkOosReturnPct >= 0 ? '+' : ''}
                        {s.benchmarkOosReturnPct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {s.outOfSampleSharpe.toFixed(2)} / {s.outOfSampleSortino.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">
                        -{s.maxDrawdownPct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {s.tradeCount} / {s.riskBlockedCount} blk
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleLogPortfolio(s)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                        >
                          {justSaved ? (
                            <>
                              <Check className="w-3 h-3" />
                              Saved
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="w-3 h-3" />
                              Log Portfolio
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Strategy</th>
                <th className="py-2.5 px-4">Symbol</th>
                <th className="py-2.5 px-4">Validation Check</th>
                <th className="py-2.5 px-4">Dataset Fingerprint</th>
                <th className="py-2.5 px-4 text-right">IS Return</th>
                <th className="py-2.5 px-4 text-right">OOS Return</th>
                <th className="py-2.5 px-4 text-right">OOS Bench</th>
                <th className="py-2.5 px-4 text-right">IS / OOS Sharpe</th>
                <th className="py-2.5 px-4 text-right">Max DD</th>
                <th className="py-2.5 px-4 text-right">Win Rate</th>
                <th className="py-2.5 px-4 text-right">Trades</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {rows.map((r) => {
                const rowKey = `${r.strategyId}-${r.symbol}`;
                const justSaved = savedKey === rowKey;
                const isClean =
                  r.validationFlags.length === 1 && r.validationFlags[0] === 'Clean Pass';
                return (
                  <tr
                    key={rowKey}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {r.strategyName} · v{r.strategyVersion}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {r.symbol}
                    </td>
                    <td
                      className={`py-2.5 px-4 font-mono text-xs whitespace-nowrap ${
                        isClean
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {r.validationFlags.join(' · ')}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {r.datasetFingerprint}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono whitespace-nowrap ${
                        r.inSampleReturnPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {r.inSampleReturnPct >= 0 ? '+' : ''}
                      {r.inSampleReturnPct.toFixed(2)}%
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap ${
                        r.outOfSampleReturnPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {r.outOfSampleReturnPct >= 0 ? '+' : ''}
                      {r.outOfSampleReturnPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {r.benchmarkOosReturnPct >= 0 ? '+' : ''}
                      {r.benchmarkOosReturnPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {r.inSampleSharpe.toFixed(2)} / {r.outOfSampleSharpe.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-rose-600 dark:text-rose-400">
                      -{r.maxDrawdownPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">
                      {r.winRatePct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                      {r.tradeCount}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleLog(r)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                        >
                          {justSaved ? (
                            <>
                              <Check className="w-3 h-3" />
                              Saved
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="w-3 h-3" />
                              Log Run
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectStrategyAndSymbol(r.strategyId, r.symbol)}
                          className="text-xs font-medium text-slate-900 dark:text-slate-100 underline underline-offset-4 hover:opacity-75 cursor-pointer"
                        >
                          Load Desk
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
