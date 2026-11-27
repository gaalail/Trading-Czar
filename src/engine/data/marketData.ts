import type { RawCandle, SymbolId, SymbolProfile } from '../types';

export const SYMBOL_PROFILES: Record<SymbolId, SymbolProfile> = {
  NVDA: {
    id: 'NVDA',
    name: 'NVIDIA Corp.',
    assetClass: 'Equity',
    initialPrice: 138.4,
    annualDrift: 0.24,
    baseVolatility: 0.014,
    tickDecimals: 2,
  },
  AAPL: {
    id: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'Equity',
    initialPrice: 229.8,
    annualDrift: 0.14,
    baseVolatility: 0.009,
    tickDecimals: 2,
  },
  MSFT: {
    id: 'MSFT',
    name: 'Microsoft Corp.',
    assetClass: 'Equity',
    initialPrice: 421.5,
    annualDrift: 0.15,
    baseVolatility: 0.0095,
    tickDecimals: 2,
  },
  SPY: {
    id: 'SPY',
    name: 'SPDR S&P 500 ETF',
    assetClass: 'Index ETF',
    initialPrice: 594.2,
    annualDrift: 0.1,
    baseVolatility: 0.006,
    tickDecimals: 2,
  },
  TSLA: {
    id: 'TSLA',
    name: 'Tesla Inc.',
    assetClass: 'Equity',
    initialPrice: 318.6,
    annualDrift: 0.18,
    baseVolatility: 0.019,
    tickDecimals: 2,
  },
  QQQ: {
    id: 'QQQ',
    name: 'Invesco QQQ Trust ETF',
    assetClass: 'Index ETF',
    initialPrice: 511.2,
    annualDrift: 0.16,
    baseVolatility: 0.0085,
    tickDecimals: 2,
  },
};

export const SYMBOL_LIST: SymbolProfile[] = Object.values(SYMBOL_PROFILES);

function seededNormal(seed: number): [number, number] {
  const s1 = (seed * 1664525 + 1013904223) >>> 0;
  const s2 = (s1 * 1664525 + 1013904223) >>> 0;
  const u1 = Math.max(1e-7, s1 / 4294967296);
  const u2 = s2 / 4294967296;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return [z, s2];
}

