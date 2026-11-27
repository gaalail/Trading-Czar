import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  FlaskConical,
  HelpCircle,
  Menu,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Sliders,
  StepForward,
  Sun,
  X,
} from 'lucide-react';
import { BacktestMatrixView } from './components/BacktestMatrixView';
import { DiscoveryRadarPanel } from './components/DiscoveryRadarPanel';
import { EquityChart } from './components/EquityChart';
import { ExperimentRegistryView } from './components/ExperimentRegistryView';
import { PriceChart } from './components/PriceChart';
import { RiskGovernanceView, type AlpacaBridgeStatus } from './components/RiskGovernanceView';
import { StrategyConfigView } from './components/StrategyConfigView';
import { TradeLedgerView } from './components/TradeLedgerView';
import {
  appendRawCandle,
  generateRawSeries,
  SYMBOL_LIST,
  SYMBOL_PROFILES,
} from './engine/data/marketData';
import { computeMarketBreadth } from './engine/intelligence/breadth';
import {
  buildSimulatedDiscoveredBars,
  buildSimulatedDiscoverySnapshots,
  rankDiscoveryMovers,
  type ExternalMoverSnapshot,
  type RankedDiscoveryMover,
} from './engine/intelligence/discovery';
import { enrichMarketIntelligence } from './engine/intelligence/indicators';
import { rankMarketOpportunities } from './engine/intelligence/scanner';
import {
  computePortfolioStats,
  computeTotalEquity,
  createInitialPortfolio,
  executeOrder,
  markToMarketAndRecord,
  runDiscoveredSymbolWalkForward,
  stepAISignals,
} from './engine/portfolio';
import { DEFAULT_RISK_LIMITS } from './engine/risk';
import { DEFAULT_WEIGHTS, evaluateModel, STRATEGIES, STRATEGY_LIST } from './engine/strategies';
import type {
  BacktestRow,
  Candle,
  ExperimentRecord,
  ModelDecision,
  PortfolioBacktestSummary,
  PortfolioState,
  RawCandle,
  RiskLimits,
  StrategyConfig,
  StrategyId,
  SymbolId,
} from './engine/types';

type NavTab = 'desk' | 'strategy' | 'ledger' | 'risk' | 'backtest' | 'experiments';

interface MarketWorkspace {
  candlesBySymbol: Record<SymbolId, Candle[]>;
  seedsBySymbol: Record<SymbolId, number>;
  sleeves: Record<StrategyId, PortfolioState>;
  decisionsByStrategy: Record<StrategyId, Record<SymbolId, ModelDecision>>;
}

const INITIAL_CAPITAL = 100000;
const EXPERIMENTS_STORAGE_KEY = 'trading-czar-experiments-v1';

