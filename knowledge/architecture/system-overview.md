# System Overview

Trading-Czar is structured as a modular single-process web workbench in TypeScript/React with clear vertical boundaries mirroring an institutional quantitative research pipeline.

## Module Boundaries

| Layer | Directory / File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| Domain Contracts | `src/engine/types.ts` | Shared interfaces (`RawCandle`, `Candle`, `ModelDecision`, `RiskLimits`, `PortfolioState`, `ExperimentRecord`) | None |
| Data Infrastructure | `src/engine/data/marketData.ts` | Symbol profiles (US equities & ETFs), deterministic multi-regime OHLCV generation, sample stress datasets, CSV parser, US regular session calendar (`09:30–16:00 ET`) | `intelligence`, `strategies`, `risk`, `portfolio` |
| Market Intelligence | `src/engine/intelligence/` | Causal indicators & Bollinger Bands + `sessionWindow` (`indicators.ts`), universe breadth (`breadth.ts`), and read-only setup scanner (`scanner.ts`) | `strategies`, `risk`, `portfolio` |
| Strategy Research | `src/engine/strategies.ts` | Versioned signal models, ATR volatility-scaled risk guards (`computeAtrScaledRiskGuards`), breadth & Time-of-Day entry shaping, and bounded online weight adaptation | `risk`, `portfolio` |
| Risk & Governance | `src/engine/risk.ts` | Fail-closed `evaluateRiskGate()` enforcing `PAPER_ONLY`, no shorting, no margin, session hours, liquidity participation, concentration caps, and circuit breaker | `strategies` |
| Execution & Sleeves | `src/engine/portfolio.ts` | Isolated per-strategy `$100,000` paper sleeves, square-root impact slippage, idempotent `clientOrderId`, Sharpe/Sortino/Calmar/Alpha accounting, and walk-forward backtester with `validationFlags` | Direct UI state |
| Server & Paper Bridge | `server.ts` | Express + Vite dev/prod server (`0.0.0.0:3000`), fail-closed `PAPER_ONLY` Alpaca routes (`/api/alpaca/*`), and disk-backed `/api/experiments` (`knowledge/experiments/registry.json`) | Client UI state |
| Presentation | `src/App.tsx`, `src/components/*` | Dark-mode workbench UI, SVG candlestick & Bollinger chart, Opportunity Scanner, Risk & Audit log, Walk-Forward Lab, and Experiment Registry | Direct state mutation bypassing `portfolio`/`risk` |

## Current Scope vs. Future Production Target

- **Current**: Express + React workbench with simulated & CSV/sample US equity/ETF market bars, fail-closed Alpaca paper bridge (ready for env keys via `.env.example`), and agent-readable experiment persistence (`knowledge/experiments/registry.json` + browser cache).
- **Future Production Target**: Wire live approved desk orders directly to `/api/alpaca/paper-order` with fill reconciliation, expand the symbol scanner to a wider US equity/ETF universe, and optionally migrate `knowledge/experiments/registry.json` to PostgreSQL + DuckDB/Parquet bar storage behind the existing TypeScript/HTTP contracts.
