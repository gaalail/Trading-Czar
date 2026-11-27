import type { RawCandle } from '../types';

export interface ExternalMoverSnapshot {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  prevVolume: number;
  rvol: number;
  rangePct: number;
  dollarVolume: number;
  sourceLabel: string;
  passedLiquidityGate: boolean;
  filterReason: string;
}

export interface RankedDiscoveryMover extends ExternalMoverSnapshot {
  discoveryScore: number;
}

/**
 * Pure Market-Wide Discovery Scoring:
 * Ranks external US equities & ETFs by relative volume expansion (RVOL),
 * intraday price displacement, range expansion, and liquidity gate compliance.
 * Strictly read-only: never reads portfolio state or submits orders.
 */
export function rankDiscoveryMovers(
  movers: ExternalMoverSnapshot[]
): RankedDiscoveryMover[] {
  const scored: RankedDiscoveryMover[] = movers.map((item) => {
    const absMove = Math.min(12, Math.abs(item.changePct));
    const rvolComponent = Math.min(35, Math.max(0, item.rvol) * 14);
    const moveComponent = absMove * 3.2;
    const rangeComponent = Math.min(20, Math.max(0, item.rangePct) * 3.5);
    const sourceBonus = item.sourceLabel.includes('Most Active') && item.sourceLabel.includes('Gainer')
      ? 10
      : item.sourceLabel.includes('Top Gainer') || item.sourceLabel.includes('Most Active')
        ? 5
        : 0;
    const gatePenalty = item.passedLiquidityGate ? 0 : -45;

    const rawScore = rvolComponent + moveComponent + rangeComponent + sourceBonus + gatePenalty;
    const discoveryScore = Number(Math.max(0, Math.min(100, rawScore)).toFixed(1));

    return {
      ...item,
      discoveryScore,
    };
  });

  return scored.sort((a, b) => {
    if (a.passedLiquidityGate !== b.passedLiquidityGate) {
      return a.passedLiquidityGate ? -1 : 1;
    }
    return b.discoveryScore - a.discoveryScore;
  });
}

const SIMULATED_EXTERNAL_POOL: Array<{
  symbol: string;
  basePrice: number;
  baseVol: number;
  tag: string;
}> = [
  { symbol: 'AMD', basePrice: 141.2, baseVol: 42000000, tag: 'Most Active + Top Gainer' },
  { symbol: 'PLTR', basePrice: 64.8, baseVol: 58000000, tag: 'Top Gainer' },
  { symbol: 'META', basePrice: 572.4, baseVol: 14500000, tag: 'Watchpool Snapshot' },
  { symbol: 'AVGO', basePrice: 168.5, baseVol: 21000000, tag: 'Most Active' },
  { symbol: 'COIN', basePrice: 298.4, baseVol: 16200000, tag: 'Top Gainer' },
  { symbol: 'AMZN', basePrice: 207.9, baseVol: 34000000, tag: 'Most Active' },
  { symbol: 'GOOGL', basePrice: 171.6, baseVol: 22500000, tag: 'Watchpool Snapshot' },
  { symbol: 'IWM', basePrice: 237.4, baseVol: 28000000, tag: 'Watchpool Snapshot' },
  { symbol: 'ARM', basePrice: 139.8, baseVol: 9800000, tag: 'Top Mover' },
  { symbol: 'XLE', basePrice: 94.6, baseVol: 15600000, tag: 'Watchpool Snapshot' },
];

export function buildSimulatedDiscoverySnapshots(salt = 101): ExternalMoverSnapshot[] {
  return SIMULATED_EXTERNAL_POOL.map((entry, idx) => {
    const phase = ((salt * 13 + idx * 37) % 100) / 100;
    const changePct = Number(((phase - 0.35) * 8.4).toFixed(2));
    const rvol = Number((0.85 + phase * 1.95).toFixed(2));
    const rangePct = Number((1.1 + Math.abs(changePct) * 0.65).toFixed(2));
    const prevClose = entry.basePrice;
    const price = Number((prevClose * (1 + changePct / 100)).toFixed(2));
    const volume = Math.round(entry.baseVol * rvol);
    const dollarVolume = price * volume;

    return {
      symbol: entry.symbol,
      price,
      prevClose,
      changePct,
      volume,
      prevVolume: entry.baseVol,
      rvol,
      rangePct,
      dollarVolume,
      sourceLabel: `${entry.tag} (Simulated)`,
      passedLiquidityGate: true,
      filterReason: 'Simulated liquid US equity/ETF reference',
    };
  });
}

export function buildSimulatedDiscoveredBars(symbol: string, length = 120): RawCandle[] {
  const clean = symbol.trim().toUpperCase() || 'AMD';
  const entry = SIMULATED_EXTERNAL_POOL.find((item) => item.symbol === clean);
  let seed = clean.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 73);
  let price = entry?.basePrice ?? 120;
  const bars: RawCandle[] = [];

  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const u1 = Math.max(1e-7, seed / 4294967296);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const u2 = seed / 4294967296;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    const slot = i % 28;
    const totalMins = 9 * 60 + 15 + slot * 15;
    const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
    const mm = String(totalMins % 60).padStart(2, '0');
    const day = String(16 + Math.floor(i / 28)).padStart(2, '0');
    const isRegularHours = totalMins >= 9 * 60 + 30 && totalMins < 16 * 60;

    const open = price;
    const close = Math.max(5, Number((open * Math.exp(0.0005 + 0.0095 * z)).toFixed(2)));
    const high = Number((Math.max(open, close) * (1 + 0.004 * Math.abs(z))).toFixed(2));
    const low = Number((Math.min(open, close) * (1 - 0.004 * Math.abs(z))).toFixed(2));
    const volume = Math.round(950000 * (0.7 + Math.abs(z) * 0.8));

    bars.push({
      index: i,
      timestamp: `11-${day} ${hh}:${mm}`,
      isRegularHours,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  return bars;
}