function loadStoredExperiments(): ExperimentRecord[] {
  try {
    const raw = window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createWorkspace(
  strategyConfigs: Record<StrategyId, StrategyConfig>,
  limits: RiskLimits,
  warmupSteps = 18,
  seedSalt = 101
): MarketWorkspace {
  const candlesBySymbol = {} as Record<SymbolId, Candle[]>;
  const seedsBySymbol = {} as Record<SymbolId, number>;

  for (const profile of SYMBOL_LIST) {
    const { rawCandles, nextSeed } = generateRawSeries(profile.id, 64, seedSalt);
    candlesBySymbol[profile.id] = enrichMarketIntelligence(rawCandles);
    seedsBySymbol[profile.id] = nextSeed;
  }

  const sleeves = {} as Record<StrategyId, PortfolioState>;
  const decisionsByStrategy = {} as Record<StrategyId, Record<SymbolId, ModelDecision>>;

  for (const strat of STRATEGY_LIST) {
    sleeves[strat.id] = createInitialPortfolio(strat.id, INITIAL_CAPITAL, candlesBySymbol);
    decisionsByStrategy[strat.id] = {} as Record<SymbolId, ModelDecision>;
  }

  for (let step = 0; step < warmupSteps; step++) {
    for (const profile of SYMBOL_LIST) {
      const next = appendRawCandle(
        profile.id,
        candlesBySymbol[profile.id],
        seedsBySymbol[profile.id]
      );
      candlesBySymbol[profile.id] = enrichMarketIntelligence(next.rawCandles);
      seedsBySymbol[profile.id] = next.nextSeed;
    }

    for (const strat of STRATEGY_LIST) {
      const cfg = strategyConfigs[strat.id];
      const res = stepAISignals(sleeves[strat.id], candlesBySymbol, cfg, true, limits);
      sleeves[strat.id] = markToMarketAndRecord(res.portfolio, candlesBySymbol, 'NVDA');
      decisionsByStrategy[strat.id] = res.decisions;
    }
  }

  if (warmupSteps === 0) {
    for (const strat of STRATEGY_LIST) {
      const cfg = strategyConfigs[strat.id];
      for (const profile of SYMBOL_LIST) {
        const breadthSnapshot = computeMarketBreadth(candlesBySymbol, profile.id);
        decisionsByStrategy[strat.id][profile.id] = evaluateModel(
          profile.id,
          candlesBySymbol[profile.id],
          cfg,
          sleeves[strat.id].weights,
          false,
          0,
          breadthSnapshot
        );
      }
    }
  }

  return {
    candlesBySymbol,
    seedsBySymbol,
    sleeves,
    decisionsByStrategy,
  };
}

export function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('desk');
  const [activeSymbol, setActiveSymbol] = useState<SymbolId>('NVDA');
  const [activeStrategyId, setActiveStrategyId] = useState<StrategyId>('neural-perceptron');
  const [strategyConfigs, setStrategyConfigs] = useState<Record<StrategyId, StrategyConfig>>(() => ({
    ...STRATEGIES,
  }));
  const [riskLimits, setRiskLimits] = useState<RiskLimits>(() => ({ ...DEFAULT_RISK_LIMITS }));
  const [workspace, setWorkspace] = useState<MarketWorkspace>(() =>
    createWorkspace(STRATEGIES, DEFAULT_RISK_LIMITS, 18, 101)
  );
  const [experiments, setExperiments] = useState<ExperimentRecord[]>(() => loadStoredExperiments());
  const [isRunning, setIsRunning] = useState(false);
  const [speedMs, setSpeedMs] = useState<number>(900);
  const [autoExecuteAI, setAutoExecuteAI] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resetSalt, setResetSalt] = useState(101);
  const [alpacaStatus, setAlpacaStatus] = useState<AlpacaBridgeStatus>({
    configured: false,
    paperOnlyLocked: true,
    feed: 'iex',
  });
  const [openMetricHelp, setOpenMetricHelp] = useState<
    'return' | 'risk' | 'accuracy' | null
  >(null);
  const [feedMode, setFeedMode] = useState<'simulated' | 'alpaca'>('simulated');
  const [alpacaSyncing, setAlpacaSyncing] = useState(false);
  const [alpacaFeedError, setAlpacaFeedError] = useState<string | null>(null);
  const [discoveryMovers, setDiscoveryMovers] = useState<RankedDiscoveryMover[]>(() =>
    rankDiscoveryMovers(buildSimulatedDiscoverySnapshots(101))
  );
  const [discoverySourceSummary, setDiscoverySourceSummary] = useState(
    'Simulated Liquid Watchpool (10 External US Equities & ETFs)'
  );
  const [discoveryFetchedAt, setDiscoveryFetchedAt] = useState<string | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [inspectedTicker, setInspectedTicker] = useState<{
    symbol: string;
    sourceLabel: string;
    candles: Candle[];
  } | null>(null);
  const [inspectingLoading, setInspectingLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const scanMarketMovers = useCallback(
    async (modeOverride?: 'simulated' | 'alpaca', alpacaConfiguredOverride?: boolean) => {
      const targetMode = modeOverride ?? feedMode;
      const canUseAlpaca = alpacaConfiguredOverride ?? alpacaStatus.configured;
      setDiscoveryLoading(true);
      setDiscoveryError(null);

      if (targetMode !== 'alpaca' || !canUseAlpaca) {
        const simMovers = rankDiscoveryMovers(
          buildSimulatedDiscoverySnapshots(resetSalt + Math.floor(Date.now() / 10000))
        );
        setDiscoveryMovers(simMovers);
        setDiscoverySourceSummary('Simulated Liquid Watchpool (10 External US Equities & ETFs)');
        setDiscoveryFetchedAt(new Date().toISOString());
        setDiscoveryLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/alpaca/movers');
        const payload = (await res.json()) as {
          movers?: ExternalMoverSnapshot[];
          sourceSummary?: string;
          fetchedAt?: string;
          error?: string;
        };
        if (!res.ok || !Array.isArray(payload.movers)) {
          throw new Error(payload.error || 'Failed to scan Alpaca market movers.');
        }
        setDiscoveryMovers(rankDiscoveryMovers(payload.movers));
        setDiscoverySourceSummary(
          payload.sourceSummary || 'Alpaca Screener Movers + Most Actives + Snapshots'
        );
        setDiscoveryFetchedAt(payload.fetchedAt || new Date().toISOString());
      } catch (err) {
        setDiscoveryError(err instanceof Error ? err.message : 'Unable to scan market movers.');
      } finally {
        setDiscoveryLoading(false);
      }
    },
    [feedMode, alpacaStatus.configured, resetSalt]
  );

  const handleInspectDiscoveredTicker = useCallback(
    async (mover: RankedDiscoveryMover) => {
      setInspectingLoading(true);
      setDiscoveryError(null);
      try {
        if (feedMode === 'alpaca' && alpacaStatus.configured) {
          const res = await fetch(
            `/api/alpaca/discover-bars?symbol=${encodeURIComponent(mover.symbol)}&limit=140`
          );
          const payload = (await res.json()) as {
            bars?: RawCandle[];
            error?: string;
          };
          if (!res.ok || !Array.isArray(payload.bars) || payload.bars.length < 20) {
            throw new Error(
              payload.error || `Not enough 15m bars available to chart ${mover.symbol}.`
            );
          }
          setInspectedTicker({
            symbol: mover.symbol,
            sourceLabel: mover.sourceLabel,
            candles: enrichMarketIntelligence(payload.bars),
          });
        } else {
          const raw = buildSimulatedDiscoveredBars(mover.symbol, 120);
          setInspectedTicker({
            symbol: mover.symbol,
            sourceLabel: mover.sourceLabel,
            candles: enrichMarketIntelligence(raw),
          });
        }
        setActiveTab('desk');
      } catch (err) {
        setDiscoveryError(
          err instanceof Error ? err.message : `Unable to load chart bars for ${mover.symbol}.`
        );
      } finally {
        setInspectingLoading(false);
      }
    },
    [feedMode, alpacaStatus.configured]
  );

  const syncAlpacaLiveWorkspace = useCallback(
    async (resetSleeves: boolean, forceStep: boolean): Promise<boolean> => {
      setAlpacaSyncing(true);
      try {
        const res = await fetch('/api/alpaca/universe-bars?limit=140');
        const payload = (await res.json()) as {
          barsBySymbol?: Record<string, RawCandle[]>;
          error?: string;
        };
        if (!res.ok || !payload.barsBySymbol) {
          throw new Error(payload.error || 'Failed to load Alpaca market bars.');
        }

        const nextCandles = {} as Record<SymbolId, Candle[]>;
        for (const profile of SYMBOL_LIST) {
          const raw = payload.barsBySymbol[profile.id];
          if (!Array.isArray(raw) || raw.length < 25) {
            throw new Error(`Insufficient Alpaca bars returned for ${profile.id}.`);
          }
          nextCandles[profile.id] = enrichMarketIntelligence(raw);
        }

        setWorkspace((prev) => {
          if (resetSleeves) {
            const sleeves = {} as Record<StrategyId, PortfolioState>;
            const decisionsByStrategy = {} as Record<StrategyId, Record<SymbolId, ModelDecision>>;
            for (const strat of STRATEGY_LIST) {
              sleeves[strat.id] = createInitialPortfolio(strat.id, INITIAL_CAPITAL, nextCandles);
              decisionsByStrategy[strat.id] = {} as Record<SymbolId, ModelDecision>;
              const cfg = strategyConfigs[strat.id];
              for (const profile of SYMBOL_LIST) {
                decisionsByStrategy[strat.id][profile.id] = evaluateModel(
                  profile.id,
                  nextCandles[profile.id],
                  cfg,
                  sleeves[strat.id].weights,
                  false,
                  0,
                  computeMarketBreadth(nextCandles, profile.id)
                );
              }
            }
            return {
              candlesBySymbol: nextCandles,
              seedsBySymbol: prev.seedsBySymbol,
              sleeves,
              decisionsByStrategy,
            };
          }

          const hasChanged = SYMBOL_LIST.some((profile) => {
            const prevLast = prev.candlesBySymbol[profile.id]?.[prev.candlesBySymbol[profile.id].length - 1];
            const nextLast = nextCandles[profile.id][nextCandles[profile.id].length - 1];
            return (
              !prevLast ||
              prevLast.timestamp !== nextLast.timestamp ||
              prevLast.close !== nextLast.close ||
              prevLast.volume !== nextLast.volume
            );
          });

          if (!hasChanged && !forceStep) {
            return prev;
          }

          const nextSleeves = { ...prev.sleeves };
          const nextDecisions = { ...prev.decisionsByStrategy };
          for (const strat of STRATEGY_LIST) {
            const cfg = strategyConfigs[strat.id];
            const stepped = stepAISignals(
              prev.sleeves[strat.id],
              nextCandles,
              cfg,
              autoExecuteAI,
              riskLimits
            );
            nextSleeves[strat.id] = markToMarketAndRecord(
              stepped.portfolio,
              nextCandles,
              activeSymbol
            );
            nextDecisions[strat.id] = stepped.decisions;
          }

          return {
            candlesBySymbol: nextCandles,
            seedsBySymbol: prev.seedsBySymbol,
            sleeves: nextSleeves,
            decisionsByStrategy: nextDecisions,
          };
        });

        setAlpacaFeedError(null);
        return true;
      } catch (err) {
        setAlpacaFeedError(err instanceof Error ? err.message : 'Unable to sync Alpaca bars.');
        return false;
      } finally {
        setAlpacaSyncing(false);
      }
    },
    [strategyConfigs, autoExecuteAI, riskLimits, activeSymbol]
  );

  useEffect(() => {
    let active = true;
    fetch('/api/alpaca/status')
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data: Partial<AlpacaBridgeStatus> | null) => {
        if (!active || !data) return;
        const baseStatus: AlpacaBridgeStatus = {
          configured: Boolean(data.configured),
          paperOnlyLocked: data.paperOnlyLocked !== false,
          feed: typeof data.feed === 'string' ? data.feed : 'iex',
        };
        if (baseStatus.configured) {
          try {
            const accRes = await fetch('/api/alpaca/account');
            const acc = (await accRes.json()) as {
              connected?: boolean;
              status?: string;
              equity?: number;
              buyingPower?: number;
              error?: string;
            };
            if (!active) return;
            setAlpacaStatus({
              ...baseStatus,
              accountConnected: Boolean(acc.connected),
              accountStatus: acc.status,
              equity: acc.equity,
              buyingPower: acc.buyingPower,
              error: acc.error,
            });
            if (acc.connected) {
              const ok = await syncAlpacaLiveWorkspace(true, false);
              if (active && ok) {
                setFeedMode('alpaca');
                void scanMarketMovers('alpaca', true);
              }
            }
            return;
          } catch {
            // Fall through to base status
          }
        }
        setAlpacaStatus(baseStatus);
      })
      .catch(() => {
        // Keep safe local simulation defaults when backend status is unavailable
      });

    fetch('/api/experiments')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { experiments?: ExperimentRecord[] } | null) => {
        if (!active || !data || !Array.isArray(data.experiments)) return;
        if (data.experiments.length > 0) {
          setExperiments((prev) => {
            const byId = new Map<string, ExperimentRecord>();
            for (const item of data.experiments!) byId.set(item.id, item);
            for (const item of prev) {
              if (!byId.has(item.id)) byId.set(item.id, item);
            }
            return Array.from(byId.values());
          });
        }
      })
      .catch(() => {
        // Keep localStorage cache if API is unavailable
      });

    return () => {
      active = false;
    };
    // Initial boot synchronization only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, JSON.stringify(experiments));
    } catch {
      // Ignore storage quota errors in restricted frames
    }
  }, [experiments]);

  const currentStrategyConfig = strategyConfigs[activeStrategyId];
  const activePortfolio = workspace.sleeves[activeStrategyId];

  const advanceMarketBar = useCallback(() => {
    if (feedMode === 'alpaca') {
      void syncAlpacaLiveWorkspace(false, true);
      return;
    }
    setWorkspace((prev) => {
      const nextCandles = { ...prev.candlesBySymbol };
      const nextSeeds = { ...prev.seedsBySymbol };

      for (const profile of SYMBOL_LIST) {
        const appended = appendRawCandle(
          profile.id,
          prev.candlesBySymbol[profile.id],
          prev.seedsBySymbol[profile.id]
        );
        nextCandles[profile.id] = enrichMarketIntelligence(appended.rawCandles.slice(-140));
        nextSeeds[profile.id] = appended.nextSeed;
      }

      const nextSleeves = { ...prev.sleeves };
      const nextDecisions = { ...prev.decisionsByStrategy };

      for (const strat of STRATEGY_LIST) {
        const cfg = strategyConfigs[strat.id];
        const stepped = stepAISignals(
          prev.sleeves[strat.id],
          nextCandles,
          cfg,
          autoExecuteAI,
          riskLimits
        );
        nextSleeves[strat.id] = markToMarketAndRecord(
          stepped.portfolio,
          nextCandles,
          activeSymbol
        );
        nextDecisions[strat.id] = stepped.decisions;
      }

      return {
        candlesBySymbol: nextCandles,
        seedsBySymbol: nextSeeds,
        sleeves: nextSleeves,
        decisionsByStrategy: nextDecisions,
      };
    });
  }, [feedMode, syncAlpacaLiveWorkspace, strategyConfigs, autoExecuteAI, activeSymbol, riskLimits]);

  useEffect(() => {
    if (!isRunning) return;
    if (feedMode === 'alpaca') {
      const timer = window.setInterval(() => {
        void syncAlpacaLiveWorkspace(false, false);
      }, 15000);
      return () => window.clearInterval(timer);
    }
    const timer = window.setInterval(() => {
      advanceMarketBar();
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [isRunning, feedMode, speedMs, advanceMarketBar, syncAlpacaLiveWorkspace]);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    if (feedMode === 'alpaca') {
      void syncAlpacaLiveWorkspace(true, false);
      return;
    }
    const nextSalt = resetSalt + 37;
    setResetSalt(nextSalt);
    setWorkspace(createWorkspace(strategyConfigs, riskLimits, 0, nextSalt));
  }, [feedMode, syncAlpacaLiveWorkspace, resetSalt, strategyConfigs, riskLimits]);

  const handleToggleFeedMode = useCallback(() => {
    setIsRunning(false);
    setInspectedTicker(null);
    if (feedMode === 'simulated') {
      void syncAlpacaLiveWorkspace(true, false).then((ok) => {
        if (ok) {
          setFeedMode('alpaca');
          void scanMarketMovers('alpaca', true);
        }
      });
    } else {
      setFeedMode('simulated');
      setAlpacaFeedError(null);
      setWorkspace(createWorkspace(strategyConfigs, riskLimits, 18, resetSalt));
      void scanMarketMovers('simulated', false);
    }
  }, [feedMode, syncAlpacaLiveWorkspace, scanMarketMovers, strategyConfigs, riskLimits, resetSalt]);

  const handleManualOrder = (side: 'BUY' | 'SELL', targetSymbol: SymbolId = activeSymbol) => {
    setWorkspace((prev) => {
      const candles = prev.candlesBySymbol[targetSymbol];
      const sleeve = prev.sleeves[activeStrategyId];
      const nextPortfolio = executeOrder(
        sleeve,
        targetSymbol,
        side,
        candles,
        prev.candlesBySymbol,
        currentStrategyConfig,
        'MANUAL',
        null,
        `Manual ${side.toLowerCase()} order executed on ${currentStrategyConfig.name} sleeve.`,
        riskLimits
      );
      const marked = markToMarketAndRecord(nextPortfolio, prev.candlesBySymbol, activeSymbol);
      const pos = marked.positions[targetSymbol];
      const nextDecision = evaluateModel(
        targetSymbol,
        candles,
        currentStrategyConfig,
        marked.weights,
        pos.quantity > 0,
        pos.unrealizedPnlPct,
        computeMarketBreadth(prev.candlesBySymbol, targetSymbol)
      );
      return {
        ...prev,
        sleeves: {
          ...prev.sleeves,
          [activeStrategyId]: marked,
        },
        decisionsByStrategy: {
          ...prev.decisionsByStrategy,
          [activeStrategyId]: {
            ...prev.decisionsByStrategy[activeStrategyId],
            [targetSymbol]: nextDecision,
          },
        },
      };
    });
  };

  const handleSelectStrategy = (id: StrategyId) => {
    setActiveStrategyId(id);
  };

  const handleUpdateStrategyConfig = (patch: Partial<StrategyConfig>) => {
    setStrategyConfigs((prev) => ({
      ...prev,
      [activeStrategyId]: {
        ...prev[activeStrategyId],
        ...patch,
      },
    }));
  };

  const handleToggleGlobalFilter = (
    key:
      | 'useAtrSizingAndStops'
      | 'useBreadthFilter'
      | 'useTimeOfDayFilter'
      | 'useVwapAnchor'
      | 'useAdxRegimeGate'
  ) => {
    setStrategyConfigs((prev) => {
      const allOn = Object.values(prev).every((c) => c[key]);
      const nextVal = !allOn;
      const updated = { ...prev };
      for (const strat of STRATEGY_LIST) {
        updated[strat.id] = {
          ...prev[strat.id],
          [key]: nextVal,
        };
      }
      return updated;
    });
  };

  const handleResetWeights = () => {
    setWorkspace((prev) => ({
      ...prev,
      sleeves: {
        ...prev.sleeves,
        [activeStrategyId]: {
          ...prev.sleeves[activeStrategyId],
          weights: { ...DEFAULT_WEIGHTS },
          weightUpdates: 0,
        },
      },
    }));
  };

  const handleSaveBacktestExperiment = (row: BacktestRow) => {
    const cfg = strategyConfigs[row.strategyId];
    const record: ExperimentRecord = {
      id: `exp-${Date.now()}-${row.symbol}`,
      createdAt: new Date().toISOString(),
      title: `${row.strategyName} on ${row.symbol} (${row.horizonBars}b WFO)`,
      hypothesis: `Testing whether ${row.strategyName} achieves positive out-of-sample risk-adjusted return on ${row.symbol} under ${row.feeBps} bps transaction costs.`,
      limitations: `Simulated 15m multi-regime series (${row.inSamplePct}/${100 - row.inSamplePct} IS/OOS split); single-symbol isolation.`,
      verdict: row.outOfSampleSharpe >= 0.8 && row.outOfSampleReturnPct > 0 ? 'Validated' : 'Pending Review',
      strategyId: row.strategyId,
      strategyName: row.strategyName,
      strategyVersion: row.strategyVersion,
      symbol: row.symbol,
      datasetFingerprint: row.datasetFingerprint,
      horizonBars: row.horizonBars,
      feeBps: row.feeBps,
      parameters: {
        confidenceThreshold: cfg.confidenceThreshold,
        maxPositionPct: cfg.maxPositionPct,
        stopLossPct: cfg.stopLossPct,
        takeProfitPct: cfg.takeProfitPct,
        learningRate: cfg.learningRate,
      },
      metrics: {
        inSampleReturnPct: row.inSampleReturnPct,
        outOfSampleReturnPct: row.outOfSampleReturnPct,
        benchmarkReturnPct: row.benchmarkOosReturnPct,
        sharpeRatio: row.outOfSampleSharpe,
        maxDrawdownPct: row.maxDrawdownPct,
        winRatePct: row.winRatePct,
        profitFactor: row.profitFactor,
        tradeCount: row.tradeCount,
      },
    };
    setExperiments((prev) => [record, ...prev]);
    fetch('/api/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {
      // Fallback to localStorage only
    });
  };

  const handleSavePortfolioExperiment = (summary: PortfolioBacktestSummary) => {
    const cfg = strategyConfigs[summary.strategyId];
    const record: ExperimentRecord = {
      id: `exp-port-${Date.now()}-${summary.strategyId}`,
      createdAt: new Date().toISOString(),
      title: `${summary.strategyName} Multi-Asset Portfolio WFO (${summary.horizonBars}b)`,
      hypothesis: `Testing whether ${summary.strategyName} beats the equal-weight 6-stock benchmark across one shared $100k pool with correlation & exposure caps enforced.`,
      limitations: `${summary.inSamplePct}/${100 - summary.inSamplePct} IS/OOS split with frozen OOS weights (${summary.feeBps} bps costs; ${summary.riskBlockedCount} orders blocked by Risk Gateway).`,
      verdict:
        summary.outOfSampleSharpe >= 0.8 && summary.outOfSampleReturnPct > summary.benchmarkOosReturnPct
          ? 'Validated'
          : 'Pending Review',
      strategyId: summary.strategyId,
      strategyName: summary.strategyName,
      strategyVersion: summary.strategyVersion,
      symbol: 'MULTI-ASSET',
      datasetFingerprint: `port-wfo-${summary.horizonBars}b-${summary.feeBps}bps`,
      horizonBars: summary.horizonBars,
      feeBps: summary.feeBps,
      parameters: {
        confidenceThreshold: cfg.confidenceThreshold,
        maxPositionPct: cfg.maxPositionPct,
        stopLossPct: cfg.stopLossPct,
        takeProfitPct: cfg.takeProfitPct,
        learningRate: cfg.learningRate,
      },
      metrics: {
        inSampleReturnPct: summary.inSampleReturnPct,
        outOfSampleReturnPct: summary.outOfSampleReturnPct,
        benchmarkReturnPct: summary.benchmarkOosReturnPct,
        sharpeRatio: summary.outOfSampleSharpe,
        maxDrawdownPct: summary.maxDrawdownPct,
        winRatePct: summary.winRatePct,
        profitFactor: summary.profitFactor,
        tradeCount: summary.tradeCount,
      },
    };
    setExperiments((prev) => [record, ...prev]);
    fetch('/api/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {
      // Fallback to localStorage only
    });
  };

  const activeCandles = workspace.candlesBySymbol[activeSymbol];
  const latestCandle = activeCandles[activeCandles.length - 1];
  const activeDecision = workspace.decisionsByStrategy[activeStrategyId][activeSymbol];
  const activePosition = activePortfolio.positions[activeSymbol];

  const isInspectingExternal = inspectedTicker !== null;
  const displayedSymbol = inspectedTicker ? inspectedTicker.symbol : activeSymbol;
  const displayedTitle = inspectedTicker
    ? `${inspectedTicker.symbol} · ${inspectedTicker.sourceLabel}`
    : `${activeSymbol} · ${SYMBOL_PROFILES[activeSymbol].name}`;
  const displayedAssetClass = inspectedTicker
    ? 'Discovery Inspection (Read-Only)'
    : SYMBOL_PROFILES[activeSymbol].assetClass;
  const displayedCandles = inspectedTicker ? inspectedTicker.candles : activeCandles;
  const displayedLatestCandle = displayedCandles[displayedCandles.length - 1];
  const displayedPrevCandle = displayedCandles[Math.max(0, displayedCandles.length - 2)];
  const priceChange = displayedLatestCandle.close - displayedPrevCandle.close;
  const priceChangePct = (priceChange / Math.max(0.01, displayedPrevCandle.close)) * 100;

  const sleeveSummaries = useMemo(() => {
    return STRATEGY_LIST.map((strat) => {
      const portfolio = workspace.sleeves[strat.id];
      const equity = computeTotalEquity(portfolio, workspace.candlesBySymbol);
      const s = computePortfolioStats(portfolio, equity);
      const openCount = Object.values(portfolio.positions).filter((p) => p.quantity > 0).length;
      return {
        strategy: strat,
        portfolio,
        equity,
        stats: s,
        openCount,
      };
    });
  }, [workspace]);

  const activeSummary =
    sleeveSummaries.find((s) => s.strategy.id === activeStrategyId) ?? sleeveSummaries[0];

  const totalEquity = activeSummary.equity;
  const stats = activeSummary.stats;

  const handleSnapshotActiveSleeve = () => {
    const cfg = currentStrategyConfig;
    const curve = activePortfolio.equityCurve;
    const benchStart = curve[0]?.benchmarkEquity ?? INITIAL_CAPITAL;
    const benchEnd = curve[curve.length - 1]?.benchmarkEquity ?? INITIAL_CAPITAL;
    const benchReturnPct = ((benchEnd - benchStart) / benchStart) * 100;

    const record: ExperimentRecord = {
      id: `exp-live-${Date.now()}`,
      createdAt: new Date().toISOString(),
      title: `${cfg.name} Live Multi-Asset Sleeve Snapshot`,
      hypothesis: `Evaluating live isolated paper sleeve for ${cfg.name} across 6 US equities & ETFs with Risk Gateway limits active.`,
      limitations:
        feedMode === 'alpaca'
          ? `Live Alpaca ${alpacaStatus.feed.toUpperCase()} 15m market feed with local paper sleeves; ${curve.length} recorded equity points.`
          : `Simulated streaming market bars (seed ${resetSalt}); ${curve.length} recorded equity points.`,
      verdict: 'Pending Review',
      strategyId: cfg.id,
      strategyName: cfg.name,
      strategyVersion: cfg.version,
      symbol: 'MULTI-ASSET',
      datasetFingerprint:
        feedMode === 'alpaca'
          ? `alpaca-${alpacaStatus.feed}-15m-b${latestCandle.index}`
          : `live-sim-15m-s${resetSalt}-b${latestCandle.index}`,
      horizonBars: curve.length,
      feeBps: cfg.feeBps,
      parameters: {
        confidenceThreshold: cfg.confidenceThreshold,
        maxPositionPct: cfg.maxPositionPct,
        stopLossPct: cfg.stopLossPct,
        takeProfitPct: cfg.takeProfitPct,
        learningRate: cfg.learningRate,
      },
      metrics: {
        inSampleReturnPct: stats.totalReturnPct,
        outOfSampleReturnPct: stats.totalReturnPct,
        benchmarkReturnPct: benchReturnPct,
        sharpeRatio: stats.sharpeRatio,
        maxDrawdownPct: activePortfolio.maxDrawdownPct,
        winRatePct: stats.winRatePct,
        profitFactor: stats.profitFactor,
        tradeCount: stats.closedCount,
      },
    };
    setExperiments((prev) => [record, ...prev]);
    fetch('/api/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {
      // Fallback to localStorage only
    });
  };

  const openPositions = useMemo(
    () => Object.values(activePortfolio.positions).filter((p) => p.quantity > 0),
    [activePortfolio.positions]
  );

  const breadth = useMemo(
    () => computeMarketBreadth(workspace.candlesBySymbol, activeSymbol),
    [workspace.candlesBySymbol, activeSymbol]
  );

  const displayedDecision = useMemo(() => {
    if (!inspectedTicker) return activeDecision;
    return evaluateModel(
      inspectedTicker.symbol,
      inspectedTicker.candles,
      currentStrategyConfig,
      activePortfolio.weights,
      false,
      0,
      breadth
    );
  }, [inspectedTicker, activeDecision, currentStrategyConfig, activePortfolio.weights, breadth]);

  const inspectedWfoCheck = useMemo(() => {
    if (!inspectedTicker) return null;
    return runDiscoveredSymbolWalkForward(
      inspectedTicker.symbol,
      inspectedTicker.candles,
      currentStrategyConfig,
      INITIAL_CAPITAL,
      65,
      riskLimits
    );
  }, [inspectedTicker, currentStrategyConfig, riskLimits]);

  const [discoveryLoggedSymbol, setDiscoveryLoggedSymbol] = useState<string | null>(null);

  const handleSaveDiscoveryExperiment = () => {
    if (!inspectedWfoCheck || !inspectedTicker) return;
    const cfg = currentStrategyConfig;
    const record: ExperimentRecord = {
      id: `exp-disc-${Date.now()}-${inspectedWfoCheck.symbol}`,
      createdAt: new Date().toISOString(),
      title: `Discovery Check: ${cfg.name} on ${inspectedWfoCheck.symbol}`,
      hypothesis: `Evaluating ${inspectedTicker.sourceLabel} mover ${inspectedWfoCheck.symbol} out-of-sample using ${cfg.name} before considering watchlist promotion.`,
      limitations: `Read-only external discovery check (${inspectedWfoCheck.horizonBars} bars, ${feedMode === 'alpaca' ? 'Alpaca IEX' : 'Simulated'}); not routed to core sleeves.`,
      verdict:
        inspectedWfoCheck.outOfSampleSharpe >= 0.8 && inspectedWfoCheck.outOfSampleReturnPct > 0
          ? 'Validated'
          : 'Pending Review',
      strategyId: cfg.id,
      strategyName: cfg.name,
      strategyVersion: cfg.version,
      symbol: inspectedWfoCheck.symbol,
      datasetFingerprint: inspectedWfoCheck.datasetFingerprint,
      horizonBars: inspectedWfoCheck.horizonBars,
      feeBps: cfg.feeBps,
      parameters: {
        confidenceThreshold: cfg.confidenceThreshold,
        maxPositionPct: cfg.maxPositionPct,
        stopLossPct: cfg.stopLossPct,
        takeProfitPct: cfg.takeProfitPct,
        learningRate: cfg.learningRate,
      },
      metrics: {
        inSampleReturnPct: inspectedWfoCheck.inSampleReturnPct,
        outOfSampleReturnPct: inspectedWfoCheck.outOfSampleReturnPct,
        benchmarkReturnPct: inspectedWfoCheck.benchmarkOosReturnPct,
        sharpeRatio: inspectedWfoCheck.outOfSampleSharpe,
        maxDrawdownPct: inspectedWfoCheck.maxDrawdownPct,
        winRatePct: inspectedWfoCheck.winRatePct,
        profitFactor: inspectedWfoCheck.profitFactor,
        tradeCount: inspectedWfoCheck.tradeCount,
      },
    };
    setExperiments((prev) => [record, ...prev]);
    setDiscoveryLoggedSymbol(inspectedWfoCheck.symbol);
    window.setTimeout(() => {
      setDiscoveryLoggedSymbol((curr) => (curr === inspectedWfoCheck.symbol ? null : curr));
    }, 1800);
    fetch('/api/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {
      // Fallback to localStorage only
    });
  };

  const opportunities = useMemo(
    () =>
      rankMarketOpportunities(
        workspace.candlesBySymbol,
        workspace.decisionsByStrategy[activeStrategyId]
      ),
    [workspace.candlesBySymbol, workspace.decisionsByStrategy, activeStrategyId]
  );

  const investedValue = totalEquity - activePortfolio.cash;
  const investedPct = totalEquity > 0 ? (investedValue / totalEquity) * 100 : 0;

  const equitySeriesForChart = useMemo(
    () =>
      STRATEGY_LIST.map((strat) => ({
        id: strat.id,
        label: strat.name,
        curve: workspace.sleeves[strat.id].equityCurve,
      })),
    [workspace.sleeves]
  );

  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'desk', label: 'Live Desk', icon: <Activity className="w-4 h-4" /> },
    { id: 'strategy', label: 'Strategy & Weights', icon: <Sliders className="w-4 h-4" /> },
    { id: 'ledger', label: 'Execution Ledger', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'risk', label: 'Risk & Governance', icon: <Shield className="w-4 h-4" /> },
    { id: 'backtest', label: 'Walk-Forward Lab', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'experiments', label: 'Experiments', icon: <FlaskConical className="w-4 h-4" /> },
  ];

  const activeTabLabel = navItems.find((n) => n.id === activeTab)?.label ?? 'Live Desk';

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-5 h-14 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
        <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
          Trading-Czar
        </span>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="p-3 space-y-1 border-b border-slate-200 dark:border-slate-800">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                <span>{item.label}</span>
              </span>
              {item.id === 'experiments' && experiments.length > 0 && (
                <span className="font-mono text-[10px] opacity-75">{experiments.length}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="px-2 pb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          Market Watchlist
        </div>
        <div className="space-y-1">
          {SYMBOL_LIST.map((profile) => {
            const cList = workspace.candlesBySymbol[profile.id];
            const last = cList[cList.length - 1];
            const prev = cList[Math.max(0, cList.length - 2)];
            const pct = ((last.close - prev.close) / prev.close) * 100;
            const pos = activePortfolio.positions[profile.id];
            const isSelected = activeSymbol === profile.id;

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setInspectedTicker(null);
                  setActiveSymbol(profile.id);
                  setActiveTab('desk');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>{profile.id}</span>
                    {pos.quantity > 0 && (
                      <span className="text-[10px] font-mono font-normal text-slate-500 dark:text-slate-400">
                        · Long
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {profile.name}
                  </div>
                </div>

                <div className="text-right shrink-0 ml-2">
                  <div className="text-xs font-mono font-medium text-slate-900 dark:text-slate-100">
                    ${last.close.toFixed(2)}
                  </div>
                  <div
                    className={`text-[11px] font-mono ${
                      pct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(2)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div>
          {feedMode === 'alpaca'
            ? `Alpaca ${alpacaStatus.feed.toUpperCase()} Live Feed · Local Paper`
            : 'Simulated Feed · Paper Mode'}
        </div>
        <div className="mt-0.5 font-mono">
          {riskLimits.halted
            ? 'Gateway Halted'
            : latestCandle.isRegularHours
              ? 'US Session Open (09:30–16:00)'
              : 'Extended Hours (Gated)'}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <aside className="hidden lg:block w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 h-full">
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                Trading-Czar
              </span>
              <span aria-hidden="true">/</span>
              <span className="whitespace-nowrap">{activeTabLabel}</span>
              <span aria-hidden="true">/</span>
              <span className="whitespace-nowrap text-slate-700 dark:text-slate-200">
                {currentStrategyConfig.name}
              </span>
              {activeTab === 'desk' && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {displayedSymbol}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {alpacaStatus.configured && (
              <button
                type="button"
                onClick={handleToggleFeedMode}
                disabled={alpacaSyncing}
                title="Switch Live Desk between real Alpaca IEX bars and simulated bars (orders always remain local paper)"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  feedMode === 'alpaca'
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-700/60 hover:bg-emerald-950/60'
                    : 'bg-white text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {alpacaSyncing
                  ? 'Syncing...'
                  : feedMode === 'alpaca'
                    ? `Feed: Alpaca ${alpacaStatus.feed.toUpperCase()}`
                    : 'Feed: Simulated'}
              </button>
            )}

            <button
              type="button"
              onClick={advanceMarketBar}
              disabled={alpacaSyncing}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <StepForward className="w-3.5 h-3.5" />
              {feedMode === 'alpaca' ? 'Sync Live' : 'Step Bar'}
            </button>

            <button
              type="button"
              onClick={() => setIsRunning((r) => !r)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isRunning
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90'
              }`}
            >
              {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isRunning ? 'Pause AI' : 'Start AI'}
            </button>

            <button
              type="button"
              onClick={handleReset}
              title="Reset all strategy sleeves to $100,000 cash"
              aria-label="Reset portfolio sleeves"
              className="p-1.5 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-1.5 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </header>
        {alpacaFeedError && (
          <div className="bg-rose-950/40 border-b border-rose-800/60 px-6 py-2 text-xs text-rose-300 flex items-center justify-between">
            <span>{alpacaFeedError}</span>
            <button
              type="button"
              onClick={() => setAlpacaFeedError(null)}
              className="underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Sleeve Net Equity · {currentStrategyConfig.name}
              </div>
              <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Cash ${activePortfolio.cash.toLocaleString('en-US', { maximumFractionDigits: 0 })} · {investedPct.toFixed(0)}% Invested
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Sleeve Return &amp; Alpha
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setOpenMetricHelp((prev) => (prev === 'return' ? null : 'return'))
                  }
                  aria-label="Explain Return and Alpha metrics"
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <div
                className={`mt-1 text-2xl font-mono font-semibold tabular-nums ${
                  stats.totalReturnPct >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {stats.totalReturnPct >= 0 ? '+' : ''}
                {stats.totalReturnPct.toFixed(2)}%
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Alpha vs. Bench {stats.alphaPct >= 0 ? '+' : ''}
                {stats.alphaPct.toFixed(2)}% · Fees ${activePortfolio.totalFees.toFixed(2)}
              </div>
              {openMetricHelp === 'return' && (
                <p className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  <strong>Alpha vs. Bench</strong> shows how much better (or worse) the AI did than simply buying and holding all 6 stocks equally over the same window.
                </p>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Risk-Adjusted Ratios
                </span>
                <button
                  type="button"
                  onClick={() => setOpenMetricHelp((prev) => (prev === 'risk' ? null : 'risk'))}
                  aria-label="Explain Sharpe, Sortino, Calmar, and Max Drawdown"
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {stats.sharpeRatio.toFixed(2)} Sharpe
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Sortino {stats.sortinoRatio.toFixed(2)} · Calmar {stats.calmarRatio.toFixed(2)} · DD -
                {activePortfolio.maxDrawdownPct.toFixed(2)}%
              </div>
              {openMetricHelp === 'risk' && (
                <p className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  <strong>Sharpe</strong> grades return vs. total bumps. <strong>Sortino</strong> only penalizes losing drops. <strong>Calmar</strong> compares gain to <strong>Max Drawdown</strong> (worst peak-to-trough drop).
                </p>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Closed Trade Accuracy
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setOpenMetricHelp((prev) => (prev === 'accuracy' ? null : 'accuracy'))
                  }
                  aria-label="Explain Win Rate and Profit Factor"
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {stats.winRatePct.toFixed(1)}% Win
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {stats.closedCount} Closed · Profit Factor {stats.profitFactor.toFixed(2)}
              </div>
              {openMetricHelp === 'accuracy' && (
                <p className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  <strong>Profit Factor</strong> is total dollars won divided by total dollars lost. Above 1.0 means winners outweigh losers even if Win Rate is under 50%.
                </p>
              )}
            </div>
          </section>

          {activeTab === 'desk' && (
            <>
              <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {sleeveSummaries.map((item) => {
                  const selected = item.strategy.id === activeStrategyId;
                  return (
                    <button
                      key={item.strategy.id}
                      type="button"
                      onClick={() => handleSelectStrategy(item.strategy.id)}
                      className={`text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-white dark:bg-slate-900 border-slate-900 dark:border-slate-100'
                          : 'bg-white/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {item.strategy.name}
                        </span>
                        <span
                          className={`font-mono text-xs font-semibold ${
                            item.stats.totalReturnPct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {item.stats.totalReturnPct >= 0 ? '+' : ''}
                          {item.stats.totalReturnPct.toFixed(2)}%
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <span>${item.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                        <span>
                          Sharpe {item.stats.sharpeRatio.toFixed(2)} · {item.openCount} open · {item.portfolio.trades.length} fills
                        </span>
                      </div>
                    </button>
                  );
                })}
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="flex flex-wrap items-baseline gap-3">
                        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                          {displayedTitle}
                        </h1>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {displayedAssetClass} ·{' '}
                          {displayedLatestCandle.isRegularHours ? 'Regular Session' : 'Extended Session'} ·{' '}
                          {displayedLatestCandle.sessionWindow}
                        </span>
                        {isInspectingExternal && (
                          <button
                            type="button"
                            onClick={() => setInspectedTicker(null)}
                            className="text-xs font-medium text-slate-700 dark:text-slate-200 underline underline-offset-4 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                          >
                            Return to {activeSymbol}
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-sm">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          ${displayedLatestCandle.close.toFixed(2)}
                        </span>
                        <span
                          className={
                            priceChange >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }
                        >
                          {priceChange >= 0 ? '+' : ''}
                          {priceChange.toFixed(2)} ({priceChangePct >= 0 ? '+' : ''}
                          {priceChangePct.toFixed(2)}%)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
                        {[
                          { label: '1x', ms: 1200 },
                          { label: '2x', ms: 650 },
                          { label: '5x', ms: 260 },
                        ].map((sp) => (
                          <button
                            key={sp.label}
                            type="button"
                            onClick={() => setSpeedMs(sp.ms)}
                            className={`px-2 py-1 text-xs font-mono rounded transition-colors cursor-pointer ${
                              speedMs === sp.ms
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                            }`}
                          >
                            {sp.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => setAutoExecuteAI((v) => !v)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                          autoExecuteAI
                            ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                            : 'bg-white text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {autoExecuteAI ? 'Auto-Trade On' : 'Auto-Trade Off'}
                      </button>
                    </div>
                  </div>

                  <PriceChart
                    candles={displayedCandles}
                    trades={isInspectingExternal ? [] : activePortfolio.trades}
                    symbol={displayedSymbol}
                  />
                  <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Universe Adv / Dec</div>
                      <div className="font-mono font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                        {breadth.advancingCount} / {breadth.decliningCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Above EMA 21</div>
                      <div className="font-mono font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                        {breadth.aboveEma21Pct.toFixed(0)}% ({breadth.dominantRegime})
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Universe Mean RSI</div>
                      <div className="font-mono font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                        {breadth.meanRsi14.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">20-Bar Corr to SPY</div>
                      <div className="font-mono font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                        {breadth.corrToSpy >= 0 ? '+' : ''}
                        {breadth.corrToSpy.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between">
                  <div>
                    <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          AI Model Evaluation
                        </h2>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {currentStrategyConfig.name} · v{currentStrategyConfig.version}
                        </div>
                      </div>
                      <div
                        className={`font-mono text-xs font-semibold ${
                          displayedDecision.action === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : displayedDecision.action === 'SELL'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {displayedDecision.action} · {(displayedDecision.confidence * 100).toFixed(0)}%
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {displayedDecision.rationale}
                      </p>

                      <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Feature Signal Breakdown
                        </div>
                        {displayedDecision.contributions.map((feat) => (
                          <div
                            key={feat.label}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-slate-700 dark:text-slate-300">
                              {feat.label}
                            </span>
                            <div className="flex items-center gap-3 font-mono">
                              <span className="text-slate-500 dark:text-slate-400">
                                {feat.rawValue}
                              </span>
                              <span
                                className={
                                  feat.contribution >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400 font-medium w-14 text-right'
                                    : 'text-rose-600 dark:text-rose-400 font-medium w-14 text-right'
                                }
                              >
                                {feat.contribution >= 0 ? '+' : ''}
                                {feat.contribution.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-5 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    {isInspectingExternal ? (
                      <>
                        {inspectedWfoCheck && (
                          <div className="space-y-1.5 text-xs pb-2 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 dark:text-slate-400">
                                Instant WFO Check ({inspectedWfoCheck.horizonBars}b)
                              </span>
                              <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                                {inspectedWfoCheck.validationFlags.join(' · ')}
                              </span>
                            </div>
                            <div className="flex items-center justify-between font-mono text-[11px] text-slate-600 dark:text-slate-300">
                              <span>
                                OOS {inspectedWfoCheck.outOfSampleReturnPct >= 0 ? '+' : ''}
                                {inspectedWfoCheck.outOfSampleReturnPct.toFixed(2)}%
                              </span>
                              <span>Sharpe {inspectedWfoCheck.outOfSampleSharpe.toFixed(2)}</span>
                              <span>
                                {inspectedWfoCheck.tradeCount} trades · DD -{inspectedWfoCheck.maxDrawdownPct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={handleSaveDiscoveryExperiment}
                            className="px-3 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-opacity cursor-pointer"
                          >
                            {discoveryLoggedSymbol === displayedSymbol ? 'Logged Run' : 'Log Discovery Run'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectedTicker(null)}
                            className="px-3 py-2 text-xs font-semibold rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            Return to {activeSymbol}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 dark:text-slate-400">
                            Current {activeSymbol} Holding
                          </span>
                          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                            {activePosition.quantity > 0
                              ? `${activePosition.quantity} @ $${activePosition.avgEntryPrice.toFixed(2)}`
                              : 'Flat (0 shares)'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => handleManualOrder('BUY', activeSymbol)}
                            className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer"
                          >
                            Manual Buy
                          </button>
                          <button
                            type="button"
                            onClick={() => handleManualOrder('SELL', activeSymbol)}
                            disabled={activePosition.quantity <= 0}
                            className="px-4 py-2 text-xs font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                          >
                            Close Position
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                  <EquityChart
                    sleeves={equitySeriesForChart}
                    activeStrategyId={activeStrategyId}
                  />
                </div>

                <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col">
                  <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {currentStrategyConfig.name} Positions ({openPositions.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('ledger')}
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 cursor-pointer"
                    >
                      View Sleeve Ledger
                    </button>
                  </div>

                  {openPositions.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-10 px-6 text-center">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                        This strategy sleeve is currently 100% cash
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Start the AI Trader or place a manual buy on {activeSymbol} to open a position.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-4">Symbol</th>
                            <th className="py-2.5 px-4 text-right">Qty</th>
                            <th className="py-2.5 px-4 text-right">Avg Entry</th>
                            <th className="py-2.5 px-4 text-right">Mark</th>
                            <th className="py-2.5 px-4 text-right">Unrealized P&amp;L</th>
                            <th className="py-2.5 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                          {openPositions.map((pos) => (
                            <tr
                              key={pos.symbol}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                            >
                              <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                                <button
                                  type="button"
                                  onClick={() => setActiveSymbol(pos.symbol)}
                                  className="hover:underline cursor-pointer"
                                >
                                  {pos.symbol}
                                </button>
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono">{pos.quantity}</td>
                              <td className="py-2.5 px-4 text-right font-mono">
                                ${pos.avgEntryPrice.toFixed(2)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono">
                                ${pos.marketPrice.toFixed(2)}
                              </td>
                              <td
                                className={`py-2.5 px-4 text-right font-mono font-medium ${
                                  pos.unrealizedPnl >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {pos.unrealizedPnl >= 0 ? '+' : ''}$
                                {pos.unrealizedPnl.toFixed(2)} ({pos.unrealizedPnlPct >= 0 ? '+' : ''}
                                {(pos.unrealizedPnlPct * 100).toFixed(2)}%)
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleManualOrder('SELL', pos.symbol)}
                                  className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                                >
                                  Close
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>

              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Universe Setup Scanner · {currentStrategyConfig.name}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Read-only intelligence ranking across the tracked US equity &amp; ETF universe — click any row to inspect on chart
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    Top Setup: {opportunities[0]?.symbol ?? activeSymbol} ({opportunities[0]?.opportunityScore.toFixed(1) ?? '0.0'})
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-4">Symbol</th>
                        <th className="py-2.5 px-4 text-right">Last Price</th>
                        <th className="py-2.5 px-4">Regime</th>
                        <th className="py-2.5 px-4">Session</th>
                        <th className="py-2.5 px-4 text-right">BB Z-Score</th>
                        <th className="py-2.5 px-4 text-right">Vol Z</th>
                        <th className="py-2.5 px-4 text-right">ATR %</th>
                        <th className="py-2.5 px-4">Signal</th>
                        <th className="py-2.5 px-4 text-right">Setup Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                      {opportunities.map((row) => {
                        const isSelected = !isInspectingExternal && row.symbol === activeSymbol;
                        return (
                          <tr
                            key={row.symbol}
                            onClick={() => {
                              setInspectedTicker(null);
                              setActiveSymbol(row.symbol);
                            }}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-slate-100/90 dark:bg-slate-800/70'
                                : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {row.symbol}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              ${row.price.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {row.regime}
                            </td>
                            <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {row.sessionWindow}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {row.zScore20 >= 0 ? '+' : ''}
                              {row.zScore20.toFixed(2)}σ
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {row.volumeZ >= 0 ? '+' : ''}
                              {row.volumeZ.toFixed(2)}σ
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {row.atrPct.toFixed(2)}%
                            </td>
                            <td
                              className={`py-2.5 px-4 font-mono font-semibold whitespace-nowrap ${
                                row.action === 'BUY'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : row.action === 'SELL'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {row.action} · {(row.confidence * 100).toFixed(0)}%
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {row.opportunityScore.toFixed(1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <DiscoveryRadarPanel
                movers={discoveryMovers}
                sourceSummary={discoverySourceSummary}
                fetchedAt={discoveryFetchedAt}
                loading={discoveryLoading}
                error={discoveryError}
                inspectedSymbol={inspectedTicker?.symbol ?? null}
                inspectingLoading={inspectingLoading}
                onRefresh={() => void scanMarketMovers()}
                onInspectTicker={(mover) => void handleInspectDiscoveredTicker(mover)}
              />
            </>
          )}

          {activeTab === 'strategy' && (
            <StrategyConfigView
              activeStrategyId={activeStrategyId}
              strategyConfig={currentStrategyConfig}
              weights={activePortfolio.weights}
              weightUpdates={activePortfolio.weightUpdates}
              onSelectStrategy={handleSelectStrategy}
              onUpdateConfig={handleUpdateStrategyConfig}
              onResetWeights={handleResetWeights}
            />
          )}

          {activeTab === 'ledger' && (
            <TradeLedgerView
              trades={activePortfolio.trades}
              onStepMarket={advanceMarketBar}
            />
          )}

          {activeTab === 'risk' && (
            <RiskGovernanceView
              limits={riskLimits}
              riskEvents={activePortfolio.riskEvents}
              alpacaStatus={alpacaStatus}
              onUpdateLimits={(patch) => setRiskLimits((prev) => ({ ...prev, ...patch }))}
            />
          )}

          {activeTab === 'backtest' && (
            <BacktestMatrixView
              initialCapital={INITIAL_CAPITAL}
              alpacaConfigured={alpacaStatus.configured}
              strategyConfigs={strategyConfigs}
              riskLimits={riskLimits}
              onToggleGlobalFilter={handleToggleGlobalFilter}
              onSelectStrategyAndSymbol={(stratId, sym) => {
                handleSelectStrategy(stratId);
                setActiveSymbol(sym);
                setActiveTab('desk');
              }}
              onSaveExperiment={handleSaveBacktestExperiment}
              onSavePortfolioExperiment={handleSavePortfolioExperiment}
            />
          )}

          {activeTab === 'experiments' && (
            <ExperimentRegistryView
              experiments={experiments}
              onUpdateExperiment={(id, patch) => {
                setExperiments((prev) =>
                  prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
                );
                fetch(`/api/experiments/${encodeURIComponent(id)}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(patch),
                }).catch(() => {
                  // Fallback to localStorage only
                });
              }}
              onDeleteExperiment={(id) => {
                setExperiments((prev) => prev.filter((item) => item.id !== id));
                fetch(`/api/experiments/${encodeURIComponent(id)}`, {
                  method: 'DELETE',
                }).catch(() => {
                  // Fallback to localStorage only
                });
              }}
              onSnapshotActiveSleeve={handleSnapshotActiveSleeve}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
