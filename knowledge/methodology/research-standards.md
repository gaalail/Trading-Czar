# Quantitative Research Standards

Trading-Czar treats backtests as falsification tools rather than proof of alpha.

## 1. Reproducibility & Provenance

Every recorded experiment in the **Experiment Registry** captures:
- Immutable strategy identifier and version (`strategyId`, `strategyVersion`).
- Full parameter snapshot (`confidenceThreshold`, `maxPositionPct`, `stopLossPct`, `takeProfitPct`, `learningRate`).
- Dataset fingerprint (`sim-15m-<symbol>-<bars>b-s<seed>` or live snapshot identifier).
- Explicit transaction cost and slippage assumptions (`feeBps`, spread + square-root impact).
- Hypothesis statement and observed limitations.

## 2. Out-of-Sample Walk-Forward Validation

- Single-pass full-sample backtests are insufficient because online weights and thresholds can overfit a specific price path.
- `runWalkForwardMatrix()` splits every series into an **In-Sample (IS)** segment (60%–75%) and an **Out-of-Sample (OOS)** segment (25%–40%).
- Online perceptron weight adaptation is frozen during the OOS evaluation window (`!inOos`) so OOS performance reflects genuine generalization rather than continuous in-sample leakage.
- Cost-stress sweeps (`5 bps`, `15 bps`, `30 bps`) verify whether edge survives realistic spread and market-impact friction.

## 3. Look-Ahead Bias Prevention

- `src/engine/intelligence/indicators.ts` computes all indicators causally (`0..t`).
- Automated tests in `tests/architecture.test.ts` assert that truncating future bars never alters indicator values at earlier indices.

## 4. Known Gaps Relative to Institutional Engines

Compared against institutional frameworks (e.g., QuantConnect LEAN) and production research stacks:
- Current bars are synthetic multi-regime series rather than survivorship-bias-free historical SIP equities with split/dividend corporate actions.
- Order fills assume instant execution at the bar close plus spread/impact slippage rather than limit-order queue simulation or partial fills.
- Multi-agent LLM debate workflows (such as `TradingAgents` or `ai-hedge-fund`) and Deep Reinforcement Learning environments (`FinRL`) are outside the deterministic TypeScript core and belong to future backend research phases.
