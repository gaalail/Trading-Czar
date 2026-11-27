# Data & Execution Flow

Every market tick follows a strict unidirectional pipeline so market intelligence never leaks into execution and no strategy can bypass risk controls.

## 1. Market Tick Pipeline

1. **Raw Bar Generation (`data/marketData.ts`)**:
   - `appendRawCandle()` appends a single `RawCandle` (`open`, `high`, `low`, `close`, `volume`, `timestamp`, `isRegularHours`) for each US equity/ETF in the watchlist.
   - Regular US trading hours (`09:30–16:00 ET`) carry full session volume; extended hours (`09:15`, `16:00`) attenuate bar volume to `18%` and flag `isRegularHours = false`.
2. **Intelligence Enrichment (`intelligence/indicators.ts`, `breadth.ts`, `scanner.ts`, `discovery.ts`)**:
   - `enrichMarketIntelligence(rawCandles)` computes causal technical indicators (EMA 9/21, RSI 14, MACD, Bollinger Bands `20, 2σ`, ATR 14, Volume Z-Score, Session VWAP resetting daily, Wilder ADX 14), observable regimes (`Trend Up`, `Mean Reverting`, `High Volatility`, `Consolidation`), and `sessionWindow` (`Open Drive`, `Midday Chop`, `Power Hour`, `Extended`).
   - `computeMarketBreadth()`, `rankMarketOpportunities()`, and `rankDiscoveryMovers()` summarize cross-asset participation/SPY correlation and rank setup quality read-only without emitting orders.
   - Verified by `tests/architecture.test.ts` to have zero look-ahead leakage: bar `t` indicators depend strictly on bars `0..t`.
3. **Strategy Signal Generation (`strategies.ts`)**:
   - Each isolated strategy sleeve calls `evaluateModel()` independently with its own weights, ATR-scaled risk guards (`computeAtrScaledRiskGuards`), optional Session VWAP anchor, ADX(14) trend gate, Market Breadth, Time-of-Day interactions, and open-position context; `stepAISignals()` also enforces `15:45 ET` pre-close flatten exits when `flattenBeforeClose` is active.
   - Output is a `ModelDecision` (`BUY` | `SELL` | `HOLD`, confidence score, feature contributions, and human-readable rationale).
4. **Independent Risk Gating (`risk.ts`)**:
   - Any non-`HOLD` signal (or manual order) enters `executeOrder()`, which applies optional ATR volatility scaling to share sizing, computes estimated fee, and models spread + square-root impact slippage.
   - `evaluateRiskGate()` runs fail-closed checks in order:
     1. `executionMode === 'PAPER_ONLY'`
     2. `!limits.halted` (Emergency Circuit Breaker)
     3. Valid positive OHLCV bar & live bar wall-clock age (`<= maxBarAgeMinutes` on `BUY`)
     4. `isRegularHours` (when `enforceMarketHours` is active) & `15:40 ET` pre-close entry cutoff (`PRE_CLOSE_ENTRY_CUTOFF` on `BUY`)
     5. Positive quantity and `quantity / bar.volume <= maxBarVolumePct`
     6. `NO_SHORT_SELLING` (for `SELL`) / `NO_MARGIN_BORROWING`, `MAX_ORDER_NOTIONAL`, `MAX_POSITION_CONCENTRATION`, `MAX_PORTFOLIO_EXPOSURE`, and `CORRELATION_CONCENTRATION_CAP` (for `BUY`).
   - Both `APPROVED` and `BLOCKED` evaluations emit an immutable `RiskEvent` into the sleeve's audit log.
5. **Paper Fill, Accounting & Experiment Persistence (`portfolio.ts`, `server.ts`)**:
   - Approved orders generate an idempotent `clientOrderId`, update cash, position average entry price, and saved `EntryFeatureSnapshot`, and record a `TradeFill`.
   - For `Momentum Perceptron`, closing an AI round-trip updates online feature weights using the saved `EntryFeatureSnapshot` within bounded `[-2.5, +2.5]` clamps.
   - `markToMarketAndRecord()` updates unrealized P&L, peak equity, max drawdown, Sharpe/Sortino/Calmar/Alpha metrics, and appends to the sleeve's equity curve.
   - Logged backtests, discovery checks, and sleeve snapshots persist to `knowledge/experiments/registry.json` via `/api/experiments` (plus browser cache and JSON export) so future research agents can inspect prior runs.
