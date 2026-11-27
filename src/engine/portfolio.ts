import { generateRawSeries, SYMBOL_LIST } from './data/marketData';
import { computeMarketBreadth, computeMarketBreadthAtBar } from './intelligence/breadth';
import { enrichMarketIntelligence } from './intelligence/indicators';
import { createRiskEvent, DEFAULT_RISK_LIMITS, evaluateRiskGate } from './risk';
import {
  adaptPerceptronWeights,
  computeAtrScaledRiskGuards,
  DEFAULT_WEIGHTS,
  evaluateModel,
  STRATEGIES,
  STRATEGY_LIST,
} from './strategies';
import type {
  BacktestRow,
  Candle,
  ModelDecision,
  PortfolioState,
  Position,
  RawCandle,
  RiskLimits,
  StrategyConfig,
  StrategyId,
  SymbolId,
  TradeFill,
} from './types';

function createEmptyPositions(marketBySymbol: Record<SymbolId, Candle[]>): Record<SymbolId, Position> {
  const positions = {} as Record<SymbolId, Position>;
  for (const profile of SYMBOL_LIST) {
    const candles = marketBySymbol[profile.id];
    const price = candles?.[candles.length - 1]?.close ?? profile.initialPrice;
    positions[profile.id] = {
      symbol: profile.id,
      quantity: 0,
      avgEntryPrice: 0,
      marketPrice: price,
      openedAtIndex: 0,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
    };
  }
  return positions;
}

export function createInitialPortfolio(
  strategyId: StrategyId,
  initialCapital: number,
  marketBySymbol: Record<SymbolId, Candle[]>
): PortfolioState {
  const positions = createEmptyPositions(marketBySymbol);
  const benchmarkShares = {} as Record<SymbolId, number>;
  const perSymbolCap = initialCapital / SYMBOL_LIST.length;

  for (const profile of SYMBOL_LIST) {
    const candles = marketBySymbol[profile.id];
    const price = candles?.[candles.length - 1]?.close ?? profile.initialPrice;
    benchmarkShares[profile.id] = perSymbolCap / price;
  }

  const activeCandle = marketBySymbol.NVDA[marketBySymbol.NVDA.length - 1];

  return {
    strategyId,
    initialCapital,
    cash: initialCapital,
    realizedPnl: 0,
    totalFees: 0,
    peakEquity: initialCapital,
    maxDrawdownPct: 0,
    positions,
    trades: [],
    riskEvents: [],
    equityCurve: [
      {
        index: activeCandle.index,
        timestamp: activeCandle.timestamp,
        equity: initialCapital,
        benchmarkEquity: initialCapital,
        drawdownPct: 0,
      },
    ],
    benchmarkShares,
    weights: { ...DEFAULT_WEIGHTS },
    weightUpdates: 0,
  };
}

export function computeTotalEquity(
  portfolio: PortfolioState,
  marketBySymbol: Record<SymbolId, Candle[]>
): number {
  let holdings = 0;
  for (const profile of SYMBOL_LIST) {
    const pos = portfolio.positions[profile.id];
    const candles = marketBySymbol[profile.id];
    const price = candles[candles.length - 1]?.close ?? pos.marketPrice;
    holdings += pos.quantity * price;
  }
  return portfolio.cash + holdings;
}

function computeBenchmarkEquity(
  portfolio: PortfolioState,
  marketBySymbol: Record<SymbolId, Candle[]>
): number {
  let total = 0;
  for (const profile of SYMBOL_LIST) {
    const candles = marketBySymbol[profile.id];
    const price = candles[candles.length - 1]?.close ?? profile.initialPrice;
    total += (portfolio.benchmarkShares[profile.id] ?? 0) * price;
  }
  return total;
}

