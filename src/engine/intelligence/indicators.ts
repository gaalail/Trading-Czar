import type { Candle, MarketRegime, RawCandle, SessionWindow } from '../types';

/**
 * Pure Market Intelligence Layer:
 * Transforms raw OHLCV data into causal technical indicators and volatility regime labels.
 * Contains zero order-execution, portfolio, or brokerage logic.
 */
function classifySessionWindow(timestamp: string, isRegularHours: boolean): SessionWindow {
  if (!isRegularHours) return 'Extended';
  const match = timestamp.match(/(\d{2}):(\d{2})/);
  if (!match) return 'Open Drive';
  const mins = Number(match[1]) * 60 + Number(match[2]);
  if (mins >= 9 * 60 + 30 && mins < 10 * 60 + 30) return 'Open Drive';
  if (mins >= 14 * 60 + 30 && mins < 16 * 60) return 'Power Hour';
  if (mins >= 10 * 60 + 30 && mins < 14 * 60 + 30) return 'Midday Chop';
  return 'Extended';
}

function extractSessionDateKey(timestamp: string): string {
  const token = timestamp.trim().split(/[\sT]+/)[0];
  return token || 'session';
}

function classifyRegime(
  emaSpreadPct: number,
  atrPct: number,
  zScore20: number,
  adx14: number
): MarketRegime {
  if (atrPct >= 0.018) {
    return 'High Volatility';
  }
  if ((adx14 >= 24 && Math.abs(emaSpreadPct) >= 0.3) || Math.abs(emaSpreadPct) >= 0.45) {
    return 'Trend Up';
  }
  if ((adx14 < 20 && Math.abs(zScore20) >= 1.0) || Math.abs(zScore20) >= 1.1) {
    return 'Mean Reverting';
  }
  return 'Consolidation';
}

