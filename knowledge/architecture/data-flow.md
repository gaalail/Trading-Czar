# Data & Execution Flow

Every market tick follows a strict unidirectional pipeline so market intelligence never leaks into execution and no strategy can bypass risk controls.

## 1. Market Tick Pipeline

1. **Raw Bar Generation (`data/marketData.ts`)**:
   - `appendRawCandle()` appends a single `RawCandle` (`open`, `high`, `low`, `close`, `volume`, `timestamp`, `isRegularHours`) for each US equity/ETF in the watchlist.
   - Regular US trading hours (`09:30–16:00 ET`) carry full session volume; extended hours (`09:15`, `16:00`) attenuate bar volume to `18%` and flag `isRegularHours = false`.
2. **Intelligence Enrichment (`intelligence/indicators.ts`)**:
   - `enrichMarketIntelligence(rawCandles)` computes causal technical indicators and classifies observable market regimes (`Trend Up`, `Mean Reverting`, `High Volatility`, `Consolidation`).
   - Verified by `tests/architecture.test.ts` to have zero look-ahead leakage: bar `t` indicators depend strictly on bars `0..t`.
3. **Strategy Signal Generation (`strategies.ts`)**:
   - Each isolated strategy sleeve calls `evaluateModel()` independently with its own weights and open-position context.
   - Output is a `ModelDecision` (`BUY` | `SELL` | `HOLD`, confidence score, feature contributions, and human-readable rationale).
4. **Independent Risk Gating (`risk.ts`)**:
   - Any non-`HOLD` signal (or manual order) enters `executeOrder()`, which computes target share quantity, estimated fee, and spread + square-root impact slippage.
   - `evaluateRiskGate()` runs fail-closed checks in order:
     1. `executionMode === 'PAPER_ONLY'`
     2. `!limits.halted` (Emergency Circuit Breaker)
     3. Valid positive market price
     4. `isRegularHours` (when `enforceMarketHours` is active)
     5. Positive quantity and `quantity / bar.volume <= maxBarVolumePct`
     6. `NO_SHORT_SELLING` (for `SELL`) / `NO_MARGIN_BORROWING`, `MAX_ORDER_NOTIONAL`, `MAX_POSITION_CONCENTRATION`, `MAX_PORTFOLIO_EXPOSURE` (for `BUY`).
   - Both `APPROVED` and `BLOCKED` evaluations emit an immutable `RiskEvent` into the sleeve's audit log.
5. **Paper Fill & Mark-to-Market (`portfolio.ts`)**:
   - Approved orders generate an idempotent `clientOrderId`, update cash and position average entry price, and record a `TradeFill`.
   - For `Momentum Perceptron`, closing an AI round-trip updates online feature weights within bounded `[-2.5, +2.5]` clamps.
   - `markToMarketAndRecord()` updates unrealized P&L, peak equity, max drawdown, and appends to the sleeve's equity curve.
