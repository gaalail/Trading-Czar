import React, { useMemo, useState } from 'react';
import type { Candle, TradeFill } from '../engine/types';

interface PriceChartProps {
  candles: Candle[];
  trades: TradeFill[];
  symbol: string;
}

export const PriceChart: React.FC<PriceChartProps> = ({ candles, trades, symbol }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showBands, setShowBands] = useState(true);
  const [showVwap, setShowVwap] = useState(true);

  const visibleCandles = useMemo(() => candles.slice(-64), [candles]);

  const tradesByCandleIndex = useMemo(() => {
    const map = new Map<number, TradeFill[]>();
    for (const t of trades) {
      if (t.symbol !== symbol) continue;
      const list = map.get(t.candleIndex) ?? [];
      list.push(t);
      map.set(t.candleIndex, list);
    }
    return map;
  }, [trades, symbol]);

  const { minPrice, maxPrice, maxVol } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let mVol = 1;
    for (const c of visibleCandles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (showEma) {
        if (c.ema9 < min) min = c.ema9;
        if (c.ema9 > max) max = c.ema9;
        if (c.ema21 < min) min = c.ema21;
        if (c.ema21 > max) max = c.ema21;
      }
      if (showBands) {
        if (c.bbLower20 < min) min = c.bbLower20;
        if (c.bbUpper20 > max) max = c.bbUpper20;
      }
      if (showVwap && Number.isFinite(c.vwap)) {
        if (c.vwap < min) min = c.vwap;
        if (c.vwap > max) max = c.vwap;
      }
      if (c.volume > mVol) mVol = c.volume;
    }
    const pad = (max - min) * 0.08 || 1;
    return { minPrice: min - pad, maxPrice: max + pad, maxVol: mVol };
  }, [visibleCandles, showEma, showBands, showVwap]);

  const width = 920;
  const height = 340;
  const padLeft = 16;
  const padRight = 72;
  const padTop = 18;
  const padBottom = 32;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const volHeight = 46;

  const yForPrice = (price: number) => {
    const ratio = (price - minPrice) / Math.max(0.0001, maxPrice - minPrice);
    return padTop + chartH - ratio * chartH;
  };

  const stepX = chartW / Math.max(1, visibleCandles.length);
  const candleW = Math.max(3, Math.min(10, stepX * 0.62));

  const buildLinePath = (accessor: (c: Candle) => number) =>
    visibleCandles
      .map((c, idx) => {
        const x = padLeft + idx * stepX + stepX / 2;
        const y = yForPrice(accessor(c));
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const ema9Path = useMemo(() => buildLinePath((c) => c.ema9), [visibleCandles, stepX, minPrice, maxPrice]);
  const ema21Path = useMemo(() => buildLinePath((c) => c.ema21), [visibleCandles, stepX, minPrice, maxPrice]);
  const vwapPath = useMemo(() => buildLinePath((c) => c.vwap), [visibleCandles, stepX, minPrice, maxPrice]);
  const bbUpperPath = useMemo(() => buildLinePath((c) => c.bbUpper20), [visibleCandles, stepX, minPrice, maxPrice]);
  const bbLowerPath = useMemo(() => buildLinePath((c) => c.bbLower20), [visibleCandles, stepX, minPrice, maxPrice]);

  const bbFillPath = useMemo(() => {
    if (visibleCandles.length < 2) return '';
    const topPts = visibleCandles.map((c, idx) => {
      const x = padLeft + idx * stepX + stepX / 2;
      const y = yForPrice(c.bbUpper20);
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const botPts = [...visibleCandles].reverse().map((c, rIdx) => {
      const idx = visibleCandles.length - 1 - rIdx;
      const x = padLeft + idx * stepX + stepX / 2;
      const y = yForPrice(c.bbLower20);
      return `L${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `${topPts.join(' ')} ${botPts.join(' ')} Z`;
  }, [visibleCandles, stepX, minPrice, maxPrice]);

  const activeCandle =
    hoverIndex !== null && visibleCandles[hoverIndex]
      ? visibleCandles[hoverIndex]
      : visibleCandles[visibleCandles.length - 1];

  const yTicks = useMemo(() => {
    const count = 5;
    const ticks: number[] = [];
    for (let i = 0; i < count; i++) {
      ticks.push(minPrice + ((maxPrice - minPrice) * i) / (count - 1));
    }
    return ticks;
  }, [minPrice, maxPrice]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
            {activeCandle.timestamp}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">O {activeCandle.open.toFixed(2)}</span>
          <span className="font-mono">H {activeCandle.high.toFixed(2)}</span>
          <span className="font-mono">L {activeCandle.low.toFixed(2)}</span>
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
            C {activeCandle.close.toFixed(2)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">RSI {activeCandle.rsi14.toFixed(1)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">VWAP {activeCandle.vwap.toFixed(2)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">ADX {activeCandle.adx14.toFixed(1)}</span>
          <span aria-hidden="true">·</span>
          <span>{activeCandle.regime}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowVwap((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showVwap
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 dark:hover:text-slate-100'
            }`}
          >
            {showVwap ? 'VWAP On' : 'VWAP Off'}
          </button>

          <button
            type="button"
            onClick={() => setShowBands((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showBands
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 dark:hover:text-slate-100'
            }`}
          >
            {showBands ? 'Bollinger (20,2σ) On' : 'Bollinger Off'}
          </button>

          <button
            type="button"
            onClick={() => setShowEma((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showEma
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 dark:hover:text-slate-100'
            }`}
          >
            {showEma ? 'EMA 9/21 On' : 'EMA 9/21 Off'}
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden px-2 pt-2 pb-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[300px] sm:h-[340px] select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {yTicks.map((tick, i) => {
            const y = yForPrice(tick);
            return (
              <g key={i}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  className="stroke-slate-200/80 dark:stroke-slate-800/80"
                  strokeWidth={1}
                />
                <text
                  x={width - padRight + 8}
                  y={y + 4}
                  className="fill-slate-500 dark:fill-slate-400 font-mono text-[11px]"
                >
                  {tick >= 1000 ? tick.toFixed(0) : tick.toFixed(2)}
                </text>
              </g>
            );
          })}

          {showBands && bbFillPath && (
            <>
              <path d={bbFillPath} className="fill-violet-500/8 dark:fill-violet-400/10" />
              <path
                d={bbUpperPath}
                fill="none"
                className="stroke-violet-500/50 dark:stroke-violet-400/50"
                strokeDasharray="3 3"
                strokeWidth={1.1}
              />
              <path
                d={bbLowerPath}
                fill="none"
                className="stroke-violet-500/50 dark:stroke-violet-400/50"
                strokeDasharray="3 3"
                strokeWidth={1.1}
              />
            </>
          )}

          {visibleCandles.map((c, idx) => {
            const cx = padLeft + idx * stepX + stepX / 2;
            const volH = (c.volume / maxVol) * volHeight;
            const volY = padTop + chartH - volH;
            const isUp = c.close >= c.open;
            return (
              <rect
                key={`vol-${c.index}`}
                x={cx - candleW / 2}
                y={volY}
                width={candleW}
                height={volH}
                className={
                  isUp
                    ? 'fill-emerald-500/15 dark:fill-emerald-400/15'
                    : 'fill-rose-500/15 dark:fill-rose-400/15'
                }
              />
            );
          })}

          {showEma && (
            <>
              <path
                d={ema21Path}
                fill="none"
                className="stroke-amber-500/85"
                strokeWidth={1.4}
              />
              <path
                d={ema9Path}
                fill="none"
                className="stroke-sky-600 dark:stroke-sky-400"
                strokeWidth={1.5}
              />
            </>
          )}

          {showVwap && vwapPath && (
            <path
              d={vwapPath}
              fill="none"
              className="stroke-teal-600 dark:stroke-teal-400"
              strokeDasharray="5 3"
              strokeWidth={1.5}
            />
          )}

          {visibleCandles.map((c, idx) => {
            const cx = padLeft + idx * stepX + stepX / 2;
            const yHigh = yForPrice(c.high);
            const yLow = yForPrice(c.low);
            const yOpen = yForPrice(c.open);
            const yClose = yForPrice(c.close);
            const isUp = c.close >= c.open;
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
            const candleTrades = tradesByCandleIndex.get(c.index);

            return (
              <g key={c.index}>
                {hoverIndex === idx && (
                  <line
                    x1={cx}
                    y1={padTop}
                    x2={cx}
                    y2={padTop + chartH}
                    className="stroke-slate-400/60 dark:stroke-slate-500/60"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                )}
                <line
                  x1={cx}
                  y1={yHigh}
                  x2={cx}
                  y2={yLow}
                  className={
                    isUp
                      ? 'stroke-emerald-600 dark:stroke-emerald-400'
                      : 'stroke-rose-600 dark:stroke-rose-400'
                  }
                  strokeWidth={1.2}
                />
                <rect
                  x={cx - candleW / 2}
                  y={bodyTop}
                  width={candleW}
                  height={bodyH}
                  rx={1}
                  className={
                    isUp
                      ? 'fill-emerald-600 dark:fill-emerald-400'
                      : 'fill-rose-600 dark:fill-rose-400'
                  }
                />

                {candleTrades?.map((tr, tIdx) => {
                  const isBuy = tr.side === 'BUY';
                  const markerY = isBuy ? yLow + 12 + tIdx * 10 : yHigh - 12 - tIdx * 10;
                  const points = isBuy
                    ? `${cx},${markerY - 6} ${cx - 5},${markerY + 3} ${cx + 5},${markerY + 3}`
                    : `${cx},${markerY + 6} ${cx - 5},${markerY - 3} ${cx + 5},${markerY - 3}`;
                  return (
                    <polygon
                      key={tr.id}
                      points={points}
                      className={
                        isBuy
                          ? 'fill-emerald-600 dark:fill-emerald-400'
                          : 'fill-rose-600 dark:fill-rose-400'
                      }
                    />
                  );
                })}

                <rect
                  x={padLeft + idx * stepX}
                  y={padTop}
                  width={stepX}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              </g>
            );
          })}

          {visibleCandles
            .filter((_, idx) => idx % 10 === 0 || idx === visibleCandles.length - 1)
            .map((c) => {
              const idx = visibleCandles.indexOf(c);
              const cx = padLeft + idx * stepX + stepX / 2;
              return (
                <text
                  key={`x-${c.index}`}
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500 font-mono text-[10px]"
                >
                  {c.timestamp.split(' ')[1]}
                </text>
              );
            })}
        </svg>
      </div>
    </div>
  );
};
