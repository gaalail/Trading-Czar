import type { Candle, PortfolioState, RiskEvent, RiskLimits, SymbolId } from './types';

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  executionMode: 'PAPER_ONLY',
  maxPortfolioExposurePct: 0.85,
  maxSinglePositionPct: 0.35,
  maxOrderNotional: 35000,
  maxBarVolumePct: 0.05,
  enforceMarketHours: true,
  allowShortSelling: false,
  allowMargin: false,
  halted: false,
};

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
}): RiskCheckResult {
  const { portfolio, symbol, side, quantity, price, fee, totalEquity, limits, latestCandle } = params;

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

  if (!Number.isFinite(latestCandle.close) || latestCandle.close <= 0) {
    return {
      approved: false,
      rule: 'STALE_OR_INVALID_DATA',
      detail: `Order rejected: invalid market bar for ${symbol}.`,
    };
  }

  if (limits.enforceMarketHours && !latestCandle.isRegularHours) {
    return {
      approved: false,
      rule: 'OUTSIDE_REGULAR_MARKET_HOURS',
      detail: `Order rejected at ${latestCandle.timestamp} ET: regular US session (09:30-16:00 ET) enforcement active.`,
    };
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