export function executeOrder(
  portfolio: PortfolioState,
  symbol: SymbolId,
  side: 'BUY' | 'SELL',
  candles: Candle[],
  marketBySymbol: Record<SymbolId, Candle[]>,
  config: StrategyConfig,
  origin: 'AI' | 'MANUAL',
  confidence: number | null,
  reason: string,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): PortfolioState {
  const latest = candles[candles.length - 1];
  const currentPos = portfolio.positions[symbol];
  const totalEquity = computeTotalEquity(portfolio, marketBySymbol);
  const feeRate = config.feeBps / 10000;

  let quantity = 0;
  if (side === 'BUY') {
    const { sizeScale } = computeAtrScaledRiskGuards(latest, config);
    const budget = Math.min(
      portfolio.cash * 0.98,
      totalEquity * config.maxPositionPct * sizeScale
    );
    quantity = Math.floor(budget / (latest.close * (1 + feeRate)));
  } else {
    quantity = currentPos.quantity;
  }

  // Spread + square-root market impact model scaled by bar participation
  const participation = latest.volume > 0 ? quantity / latest.volume : 0;
  const impactBps = Number(
    (config.feeBps * 0.4 + Math.sqrt(Math.max(0, participation)) * 35).toFixed(2)
  );
  const slippageMult =
    side === 'BUY' ? 1 + impactBps / 10000 : 1 - impactBps / 10000;
  const fillPrice = Number((latest.close * slippageMult).toFixed(4));

  const notional = quantity * fillPrice;
  const fee = Number((notional * feeRate).toFixed(2));

  const riskResult = evaluateRiskGate({
    portfolio,
    symbol,
    side,
    quantity,
    price: fillPrice,
    fee,
    totalEquity,
    limits,
    latestCandle: latest,
  });

  const riskEvent = createRiskEvent({
    timestamp: latest.timestamp,
    symbol,
    side,
    origin,
    result: riskResult,
    seq: portfolio.riskEvents.length + 1,
  });

  const updatedRiskEvents = [riskEvent, ...portfolio.riskEvents].slice(0, 120);

  if (!riskResult.approved) {
    return {
      ...portfolio,
      riskEvents: updatedRiskEvents,
    };
  }

  const clientOrderId = `paper-${config.id}-${symbol}-${latest.index}-${side}-${portfolio.trades.length + 1}`;

  if (side === 'BUY') {
    const newQty = currentPos.quantity + quantity;
    const newAvg = (currentPos.quantity * currentPos.avgEntryPrice + notional) / newQty;

    const updatedPos: Position = {
      symbol,
      quantity: newQty,
      avgEntryPrice: newAvg,
      marketPrice: latest.close,
      openedAtIndex: currentPos.quantity === 0 ? latest.index : currentPos.openedAtIndex,
      unrealizedPnl: (latest.close - newAvg) * newQty,
      unrealizedPnlPct: (latest.close - newAvg) / newAvg,
    };

    const fill: TradeFill = {
      id: `${symbol}-${latest.index}-${portfolio.trades.length + 1}`,
      clientOrderId,
      timestamp: latest.timestamp,
      candleIndex: latest.index,
      symbol,
      side: 'BUY',
      origin,
      quantity,
      price: fillPrice,
      fee,
      impactBps,
      realizedPnl: null,
      confidence,
      reason,
    };

    return {
      ...portfolio,
      cash: Number((portfolio.cash - notional - fee).toFixed(2)),
      totalFees: Number((portfolio.totalFees + fee).toFixed(2)),
      positions: {
        ...portfolio.positions,
        [symbol]: updatedPos,
      },
      trades: [fill, ...portfolio.trades],
      riskEvents: updatedRiskEvents,
    };
  }

  const realized = Number(((fillPrice - currentPos.avgEntryPrice) * quantity - fee).toFixed(2));

  const updatedPos: Position = {
    symbol,
    quantity: 0,
    avgEntryPrice: 0,
    marketPrice: latest.close,
    openedAtIndex: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
  };

  const nextWeights =
    origin === 'AI' && config.id === 'neural-perceptron'
      ? adaptPerceptronWeights(portfolio.weights, candles, realized, config.learningRate)
      : portfolio.weights;

  const fill: TradeFill = {
    id: `${symbol}-${latest.index}-${portfolio.trades.length + 1}`,
    clientOrderId,
    timestamp: latest.timestamp,
    candleIndex: latest.index,
    symbol,
    side: 'SELL',
    origin,
    quantity,
    price: fillPrice,
    fee,
    impactBps,
    realizedPnl: realized,
    confidence,
    reason,
  };

  return {
    ...portfolio,
    cash: Number((portfolio.cash + notional - fee).toFixed(2)),
    realizedPnl: Number((portfolio.realizedPnl + realized).toFixed(2)),
    totalFees: Number((portfolio.totalFees + fee).toFixed(2)),
    positions: {
      ...portfolio.positions,
      [symbol]: updatedPos,
    },
    trades: [fill, ...portfolio.trades],
    riskEvents: updatedRiskEvents,
    weights: nextWeights,
    weightUpdates:
      origin === 'AI' && config.id === 'neural-perceptron'
        ? portfolio.weightUpdates + 1
        : portfolio.weightUpdates,
  };
}

