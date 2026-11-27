# ADR 0007: Session VWAP, ADX(14) Regime Gate, and Pre-Close / Stale-Data Execution Guards (v1.3.0)

- **Status**: Accepted
- **Date**: 2026-11-27

## Context
Following the v1.2.0 portfolio contention and entry-snapshot upgrades, quantitative feature evaluation highlighted two orthogonal signals missing from the intelligence layer plus two intraday execution safeguards:
1. **Session VWAP**: Existing indicators (`EMA`, `RSI`, `MACD`, `Bollinger`) were purely price-time series without a cumulative volume-weighted anchor resetting each trading day.
2. **ADX(14) Trend Strength**: Regime classification previously relied on EMA spread and ATR/Price without a directional strength oscillator separating trend breakouts from sideways chop.
3. **Stale Live Feed & End-of-Day Gap Guards**: Live Alpaca bars require explicit wall-clock age verification, and intraday 15m strategies should avoid holding accidental overnight exposure or opening new positions minutes before the 16:00 ET close.

## Decision
1. **Causal Session VWAP & Wilder ADX(14) (`src/engine/intelligence/indicators.ts`)**:
   - Added strictly causal Session VWAP resetting at trading-day transitions and at the `09:30 ET` regular-open boundary, plus `vwapDistancePct`.
   - Added Wilder-smoothed `adx14`, `plusDi14`, and `minusDi14` strictly from past and current bars, and incorporated `adx14` into `classifyRegime()`.
2. **A/B-Testable Strategy Toggles (`src/engine/strategies.ts`)**:
   - Added `useVwapAnchor` and `useAdxRegimeGate` to `StrategyConfig` (v1.3.0), wired into both `StrategyConfigView` and the `Walk-Forward Lab` filter toolbar for isolated out-of-sample attribution testing.
3. **Fail-Closed Stale-Bar & Pre-Close Guards (`src/engine/risk.ts`, `src/engine/portfolio.ts`, `server.ts`)**:
   - Attached `barEpochMs` to fetched Alpaca bars in `server.ts` so `evaluateRiskGate()` rejects new `BUY` orders when `maxBarAgeMinutes` (default `45m`) is exceeded (`STALE_OR_INVALID_DATA`), while still permitting protective `SELL` exits.
   - Added `flattenBeforeClose` (default `true`): `evaluateRiskGate()` blocks new `BUY` entries from `15:40 ET` onward (`PRE_CLOSE_ENTRY_CUTOFF`), and `stepAISignals()` / WFO loops close held positions at `>= 15:45 ET`.

## Consequences
- Every strategy can now be A/B tested with and without Session VWAP and ADX(14) directly in `Walk-Forward Lab`.
- Live paper sessions fail closed on stale quotes and protect against unmonitored overnight gap risk while keeping existing no-shorting, no-margin, and `PAPER_ONLY` invariants intact.
