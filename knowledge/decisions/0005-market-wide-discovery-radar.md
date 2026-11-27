# ADR 0005: Market-Wide Movers Discovery Radar (Read-Only External Screening)

## Status
Accepted

## Context
Restricting observation solely to the 6 core portfolio tickers (`NVDA`, `AAPL`, `MSFT`, `SPY`, `QQQ`, `TSLA`) gave limited visibility into broader market momentum, sector rotation, and high-relative-volume movers when researching strategy improvements. However, allowing unvetted external screener symbols directly into automated sleeve trading would compromise portfolio isolation, benchmark comparability, and paper-risk controls.

## Decision
1. **Market-Wide Read-Only Discovery (`server.ts`, `src/engine/intelligence/discovery.ts`)**:
   - Added `/api/alpaca/movers` querying Alpaca Screener Movers (`/v1beta1/screener/stocks/movers`), Most Actives (`/v1beta1/screener/stocks/most-actives`), and Multi-Symbol Snapshots (`/v2/stocks/snapshots`), falling back to a liquid US equity/ETF watchpool when market screeners are empty (e.g., holidays/weekends).
   - Enforced a strict server-side liquidity gate (`price >= $10.00` and `volume >= 500,000` or `$10M` dollar volume) and `^[A-Z]{1,5}$` ticker validation.
2. **Isolated Read-Only Chart & Signal Inspection (`GET /api/alpaca/discover-bars`, `src/App.tsx`)**:
   - Clicking any discovered symbol loads its 15-minute bars into the Live Desk chart and evaluates `evaluateModel()` read-only without modifying `PortfolioState`, adding sleeve positions, or relaxing `ALLOWED_SYMBOLS` order restrictions.

## Consequences
- Users and agents can spot and inspect top market movers across US equities/ETFs with zero dilution of the core 6-ticker sleeve accounting or Risk Gateway invariants.
- `POST /api/alpaca/paper-order` and `DEFAULT_RISK_LIMITS` remain strictly locked to paper-only core symbols.