export function markToMarketAndRecord(
  portfolio: PortfolioState,
  marketBySymbol: Record<SymbolId, Candle[]>,
  activeSymbol: SymbolId
): PortfolioState {
  const nextPositions = { ...portfolio.positions };
  for (const profile of SYMBOL_LIST) {
    const pos = nextPositions[profile.id];
    const candles = marketBySymbol[profile.id];
    const latestPrice = candles[candles.length - 1].close;
    const unrealized = pos.quantity > 0 ? (latestPrice - pos.avgEntryPrice) * pos.quantity : 0;
    const unrealizedPct =
      pos.quantity > 0 && pos.avgEntryPrice > 0 ? (latestPrice - pos.avgEntryPrice) / pos.avgEntryPrice : 0;

    nextPositions[profile.id] = {
      ...pos,
      marketPrice: latestPrice,
      unrealizedPnl: unrealized,
      unrealizedPnlPct: unrealizedPct,
    };
  }

  const nextPortfolio: PortfolioState = {
    ...portfolio,
    positions: nextPositions,
  };

  const equity = computeTotalEquity(nextPortfolio, marketBySymbol);
  const benchmarkEquity = computeBenchmarkEquity(nextPortfolio, marketBySymbol);
  const peakEquity = Math.max(portfolio.peakEquity, equity);
  const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
  const maxDrawdownPct = Math.max(portfolio.maxDrawdownPct, drawdownPct);
  const activeCandle = marketBySymbol[activeSymbol][marketBySymbol[activeSymbol].length - 1];

  return {
    ...nextPortfolio,
    peakEquity,
    maxDrawdownPct,
    equityCurve: [
      ...portfolio.equityCurve.slice(-199),
      {
        index: activeCandle.index,
        timestamp: activeCandle.timestamp,
        equity: Number(equity.toFixed(2)),
        benchmarkEquity: Number(benchmarkEquity.toFixed(2)),
        drawdownPct: Number(drawdownPct.toFixed(2)),
      },
    ],
  };
}

export function stepAISignals(
  portfolio: PortfolioState,
  marketBySymbol: Record<SymbolId, Candle[]>,
  config: StrategyConfig,
  autoExecute: boolean,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): { portfolio: PortfolioState; decisions: Record<SymbolId, ModelDecision> } {
  let nextPortfolio = portfolio;
  const decisions = {} as Record<SymbolId, ModelDecision>;

  for (const profile of SYMBOL_LIST) {
    const candles = marketBySymbol[profile.id];
    const pos = nextPortfolio.positions[profile.id];
    const breadth = computeMarketBreadth(marketBySymbol, profile.id);
    const decision = evaluateModel(
      profile.id,
      candles,
      config,
      nextPortfolio.weights,
      pos.quantity > 0,
      pos.unrealizedPnlPct,
      breadth
    );
    decisions[profile.id] = decision;

    if (autoExecute && decision.action !== 'HOLD') {
      nextPortfolio = executeOrder(
        nextPortfolio,
        profile.id,
        decision.action,
        candles,
        marketBySymbol,
        config,
        'AI',
        decision.confidence,
        decision.rationale,
        limits
      );
    }
  }

  return {
    portfolio: nextPortfolio,
    decisions,
  };
}

