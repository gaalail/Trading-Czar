import type { MarketBreadthSnapshot } from './intelligence/breadth';
import type {
  Candle,
  FeatureContribution,
  ModelDecision,
  SignalAction,
  StrategyConfig,
  StrategyId,
  StrategyWeights,
  SymbolId,
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
    version: '1.1.0',
    name: 'Momentum Perceptron',
    summary:
      'Online logistic neural scorer combining EMA slope, RSI momentum, MACD acceleration, and volume flow with live weight updates.',
    confidenceThreshold: 0.62,
    maxPositionPct: 0.3,
    stopLossPct: 0.032,
    takeProfitPct: 0.058,
    learningRate: 0.08,
    feeBps: 5,
    useAtrSizingAndStops: true,
    useBreadthFilter: true,
    useTimeOfDayFilter: true,
  },
  'mean-reversion': {
    id: 'mean-reversion',
    version: '1.1.0',
    name: 'Mean-Reversion Z-Score',
    summary:
      'Statistical arbitrage engine targeting 20-bar price extremes while filtering runaway trend breakouts via RSI bounds.',
    confidenceThreshold: 0.64,
    maxPositionPct: 0.25,
    stopLossPct: 0.025,
    takeProfitPct: 0.042,
    learningRate: 0.04,
    feeBps: 5,
    useAtrSizingAndStops: true,
    useBreadthFilter: true,
    useTimeOfDayFilter: true,
  },
  'regime-ensemble': {
    id: 'regime-ensemble',
    version: '1.1.0',
    name: 'Regime-Adaptive Ensemble',
    summary:
      'Detects active market volatility regime (ATR / Price) and blends trend-following with mean-reversion dynamically.',
    confidenceThreshold: 0.6,
    maxPositionPct: 0.35,
    stopLossPct: 0.03,
    takeProfitPct: 0.065,
    learningRate: 0.06,
    feeBps: 5,
    useAtrSizingAndStops: true,
    useBreadthFilter: true,
    useTimeOfDayFilter: true,
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

export function evaluateModel(
  symbol: SymbolId,
  candles: Candle[],
  config: StrategyConfig,
  weights: StrategyWeights,
  hasOpenPosition: boolean,
  unrealizedPnlPct: number,
  breadth?: MarketBreadthSnapshot
): ModelDecision {
  const current = candles[candles.length - 1];
  const prev = candles[Math.max(0, candles.length - 2)];
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

  const emaSpread = ((current.ema9 - current.ema21) / Math.max(0.01, current.ema21)) * 100;
  const rsiCentered = (50 - current.rsi14) / 25;
  const macdNorm = (current.macdHist / Math.max(0.01, current.atr14)) * 1.4;
  const macdAccel = ((current.macdHist - prev.macdHist) / Math.max(0.01, current.atr14)) * 1.2;
  const zNeg = -current.zScore20 / 2;
  const volAligned = Math.sign(current.close - current.open) * Math.min(2, Math.max(-2, current.volumeZ)) * 0.5;

  let rawScore = 0;
  let contributions: FeatureContribution[] = [];

  if (config.id === 'neural-perceptron') {
    const cEma = emaSpread * weights.emaCross;
    const cRsi = -rsiCentered * weights.rsi * 0.65;
    const cMacd = (macdNorm + macdAccel * 0.5) * weights.macd;
    const cZ = zNeg * weights.zScore;
    const cVol = volAligned * weights.volume;

    rawScore = cEma + cRsi + cMacd + cZ + cVol + weights.bias;
    contributions = [
      { label: 'EMA 9/21 Spread', rawValue: `${emaSpread >= 0 ? '+' : ''}${emaSpread.toFixed(2)}%`, contribution: cEma },
      { label: 'RSI(14) Momentum', rawValue: current.rsi14.toFixed(1), contribution: cRsi },
      { label: 'MACD Acceleration', rawValue: current.macdHist.toFixed(3), contribution: cMacd },
      { label: 'Bollinger Z-Score', rawValue: current.zScore20.toFixed(2), contribution: cZ },
      { label: 'Volume Impulse', rawValue: `${current.volumeZ.toFixed(2)}σ`, contribution: cVol },
    ];
  } else if (config.id === 'mean-reversion') {
    const cZ = -current.zScore20 * 1.25;
    const cRsi = rsiCentered * 1.1;
    const cTrendFilter = -Math.abs(emaSpread) * 0.15;
    rawScore = cZ + cRsi + cTrendFilter;
    contributions = [
      { label: '20-Bar Z-Score', rawValue: current.zScore20.toFixed(2), contribution: cZ },
      { label: 'RSI Reversal', rawValue: current.rsi14.toFixed(1), contribution: cRsi },
      { label: 'Trend Dampener', rawValue: `${emaSpread.toFixed(2)}%`, contribution: cTrendFilter },
    ];
  } else {
    const volRatio = current.atr14 / current.close;
    const isTrending = current.regime === 'Trend Up' || Math.abs(emaSpread) > 0.65 || volRatio > 0.022;
    const trendScore = emaSpread * 1.1 + macdNorm * 0.9 + volAligned * 0.4;
    const revertScore = -current.zScore20 * 1.1 + rsiCentered * 0.9;
    rawScore = isTrending ? trendScore * 0.78 + revertScore * 0.22 : revertScore * 0.72 + trendScore * 0.28;
    contributions = [
      { label: 'Regime Mode', rawValue: isTrending ? 'Trend Bias' : 'Mean Revert', contribution: isTrending ? trendScore * 0.78 : revertScore * 0.72 },
      { label: 'EMA 9/21 Spread', rawValue: `${emaSpread.toFixed(2)}%`, contribution: emaSpread * 0.6 },
      { label: '20-Bar Z-Score', rawValue: current.zScore20.toFixed(2), contribution: -current.zScore20 * 0.5 },
      { label: 'ATR Volatility', rawValue: `${(volRatio * 100).toFixed(2)}%`, contribution: volRatio * 10 },
    ];
  }

  // Synergistic Market Breadth Filter (entry discipline only — never blocks risk exits)
  if (config.useBreadthFilter && breadth && !hasOpenPosition) {
    let cBreadth = 0;
    if (breadth.aboveEma21Pct < 35 && breadth.advancingCount < breadth.decliningCount) {
      cBreadth = config.id === 'mean-reversion' ? -0.25 : -0.65;
    } else if (breadth.aboveEma21Pct >= 65) {
      cBreadth = 0.25;
    }
    rawScore += cBreadth;
    contributions.push({
      label: 'Market Breadth',
      rawValue: `${breadth.aboveEma21Pct.toFixed(0)}% > EMA21`,
      contribution: cBreadth,
    });
  }

  // Synergistic Time-of-Day Session Shaping (entry discipline only — never blocks exits)
  if (config.useTimeOfDayFilter && !hasOpenPosition) {
    let cSession = 0;
    if (current.sessionWindow === 'Open Drive' || current.sessionWindow === 'Power Hour') {
      cSession = 0.25;
    } else if (current.sessionWindow === 'Midday Chop') {
      cSession = -0.45;
    }
    rawScore += cSession;
    contributions.push({
      label: 'Time-of-Day',
      rawValue: current.sessionWindow,
      contribution: cSession,
    });
  }

  const buyProb = sigmoid(rawScore);
  const sellProb = 1 - buyProb;

  let action: SignalAction = 'HOLD';
  let confidence = Math.max(buyProb, sellProb);
  let rationale = 'Signal conviction below execution threshold; holding current allocation.';

  if (buyProb >= config.confidenceThreshold && !hasOpenPosition) {
    action = 'BUY';
    confidence = buyProb;
    rationale = `Bullish composite score (+${rawScore.toFixed(2)}) cleared ${(config.confidenceThreshold * 100).toFixed(0)}% threshold in ${current.regime} (${current.sessionWindow}).`;
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
  candles: Candle[],
  realizedPnl: number,
  learningRate: number
): StrategyWeights {
  const current = candles[candles.length - 1];
  const reward = Math.tanh(realizedPnl / 400);
  const emaSpread = ((current.ema9 - current.ema21) / Math.max(0.01, current.ema21)) * 100;
  const clamp = (v: number) => Number(Math.max(-2.5, Math.min(2.5, v)).toFixed(3));

  return {
    emaCross: clamp(weights.emaCross + learningRate * reward * Math.sign(emaSpread || 1)),
    rsi: clamp(weights.rsi + learningRate * reward * ((current.rsi14 - 50) / 50)),
    macd: clamp(weights.macd + learningRate * reward * Math.sign(current.macdHist || 1)),
    zScore: clamp(weights.zScore - learningRate * reward * Math.sign(current.zScore20 || 1)),
    volume: clamp(weights.volume + learningRate * reward * Math.sign(current.volumeZ || 1) * 0.5),
    bias: clamp(weights.bias + learningRate * reward * 0.25),
  };
}
