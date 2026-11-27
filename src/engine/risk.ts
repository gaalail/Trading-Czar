import type { Candle, PortfolioState, RiskEvent, RiskLimits, SymbolId } from './types';

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  executionMode: 'PAPER_ONLY',
  maxPortfolioExposurePct: 0.85,
  maxSinglePositionPct: 0.35,
  maxCorrelatedExposurePct: 0.55,
  maxOrderNotional: 35000,
  maxBarVolumePct: 0.05,
  enforceMarketHours: true,
  flattenBeforeClose: true,
  maxBarAgeMinutes: 45,
  allowShortSelling: false,
  allowMargin: false,
  halted: false,
};

export function getEtMinutesFromTimestamp(timestamp: string): number | null {
  const match = timestamp.match(/(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isPreCloseFlattenWindow(candle: Candle): boolean {
  if (!candle.isRegularHours) return false;
  const mins = getEtMinutesFromTimestamp(candle.timestamp);
  return mins !== null && mins >= 15 * 60 + 45 && mins < 16 * 60;
}

export interface RiskCheckResult {
  approved: boolean;
  rule: string;
  detail: string;
}

export function evaluateRiskGate(params: {
  portfolio: PortfolioState;
  symbol: SymbolId;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fee: number;
  totalEquity: number;
  limits: RiskLimits;
  latestCandle: Candle;
  symbolCorrToSpy?: number;
  correlatedOpenValue?: number;
  nowMs?: number;
}): RiskCheckResult {
  const {
    portfolio,
    symbol,
    side,
    quantity,
    price,
    fee,
    totalEquity,
    limits,
    latestCandle,
    symbolCorrToSpy = 0,
    correlatedOpenValue = 0,
    nowMs = Date.now(),
  } = params;

  if (limits.executionMode !== 'PAPER_ONLY') {
    return {
      approved: false,
      rule: 'FAIL_CLOSED_PAPER_ONLY',
      detail: 'Order rejected: execution mode must be verified as PAPER_ONLY.',
    };
  }

  if (limits.halted) {
    return {
      approved: false,
      rule: 'EMERGENCY_CIRCUIT_BREAKER',
      detail: 'Order rejected: Risk Gateway emergency halt is active.',
    };
  }

  if (
    !Number.isFinite(latestCandle.close) ||
    latestCandle.close <= 0 ||
    latestCandle.high < latestCandle.low
  ) {
    return {
      approved: false,
      rule: 'STALE_OR_INVALID_DATA',
      detail: `Order rejected: invalid market bar for ${symbol}.`,
    };
  }

  if (
    side === 'BUY' &&
    limits.maxBarAgeMinutes > 0 &&
    typeof latestCandle.barEpochMs === 'number'
  ) {
    const ageMinutes = (nowMs - latestCandle.barEpochMs) / 60000;
    if (ageMinutes > limits.maxBarAgeMinutes) {
      return {
        approved: false,
        rule: 'STALE_OR_INVALID_DATA',
        detail: `Order rejected: latest ${symbol} bar is ${Math.round(ageMinutes)}m old (stale-data limit ${limits.maxBarAgeMinutes}m).`,
      };
    }
  }

  if (limits.enforceMarketHours && !latestCandle.isRegularHours) {
    return {
      approved: false,
      rule: 'OUTSIDE_REGULAR_MARKET_HOURS',
      detail: `Order rejected at ${latestCandle.timestamp} ET: regular US session (09:30-16:00 ET) enforcement active.`,
    };
  }

  if (limits.flattenBeforeClose && side === 'BUY') {
    const mins = getEtMinutesFromTimestamp(latestCandle.timestamp);
    if (mins !== null && mins >= 15 * 60 + 40 && mins < 16 * 60) {
      return {
        approved: false,
        rule: 'PRE_CLOSE_ENTRY_CUTOFF',
        detail: `Order rejected at ${latestCandle.timestamp} ET: pre-close flatten guard blocks new entries from 15:40 ET onward.`,
      };
    }
  }

  if (quantity <= 0) {
    return {
      approved: false,
      rule: 'INVALID_QUANTITY',
      detail: `Order rejected: computed quantity (${quantity}) must be positive.`,
    };
  }

  const barParticipation = latestCandle.volume > 0 ? quantity / latestCandle.volume : 1;
  if (barParticipation > limits.maxBarVolumePct) {
    return {
      approved: false,
      rule: 'LIQUIDITY_PARTICIPATION_CAP',
      detail: `Order (${quantity} sh) is ${(barParticipation * 100).toFixed(2)}% of bar volume (limit ${(limits.maxBarVolumePct * 100).toFixed(1)}%).`,
    };
  }

  const pos = portfolio.positions[symbol];
  const notional = quantity * price;

  if (side === 'SELL') {
    if (!limits.allowShortSelling && quantity > pos.quantity) {
      return {
        approved: false,
        rule: 'NO_SHORT_SELLING',
        detail: `Sell quantity (${quantity}) exceeds held shares (${pos.quantity}); short selling is prohibited.`,
      };
    }
    return {
      approved: true,
      rule: 'LONG_EXIT_APPROVED',
      detail: `Approved closing ${quantity} shares of ${symbol} at $${price.toFixed(2)}.`,
    };
  }

  if (!limits.allowMargin && notional + fee > portfolio.cash) {
    return {
      approved: false,
      rule: 'NO_MARGIN_BORROWING',
      detail: `Order cost ($${(notional + fee).toFixed(2)}) exceeds available cash ($${portfolio.cash.toFixed(2)}).`,
    };
  }

  if (notional > limits.maxOrderNotional) {
    return {
      approved: false,
      rule: 'MAX_ORDER_NOTIONAL',
      detail: `Order notional ($${notional.toFixed(2)}) exceeds $${limits.maxOrderNotional.toLocaleString()} cap.`,
    };
  }

  const projectedSymbolValue = (pos.quantity + quantity) * price;
  if (totalEquity > 0 && projectedSymbolValue / totalEquity > limits.maxSinglePositionPct) {
    return {
      approved: false,
      rule: 'MAX_POSITION_CONCENTRATION',
      detail: `${symbol} exposure would reach ${((projectedSymbolValue / totalEquity) * 100).toFixed(1)}% (limit ${(limits.maxSinglePositionPct * 100).toFixed(0)}%).`,
    };
  }

  const currentInvested = totalEquity - portfolio.cash;
  const projectedExposure = (currentInvested + notional) / Math.max(1, totalEquity);
  if (projectedExposure > limits.maxPortfolioExposurePct) {
    return {
      approved: false,
      rule: 'MAX_PORTFOLIO_EXPOSURE',
      detail: `Gross invested exposure would reach ${(projectedExposure * 100).toFixed(1)}% (limit ${(limits.maxPortfolioExposurePct * 100).toFixed(0)}%).`,
    };
  }

  if (symbolCorrToSpy >= 0.65 && totalEquity > 0) {
    const projectedCorrelatedPct = (correlatedOpenValue + notional) / totalEquity;
    if (projectedCorrelatedPct > limits.maxCorrelatedExposurePct) {
      return {
        approved: false,
        rule: 'CORRELATION_CONCENTRATION_CAP',
        detail: `High-SPY-beta cluster (${symbol} corr +${symbolCorrToSpy.toFixed(2)}) would reach ${(projectedCorrelatedPct * 100).toFixed(1)}% of equity (limit ${(limits.maxCorrelatedExposurePct * 100).toFixed(0)}%).`,
      };
    }
  }

  return {
    approved: true,
    rule: 'RISK_GATE_PASSED',
    detail: `Approved buying ${quantity} shares of ${symbol} ($${notional.toFixed(2)}) under paper limits.`,
  };
}

export function createRiskEvent(params: {
  timestamp: string;
  symbol: SymbolId;
  side: 'BUY' | 'SELL';
  origin: 'AI' | 'MANUAL';
  result: RiskCheckResult;
  seq: number;
}): RiskEvent {
  return {
    id: `risk-${params.symbol}-${params.seq}`,
    timestamp: params.timestamp,
    symbol: params.symbol,
    side: params.side,
    origin: params.origin,
    status: params.result.approved ? 'APPROVED' : 'BLOCKED',
    rule: params.result.rule,
    detail: params.result.detail,
  };
}
