# CLAUDE.md — Engineering Rules for Trading-Czar

This file governs future AI development sessions (Claude Code or equivalent) working in this repository.

## Mandatory Working Protocol

1. **Inspect before modifying**: Read existing modules, types (`src/engine/types.ts`), and relevant ADRs in `knowledge/decisions/` before proposing or writing changes.
2. **Respect layer boundaries**:
   - `src/engine/data/` must ONLY emit raw OHLCV data, session calendars, and feed provenance. Never compute indicators, regimes, or signals here.
   - `src/engine/intelligence/` must ONLY compute causal indicators, volatility metrics, and regime classifications from `RawCandle[]`. Never read portfolio state or emit orders here.
   - `src/engine/strategies.ts` must ONLY emit `ModelDecision` signals. Strategies must NEVER mutate cash, positions, or bypass the Risk Gateway.
   - `src/engine/risk.ts` is an independent, fail-closed gatekeeper. All orders (AI and manual) MUST pass `evaluateRiskGate()` before updating portfolio state.
3. **Preserve paper-trading safety invariants**:
   - Execution mode is locked to `PAPER_ONLY`.
   - Short selling, margin borrowing, options, and cryptocurrency trading remain disabled unless explicitly authorized via a formal ADR and architectural review.
   - Do not remove `enforceMarketHours`, `maxBarVolumePct`, or emergency `halted` circuit-breaker checks.
4. **Research integrity**:
   - All indicator calculations must remain strictly causal (no future-bar look-ahead). Check `tests/architecture.test.ts`.
   - Backtest evaluations must report out-of-sample metrics alongside in-sample metrics and preserve dataset fingerprints.
5. **Test & verify every change**:
   - Add or update unit/safety tests in `tests/` whenever modifying risk, data, intelligence, or portfolio logic.
   - Run `npm test`, `npm run lint`, and `npm run build` after changes and report exact results.
6. **Document decisions**:
   - Record non-obvious architectural or modeling choices as a new numbered ADR under `knowledge/decisions/`.
