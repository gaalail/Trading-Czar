# ADR 0004: Synergistic Entry Filters, Agent-Readable Registry, and Fail-Closed Paper Bridge

## Status
Accepted

## Context
As Trading-Czar evolved from a browser-only simulation into a multi-agent quantitative research workbench, three needs emerged:
1. Entry signals needed to account for symbol-specific volatility (ATR), broader universe participation (Market Breadth), and intraday liquidity patterns (Time-of-Day) without compromising exit safety.
2. Future CLI/research agents (such as Claude Code) needed direct disk access to past experiment records rather than trapping run history solely in browser `localStorage`.
3. Connecting to Alpaca for real historical bars and paper execution required strict server-side credential isolation and fail-closed paper-trading guarantees.

## Decision
1. **Entry-Only Synergistic Filters (`src/engine/strategies.ts`, `src/engine/intelligence/`)**:
   - `computeAtrScaledRiskGuards()` dynamically scales position budgets and stop-loss / take-profit bands using `ATR(14) / Close`.
   - `useBreadthFilter` and `useTimeOfDayFilter` (`Open Drive`, `Midday Chop`, `Power Hour`) shape entry conviction only; they never delay or block `SELL` stop-loss, take-profit, or risk-exit signals.
2. **Server-Backed Experiment Registry (`server.ts`, `knowledge/experiments/registry.json`)**:
   - Saved experiments are persisted via `/api/experiments` to `knowledge/experiments/registry.json` (with `localStorage` retained as a resilient client cache and JSON download export).
3. **Fail-Closed Paper Bridge (`server.ts`)**:
   - `server.ts` locks Alpaca execution to `https://paper-api.alpaca.markets` and returns `403` on any non-paper URL. API credentials live exclusively in server environment variables (`.env.example`), never in client UI or browser bundles.

## Consequences
- Every strategy improvement can be A/B tested directly in Walk-Forward Lab across `Choppy Range`, `Tech Rally`, and `Vol Selloff` stress datasets.
- Any coding agent inspecting the repository can read `knowledge/experiments/registry.json` directly alongside ADRs.
- Live brokerage orders remain strictly locked to paper accounts with zero risk of accidental real-money routing.
