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

- **Data (`src/engine/data/marketData.ts`)**: Generates raw OHLCV bars, CSV datasets, stress-test regimes (`Choppy Range`, `Tech Rally`, `Vol Selloff`), and US market session metadata (`09:30–16:00 ET`) with zero indicator or execution awareness.
- **Intelligence (`src/engine/intelligence/`)**: Computes causal technical indicators (`indicators.ts` — EMA 9/21, RSI 14, MACD, Bollinger Bands 20/2σ, ATR 14, Volume Z-Score, Session VWAP, Wilder ADX 14, `sessionWindow`), cross-asset universe breadth & SPY correlation (`breadth.ts`), and read-only setup/discovery rankings (`scanner.ts`, `discovery.ts`).
- **Strategies (`src/engine/strategies.ts`)**: Evaluates candidate signals (`BUY` / `SELL` / `HOLD`) with versioned v1.3.0 configs, ATR volatility-scaled sizing & stops, Session VWAP anchor, ADX(14) trend-vs-chop gate, Breadth & Time-of-Day interactions, and entry-snapshot online perceptron weights; never submits orders directly.
- **Risk Gateway (`src/engine/risk.ts`)**: Fail-closed boundary enforcing `PAPER_ONLY`, no short selling, no margin, regular US market hours, live stale-bar age limits, `15:40 ET` pre-close entry cutoff, bar-volume participation caps, SPY-correlation cluster caps, position concentration caps, and an emergency circuit breaker.
- **Portfolio & Walk-Forward Lab (`src/engine/portfolio.ts`)**: Runs isolated `$100,000` paper sleeves per strategy (with `15:45 ET` EOD flatten and Sharpe, Sortino, Calmar, Alpha vs. Benchmark) plus both per-symbol and shared-pool multi-asset contention walk-forward backtests with frozen OOS weights and overfit/vanity validation flags.
- **Server & Paper Bridge (`server.ts`)**: Serves the Express/Vite app on port `3000`, exposes fail-closed `/api/alpaca/*` paper bars & market-wide discovery endpoints (locked strictly to `https://paper-api.alpaca.markets`), and persists experiments to `knowledge/experiments/registry.json`.

## Running Locally

```bash
npm install
npm run dev      # Starts Express + Vite dev server via tsx server.ts on http://0.0.0.0:3000
npm test         # Runs Vitest safety & architecture test suite
npm run lint     # Runs TypeScript type checking (tsc --noEmit)
npm run build    # Builds production bundle
```

## Documentation

- `CLAUDE.md` — Development rules and boundary invariants for future AI coding sessions.
- `knowledge/architecture/system-overview.md` — Layer boundaries and module contracts.
- `knowledge/architecture/data-flow.md` — End-to-end bar ingestion, signal evaluation, risk gating, and fill lifecycle.
- `knowledge/methodology/research-standards.md` — Walk-forward validation, slippage modeling, and experiment provenance rules.
- `knowledge/experiments/registry.json` — Agent-readable experiment run history synced with the Experiments tab.
- `knowledge/decisions/` — Architecture Decision Records (ADRs).
