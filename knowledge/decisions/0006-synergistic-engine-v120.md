# ADR 0006: Interaction-Driven Signal Conditioning, Entry Credit Assignment, and Portfolio-Level WFO

## Status
Accepted

## Context
A critical architectural review of Trading-Czar v1.1.0 identified five modeling seams where modules were still additive or loosely coupled:
1. Time-of-Day and Breadth filters acted as flat score offsets rather than modifying trend vs. mean-reversion scaling and confidence thresholds.
2. `adaptPerceptronWeights` updated Momentum Perceptron weights using the exit candle's indicators instead of the entry setup that triggered the trade.
3. Rolling 20-bar `corrToSpy` was computed and displayed, but unused in Risk Gateway concentration enforcement or entry caution.
4. Walk-Forward Lab evaluated each symbol independently with $100,000 rather than competing all 6 core assets against one shared cash pool.
5. Discovered external tickers stopped at read-only chart inspection without instant Walk-Forward research logging.

## Decision
1. **Interaction-Driven Entry Conditioning (`src/engine/strategies.ts` v1.2.0)**:
   - `Open Drive`, `Midday Chop`, `Power Hour`, and `Market Breadth` dynamically scale `trendScale`, `revertScale`, and `effectiveEntryThreshold` (plus `SPY Beta Caution` when weak breadth meets `corrToSpy >= 0.75`). Protective `SELL` exits remain unblocked.
2. **Entry-Snapshot Credit Assignment (`src/engine/types.ts`, `src/engine/portfolio.ts`)**:
   - `Position.entryFeatures` captures `extractModelFeatures(candles)` at entry so closed round-trips update Perceptron weights from true entry features in both live sleeves and in-sample WFO.
3. **Correlation Concentration Risk Cap (`src/engine/risk.ts`, `src/engine/intelligence/breadth.ts`)**:
   - `evaluateRiskGate()` enforces `CORRELATION_CONCENTRATION_CAP` (`maxCorrelatedExposurePct`, default 55%) across positions with `corrToSpy >= 0.65`.
4. **Portfolio-Level Multi-Asset WFO & Discovery WFO Check (`src/engine/portfolio.ts`, `src/components/BacktestMatrixView.tsx`)**:
   - `runPortfolioWalkForward()` simulates all 6 assets competing over a shared `$100,000` pool with frozen OOS weights and full Risk Gateway limits.
   - `runDiscoveredSymbolWalkForward()` evaluates any inspected Discovery Radar symbol and logs findings to `/api/experiments`.

## Consequences
- Model adaptation, risk concentration, and out-of-sample testing now operate end-to-end across assets rather than in isolated per-ticker silos.
- Paper-only safety locks (`PAPER_ONLY`, no shorting, no margin, regular US hours, core sleeve isolation) remain strictly enforced.
