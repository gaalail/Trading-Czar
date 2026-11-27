# System Overview

Trading-Czar is structured as a modular single-process web workbench in TypeScript/React with clear vertical boundaries mirroring an institutional quantitative research pipeline.

## Module Boundaries

| Layer | Directory / File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| Domain Contracts | `src/engine/types.ts` | Shared interfaces (`RawCandle`, `Candle`, `ModelDecision`, `RiskLimits`, `PortfolioState`, `ExperimentRecord`) | None |
| Data Infrastructure | `src/engine/data/marketData.ts` | Symbol profiles (US equities & ETFs), deterministic multi-regime OHLCV generation, US regular session calendar (`09:30–16:00 ET`) | `intelligence`, `strategies`, `risk`, `portfolio` |
| Market Intelligence | `src/engine/intelligence/indicators.ts` | Causal EMA(9/21), RSI(14), MACD histogram, Bollinger Z-Score(20), ATR(14), Volume Z-Score, and regime classification | `strategies`, `risk`, `portfolio` |
| Strategy Research | `src/engine/strategies.ts` | Versioned signal models (`Momentum Perceptron`, `Mean-Reversion Z-Score`, `Regime-Adaptive Ensemble`) and bounded online weight adaptation | `risk`, `portfolio` |
| Risk & Governance | `src/engine/risk.ts` | Fail-closed `evaluateRiskGate()` enforcing `PAPER_ONLY`, no shorting, no margin, session hours, liquidity participation, concentration caps, and circuit breaker | `strategies` |
| Execution & Sleeves | `src/engine/portfolio.ts` | Isolated per-strategy `$100,000` paper sleeves, square-root impact slippage, idempotent `clientOrderId`, mark-to-market accounting, and walk-forward backtester | Direct UI state |
| Presentation | `src/App.tsx`, `src/components/*` | Dark-mode workbench UI, SVG candlestick & multi-sleeve equity charts, Risk & Audit log, Walk-Forward Lab, and `localStorage`-backed Experiment Registry | Direct state mutation bypassing `portfolio`/`risk` |

## Current Scope vs. Future Production Target

- **Current**: Self-contained browser runtime with deterministic simulated US equity/ETF market bars and `localStorage` experiment persistence.
- **Future Backend Target**: Replace `data/marketData.ts` with a server-side Alpaca IEX/SIP adapter, persist portfolio/experiment state in PostgreSQL (via Alembic migrations), store historical bars in Parquet/DuckDB, and add a Python/FastAPI service behind the same interface contracts.
