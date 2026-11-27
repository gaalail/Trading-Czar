import type { MarketBreadthSnapshot } from './intelligence/breadth';
import type {
  Candle,
  EntryFeatureSnapshot,
  FeatureContribution,
  ModelDecision,
  SignalAction,
  StrategyConfig,
  StrategyId,
  StrategyWeights,
} from './types';

export const DEFAULT_WEIGHTS: StrategyWeights = {
  emaCross: 1.15,
  rsi: 0.75,
  macd: 0.95,
  zScore: -0.55,
  volume: 0.4,
  bias: 0.05,
};

export const STRATEGIES: Record<StrategyId, StrategyConfig> = {
  'neural-perceptron': {
    id: 'neural-perceptron',
    version: '1.3.0',
    name: 'Momentum Perceptron',
    summary:
      'Online logistic neural scorer combining EMA slope, RSI momentum, MACD acceleration, VWAP anchor, and ADX trend gating.',
    confidenceThreshold: 0.62,
    maxPositionPct: 0.3,
    stopLossPct: 0.032,
    takeProfitPct: 0.058,
    learningRate: 0.08,
    feeBps: 5,
    useAtrSizingAndStops: true,
    useBreadthFilter: true,
    useTimeOfDayFilter: true,
    useVwapAnchor: true,
    useAdxRegimeGate: true,
  },
  'mean-reversion': {
    id: 'mean-reversion',
    version: '1.3.0',
    name: 'Mean-Reversion Z-Score',
    summary:
      'Statistical arbitrage engine targeting 20-bar and VWAP extremes while filtering runaway ADX trends via RSI and session scaling.',
    confidenceThreshold: 0.64,
    maxPositionPct: 0.25,
    stopLossPct: 0.025,
    takeProfitPct: 0.042,
    learningRate: 0.04,
    feeBps: 5,
    useAtrSizingAndStops: true,
    useBreadthFilter: true,
    useTimeOfDayFilter: true,
    useVwapAnchor: true,
    useAdxRegimeGate: true,
  },
  'regime-ensemble': {
    id: 'regime-ensemble',
    version: '1.3.0',
    name: 'Regime-Adaptive Ensemble',
    summary:
      'Combines ATR volatility and ADX(14) trend strength to blend breakout momentum and VWAP/Z-Score reversion across market regimes.',
    confidenceThreshold: 0.6,
    maxPositionPct: 0.35,
    stopLossPct: 0.03,
    takeProfitPct: 0.065,
    learningRate: 0.06,
    feeBps: 5,
    useAtrSizingAndStops: true,
    useBreadthFilter: true,
    useTimeOfDayFilter: true,
    useVwapAnchor: true,
    useAdxRegimeGate: true,
  },
};

export const STRATEGY_LIST: StrategyConfig[] = Object.values(STRATEGIES);

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, x))));
}

export function computeAtrScaledRiskGuards(
  candle: Candle,
  config: StrategyConfig
): { stopLossPct: number; takeProfitPct: number; sizeScale: number } {
  if (!config.useAtrSizingAndStops) {
    return {
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
      sizeScale: 1,
    };
  }
  const atrPct = candle.atr14 / Math.max(0.01, candle.close);
  const volRatio = atrPct / 0.011;
  const stopScale = Math.max(0.7, Math.min(1.8, volRatio));
  const sizeScale = Math.max(0.45, Math.min(1.0, 0.011 / Math.max(0.004, atrPct)));

  return {
    stopLossPct: Math.max(0.015, Math.min(0.1, config.stopLossPct * stopScale)),
    takeProfitPct: Math.max(0.025, Math.min(0.18, config.takeProfitPct * stopScale)),
    sizeScale,
  };
}

export function extractModelFeatures(candles: Candle[]): EntryFeatureSnapshot {
  const current = candles[candles.length - 1];
  const prev = candles[Math.max(0, candles.length - 2)];
  const emaSpread = ((current.ema9 - current.ema21) / Math.max(0.01, current.ema21)) * 100;
  const rsiCentered = (50 - current.rsi14) / 25;
  const macdNorm = (current.macdHist / Math.max(0.01, current.atr14)) * 1.4;
  const macdAccel = ((current.macdHist - prev.macdHist) / Math.max(0.01, current.atr14)) * 1.2;
  const volAligned =
    Math.sign(current.close - current.open) *
    Math.min(2, Math.max(-2, current.volumeZ)) *
    0.5;

  return {
    emaSpread,
    rsiCentered,
    macdNorm: macdNorm + macdAccel * 0.5,
    zScore20: current.zScore20,
    volAligned,
    vwapDistPct: current.vwapDistancePct,
    adx14: current.adx14,
  };
}

