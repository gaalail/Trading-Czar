import { describe, expect, it } from 'vitest';
import {
  generateRawSeries,
  generateSampleScenarioSeries,
  parseHistoricalOhlcvCsv,
  SYMBOL_LIST,
} from '../src/engine/data/marketData';
import { computeMarketBreadth } from '../src/engine/intelligence/breadth';
import {
  buildSimulatedDiscoveredBars,
  buildSimulatedDiscoverySnapshots,
  rankDiscoveryMovers,
} from '../src/engine/intelligence/discovery';
import { enrichMarketIntelligence } from '../src/engine/intelligence/indicators';
import { rankMarketOpportunities } from '../src/engine/intelligence/scanner';
import {
  computePortfolioStats,
  computeTotalEquity,
  createInitialPortfolio,
  markToMarketAndRecord,
  runDiscoveredSymbolWalkForward,
  runPortfolioWalkForward,
  runWalkForwardMatrix,
  stepAISignals,
} from '../src/engine/portfolio';
import { DEFAULT_RISK_LIMITS } from '../src/engine/risk';
import {
  adaptPerceptronWeights,
  computeAtrScaledRiskGuards,
  DEFAULT_WEIGHTS,
  evaluateModel,
  STRATEGIES,
} from '../src/engine/strategies';
import type { Candle, SymbolId } from '../src/engine/types';