export function computePortfolioStats(portfolio: PortfolioState, totalEquity: number) {
  const closedTrades = portfolio.trades.filter((t) => t.realizedPnl !== null);
  const wins = closedTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.realizedPnl ?? 0) < 0);

  const grossProfit = wins.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.realizedPnl ?? 0), 0));
  const winRatePct = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 3.5 : 0;

  const curve = portfolio.equityCurve;
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    if (prev > 0) {
      returns.push((curve[i].equity - prev) / prev);
    }
  }

  let sharpeRatio = 0;
  let sortinoRatio = 0;
  if (returns.length > 2) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    const downsideSq =
      returns.reduce((s, r) => s + (r < 0 ? r * r : 0), 0) / returns.length;
    const downsideDev = Math.sqrt(downsideSq);
    sortinoRatio = downsideDev > 0 ? (mean / downsideDev) * Math.sqrt(252) : sharpeRatio;
  }

  const totalReturnPct =
    ((totalEquity - portfolio.initialCapital) / portfolio.initialCapital) * 100;
  const calmarRatio =
    portfolio.maxDrawdownPct > 0.05
      ? totalReturnPct / portfolio.maxDrawdownPct
      : totalReturnPct > 0
        ? totalReturnPct
        : 0;

  const benchStart = curve[0]?.benchmarkEquity ?? portfolio.initialCapital;
  const benchEnd = curve[curve.length - 1]?.benchmarkEquity ?? portfolio.initialCapital;
  const benchmarkReturnPct =
    benchStart > 0 ? ((benchEnd - benchStart) / benchStart) * 100 : 0;
  const alphaPct = totalReturnPct - benchmarkReturnPct;

  return {
    totalReturnPct,
    benchmarkReturnPct,
    alphaPct,
    winRatePct,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    closedCount: closedTrades.length,
  };
}

function calcSharpeFromSeries(series: number[]): number {
  if (series.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) {
      returns.push((series[i] - series[i - 1]) / series[i - 1]);
    }
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
  return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
}

export interface CustomDatasetMap {
  [key: string]: { rawCandles: RawCandle[]; fingerprint: string } | undefined;
}

