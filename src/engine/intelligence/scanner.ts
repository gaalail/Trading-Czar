import type { MarketRegime, ModelDecision, SessionWindow, SymbolId, Candle } from '../types';

export interface OpportunityRank {
  symbol: SymbolId;
  price: number;
  regime: MarketRegime;
  sessionWindow: SessionWindow;
  zScore20: number;
  volumeZ: number;
  atrPct: number;
  action: ModelDecision['action'];
  confidence: number;
  opportunityScore: number;
}

/**
 * Pure Market Intelligence Scanner:
 * Ranks the tracked US equity & ETF universe by setup quality and conviction.
 * Read-only: emits ranked observations only, never triggers orders.
 */
export function rankMarketOpportunities(
  candlesBySymbol: Record<SymbolId, Candle[]>,
  decisionsBySymbol: Record<SymbolId, ModelDecision>
): OpportunityRank[] {
  const ranked: OpportunityRank[] = [];

  for (const symbol of Object.keys(candlesBySymbol) as SymbolId[]) {
    const series = candlesBySymbol[symbol];
    const bar = series[series.length - 1];
    const decision = decisionsBySymbol[symbol];
    if (!bar || !decision) continue;

    const atrPct = (bar.atr14 / Math.max(0.01, bar.close)) * 100;
    const stretchScore = Math.min(25, Math.abs(bar.zScore20) * 10);
    const volumeScore = Math.min(20, Math.max(0, bar.volumeZ) * 10);
    const convictionScore = decision.confidence * 55;
    const actionBonus = decision.action === 'BUY' ? 12 : decision.action === 'SELL' ? 6 : 0;
    const opportunityScore = Number(
      Math.min(100, convictionScore + stretchScore * 0.6 + volumeScore * 0.5 + actionBonus).toFixed(1)
    );

    ranked.push({
      symbol,
      price: bar.close,
      regime: bar.regime,
      sessionWindow: bar.sessionWindow,
      zScore20: bar.zScore20,
      volumeZ: bar.volumeZ,
      atrPct,
      action: decision.action,
      confidence: decision.confidence,
      opportunityScore,
    });
  }

  return ranked.sort((a, b) => b.opportunityScore - a.opportunityScore);
}
