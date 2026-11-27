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
import { enrichMarketIntelligence } from './engine/intelligence/indicators';
import {
  computePortfolioStats,
  computeTotalEquity,
  createInitialPortfolio,
  executeOrder,
  markToMarketAndRecord,
  stepAISignals,
} from './engine/portfolio';
import { DEFAULT_RISK_LIMITS } from './engine/risk';
import { DEFAULT_WEIGHTS, evaluateModel, STRATEGIES, STRATEGY_LIST } from './engine/strategies';
import type {
  BacktestRow,
  Candle,
  ExperimentRecord,
  ModelDecision,
  PortfolioState,
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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    fetch('/api/alpaca/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Partial<AlpacaBridgeStatus> | null) => {
        if (!active || !data) return;
        setAlpacaStatus({
          configured: Boolean(data.configured),
          paperOnlyLocked: data.paperOnlyLocked !== false,
          feed: typeof data.feed === 'string' ? data.feed : 'iex',
        });
      })
      .catch(() => {
        // Keep safe local simulation defaults when backend status is unavailable
      });
    return () => {
      active = false;
    };
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
  }, [strategyConfigs, autoExecuteAI, activeSymbol, riskLimits]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      advanceMarketBar();
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [isRunning, speedMs, advanceMarketBar]);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    const nextSalt = resetSalt + 37;
    setResetSalt(nextSalt);
    setWorkspace(createWorkspace(strategyConfigs, riskLimits, 0, nextSalt));
  }, [resetSalt, strategyConfigs, riskLimits]);

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
    key: 'useAtrSizingAndStops' | 'useBreadthFilter' | 'useTimeOfDayFilter'
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
  };

  const activeCandles = workspace.candlesBySymbol[activeSymbol];
  const latestCandle = activeCandles[activeCandles.length - 1];
  const prevCandle = activeCandles[Math.max(0, activeCandles.length - 2)];
  const priceChange = latestCandle.close - prevCandle.close;
  const priceChangePct = (priceChange / prevCandle.close) * 100;
  const activeDecision = workspace.decisionsByStrategy[activeStrategyId][activeSymbol];
  const activePosition = activePortfolio.positions[activeSymbol];

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
      limitations: `Simulated streaming market bars (seed ${resetSalt}); ${curve.length} recorded equity points.`,
      verdict: 'Pending Review',
      strategyId: cfg.id,
      strategyName: cfg.name,
      strategyVersion: cfg.version,
      symbol: 'MULTI-ASSET',
      datasetFingerprint: `live-sim-15m-s${resetSalt}-b${latestCandle.index}`,
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
  };

  const openPositions = useMemo(
    () => Object.values(activePortfolio.positions).filter((p) => p.quantity > 0),
    [activePortfolio.positions]
  );

  const breadth = useMemo(
    () => computeMarketBreadth(workspace.candlesBySymbol, activeSymbol),
    [workspace.candlesBySymbol, activeSymbol]
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
        <div>Paper Mode · No Margin · No Short</div>
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
                    {activeSymbol}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={advanceMarketBar}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <StepForward className="w-3.5 h-3.5" />
              Step Bar
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
                      <div className="flex items-baseline gap-3">
                        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                          {activeSymbol} · {SYMBOL_PROFILES[activeSymbol].name}
                        </h1>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {SYMBOL_PROFILES[activeSymbol].assetClass} ·{' '}
                          {latestCandle.isRegularHours ? 'Regular Session' : 'Extended Session'} ·{' '}
                          {latestCandle.sessionWindow}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-sm">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          ${latestCandle.close.toFixed(2)}
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
                    candles={activeCandles}
                    trades={activePortfolio.trades}
                    symbol={activeSymbol}
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
                          activeDecision.action === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : activeDecision.action === 'SELL'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {activeDecision.action} · {(activeDecision.confidence * 100).toFixed(0)}%
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {activeDecision.rationale}
                      </p>

                      <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Feature Signal Breakdown
                        </div>
                        {activeDecision.contributions.map((feat) => (
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
              onToggleGlobalFilter={handleToggleGlobalFilter}
              onSelectStrategyAndSymbol={(stratId, sym) => {
                handleSelectStrategy(stratId);
                setActiveSymbol(sym);
                setActiveTab('desk');
              }}
              onSaveExperiment={handleSaveBacktestExperiment}
            />
          )}

          {activeTab === 'experiments' && (
            <ExperimentRegistryView
              experiments={experiments}
              onUpdateExperiment={(id, patch) =>
                setExperiments((prev) =>
                  prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
                )
              }
              onDeleteExperiment={(id) =>
                setExperiments((prev) => prev.filter((item) => item.id !== id))
              }
              onSnapshotActiveSleeve={handleSnapshotActiveSleeve}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