export function runWalkForwardMatrix(
  initialCapital = 100000,
  bars = 240,
  inSamplePct = 65,
  feeBpsOverride?: number,
  customDatasets?: CustomDatasetMap,
  strategyConfigsOverride?: Record<StrategyId, StrategyConfig>
): BacktestRow[] {
  const rows: BacktestRow[] = [];
  const seed = 409;
  const warmup = 25;
  const activeStrategies = strategyConfigsOverride
    ? STRATEGY_LIST.map((s) => strategyConfigsOverride[s.id] ?? STRATEGIES[s.id])
    : STRATEGY_LIST;

  const enrichedBySymbol = {} as Record<SymbolId, Candle[]>;
  const fingerprintBySymbol = {} as Record<SymbolId, string>;

  for (const profile of SYMBOL_LIST) {
    const custom = customDatasets?.[profile.id];
    const rawCandles = custom ? custom.rawCandles : generateRawSeries(profile.id, bars, seed).rawCandles;
    enrichedBySymbol[profile.id] = enrichMarketIntelligence(rawCandles);
    fingerprintBySymbol[profile.id] = custom
      ? custom.fingerprint
      : `sim-15m-${profile.id.toLowerCase()}-${rawCandles.length}b-s${seed}`;
  }

  for (const profile of SYMBOL_LIST) {
    const candles = enrichedBySymbol[profile.id];
    const effectiveBars = candles.length;
    const splitIndex = Math.max(
      warmup + 15,
      Math.min(effectiveBars - 15, Math.floor((effectiveBars * inSamplePct) / 100))
    );
    const datasetFingerprint = fingerprintBySymbol[profile.id];

    for (const strategy of activeStrategies) {
      const effectiveFeeBps = feeBpsOverride ?? strategy.feeBps;
      const effectiveConfig: StrategyConfig = {
        ...strategy,
        feeBps: effectiveFeeBps,
      };

      let cash = initialCapital;
      let shares = 0;
      let avgEntry = 0;
      let peak = initialCapital;
      let maxDd = 0;
      let weights = { ...DEFAULT_WEIGHTS };
      const closedPnls: number[] = [];
      const isEquitySeries: number[] = [];
      const oosEquitySeries: number[] = [];
      let oosStartEquity = initialCapital;
      const oosStartPrice = candles[splitIndex].close;

      for (let i = warmup; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const bar = candles[i];
        const unrealizedPct = shares > 0 && avgEntry > 0 ? (bar.close - avgEntry) / avgEntry : 0;
        const breadth = effectiveConfig.useBreadthFilter
          ? computeMarketBreadthAtBar(enrichedBySymbol, profile.id, i)
          : undefined;
        const decision = evaluateModel(
          profile.id,
          slice,
          effectiveConfig,
          weights,
          shares > 0,
          unrealizedPct,
          breadth
        );

        const inOos = i >= splitIndex;
        if (i === splitIndex) {
          oosStartEquity = cash + shares * bar.close;
        }

        if (bar.isRegularHours && decision.action === 'BUY' && shares === 0) {
          const { sizeScale } = computeAtrScaledRiskGuards(bar, effectiveConfig);
          const budget = cash * effectiveConfig.maxPositionPct * 2.5 * sizeScale;
          const usable = Math.min(cash * 0.98, budget);
          const feeRate = effectiveFeeBps / 10000;
          const qty = Math.floor(usable / (bar.close * (1 + feeRate)));
          if (qty > 0 && (bar.volume === 0 || qty / bar.volume <= 0.05)) {
            const impactMult = 1 + (effectiveFeeBps * 0.4) / 10000;
            const fillPx = bar.close * impactMult;
            const cost = qty * fillPx * (1 + feeRate);
            if (cost <= cash) {
              cash -= cost;
              shares = qty;
              avgEntry = fillPx;
            }
          }
        } else if (bar.isRegularHours && decision.action === 'SELL' && shares > 0) {
          const feeRate = effectiveFeeBps / 10000;
          const impactMult = 1 - (effectiveFeeBps * 0.4) / 10000;
          const fillPx = bar.close * impactMult;
          const proceeds = shares * fillPx * (1 - feeRate);
          const pnl = proceeds - shares * avgEntry;
          closedPnls.push(pnl);
          if (!inOos && effectiveConfig.id === 'neural-perceptron') {
            weights = adaptPerceptronWeights(weights, slice, pnl, effectiveConfig.learningRate);
          }
          cash += proceeds;
          shares = 0;
          avgEntry = 0;
        }

        const eq = cash + shares * bar.close;
        if (i < splitIndex) {
          isEquitySeries.push(eq);
        } else {
          oosEquitySeries.push(eq);
        }

        if (eq > peak) peak = eq;
        const dd = ((peak - eq) / peak) * 100;
        if (dd > maxDd) maxDd = dd;
      }

      const finalEquity = cash + shares * candles[candles.length - 1].close;
      const isEndEquity = isEquitySeries[isEquitySeries.length - 1] ?? initialCapital;
      const inSampleReturnPct = ((isEndEquity - initialCapital) / initialCapital) * 100;
      const outOfSampleReturnPct = ((finalEquity - oosStartEquity) / oosStartEquity) * 100;
      const benchmarkOosReturnPct =
        ((candles[candles.length - 1].close - oosStartPrice) / oosStartPrice) * 100;

      const wins = closedPnls.filter((p) => p > 0);
      const losses = closedPnls.filter((p) => p < 0);
      const grossWin = wins.reduce((s, p) => s + p, 0);
      const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
      const winRatePct = closedPnls.length > 0 ? (wins.length / closedPnls.length) * 100 : 0;
      const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3.5 : 0;
      const inSampleSharpe = calcSharpeFromSeries(isEquitySeries);
      const outOfSampleSharpe = calcSharpeFromSeries(oosEquitySeries);

      const validationFlags: string[] = [];
      if (closedPnls.length < 4) {
        validationFlags.push('Low Sample');
      }
      if (inSampleReturnPct > 1.5 && outOfSampleReturnPct < inSampleReturnPct * 0.3) {
        validationFlags.push('OOS Decay');
      }
      if (outOfSampleReturnPct < benchmarkOosReturnPct - 0.5) {
        validationFlags.push('Trails Benchmark');
      }
      if (closedPnls.length >= 4 && winRatePct >= 65 && profitFactor < 1.15) {
        validationFlags.push('Win-Rate Trap');
      }
      if (validationFlags.length === 0) {
        validationFlags.push('Clean Pass');
      }

      rows.push({
        strategyId: effectiveConfig.id,
        strategyVersion: effectiveConfig.version,
        strategyName: effectiveConfig.name,
        symbol: profile.id,
        horizonBars: effectiveBars,
        inSamplePct,
        feeBps: effectiveFeeBps,
        inSampleReturnPct,
        outOfSampleReturnPct,
        benchmarkOosReturnPct,
        inSampleSharpe,
        outOfSampleSharpe,
        maxDrawdownPct: maxDd,
        winRatePct,
        tradeCount: closedPnls.length,
        profitFactor,
        finalEquity,
        datasetFingerprint,
        validationFlags,
      });
    }
  }

  return rows;
}
