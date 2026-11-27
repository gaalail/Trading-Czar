# ADR 0001: Strict Separation of Data, Intelligence, Strategy, Risk, and Execution

- **Status**: Accepted
- **Date**: 2026-11-26

## Context

In early trading prototypes, OHLCV fetching, technical indicator calculation, signal logic, and portfolio mutation frequently end up in the same module. When coupled together, it becomes impossible to verify whether indicators leak future data, whether an AI model can bypass position caps, or whether multiple research strategies can share a single intelligence pipeline safely.

## Decision

Physically separate the engine into five unidirectional layers:
1. `src/engine/data/marketData.ts` — Raw OHLCV bars and US market session metadata (`RawCandle[]`).
2. `src/engine/intelligence/indicators.ts` — Pure causal indicator enrichment and regime classification (`Candle[]`).
3. `src/engine/strategies.ts` — Pure signal evaluation returning `ModelDecision`.
4. `src/engine/risk.ts` — Independent fail-closed `evaluateRiskGate()`.
5. `src/engine/portfolio.ts` — Order execution, slippage/fee accounting, and isolated portfolio sleeves.

## Consequences

- `Market Intelligence` can expand (breadth, volatility surfaces, sentiment) without touching execution code.
- Automated tests (`tests/architecture.test.ts`) can independently verify causal no-lookahead behavior on `intelligence/` and purity of `data/` and `strategies/`.
- Future external data feeds (e.g., Alpaca IEX/SIP proxy) only require replacing `data/marketData.ts` behind the `RawCandle` contract.
