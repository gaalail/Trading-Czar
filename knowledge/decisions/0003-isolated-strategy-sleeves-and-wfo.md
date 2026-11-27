# ADR 0003: Isolated Per-Strategy Sleeves and Walk-Forward Out-of-Sample Validation

- **Status**: Accepted
- **Date**: 2026-11-26

## Context

Sharing one cash pool across competing strategies makes attribution ambiguous, and full-sample backtests hide overfitting—especially for adaptive models like online perceptrons.

## Decision

1. Run each registered strategy inside its own isolated `$100,000` `PortfolioState` sleeve (`sleeves: Record<StrategyId, PortfolioState>`) so all strategies process identical market bars independently without cross-strategy capital interference.
2. Evaluate historical viability in `runWalkForwardMatrix()` using explicit In-Sample / Out-of-Sample splits (`60/40`, `65/35`, `75/25`) with online weight updates frozen during Out-of-Sample windows, paired with transaction cost stress testing (`5`, `15`, `30 bps`).
3. Persist saved hypotheses, parameter snapshots, dataset fingerprints, and human verdicts in the browser Experiment Registry (`localStorage` + JSON export).

## Consequences

- Users can compare strategy equity curves, Sharpe ratios, and drawdowns head-to-head on identical market paths.
- Backtest results immediately expose overfit decay between In-Sample and Out-of-Sample windows.
