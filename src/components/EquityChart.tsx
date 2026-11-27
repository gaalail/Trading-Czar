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

const SLEEVE_COLORS: Record<StrategyId, { stroke: string; dot: string }> = {
  'neural-perceptron': {
    stroke: 'stroke-sky-400',
    dot: 'bg-sky-400',
  },
  'mean-reversion': {
    stroke: 'stroke-amber-400',
    dot: 'bg-amber-400',
  },
  'regime-ensemble': {
    stroke: 'stroke-emerald-400',
    dot: 'bg-emerald-400',
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

  const activePointIdx =
    hoverIdx !== null && hoverIdx < primaryCurve.length ? hoverIdx : primaryCurve.length - 1;
  const activeBench = primaryCurve[activePointIdx]?.benchmarkEquity ?? 100000;

  const yTicks = [minVal, (minVal + maxVal) / 2, maxVal];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Isolated Strategy Sleeves vs. Benchmark
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
          {yTicks.map((tick, i) => {
            const y = yForVal(tick);
            return (
              <g key={i}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  className="stroke-slate-200 dark:stroke-slate-800"
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
                strokeOpacity={isSel ? 1 : 0.55}
              />
            );
          })}

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
                    className="stroke-slate-300 dark:stroke-slate-700"
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
        </svg>
      </div>
    </div>
  );
};
