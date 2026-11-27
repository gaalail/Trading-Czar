# Trading-Czar

An experimental quantitative trading workbench and paper-execution simulator for US equities and ETFs.

## Architecture Layers

Trading-Czar enforces strict separation between market data, market intelligence, strategy signal generation, risk validation, and portfolio execution:

```text
Data Infrastructure (src/engine/data/)
  -> Market Intelligence (src/engine/intelligence/)
  -> Strategy Research (src/engine/strategies.ts)
  -> Risk Gateway (src/engine/risk.ts)
  -> Paper Execution & Sleeves (src/engine/portfolio.ts)
```

- **Data (`src/engine/data/marketData.ts`)**: Generates raw OHLCV bars and US market session metadata (`09:30–16:00 ET`) with zero indicator or execution awareness.
- **Intelligence (`src/engine/intelligence/indicators.ts`)**: Computes causal technical indicators (EMA 9/21, RSI 14, MACD, Bollinger Z-Score 20, ATR 14, Volume Z-Score) and observable regime labels.
- **Strategies (`src/engine/strategies.ts`)**: Evaluates candidate signals (`BUY` / `SELL` / `HOLD`) with versioned configs and online perceptron weights; never submits orders directly.
- **Risk Gateway (`src/engine/risk.ts`)**: Fail-closed boundary enforcing `PAPER_ONLY`, no short selling, no margin, regular US market hours, bar-volume participation caps, position concentration caps, and an emergency circuit breaker.
- **Portfolio & Walk-Forward Lab (`src/engine/portfolio.ts`)**: Runs isolated `$100,000` paper sleeves per strategy and walk-forward out-of-sample backtests with spread + square-root market impact slippage.

## Running Locally

```bash
npm install
npm run dev      # Starts Vite dev server on http://0.0.0.0:3000
npm test         # Runs Vitest safety & architecture test suite
npm run lint     # Runs TypeScript type checking (tsc --noEmit)
npm run build    # Builds production bundle
```

## Documentation

- `CLAUDE.md` — Development rules and boundary invariants for future AI coding sessions.
- `knowledge/architecture/system-overview.md` — Layer boundaries and module contracts.
- `knowledge/architecture/data-flow.md` — End-to-end bar ingestion, signal evaluation, risk gating, and fill lifecycle.
- `knowledge/methodology/research-standards.md` — Walk-forward validation, slippage modeling, and experiment provenance rules.
- `knowledge/decisions/` — Architecture Decision Records (ADRs).