export function enrichMarketIntelligence(rawCandles: RawCandle[]): Candle[] {
  const result: Candle[] = [];
  const k9 = 2 / (9 + 1);
  const k12 = 2 / (12 + 1);
  const k21 = 2 / (21 + 1);
  const k26 = 2 / (26 + 1);
  const kSig = 2 / (9 + 1);

  let ema9 = rawCandles[0]?.close ?? 100;
  let ema12 = ema9;
  let ema21 = ema9;
  let ema26 = ema9;
  let macdSignal = 0;

  let avgGain = 0;
  let avgLoss = 0;
  let atr14 = 0;

  // Causal Wilder ADX(14) state
  let tr14 = 0;
  let plusDm14 = 0;
  let minusDm14 = 0;
  let adx14 = 20;

  // Causal Session VWAP accumulators (reset at new trading day & regular open)
  let currentDayKey = '';
  let cumPV = 0;
  let cumVol = 0;

  for (let i = 0; i < rawCandles.length; i++) {
    const c = rawCandles[i];
    const dayKey = extractSessionDateKey(c.timestamp);
    const crossedIntoRegularOpen =
      i > 0 && !rawCandles[i - 1].isRegularHours && c.isRegularHours;

    if (i === 0 || dayKey !== currentDayKey || crossedIntoRegularOpen) {
      currentDayKey = dayKey;
      cumPV = 0;
      cumVol = 0;
    }

    const typicalPrice = (c.high + c.low + c.close) / 3;
    const barVol = Math.max(0, c.volume);
    cumPV += typicalPrice * barVol;
    cumVol += barVol;
    const vwap = cumVol > 0 ? cumPV / cumVol : c.close;
    const vwapDistancePct = ((c.close - vwap) / Math.max(0.01, vwap)) * 100;

    if (i === 0) {
      ema9 = c.close;
      ema12 = c.close;
      ema21 = c.close;
      ema26 = c.close;
      atr14 = c.high - c.low;
      tr14 = Math.max(0.0001, c.high - c.low);
      plusDm14 = 0;
      minusDm14 = 0;
      adx14 = 20;
    } else {
      ema9 = c.close * k9 + ema9 * (1 - k9);
      ema12 = c.close * k12 + ema12 * (1 - k12);
      ema21 = c.close * k21 + ema21 * (1 - k21);
      ema26 = c.close * k26 + ema26 * (1 - k26);

      const prev = rawCandles[i - 1];
      const prevClose = prev.close;
      const delta = c.close - prevClose;
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? -delta : 0;

      if (i <= 14) {
        avgGain = (avgGain * (i - 1) + gain) / i;
        avgLoss = (avgLoss * (i - 1) + loss) / i;
      } else {
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
      }

      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
      atr14 = i <= 14 ? (atr14 * i + tr) / (i + 1) : (atr14 * 13 + tr) / 14;

      const upMove = c.high - prev.high;
      const downMove = prev.low - c.low;
      const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;

      if (i <= 14) {
        tr14 = (tr14 * (i - 1) + tr) / i;
        plusDm14 = (plusDm14 * (i - 1) + plusDm) / i;
        minusDm14 = (minusDm14 * (i - 1) + minusDm) / i;
      } else {
        tr14 = (tr14 * 13 + tr) / 14;
        plusDm14 = (plusDm14 * 13 + plusDm) / 14;
        minusDm14 = (minusDm14 * 13 + minusDm) / 14;
      }
    }

    const plusDi14 = tr14 > 0 ? Math.min(100, (plusDm14 / tr14) * 100) : 0;
    const minusDi14 = tr14 > 0 ? Math.min(100, (minusDm14 / tr14) * 100) : 0;
    const diSum = plusDi14 + minusDi14;
    const dx = diSum > 0 ? (Math.abs(plusDi14 - minusDi14) / diSum) * 100 : 0;
    if (i > 0) {
      adx14 = i <= 14 ? (adx14 * (i - 1) + dx) / i : (adx14 * 13 + dx) / 14;
    }

    const macdLine = ema12 - ema26;
    macdSignal = i === 0 ? macdLine : macdLine * kSig + macdSignal * (1 - kSig);
    const macdHist = macdLine - macdSignal;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi14 = i === 0 ? 50 : avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    const winStart = Math.max(0, i - 19);
    const windowSlice = rawCandles.slice(winStart, i + 1);
    const meanClose = windowSlice.reduce((s, x) => s + x.close, 0) / windowSlice.length;
    const variance =
      windowSlice.reduce((s, x) => s + (x.close - meanClose) ** 2, 0) / windowSlice.length;
    const stdClose = Math.sqrt(variance) || c.close * 0.005;
    const zScore20 = (c.close - meanClose) / stdClose;

    const meanVol = windowSlice.reduce((s, x) => s + x.volume, 0) / windowSlice.length;
    const volVar =
      windowSlice.reduce((s, x) => s + (x.volume - meanVol) ** 2, 0) / windowSlice.length;
    const volStd = Math.sqrt(volVar) || meanVol * 0.15;
    const volumeZ = (c.volume - meanVol) / volStd;

    const emaSpreadPct = ((ema9 - ema21) / Math.max(0.01, ema21)) * 100;
    const atrPct = atr14 / Math.max(0.01, c.close);
    const regime = classifyRegime(emaSpreadPct, atrPct, zScore20, adx14);

    const bbMiddle20 = meanClose;
    const bbUpper20 = meanClose + 2 * stdClose;
    const bbLower20 = Math.max(0.01, meanClose - 2 * stdClose);
    const sessionWindow = classifySessionWindow(c.timestamp, c.isRegularHours);

    result.push({
      ...c,
      regime,
      sessionWindow,
      ema9,
      ema21,
      rsi14,
      macdHist,
      zScore20,
      bbUpper20,
      bbMiddle20,
      bbLower20,
      atr14,
      volumeZ,
      vwap,
      vwapDistancePct,
      adx14,
      plusDi14,
      minusDi14,
    });
  }

  return result;
}