// 26 regular-session 15m bars (09:30-15:45 ET) + 2 extended-session bars per trading day
function formatBarTimestamp(index: number): {
  timestamp: string;
  isRegularHours: boolean;
  intradayVolScale: number;
  intradayVolumeScale: number;
} {
  const barsPerDay = 28;
  const dayOffset = Math.floor(index / barsPerDay);
  const slotInDay = index % barsPerDay;

  const baseDate = new Date(Date.UTC(2026, 10, 16, 0, 0, 0));
  let tradingDaysAdded = 0;
  while (tradingDaysAdded < dayOffset) {
    baseDate.setUTCDate(baseDate.getUTCDate() + 1);
    const dow = baseDate.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      tradingDaysAdded++;
    }
  }

  const totalMinutes = 9 * 60 + 15 + slotInDay * 15;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const isRegularHours = totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;

  let intradayVolScale = 0.7;
  let intradayVolumeScale = 0.18;
  if (isRegularHours) {
    if (totalMinutes < 10 * 60 + 30) {
      intradayVolScale = 1.25;
      intradayVolumeScale = 1.45;
    } else if (totalMinutes >= 14 * 60 + 30) {
      intradayVolScale = 1.15;
      intradayVolumeScale = 1.3;
    } else {
      intradayVolScale = 0.85;
      intradayVolumeScale = 0.78;
    }
  }

  const month = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(baseDate.getUTCDate()).padStart(2, '0');
  return {
    timestamp: `${month}-${day} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    isRegularHours,
    intradayVolScale,
    intradayVolumeScale,
  };
}

function latentDriverPhase(index: number, seed: number): 'trend' | 'revert' | 'volatile' | 'quiet' {
  const phase = (index + (seed % 37)) % 48;
  if (phase < 16) return 'trend';
  if (phase < 28) return 'revert';
  if (phase < 38) return 'volatile';
  return 'quiet';
}

export function generateRawSeries(
  symbol: SymbolId,
  length = 80,
  seedOffset = 101
): { rawCandles: RawCandle[]; nextSeed: number } {
  const profile = SYMBOL_PROFILES[symbol];
  let seed =
    symbol.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 17) + seedOffset;
  let price = profile.initialPrice;

  const rawCandles: RawCandle[] = [];

  for (let i = 0; i < length; i++) {
    const [z1, s1] = seededNormal(seed);
    const [z2, s2] = seededNormal(s1);
    seed = s2;

    const driver = latentDriverPhase(i, seedOffset);
    let drift = profile.annualDrift / 252;
    let vol = profile.baseVolatility;

    if (driver === 'trend') {
      drift += 0.0018;
      vol *= 0.85;
    } else if (driver === 'revert') {
      const anchor = profile.initialPrice * (1 + 0.04 * Math.sin(i / 12));
      drift = ((anchor - price) / price) * 0.12;
      vol *= 0.9;
    } else if (driver === 'volatile') {
      vol *= 1.65;
    } else {
      drift *= 0.2;
      vol *= 0.6;
    }

    const { timestamp, isRegularHours, intradayVolScale, intradayVolumeScale } =
      formatBarTimestamp(i);
    vol *= intradayVolScale;
    const open = price;
    const ret = drift + vol * z1;
    const close = Math.max(profile.initialPrice * 0.25, open * Math.exp(ret));
    const wickScale = vol * (0.45 + Math.abs(z2) * 0.45);
    const high = Math.max(open, close) * (1 + wickScale);
    const low = Math.max(0.01, Math.min(open, close) * (1 - wickScale));

    const baseVol = symbol === 'SPY' || symbol === 'QQQ' ? 540000 : 1200000;
    const volume = Math.round(
      baseVol *
        intradayVolumeScale *
        (0.75 + Math.abs(z1) * 0.75 + (driver === 'volatile' ? 0.5 : 0))
    );

    rawCandles.push({
      index: i,
      timestamp,
      isRegularHours,
      open: Number(open.toFixed(profile.tickDecimals)),
      high: Number(high.toFixed(profile.tickDecimals)),
      low: Number(low.toFixed(profile.tickDecimals)),
      close: Number(close.toFixed(profile.tickDecimals)),
      volume,
    });

    price = close;
  }

  return { rawCandles, nextSeed: seed };
}

export function appendRawCandle(
  symbol: SymbolId,
  existing: RawCandle[],
  seed: number
): { rawCandles: RawCandle[]; nextSeed: number } {
  const profile = SYMBOL_PROFILES[symbol];
  const last = existing[existing.length - 1];
  const nextIndex = last.index + 1;

  const [z1, s1] = seededNormal(seed);
  const [z2, s2] = seededNormal(s1);
  const driver = latentDriverPhase(nextIndex, seed % 97);

  let drift = profile.annualDrift / 252;
  let vol = profile.baseVolatility;

  if (driver === 'trend') {
    drift += 0.0019;
    vol *= 0.85;
  } else if (driver === 'revert') {
    const recentMean =
      existing.slice(-20).reduce((sum, c) => sum + c.close, 0) / Math.min(20, existing.length);
    drift = ((recentMean - last.close) / last.close) * 0.14;
    vol *= 0.9;
  } else if (driver === 'volatile') {
    vol *= 1.65;
  } else {
    drift *= 0.15;
    vol *= 0.65;
  }

  const { timestamp, isRegularHours, intradayVolScale, intradayVolumeScale } =
    formatBarTimestamp(nextIndex);
  vol *= intradayVolScale;
  const open = last.close;
  const ret = drift + vol * z1;
  const close = Math.max(profile.initialPrice * 0.25, open * Math.exp(ret));
  const wickScale = vol * (0.45 + Math.abs(z2) * 0.45);
  const high = Math.max(open, close) * (1 + wickScale);
  const low = Math.max(0.01, Math.min(open, close) * (1 - wickScale));

  const baseVol = symbol === 'SPY' || symbol === 'QQQ' ? 540000 : 1200000;
  const volume = Math.round(
    baseVol *
      intradayVolumeScale *
      (0.75 + Math.abs(z1) * 0.75 + (driver === 'volatile' ? 0.5 : 0))
  );

  const nextBar: RawCandle = {
    index: nextIndex,
    timestamp,
    isRegularHours,
    open: Number(open.toFixed(profile.tickDecimals)),
    high: Number(high.toFixed(profile.tickDecimals)),
    low: Number(low.toFixed(profile.tickDecimals)),
    close: Number(close.toFixed(profile.tickDecimals)),
    volume,
  };

  return {
    rawCandles: [...existing, nextBar],
    nextSeed: s2,
  };
}

export interface ParsedCsvDataset {
  rawCandles: RawCandle[];
  fingerprint: string;
}

export function parseHistoricalOhlcvCsv(
  csvText: string,
  sourceName: string
): ParsedCsvDataset {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 60) {
    throw new Error('CSV must include a header row and at least 60 OHLCV bars for walk-forward testing.');
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const findCol = (aliases: string[]) =>
    headers.findIndex((h) => aliases.some((a) => h === a || h.includes(a)));

  const dateCol = findCol(['date', 'time', 'timestamp']);
  const openCol = findCol(['open']);
  const highCol = findCol(['high']);
  const lowCol = findCol(['low']);
  const closeCol = findCol(['adj close', 'close']);
  const volCol = findCol(['volume', 'vol']);

  if (dateCol === -1 || openCol === -1 || highCol === -1 || lowCol === -1 || closeCol === -1) {
    throw new Error('CSV header must contain Date/Timestamp, Open, High, Low, and Close columns.');
  }

  const rawCandles: RawCandle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.trim());
    const open = Number(parts[openCol]);
    const high = Number(parts[highCol]);
    const low = Number(parts[lowCol]);
    const close = Number(parts[closeCol]);
    const volume = volCol >= 0 ? Math.max(1000, Math.round(Number(parts[volCol]) || 500000)) : 500000;
    const rawDate = parts[dateCol] || `bar-${i}`;

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const hhmmMatch = rawDate.match(/(\d{2}):(\d{2})/);
    let isRegularHours = true;
    if (hhmmMatch) {
      const mins = Number(hhmmMatch[1]) * 60 + Number(hhmmMatch[2]);
      isRegularHours = mins >= 9 * 60 + 30 && mins < 16 * 60;
    }

    rawCandles.push({
      index: rawCandles.length,
      timestamp: rawDate.slice(0, 16),
      isRegularHours,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume,
    });
  }

  if (rawCandles.length < 60) {
    throw new Error('Fewer than 60 valid numeric OHLCV rows were parsed from CSV.');
  }

  const cleanName = sourceName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18) || 'custom';
  const fingerprint = `csv-${cleanName}-${rawCandles.length}b-${rawCandles[0].close.toFixed(0)}-${rawCandles[rawCandles.length - 1].close.toFixed(0)}`;

  return { rawCandles, fingerprint };
}

export type SampleScenarioId = 'sideways-chop' | 'tech-rally' | 'vol-selloff';

export function generateSampleScenarioSeries(
  scenario: SampleScenarioId,
  symbol: SymbolId,
  bars = 240
): ParsedCsvDataset {
  const profile = SYMBOL_PROFILES[symbol];
  let seed =
    symbol.split('').reduce((acc, ch) => acc * 37 + ch.charCodeAt(0), 29) +
    scenario.length * 131;
  let price = profile.initialPrice;
  const rawCandles: RawCandle[] = [];

  for (let i = 0; i < bars; i++) {
    const [z1, s1] = seededNormal(seed);
    const [z2, s2] = seededNormal(s1);
    seed = s2;

    let drift = 0;
    let vol = profile.baseVolatility;

    if (scenario === 'sideways-chop') {
      const anchor = profile.initialPrice * (1 + 0.025 * Math.sin(i / 8));
      drift = ((anchor - price) / price) * 0.16;
      vol *= 0.85;
    } else if (scenario === 'tech-rally') {
      drift = 0.0014 + 0.0005 * Math.sin(i / 18);
      vol *= 0.95;
    } else {
      // Volatility selloff followed by partial recovery
      if (i < bars * 0.45) {
        drift = -0.0018;
        vol *= 1.85;
      } else {
        drift = 0.0012;
        vol *= 1.3;
      }
    }

    const { timestamp, isRegularHours, intradayVolScale, intradayVolumeScale } =
      formatBarTimestamp(i);
    vol *= intradayVolScale;
    const open = price;
    const close = Math.max(profile.initialPrice * 0.3, open * Math.exp(drift + vol * z1));
    const wick = vol * (0.45 + Math.abs(z2) * 0.45);
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.max(0.01, Math.min(open, close) * (1 - wick));
    const baseVol = symbol === 'SPY' || symbol === 'QQQ' ? 560000 : 1250000;
    const volume = Math.round(
      baseVol * intradayVolumeScale * (0.8 + Math.abs(z1) * 0.7)
    );

    rawCandles.push({
      index: i,
      timestamp,
      isRegularHours,
      open: Number(open.toFixed(profile.tickDecimals)),
      high: Number(high.toFixed(profile.tickDecimals)),
      low: Number(low.toFixed(profile.tickDecimals)),
      close: Number(close.toFixed(profile.tickDecimals)),
      volume,
    });
    price = close;
  }

  return {
    rawCandles,
    fingerprint: `sample-${scenario}-${symbol.toLowerCase()}-${bars}b`,
  };
}

