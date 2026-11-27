import React, { useMemo, useState } from 'react';
import type { EquityPoint, StrategyId } from '../engine/types';

interface SleeveSeries {
  id: StrategyId;
  label: string;
  curve: EquityPoint[];
}

interface EquityChartProps {
  sleeves: SleeveSeries[];
  activeStrategyId: StrategyId;
}

const SLEEVE_COLORS: Record<
  StrategyId,
  { stroke: string; dot: string; hex: string }
> = {
  'neural-perceptron': {
    stroke: 'stroke-sky-500 dark:stroke-sky-400',
    dot: 'bg-sky-500 dark:bg-sky-400',
    hex: '#38bdf8',
  },
  'mean-reversion': {
    stroke: 'stroke-amber-500 dark:stroke-amber-400',
    dot: 'bg-amber-500 dark:bg-amber-400',
    hex: '#fbbf24',
  },
  'regime-ensemble': {
    stroke: 'stroke-emerald-500 dark:stroke-emerald-400',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    hex: '#34d399',
  },
};

export const EquityChart: React.FC<EquityChartProps> = ({ sleeves, activeStrategyId }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const primaryCurve = useMemo(() => {
    return sleeves.find((s) => s.id === activeStrategyId)?.curve ?? sleeves[0]?.curve ?? [];
  }, [sleeves, activeStrategyId]);

  const width = 560;
  const height = 220;
  const padL = 12;
  const padR = 64;
  const padT = 16;
  const padB = 26;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const { minVal, maxVal } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of sleeves) {
      for (const p of s.curve) {
        min = Math.min(min, p.equity, p.benchmarkEquity);
        max = Math.max(max, p.equity, p.benchmarkEquity);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { minVal: 99000, maxVal: 101000 };
    }
    const spread = max - min;
    const pad = spread > 10 ? spread * 0.14 : 400;
    return { minVal: min - pad, maxVal: max + pad };
  }, [sleeves]);

  const len = Math.max(1, primaryCurve.length);
  const xForIdx = (i: number) =>
    len <= 1 ? padL + chartW / 2 : padL + (i / (len - 1)) * chartW;
  const yForVal = (v: number) =>
    padT + chartH - ((v - minVal) / Math.max(1, maxVal - minVal)) * chartH;

  const benchPath = useMemo(
    () =>
      primaryCurve
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'}${xForIdx(i).toFixed(1)},${yForVal(p.benchmarkEquity).toFixed(1)}`
        )
        .join(' '),
    [primaryCurve, minVal, maxVal]
  );

  const activeAreaPath = useMemo(() => {
    if (primaryCurve.length <= 1) return '';
    const linePts = primaryCurve.map(
      (p, i) => `${i === 0 ? 'M' : 'L'}${xForIdx(i).toFixed(1)},${yForVal(p.equity).toFixed(1)}`
    );
    const lastX = xForIdx(primaryCurve.length - 1).toFixed(1);
    const firstX = xForIdx(0).toFixed(1);
    const baselineY = (padT + chartH).toFixed(1);
    return `${linePts.join(' ')} L${lastX},${baselineY} L${firstX},${baselineY} Z`;
  }, [primaryCurve, minVal, maxVal]);

  const activePointIdx =
    hoverIdx !== null && hoverIdx < primaryCurve.length ? hoverIdx : primaryCurve.length - 1;
  const activePoint = primaryCurve[activePointIdx];
  const activeBench = activePoint?.benchmarkEquity ?? 100000;
  const activeEquity = activePoint?.equity ?? 100000;
  const spreadPct = activeBench > 0 ? ((activeEquity - activeBench) / activeBench) * 100 : 0;

  const activeColor = SLEEVE_COLORS[activeStrategyId] ?? SLEEVE_COLORS['neural-perceptron'];
  const yTicks = [minVal, (minVal + maxVal) / 2, maxVal];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Isolated Strategy Sleeves vs. Benchmark
          </div>
          {activePoint && (
            <span
              className={`font-mono text-[11px] font-medium ${
                spreadPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {spreadPct >= 0 ? '+' : ''}
              {spreadPct.toFixed(2)}% vs Bench
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-600 dark:text-slate-400">
          {sleeves.map((s) => {
            const val = s.curve[activePointIdx]?.equity ?? 100000;
            const isSel = s.id === activeStrategyId;
            return (
              <span
                key={s.id}
                className={`flex items-center gap-1.5 ${isSel ? 'text-slate-900 dark:text-slate-100 font-semibold' : ''}`}
              >
                <span className={`inline-block w-2.5 h-0.5 ${SLEEVE_COLORS[s.id].dot}`} />
                {s.label.split(' ')[0]} ${(val / 1000).toFixed(1)}k
              </span>
            );
          })}
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-0.5 bg-slate-500" />
            Bench ${(activeBench / 1000).toFixed(1)}k
          </span>
        </div>
      </div>

      <div className="px-3 py-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[210px] select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="tc-equity-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={activeColor.hex} stopOpacity="0.22" />
              <stop offset="100%" stopColor={activeColor.hex} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {yTicks.map((tick, i) => {
            const y = yForVal(tick);
            return (
              <g key={i}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  className="stroke-slate-200/75 dark:stroke-slate-800/75"
                  strokeWidth={1}
                />
                <text
                  x={width - padR + 6}
                  y={y + 4}
                  className="fill-slate-500 dark:fill-slate-400 font-mono text-[10px]"
                >
                  ${(tick / 1000).toFixed(1)}k
                </text>
              </g>
            );
          })}

          {activeAreaPath && <path d={activeAreaPath} fill="url(#tc-equity-area)" />}

          {primaryCurve.length > 1 && (
            <path
              d={benchPath}
              fill="none"
              className="stroke-slate-400 dark:stroke-slate-600"
              strokeDasharray="4 3"
              strokeWidth={1.3}
            />
          )}

          {sleeves.map((s) => {
            if (s.curve.length <= 1) return null;
            const isSel = s.id === activeStrategyId;
            const d = s.curve
              .map(
                (p, i) =>
                  `${i === 0 ? 'M' : 'L'}${xForIdx(i).toFixed(1)},${yForVal(p.equity).toFixed(1)}`
              )
              .join(' ');
            return (
              <path
                key={s.id}
                d={d}
                fill="none"
                className={SLEEVE_COLORS[s.id].stroke}
                strokeWidth={isSel ? 2.2 : 1.25}
                strokeOpacity={isSel ? 1 : 0.48}
              />
            );
          })}

          {activePoint && primaryCurve.length > 0 && (
            <circle
              cx={xForIdx(activePointIdx)}
              cy={yForVal(activeEquity)}
              r={3.5}
              className={`fill-white dark:fill-[#0B111C] ${activeColor.stroke} pointer-events-none`}
              strokeWidth={2}
            />
          )}

          {primaryCurve.map((p, i) => {
            const cx = xForIdx(i);
            const sliceW = chartW / Math.max(1, primaryCurve.length);
            return (
              <g key={`${p.index}-${i}`}>
                {hoverIdx === i && (
                  <line
                    x1={cx}
                    y1={padT}
                    x2={cx}
                    y2={padT + chartH}
                    className="stroke-sky-500/45 dark:stroke-sky-400/45"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                )}
                <rect
                  x={cx - sliceW / 2}
                  y={padT}
                  width={Math.max(4, sliceW)}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                />
              </g>
            );
          })}

          {activePoint && (
            <text
              x={padL}
              y={height - 6}
              className="fill-slate-400 dark:fill-slate-500 font-mono text-[10px]"
            >
              {activePoint.timestamp}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
};
