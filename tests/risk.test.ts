import { describe, expect, it } from 'vitest';
import { generateRawSeries } from '../src/engine/data/marketData';
import { enrichMarketIntelligence } from '../src/engine/intelligence/indicators';
import { createInitialPortfolio, executeOrder } from '../src/engine/portfolio';
import { DEFAULT_RISK_LIMITS, evaluateRiskGate } from '../src/engine/risk';
import { STRATEGIES } from '../src/engine/strategies';
import type { Candle, RiskLimits, SymbolId } from '../src/engine/types';

function buildTestMarket() {
  const symbols: SymbolId[] = ['NVDA', 'AAPL', 'MSFT', 'SPY', 'QQQ', 'TSLA'];
  const market = {} as Record<SymbolId, Candle[]>;
  for (const sym of symbols) {
    const { rawCandles } = generateRawSeries(sym, 64, 101);
    market[sym] = enrichMarketIntelligence(rawCandles);
  }
  return market;
}

describe('Fail-Closed Risk Gateway', () => {
  it('blocks execution if executionMode is anything other than PAPER_ONLY', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const regularCandle = { ...market.NVDA[market.NVDA.length - 1], isRegularHours: true };

    const tamperedLimits = {
      ...DEFAULT_RISK_LIMITS,
      executionMode: 'LIVE' as unknown as RiskLimits['executionMode'],
    };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: regularCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: tamperedLimits,
      latestCandle: regularCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('FAIL_CLOSED_PAPER_ONLY');
  });

  it('blocks all orders when emergency circuit breaker halt is active', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const regularCandle = { ...market.NVDA[market.NVDA.length - 1], isRegularHours: true };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: regularCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: { ...DEFAULT_RISK_LIMITS, halted: true },
      latestCandle: regularCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('EMERGENCY_CIRCUIT_BREAKER');
  });

  it('blocks orders outside regular US market hours when enforceMarketHours is enabled', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const extendedCandle = { ...market.NVDA[market.NVDA.length - 1], isRegularHours: false };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: extendedCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: { ...DEFAULT_RISK_LIMITS, enforceMarketHours: true },
      latestCandle: extendedCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('OUTSIDE_REGULAR_MARKET_HOURS');
  });

  it('prohibits short selling when sell quantity exceeds held shares', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const regularCandle = { ...market.NVDA[market.NVDA.length - 1], isRegularHours: true };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'SELL',
      quantity: 5,
      price: regularCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: DEFAULT_RISK_LIMITS,
      latestCandle: regularCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('NO_SHORT_SELLING');
  });

  it('prohibits margin borrowing when order cost exceeds cash', () => {
    const market = buildTestMarket();
    const portfolio = {
      ...createInitialPortfolio('neural-perceptron', 100000, market),
      cash: 500,
    };
    const regularCandle = { ...market.NVDA[market.NVDA.length - 1], isRegularHours: true };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 20,
      price: regularCandle.close,
      fee: 2,
      totalEquity: 100000,
      limits: DEFAULT_RISK_LIMITS,
      latestCandle: regularCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('NO_MARGIN_BORROWING');
  });

  it('blocks orders exceeding bar liquidity participation cap', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const lowVolCandle = {
      ...market.NVDA[market.NVDA.length - 1],
      isRegularHours: true,
      volume: 100,
    };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 20,
      price: lowVolCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: DEFAULT_RISK_LIMITS,
      latestCandle: lowVolCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('LIQUIDITY_PARTICIPATION_CAP');
  });

  it('approves valid paper buy orders and records clientOrderId + audit event', () => {
    const market = buildTestMarket();
    const regularCandle = { ...market.NVDA[market.NVDA.length - 1], isRegularHours: true };
    market.NVDA = [...market.NVDA.slice(0, -1), regularCandle];
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);

    const updated = executeOrder(
      portfolio,
      'NVDA',
      'BUY',
      market.NVDA,
      market,
      STRATEGIES['neural-perceptron'],
      'AI',
      0.78,
      'Test approval',
      DEFAULT_RISK_LIMITS
    );

    expect(updated.trades.length).toBe(1);
    expect(updated.trades[0].clientOrderId).toContain('paper-neural-perceptron-NVDA');
    expect(updated.riskEvents[0].status).toBe('APPROVED');
    expect(updated.cash).toBeLessThan(100000);
  });

  it('blocks excessive correlated SPY-beta exposure via CORRELATION_CONCENTRATION_CAP', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const regularCandle = { ...market.QQQ[market.QQQ.length - 1], isRegularHours: true };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'QQQ',
      side: 'BUY',
      quantity: 30,
      price: 500,
      fee: 7.5,
      totalEquity: 100000,
      limits: { ...DEFAULT_RISK_LIMITS, maxCorrelatedExposurePct: 0.55 },
      latestCandle: regularCandle,
      symbolCorrToSpy: 0.88,
      correlatedOpenValue: 45000,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('CORRELATION_CONCENTRATION_CAP');
  });

  it('blocks stale live BUY quotes via STALE_OR_INVALID_DATA while still allowing protective SELL exits', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    portfolio.positions.NVDA.quantity = 10;
    const nowMs = Date.UTC(2026, 10, 27, 15, 0, 0);
    const staleCandle = {
      ...market.NVDA[market.NVDA.length - 1],
      isRegularHours: true,
      barEpochMs: nowMs - 75 * 60 * 1000, // 75 minutes stale (> 45m limit)
    };

    const buyRes = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: staleCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: { ...DEFAULT_RISK_LIMITS, maxBarAgeMinutes: 45 },
      latestCandle: staleCandle,
      nowMs,
    });
    expect(buyRes.approved).toBe(false);
    expect(buyRes.rule).toBe('STALE_OR_INVALID_DATA');

    const sellRes = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'SELL',
      quantity: 10,
      price: staleCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: { ...DEFAULT_RISK_LIMITS, maxBarAgeMinutes: 45 },
      latestCandle: staleCandle,
      nowMs,
    });
    expect(sellRes.approved).toBe(true);
  });

  it('blocks new BUY entries after 15:40 ET via PRE_CLOSE_ENTRY_CUTOFF when flattenBeforeClose is active', () => {
    const market = buildTestMarket();
    const portfolio = createInitialPortfolio('neural-perceptron', 100000, market);
    const lateCandle = {
      ...market.NVDA[market.NVDA.length - 1],
      timestamp: '11-27 15:45',
      isRegularHours: true,
    };

    const res = evaluateRiskGate({
      portfolio,
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: lateCandle.close,
      fee: 1,
      totalEquity: 100000,
      limits: { ...DEFAULT_RISK_LIMITS, flattenBeforeClose: true },
      latestCandle: lateCandle,
    });

    expect(res.approved).toBe(false);
    expect(res.rule).toBe('PRE_CLOSE_ENTRY_CUTOFF');
  });
});
