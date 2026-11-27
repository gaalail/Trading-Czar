# ADR 0002: Fail-Closed Paper-Only Risk Gateway

- **Status**: Accepted
- **Date**: 2026-11-26

## Context

Experimental AI models and interactive controls should never be trusted to self-police capital allocation, leverage, or trading hours.

## Decision

All order paths (both automated AI signals and manual user overrides) must route through `evaluateRiskGate()` in `src/engine/risk.ts`, which enforces:
- `executionMode === 'PAPER_ONLY'` (fail-closed if anything else)
- Emergency circuit breaker (`limits.halted`)
- Regular US market hours (`09:30–16:00 ET`) enforcement toggle
- Bar liquidity participation cap (`maxBarVolumePct`)
- Hard prohibition on short selling (`allowShortSelling: false`) and margin (`allowMargin: false`)
- Single-symbol concentration, gross portfolio exposure, and max order notional caps
- Immutable `RiskEvent` audit logging for both approved and blocked orders

## Consequences

- No strategy can mutate cash or open positions without an explicit `APPROVED` risk check.
- `tests/risk.test.ts` continuously guards every safety invariant against regressions.
- Introducing live brokerage execution in any future system will require a separate architectural review and explicit human-authorized adapter boundary.
