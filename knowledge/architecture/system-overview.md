# System Overview

Trading-Czar is structured as a modular single-process web workbench in TypeScript/React with clear vertical boundaries mirroring an institutional quantitative research pipeline.

## Module Boundaries

| Layer | Directory / File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| Domain Contracts | `src/engine/types.ts` | Shared interfaces (`RawCandle`, `Candle`, `ModelDecision`, `RiskLimits`, `PortfolioState`, `ExperimentRecord`) | None |
| Data Infrastructure | `src/engine/data/marketData.ts` | Symbol profiles (US equities & ETFs), deterministic multi-regime OHLCV generation, sample stress datasets, CSV parser, US regular session calendar (`09:30–16:00 ET`) | `intelligence`, `strategies`, `risk`, `portfolio` |
| Market Intelligence | `src/engine/intelligence/` | Causal indicators, Session VWAP, ADX(14), Bollinger Bands, `sessionWindow` (`indicators.ts`), universe breadth & SPY correlation (`breadth.ts`), setup scanner (`scanner.ts`), and market-wide mover discovery (`discovery.ts`) | `strategies`, `risk`, `portfolio` |
| Strategy Research | `src/engine/strategies.ts` | Versioned v1.3.0 signal models, ATR volatility-scaled risk guards (`computeAtrScaledRiskGuards`), Session VWAP, ADX(14), breadth & Time-of-Day entry shaping, and entry-snapshot weight learning | `risk`, `portfolio` |
| Risk & Governance | `src/engine/risk.ts` | Fail-closed `evaluateRiskGate()` enforcing `PAPER_ONLY`, no shorting, no margin, session hours, stale-bar age guard, `15:40 ET` pre-close entry cutoff, liquidity participation, SPY-beta cluster & concentration caps, and circuit breaker | `strategies` |
| Execution & Sleeves | `src/engine/portfolio.ts` | Isolated per-strategy `$100,000` paper sleeves, `15:45 ET` EOD flatten, square-root impact slippage, idempotent `clientOrderId`, per-symbol and shared-pool multi-asset walk-forward backtesters with frozen OOS weights | Direct UI state |
| Server & Paper Bridge | `server.ts` | Express + Vite dev/prod server (`0.0.0.0:3000`), fail-closed `PAPER_ONLY` Alpaca market-data & screener routes (`/api/alpaca/*`), and disk-backed `/api/experiments` (`knowledge/experiments/registry.json`) | Client UI state |
| Presentation | `src/App.tsx`, `src/components/*` | Dark-mode workbench UI, SVG candlestick + Bollinger + VWAP chart, Opportunity Scanner, read-only Discovery Radar, Risk & Audit log, Walk-Forward Lab, and Experiment Registry | Direct state mutation bypassing `portfolio`/`risk` |

## Current Scope vs. Future Production Target

- **Current**: Express + React workbench with live Alpaca IEX / simulated / CSV / sample US equity & ETF market bars, read-only Market-Wide Discovery Radar with instant out-of-sample inspection, fail-closed Alpaca paper bridge (ready for env keys via `.env.example`), and agent-readable experiment persistence (`knowledge/experiments/registry.json` + browser cache).
- **Future Production Target**: Wire single-strategy approved desk orders directly to `/api/alpaca/paper-order` with live broker position reconciliation, and optionally migrate `knowledge/experiments/registry.json` to PostgreSQL + DuckDB/Parquet bar storage behind the existing TypeScript/HTTP contracts.
