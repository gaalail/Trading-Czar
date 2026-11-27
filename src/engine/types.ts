export type SymbolId = 'NVDA' | 'AAPL' | 'MSFT' | 'SPY' | 'QQQ' | 'TSLA';

export type MarketRegime = 'Trend Up' | 'Mean Reverting' | 'High Volatility' | 'Consolidation';

export type ExecutionMode = 'PAPER_ONLY';

export interface SymbolProfile {
  id: SymbolId;
  name: string;
  assetClass: 'Equity' | 'Index ETF';
  initialPrice: number;
  annualDrift: number;
  baseVolatility: number;
  tickDecimals: number;
}

export interface RawCandle {
  index: number;
  timestamp: string;
  isRegularHours: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SessionWindow = 'Open Drive' | 'Midday Chop' | 'Power Hour' | 'Extended';

export interface Candle extends RawCandle {
  regime: MarketRegime;
  sessionWindow: SessionWindow;
  ema9: number;
  ema21: number;
  rsi14: number;
  macdHist: number;
  zScore20: number;
  bbUpper20: number;
  bbMiddle20: number;
  bbLower20: number;
  atr14: number;
  volumeZ: number;
}

export type StrategyId = 'neural-perceptron' | 'mean-reversion' | 'regime-ensemble';

export interface StrategyWeights {
  emaCross: number;
  rsi: number;
  macd: number;
  zScore: number;
  volume: number;
  bias: number;
}

export interface StrategyConfig {
  id: StrategyId;
  version: string;
  name: string;
  summary: string;
  confidenceThreshold: number;
  maxPositionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  learningRate: number;
  feeBps: number;
  useAtrSizingAndStops: boolean;
  useBreadthFilter: boolean;
  useTimeOfDayFilter: boolean;
}

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface FeatureContribution {
  label: string;
  rawValue: string;
  contribution: number;
}

export interface ModelDecision {
  symbol: string;
  candleIndex: number;
  timestamp: string;
  action: SignalAction;
  confidence: number;
  score: number;
  rationale: string;
  contributions: FeatureContribution[];
}

export interface Position {
  symbol: SymbolId;
  quantity: number;
  avgEntryPrice: number;
  marketPrice: number;
  openedAtIndex: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface TradeFill {
  id: string;
  clientOrderId: string;
  timestamp: string;
  candleIndex: number;
  symbol: SymbolId;
  side: 'BUY' | 'SELL';
  origin: 'AI' | 'MANUAL';
  quantity: number;
  price: number;
  fee: number;
  impactBps: number;
  realizedPnl: number | null;
  confidence: number | null;
  reason: string;
}

export interface RiskLimits {
  executionMode: ExecutionMode;
  maxPortfolioExposurePct: number;
  maxSinglePositionPct: number;
  maxOrderNotional: number;
  maxBarVolumePct: number;
  enforceMarketHours: boolean;
  allowShortSelling: false;
  allowMargin: false;
  halted: boolean;
}

export interface RiskEvent {
  id: string;
  timestamp: string;
  symbol: SymbolId;
  side: 'BUY' | 'SELL';
  origin: 'AI' | 'MANUAL';
  status: 'APPROVED' | 'BLOCKED';
  rule: string;
  detail: string;
}

export interface EquityPoint {
  index: number;
  timestamp: string;
  equity: number;
  benchmarkEquity: number;
  drawdownPct: number;
}

export interface PortfolioState {
  strategyId: StrategyId;
  initialCapital: number;
  cash: number;
  realizedPnl: number;
  totalFees: number;
  peakEquity: number;
  maxDrawdownPct: number;
  positions: Record<SymbolId, Position>;
  trades: TradeFill[];
  riskEvents: RiskEvent[];
  equityCurve: EquityPoint[];
  benchmarkShares: Record<SymbolId, number>;
  weights: StrategyWeights;
  weightUpdates: number;
}

export interface BacktestRow {
  strategyId: StrategyId;
  strategyVersion: string;
  strategyName: string;
  symbol: SymbolId;
  horizonBars: number;
  inSamplePct: number;
  feeBps: number;
  inSampleReturnPct: number;
  outOfSampleReturnPct: number;
  benchmarkOosReturnPct: number;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  profitFactor: number;
  finalEquity: number;
  datasetFingerprint: string;
  validationFlags: string[];
}

export type ExperimentVerdict = 'Pending Review' | 'Validated' | 'Inconclusive' | 'Rejected';

export interface ExperimentRecord {
  id: string;
  createdAt: string;
  title: string;
  hypothesis: string;
  limitations: string;
  verdict: ExperimentVerdict;
  strategyId: StrategyId;
  strategyName: string;
  strategyVersion: string;
  symbol: SymbolId | 'MULTI-ASSET';
  datasetFingerprint: string;
  horizonBars: number;
  feeBps: number;
  parameters: {
    confidenceThreshold: number;
    maxPositionPct: number;
    stopLossPct: number;
    takeProfitPct: number;
    learningRate: number;
  };
  metrics: {
    inSampleReturnPct: number;
    outOfSampleReturnPct: number;
    benchmarkReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number;
    tradeCount: number;
  };
}
