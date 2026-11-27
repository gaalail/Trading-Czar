import type { Candle, SymbolId } from '../types';

export interface MarketBreadthSnapshot {
  advancingCount: number;
  decliningCount: number;
  aboveEma21Pct: number;
  meanRsi14: number;
  corrToSpy: number;
  dominantRegime: string;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return 0;
  const xSlice = xs.slice(-n);
  const ySlice = ys.slice(-n);
  const meanX = xSlice.reduce((s, v) => s + v, 0) / n;
  const meanY = ySlice.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - meanX;
    const dy = ySlice[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

function returnsFromCandles(candles: Candle[], lookback = 21): number[] {
  const slice = candles.slice(-lookback);
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push((slice[i].close - slice[i - 1].close) / Math.max(0.01, slice[i - 1].close));
  }
  return rets;
}

/**
 * Pure Cross-Asset Market Intelligence:
 * Measures universe breadth, trend participation, and rolling correlation to SPY.
 */
export function computeMarketBreadth(
  candlesBySymbol: Record<SymbolId, Candle[]>,
  activeSymbol: SymbolId
): MarketBreadthSnapshot {
  const entries = Object.values(candlesBySymbol);
  let advancingCount = 0;
  let decliningCount = 0;
  let aboveEma21 = 0;
  let rsiSum = 0;
  const regimeCounts = new Map<string, number>();

  for (const series of entries) {
    const last = series[series.length - 1];
    const prev = series[Math.max(0, series.length - 2)];
    if (last.close >= prev.close) {
      advancingCount++;
    } else {
      decliningCount++;
    }
    if (last.close > last.ema21) {
      aboveEma21++;
    }
    rsiSum += last.rsi14;
    regimeCounts.set(last.regime, (regimeCounts.get(last.regime) ?? 0) + 1);
  }

  let dominantRegime = 'Consolidation';
  let topCount = -1;
  for (const [regime, count] of regimeCounts.entries()) {
    if (count > topCount) {
      topCount = count;
      dominantRegime = regime;
    }
  }

  const activeRets = returnsFromCandles(candlesBySymbol[activeSymbol]);
  const spyRets = returnsFromCandles(candlesBySymbol.SPY);
  const corrToSpy =
    activeSymbol === 'SPY' ? 1 : pearsonCorrelation(activeRets, spyRets);

  const count = Math.max(1, entries.length);
  return {
    advancingCount,
    decliningCount,
    aboveEma21Pct: (aboveEma21 / count) * 100,
    meanRsi14: rsiSum / count,
    corrToSpy,
    dominantRegime,
  };
}

export function computeMarketBreadthAtBar(
  candlesBySymbol: Record<SymbolId, Candle[]>,
  activeSymbol: SymbolId,
  barIndex: number
): MarketBreadthSnapshot {
  const sliced = {} as Record<SymbolId, Candle[]>;
  for (const key of Object.keys(candlesBySymbol) as SymbolId[]) {
    const series = candlesBySymbol[key];
    const end = Math.min(series.length, barIndex + 1);
    sliced[key] = series.slice(0, Math.max(1, end));
  }
  return computeMarketBreadth(sliced, activeSymbol);
}