export function evaluateModel(
  symbol: string,
  candles: Candle[],
  config: StrategyConfig,
  weights: StrategyWeights,
  hasOpenPosition: boolean,
  unrealizedPnlPct: number,
  breadth?: MarketBreadthSnapshot
): ModelDecision {
  const current = candles[candles.length - 1];
  const guards = computeAtrScaledRiskGuards(current, config);

  if (hasOpenPosition && unrealizedPnlPct <= -guards.stopLossPct) {
    return {
      symbol,
      candleIndex: current.index,
      timestamp: current.timestamp,
      action: 'SELL',
      confidence: 0.96,
      score: -2.5,
      rationale: `${config.useAtrSizingAndStops ? 'ATR-adjusted stop-loss' : 'Stop-loss'} triggered at ${(unrealizedPnlPct * 100).toFixed(2)}% (limit -${(guards.stopLossPct * 100).toFixed(2)}%).`,
      contributions: [
        { label: 'Risk Guard', rawValue: `${(unrealizedPnlPct * 100).toFixed(2)}%`, contribution: -2.5 },
      ],
    };
  }

  if (hasOpenPosition && unrealizedPnlPct >= guards.takeProfitPct) {
    return {
      symbol,
      candleIndex: current.index,
      timestamp: current.timestamp,
      action: 'SELL',
      confidence: 0.92,
      score: -2.1,
      rationale: `${config.useAtrSizingAndStops ? 'ATR-adjusted target' : 'Take-profit target'} reached at +${(unrealizedPnlPct * 100).toFixed(2)}% (goal +${(guards.takeProfitPct * 100).toFixed(2)}%).`,
      contributions: [
        { label: 'Profit Target', rawValue: `+${(unrealizedPnlPct * 100).toFixed(2)}%`, contribution: -2.1 },
      ],
    };
  }

  const features = extractModelFeatures(candles);
  const { emaSpread, rsiCentered, macdNorm, zScore20, volAligned } = features;
  const zNeg = -zScore20 / 2;

  // Session, ADX & Breadth interaction multipliers (entry logic only — never impairs protective exits)
  let trendScale = 1;
  let revertScale = 1;
  let entryThresholdShift = 0;

  if (config.useTimeOfDayFilter && !hasOpenPosition) {
    if (current.sessionWindow === 'Open Drive') {
      trendScale *= 1.2;
      revertScale *= 0.78;
      entryThresholdShift -= 0.01;
    } else if (current.sessionWindow === 'Midday Chop') {
      trendScale *= 0.68;
      revertScale *= 1.18;
      entryThresholdShift += 0.04;
    } else if (current.sessionWindow === 'Power Hour') {
      trendScale *= 1.15;
      revertScale *= 0.95;
    }
  }

  let adxLabel = 'Mixed';
  let adxDelta = 0;
  if (config.useAdxRegimeGate && !hasOpenPosition) {
    if (current.adx14 >= 25) {
      adxLabel = 'Trend';
      trendScale *= 1.18;
      revertScale *= 0.78;
      entryThresholdShift -= 0.01;
      adxDelta = 0.18;
    } else if (current.adx14 < 18) {
      adxLabel = 'Chop';
      trendScale *= 0.72;
      revertScale *= 1.15;
      entryThresholdShift += 0.02;
      adxDelta = config.id === 'mean-reversion' ? 0.12 : -0.18;
    }
  }

  let breadthDelta = 0;
  let corrPenalty = 0;
  if (config.useBreadthFilter && breadth && !hasOpenPosition) {
    const weakTape = breadth.aboveEma21Pct < 35 && breadth.advancingCount < breadth.decliningCount;
    const strongTape = breadth.aboveEma21Pct >= 65;

    if (weakTape) {
      trendScale *= 0.72;
      entryThresholdShift += 0.04;
      breadthDelta = config.id === 'mean-reversion' ? -0.15 : -0.4;
      if (breadth.corrToSpy >= 0.75) {
        entryThresholdShift += 0.03;
        corrPenalty = -0.35;
      }
    } else if (strongTape) {
      trendScale *= 1.12;
      entryThresholdShift -= 0.01;
      breadthDelta = 0.2;
    }
  }

  let vwapDelta = 0;
  if (config.useVwapAnchor && !hasOpenPosition) {
    const atrPctSafe = Math.max(0.25, (current.atr14 / Math.max(0.01, current.close)) * 100);
    const vwapZ = Math.max(-2.5, Math.min(2.5, current.vwapDistancePct / atrPctSafe));

    if (config.id === 'mean-reversion') {
      vwapDelta = -vwapZ * 0.32 * revertScale;
    } else {
      if (current.vwapDistancePct > 2.2) {
        vwapDelta = -0.3; // Penalize chasing far above institutional VWAP
      } else if (current.vwapDistancePct >= 0) {
        vwapDelta = 0.22; // Healthy support above session VWAP
      } else if (current.vwapDistancePct <= -1.5) {
        vwapDelta = -0.15;
      } else {
        vwapDelta = 0.05;
      }
    }
  }

  let rawScore = 0;
  let contributions: FeatureContribution[] = [];

  if (config.id === 'neural-perceptron') {
    const cEma = emaSpread * weights.emaCross * trendScale;
    const cRsi = -rsiCentered * weights.rsi * 0.65;
    const cMacd = macdNorm * weights.macd * trendScale;
    const cZ = zNeg * weights.zScore * revertScale;
    const cVol = volAligned * weights.volume * (current.sessionWindow === 'Power Hour' ? 1.15 : 1);

    rawScore =
      cEma +
      cRsi +
      cMacd +
      cZ +
      cVol +
      weights.bias +
      breadthDelta +
      corrPenalty +
      vwapDelta +
      adxDelta;
    contributions = [
      { label: 'EMA 9/21 Spread', rawValue: `${emaSpread >= 0 ? '+' : ''}${emaSpread.toFixed(2)}%`, contribution: cEma },
      { label: 'RSI(14) Momentum', rawValue: current.rsi14.toFixed(1), contribution: cRsi },
      { label: 'MACD Acceleration', rawValue: current.macdHist.toFixed(3), contribution: cMacd },
      { label: 'Bollinger Z-Score', rawValue: zScore20.toFixed(2), contribution: cZ },
      { label: 'Volume Impulse', rawValue: `${current.volumeZ.toFixed(2)}σ`, contribution: cVol },
    ];
  } else if (config.id === 'mean-reversion') {
    const cZ = -zScore20 * 1.25 * revertScale;
    const cRsi = rsiCentered * 1.1 * revertScale;
    const cTrendFilter = -Math.abs(emaSpread) * 0.15 * trendScale;
    rawScore = cZ + cRsi + cTrendFilter + breadthDelta + corrPenalty + vwapDelta + adxDelta;
    contributions = [
      { label: '20-Bar Z-Score', rawValue: zScore20.toFixed(2), contribution: cZ },
      { label: 'RSI Reversal', rawValue: current.rsi14.toFixed(1), contribution: cRsi },
      { label: 'Trend Dampener', rawValue: `${emaSpread.toFixed(2)}%`, contribution: cTrendFilter },
    ];
  } else {
    const volRatio = current.atr14 / current.close;
    const isTrending =
      current.regime === 'Trend Up' ||
      (config.useAdxRegimeGate && current.adx14 >= 25) ||
      Math.abs(emaSpread) > 0.65 ||
      volRatio > 0.022;
    const trendScore = (emaSpread * 1.1 + macdNorm * 0.9 + volAligned * 0.4) * trendScale;
    const revertScore = (-zScore20 * 1.1 + rsiCentered * 0.9) * revertScale;
    rawScore =
      (isTrending ? trendScore * 0.78 + revertScore * 0.22 : revertScore * 0.72 + trendScore * 0.28) +
      breadthDelta +
      corrPenalty +
      vwapDelta +
      adxDelta;
    contributions = [
      { label: 'Regime Mode', rawValue: isTrending ? 'Trend Bias' : 'Mean Revert', contribution: isTrending ? trendScore * 0.78 : revertScore * 0.72 },
      { label: 'EMA 9/21 Spread', rawValue: `${emaSpread.toFixed(2)}%`, contribution: emaSpread * 0.6 * trendScale },
      { label: '20-Bar Z-Score', rawValue: zScore20.toFixed(2), contribution: -zScore20 * 0.5 * revertScale },
      { label: 'ATR Volatility', rawValue: `${(volRatio * 100).toFixed(2)}%`, contribution: volRatio * 10 },
    ];
  }

  if (config.useVwapAnchor && !hasOpenPosition) {
    contributions.push({
      label: 'Session VWAP Anchor',
      rawValue: `${current.vwapDistancePct >= 0 ? '+' : ''}${current.vwapDistancePct.toFixed(2)}%`,
      contribution: vwapDelta,
    });
  }

  if (config.useAdxRegimeGate && !hasOpenPosition) {
    contributions.push({
      label: 'ADX(14) Trend Gate',
      rawValue: `${current.adx14.toFixed(1)} (${adxLabel})`,
      contribution: adxDelta,
    });
  }

  if (config.useBreadthFilter && breadth && !hasOpenPosition) {
    contributions.push({
      label: 'Market Breadth',
      rawValue: `${breadth.aboveEma21Pct.toFixed(0)}% > EMA21`,
      contribution: breadthDelta,
    });
    if (corrPenalty !== 0) {
      contributions.push({
        label: 'SPY Beta Caution',
        rawValue: `r=${breadth.corrToSpy.toFixed(2)}`,
        contribution: corrPenalty,
      });
    }
  }

  if (config.useTimeOfDayFilter && !hasOpenPosition) {
    contributions.push({
      label: 'Time-of-Day',
      rawValue: `${current.sessionWindow} (${trendScale.toFixed(2)}x/${revertScale.toFixed(2)}x)`,
      contribution: (trendScale - revertScale) * 0.3,
    });
  }

  const effectiveEntryThreshold = Math.max(
    0.52,
    Math.min(0.85, config.confidenceThreshold + entryThresholdShift)
  );
  const buyProb = sigmoid(rawScore);
  const sellProb = 1 - buyProb;

  let action: SignalAction = 'HOLD';
  let confidence = Math.max(buyProb, sellProb);
  let rationale = 'Signal conviction below execution threshold; holding current allocation.';

  if (buyProb >= effectiveEntryThreshold && !hasOpenPosition) {
    action = 'BUY';
    confidence = buyProb;
    rationale = `Bullish composite score (+${rawScore.toFixed(2)}) cleared ${(effectiveEntryThreshold * 100).toFixed(0)}% gate in ${current.regime} (${current.sessionWindow}).`;
  } else if (sellProb >= config.confidenceThreshold && hasOpenPosition) {
    action = 'SELL';
    confidence = sellProb;
    rationale = `Bearish reversal score (${rawScore.toFixed(2)}) triggered exit in ${current.regime} regime.`;
  } else if (hasOpenPosition && buyProb >= config.confidenceThreshold) {
    rationale = `Bullish continuation (+${rawScore.toFixed(2)}) confirms holding existing ${symbol} position.`;
  }

  return {
    symbol,
    candleIndex: current.index,
    timestamp: current.timestamp,
    action,
    confidence,
    score: rawScore,
    rationale,
    contributions,
  };
}

export function adaptPerceptronWeights(
  weights: StrategyWeights,
  entrySnapshotOrCandles: EntryFeatureSnapshot | Candle[],
  realizedPnl: number,
  learningRate: number
): StrategyWeights {
  const features = Array.isArray(entrySnapshotOrCandles)
    ? extractModelFeatures(entrySnapshotOrCandles)
    : entrySnapshotOrCandles;

  const reward = Math.tanh(realizedPnl / 400);
  const clamp = (v: number) => Number(Math.max(-2.5, Math.min(2.5, v)).toFixed(3));

  return {
    emaCross: clamp(weights.emaCross + learningRate * reward * Math.sign(features.emaSpread || 1)),
    rsi: clamp(weights.rsi + learningRate * reward * features.rsiCentered),
    macd: clamp(weights.macd + learningRate * reward * Math.sign(features.macdNorm || 1)),
    zScore: clamp(weights.zScore - learningRate * reward * Math.sign(features.zScore20 || 1)),
    volume: clamp(weights.volume + learningRate * reward * Math.sign(features.volAligned || 1) * 0.5),
    bias: clamp(weights.bias + learningRate * reward * 0.25),
  };
}