describe('Layer Separation & Research Integrity', () => {
  it('Data layer outputs pure OHLCV bars without indicator or regime leakage', () => {
    const { rawCandles } = generateRawSeries('NVDA', 40, 101);
    expect(rawCandles).toHaveLength(40);
    const bar = rawCandles[0] as unknown as Record<string, unknown>;
    expect(bar.ema9).toBeUndefined();
    expect(bar.rsi14).toBeUndefined();
    expect(bar.regime).toBeUndefined();
    expect(typeof bar.isRegularHours).toBe('boolean');
  });

  it('Intelligence layer computes causal indicators and Bollinger Bands without look-ahead leakage', () => {
    const { rawCandles } = generateRawSeries('AAPL', 60, 202);
    const prefixEnriched = enrichMarketIntelligence(rawCandles.slice(0, 45));
    const fullEnriched = enrichMarketIntelligence(rawCandles);

    const barPrefix = prefixEnriched[44];
    const barFull = fullEnriched[44];

    expect(barPrefix.ema9).toBeCloseTo(barFull.ema9, 10);
    expect(barPrefix.ema21).toBeCloseTo(barFull.ema21, 10);
    expect(barPrefix.rsi14).toBeCloseTo(barFull.rsi14, 10);
    expect(barPrefix.zScore20).toBeCloseTo(barFull.zScore20, 10);
    expect(barPrefix.bbMiddle20).toBeCloseTo(barFull.bbMiddle20, 10);
    expect(barPrefix.bbUpper20).toBeCloseTo(barFull.bbUpper20, 10);
    expect(barPrefix.bbLower20).toBeCloseTo(barFull.bbLower20, 10);
    expect(barPrefix.vwap).toBeCloseTo(barFull.vwap, 10);
    expect(barPrefix.adx14).toBeCloseTo(barFull.adx14, 10);
    expect(barPrefix.plusDi14).toBeCloseTo(barFull.plusDi14, 10);
    expect(barPrefix.minusDi14).toBeCloseTo(barFull.minusDi14, 10);
    expect(barFull.adx14).toBeGreaterThanOrEqual(0);
    expect(barFull.adx14).toBeLessThanOrEqual(100);
    expect(barFull.bbLower20).toBeLessThanOrEqual(barFull.bbMiddle20);
    expect(barFull.bbMiddle20).toBeLessThanOrEqual(barFull.bbUpper20);
    expect(barPrefix.regime).toBe(barFull.regime);
  });

  it('Breadth intelligence computes universe advance/decline and SPY correlation', () => {
    const market = {} as Record<SymbolId, Candle[]>;
    for (const profile of SYMBOL_LIST) {
      const { rawCandles } = generateRawSeries(profile.id, 60, 101);
      market[profile.id] = enrichMarketIntelligence(rawCandles);
    }

    const spyBreadth = computeMarketBreadth(market, 'SPY');
    expect(spyBreadth.advancingCount + spyBreadth.decliningCount).toBe(SYMBOL_LIST.length);
    expect(spyBreadth.corrToSpy).toBeCloseTo(1, 5);
    expect(spyBreadth.aboveEma21Pct).toBeGreaterThanOrEqual(0);
    expect(spyBreadth.aboveEma21Pct).toBeLessThanOrEqual(100);
  });

  it('Sample stress-test scenarios generate 240 valid bars for each regime', () => {
    const scenarios = ['sideways-chop', 'tech-rally', 'vol-selloff'] as const;
    for (const sc of scenarios) {
      const dataset = generateSampleScenarioSeries(sc, 'NVDA', 240);
      expect(dataset.rawCandles).toHaveLength(240);
      expect(dataset.fingerprint).toContain(`sample-${sc}-nvda-240b`);
      for (const bar of dataset.rawCandles) {
        expect(bar.high).toBeGreaterThanOrEqual(bar.low);
        expect(bar.close).toBeGreaterThan(0);
      }
    }
  });

  it('CSV parser validates OHLCV format and feeds walk-forward matrix', () => {
    const header = 'Date,Open,High,Low,Close,Volume';
    const rows: string[] = [header];
    for (let i = 0; i < 80; i++) {
      const px = 100 + Math.sin(i / 6) * 4 + i * 0.1;
      rows.push(
        `2026-10-${String((i % 28) + 1).padStart(2, '0')} 10:00,${px.toFixed(2)},${(px + 1).toFixed(2)},${(px - 1).toFixed(2)},${(px + 0.3).toFixed(2)},900000`
      );
    }

    const parsed = parseHistoricalOhlcvCsv(rows.join('\n'), 'nvda_real.csv');
    expect(parsed.rawCandles).toHaveLength(80);
    expect(parsed.fingerprint).toContain('csv-nvda_realcsv-80b');

    const matrix = runWalkForwardMatrix(100000, 240, 65, 5, { NVDA: parsed });
    const nvdaRow = matrix.find((r) => r.symbol === 'NVDA');
    expect(nvdaRow?.datasetFingerprint).toBe(parsed.fingerprint);
    expect(nvdaRow?.horizonBars).toBe(80);
  });

  it('Strategy layer returns deterministic signal decisions without mutating inputs', () => {
    const { rawCandles } = generateRawSeries('SPY', 64, 303);
    const candles = enrichMarketIntelligence(rawCandles);
    const snapshot = JSON.stringify(candles);

    const decision = evaluateModel(
      'SPY',
      candles,
      STRATEGIES['mean-reversion'],
      DEFAULT_WEIGHTS,
      false,
      0
    );

    expect(['BUY', 'SELL', 'HOLD']).toContain(decision.action);
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
    expect(JSON.stringify(candles)).toBe(snapshot);
  });

  it('Walk-forward backtest matrix is reproducible and includes dataset fingerprints and validationFlags', () => {
    const run1 = runWalkForwardMatrix(100000, 180, 65, 5);
    const run2 = runWalkForwardMatrix(100000, 180, 65, 5);

    expect(run1).toHaveLength(18);
    expect(run1[0].datasetFingerprint).toMatch(/^sim-15m-/);
    expect(run1[0].outOfSampleReturnPct).toBe(run2[0].outOfSampleReturnPct);
    expect(run1[0].outOfSampleSharpe).toBe(run2[0].outOfSampleSharpe);
    for (const row of run1) {
      expect(Array.isArray(row.validationFlags)).toBe(true);
      expect(row.validationFlags.length).toBeGreaterThan(0);
    }
  });

  it('Portfolio stats compute finite Sortino, Calmar, and Alpha vs. Benchmark', () => {
    const market = {} as Record<SymbolId, Candle[]>;
    for (const profile of SYMBOL_LIST) {
      const { rawCandles } = generateRawSeries(profile.id, 60, 404);
      market[profile.id] = enrichMarketIntelligence(rawCandles);
    }
    let portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    for (let i = 0; i < 6; i++) {
      const stepped = stepAISignals(
        portfolio,
        market,
        STRATEGIES['neural-perceptron'],
        true,
        DEFAULT_RISK_LIMITS
      );
      portfolio = markToMarketAndRecord(stepped.portfolio, market, 'NVDA');
    }
    const equity = computeTotalEquity(portfolio, market);
    const stats = computePortfolioStats(portfolio, equity);

    expect(Number.isFinite(stats.sortinoRatio)).toBe(true);
    expect(Number.isFinite(stats.calmarRatio)).toBe(true);
    expect(Number.isFinite(stats.alphaPct)).toBe(true);
    expect(Number.isFinite(stats.benchmarkReturnPct)).toBe(true);
  });

  it('Session windows, ATR risk scaling, and breadth/time-of-day filters behave causally', () => {
    const { rawCandles } = generateRawSeries('TSLA', 64, 505);
    const tslaCandles = enrichMarketIntelligence(rawCandles);
    const windows = new Set(tslaCandles.map((c) => c.sessionWindow));
    expect(windows.has('Open Drive')).toBe(true);
    expect(windows.has('Midday Chop')).toBe(true);
    expect(windows.has('Power Hour')).toBe(true);

    const highAtrBar: Candle = {
      ...tslaCandles[tslaCandles.length - 1],
      close: 300,
      atr14: 6.6,
    };
    const lowAtrBar: Candle = {
      ...tslaCandles[tslaCandles.length - 1],
      close: 300,
      atr14: 1.8,
    };
    const cfg = STRATEGIES['neural-perceptron'];
    const highGuards = computeAtrScaledRiskGuards(highAtrBar, cfg);
    const lowGuards = computeAtrScaledRiskGuards(lowAtrBar, cfg);

    expect(highGuards.sizeScale).toBeLessThan(lowGuards.sizeScale);
    expect(highGuards.stopLossPct).toBeGreaterThan(lowGuards.stopLossPct);

    const decision = evaluateModel(
      'TSLA',
      tslaCandles,
      cfg,
      DEFAULT_WEIGHTS,
      false,
      0,
      {
        advancingCount: 1,
        decliningCount: 5,
        aboveEma21Pct: 16.7,
        meanRsi14: 38,
        corrToSpy: 0.72,
        dominantRegime: 'Mean Reverting',
      }
    );
    expect(decision.contributions.some((c) => c.label === 'Market Breadth')).toBe(true);
    expect(decision.contributions.some((c) => c.label === 'Time-of-Day')).toBe(true);
  });

  it('Opportunity scanner ranks the entire universe read-only by setup score', () => {
    const market = {} as Record<SymbolId, Candle[]>;
    const decisions = {} as Record<SymbolId, ReturnType<typeof evaluateModel>>;
    for (const profile of SYMBOL_LIST) {
      const { rawCandles } = generateRawSeries(profile.id, 64, 606);
      market[profile.id] = enrichMarketIntelligence(rawCandles);
    }
    for (const profile of SYMBOL_LIST) {
      decisions[profile.id] = evaluateModel(
        profile.id,
        market[profile.id],
        STRATEGIES['regime-ensemble'],
        DEFAULT_WEIGHTS,
        false,
        0,
        computeMarketBreadth(market, profile.id)
      );
    }
    const ranked = rankMarketOpportunities(market, decisions);
    expect(ranked).toHaveLength(SYMBOL_LIST.length);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].opportunityScore).toBeGreaterThanOrEqual(ranked[i].opportunityScore);
    }
  });

  it('Market-Wide Discovery Radar prioritizes liquidity-passing movers and supports read-only inspection', () => {
    const snapshots = buildSimulatedDiscoverySnapshots(202);
    snapshots.push({
      symbol: 'PENNY',
      price: 3.4,
      prevClose: 2.1,
      changePct: 61.9,
      volume: 150000,
      prevVolume: 50000,
      rvol: 3.0,
      rangePct: 18.5,
      dollarVolume: 510000,
      sourceLabel: 'Top Gainer',
      passedLiquidityGate: false,
      filterReason: 'Filtered: price $3.40 below $10.00 minimum',
    });

    const ranked = rankDiscoveryMovers(snapshots);
    expect(ranked[0].passedLiquidityGate).toBe(true);
    expect(ranked[ranked.length - 1].symbol).toBe('PENNY');
    expect(ranked[ranked.length - 1].passedLiquidityGate).toBe(false);

    const bars = buildSimulatedDiscoveredBars('AMD', 90);
    const enriched = enrichMarketIntelligence(bars);
    const previewDecision = evaluateModel(
      'AMD',
      enriched,
      STRATEGIES['neural-perceptron'],
      DEFAULT_WEIGHTS,
      false,
      0
    );
    expect(previewDecision.symbol).toBe('AMD');
    expect(['BUY', 'SELL', 'HOLD']).toContain(previewDecision.action);

    const wfoCheck = runDiscoveredSymbolWalkForward('AMD', enriched, STRATEGIES['neural-perceptron']);
    expect(wfoCheck.symbol).toBe('AMD');
    expect(wfoCheck.datasetFingerprint).toBe('discover-15m-amd-90b');
    expect(wfoCheck.validationFlags.length).toBeGreaterThan(0);
  });

  it('Entry-snapshot credit assignment updates weights from entry features and portfolio WFO enforces shared pool contention', () => {
    const updatedWeights = adaptPerceptronWeights(
      DEFAULT_WEIGHTS,
      { emaSpread: 1.5, rsiCentered: -0.4, macdNorm: 1.2, zScore20: -0.8, volAligned: 0.9 },
      450,
      0.1
    );
    expect(updatedWeights.emaCross).toBeGreaterThan(DEFAULT_WEIGHTS.emaCross);
    expect(updatedWeights.macd).toBeGreaterThan(DEFAULT_WEIGHTS.macd);

    const portfolioWfo = runPortfolioWalkForward(100000, 180, 65, 5);
    expect(portfolioWfo).toHaveLength(3);
    for (const summary of portfolioWfo) {
      expect(Number.isFinite(summary.outOfSampleSharpe)).toBe(true);
      expect(Number.isFinite(summary.outOfSampleSortino)).toBe(true);
      expect(summary.validationFlags.length).toBeGreaterThan(0);
    }
  });

  it('Session VWAP anchor, ADX(14) gate, and 15:45 ET pre-close flatten execute deterministically', () => {
    const market = {} as Record<SymbolId, Candle[]>;
    for (const profile of SYMBOL_LIST) {
      const { rawCandles } = generateRawSeries(profile.id, 64, 707);
      market[profile.id] = enrichMarketIntelligence(rawCandles);
    }

    const decision = evaluateModel(
      'NVDA',
      market.NVDA,
      STRATEGIES['neural-perceptron'],
      DEFAULT_WEIGHTS,
      false,
      0
    );
    expect(decision.contributions.some((c) => c.label === 'Session VWAP Anchor')).toBe(true);
    expect(decision.contributions.some((c) => c.label === 'ADX(14) Trend Gate')).toBe(true);

    // Verify 15:45 ET bar triggers pre-close flatten exit on held position
    let portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    portfolio.positions.NVDA.quantity = 25;
    portfolio.positions.NVDA.avgEntryPrice = market.NVDA[market.NVDA.length - 1].close;
    const lateNvda = {
      ...market.NVDA[market.NVDA.length - 1],
      timestamp: '11-27 15:45',
      isRegularHours: true,
    };
    market.NVDA = [...market.NVDA.slice(0, -1), lateNvda];

    const stepped = stepAISignals(
      portfolio,
      market,
      STRATEGIES['neural-perceptron'],
      true,
      { ...DEFAULT_RISK_LIMITS, flattenBeforeClose: true }
    );
    expect(stepped.decisions.NVDA.action).toBe('SELL');
    expect(stepped.decisions.NVDA.rationale).toContain('Pre-close flatten');
    expect(stepped.portfolio.positions.NVDA.quantity).toBe(0);
  });
});
