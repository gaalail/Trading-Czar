import React from 'react';
import { RotateCcw } from 'lucide-react';
import { STRATEGY_LIST } from '../engine/strategies';
import type { StrategyConfig, StrategyId, StrategyWeights } from '../engine/types';

interface StrategyConfigViewProps {
  activeStrategyId: StrategyId;
  strategyConfig: StrategyConfig;
  weights: StrategyWeights;
  weightUpdates: number;
  onSelectStrategy: (id: StrategyId) => void;
  onUpdateConfig: (patch: Partial<StrategyConfig>) => void;
  onResetWeights: () => void;
}

export const StrategyConfigView: React.FC<StrategyConfigViewProps> = ({
  activeStrategyId,
  strategyConfig,
  weights,
  weightUpdates,
  onSelectStrategy,
  onUpdateConfig,
  onResetWeights,
}) => {
  const weightEntries: { key: keyof StrategyWeights; label: string; value: number }[] = [
    { key: 'emaCross', label: 'EMA 9/21 Crossover Weight', value: weights.emaCross },
    { key: 'rsi', label: 'RSI(14) Momentum Weight', value: weights.rsi },
    { key: 'macd', label: 'MACD Histogram Weight', value: weights.macd },
    { key: 'zScore', label: 'Bollinger Z-Score Weight', value: weights.zScore },
    { key: 'volume', label: 'Volume Impulse Weight', value: weights.volume },
    { key: 'bias', label: 'Logistic Intercept Bias', value: weights.bias },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Decision Engine &amp; Risk Parameters
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Select the active AI model and tune execution conviction, sizing, and risk guards.
          </p>
        </div>

        <div className="p-5 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {STRATEGY_LIST.map((strat) => {
              const selected = strat.id === activeStrategyId;
              return (
                <button
                  key={strat.id}
                  type="button"
                  onClick={() => onSelectStrategy(strat.id)}
                  className={`text-left p-4 rounded-lg border transition-colors cursor-pointer ${
                    selected
                      ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800/70'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {strat.name}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    {strat.summary}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="conf-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Confidence Threshold
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(strategyConfig.confidenceThreshold * 100).toFixed(0)}%
                </span>
              </div>
              <input
                id="conf-slider"
                type="range"
                min={52}
                max={85}
                step={1}
                value={Math.round(strategyConfig.confidenceThreshold * 100)}
                onChange={(e) =>
                  onUpdateConfig({ confidenceThreshold: Number(e.target.value) / 100 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Minimum sigmoid probability required to open or close a position.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="size-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Max Position Allocation
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(strategyConfig.maxPositionPct * 100).toFixed(0)}%
                </span>
              </div>
              <input
                id="size-slider"
                type="range"
                min={10}
                max={50}
                step={5}
                value={Math.round(strategyConfig.maxPositionPct * 100)}
                onChange={(e) =>
                  onUpdateConfig({ maxPositionPct: Number(e.target.value) / 100 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Maximum percentage of total portfolio equity allocated per symbol.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="sl-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Stop-Loss Guard
                </label>
                <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                  -{(strategyConfig.stopLossPct * 100).toFixed(1)}%
                </span>
              </div>
              <input
                id="sl-slider"
                type="range"
                min={10}
                max={80}
                step={2}
                value={Math.round(strategyConfig.stopLossPct * 1000)}
                onChange={(e) =>
                  onUpdateConfig({ stopLossPct: Number(e.target.value) / 1000 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="tp-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Take-Profit Target
                </label>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  +{(strategyConfig.takeProfitPct * 100).toFixed(1)}%
                </span>
              </div>
              <input
                id="tp-slider"
                type="range"
                min={20}
                max={120}
                step={2}
                value={Math.round(strategyConfig.takeProfitPct * 1000)}
                onChange={(e) =>
                  onUpdateConfig({ takeProfitPct: Number(e.target.value) / 1000 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="lr-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Perceptron Learning Rate
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {strategyConfig.learningRate.toFixed(2)}
                </span>
              </div>
              <input
                id="lr-slider"
                type="range"
                min={1}
                max={20}
                step={1}
                value={Math.round(strategyConfig.learningRate * 100)}
                onChange={(e) =>
                  onUpdateConfig({ learningRate: Number(e.target.value) / 100 })
                }
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <label htmlFor="fee-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Commission &amp; Slippage
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {strategyConfig.feeBps} bps
                </span>
              </div>
              <input
                id="fee-slider"
                type="range"
                min={0}
                max={25}
                step={1}
                value={strategyConfig.feeBps}
                onChange={(e) => onUpdateConfig({ feeBps: Number(e.target.value) })}
                className="w-full accent-slate-900 dark:accent-slate-100 cursor-pointer"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Synergistic Entry &amp; Sizing Filters
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  ATR Volatility-Adjusted Sizing &amp; Stops
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Scales position size down and widens stops/targets on high-ATR movers like TSLA &amp; NVDA.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateConfig({ useAtrSizingAndStops: !strategyConfig.useAtrSizingAndStops })
                }
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  strategyConfig.useAtrSizingAndStops
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800'
                }`}
              >
                {strategyConfig.useAtrSizingAndStops ? 'Enabled' : 'Fixed %'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Cross-Asset Market Breadth Gate
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Dampens new long entries when fewer than 35% of tracked symbols are above EMA 21.
                </div>
              </div>
              <button
                type="button"
                onClick={() => onUpdateConfig({ useBreadthFilter: !strategyConfig.useBreadthFilter })}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  strategyConfig.useBreadthFilter
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800'
                }`}
              >
                {strategyConfig.useBreadthFilter ? 'Enabled' : 'Off'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Time-of-Day Session Shaping
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Favors Open Drive (09:30–10:30) and Power Hour (14:30–16:00) over Midday Chop.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateConfig({ useTimeOfDayFilter: !strategyConfig.useTimeOfDayFilter })
                }
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  strategyConfig.useTimeOfDayFilter
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800'
                }`}
              >
                {strategyConfig.useTimeOfDayFilter ? 'Enabled' : 'Off'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Online Neural Feature Weights
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {weightUpdates} online gradient updates applied from closed trades
              </p>
            </div>
            <button
              type="button"
              onClick={onResetWeights}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Weights
            </button>
          </div>

          <div className="p-5 space-y-4">
            {weightEntries.map((item) => {
              const normPct = Math.min(100, (Math.abs(item.value) / 2.5) * 100);
              const positive = item.value >= 0;
              return (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {item.label}
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        positive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {positive ? '+' : ''}
                      {item.value.toFixed(3)}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden">
                    <div
                      className={`h-full transition-all duration-150 ${
                        positive
                          ? 'bg-emerald-600 dark:bg-emerald-400'
                          : 'bg-rose-600 dark:bg-rose-400'
                      }`}
                      style={{ width: `${normPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Weights adapt automatically after each closed AI round-trip in Momentum Perceptron mode using realized trade outcome and feature polarity.
        </div>
      </div>
    </div>
  );
};
