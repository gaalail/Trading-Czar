import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const ALLOWED_SYMBOLS = new Set(['NVDA', 'AAPL', 'MSFT', 'SPY', 'QQQ', 'TSLA']);
const MOVER_SYMBOL_REGEX = /^[A-Z]{1,5}$/;
const FALLBACK_LIQUID_WATCHPOOL = [
  'AMD',
  'META',
  'AMZN',
  'GOOGL',
  'AVGO',
  'NFLX',
  'PLTR',
  'COIN',
  'ARM',
  'JPM',
  'IWM',
  'XLE',
];
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets';
const REGISTRY_PATH = path.join(__dirname, 'knowledge', 'experiments', 'registry.json');

interface StoredExperiment {
  id: string;
  [key: string]: unknown;
}

function readRegistryFromDisk(): StoredExperiment[] {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredExperiment[]) : [];
  } catch {
    return [];
  }
}

function writeRegistryToDisk(records: StoredExperiment[]): void {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(records, null, 2) + '\n', 'utf8');
}

function getAlpacaPaperConfig() {
  const apiKey = process.env.ALPACA_API_KEY?.trim() || '';
  const apiSecret = process.env.ALPACA_API_SECRET?.trim() || '';
  const baseUrl = (process.env.ALPACA_BASE_URL?.trim() || PAPER_BASE_URL).replace(/\/+$/, '');
  const feed = process.env.ALPACA_DATA_FEED?.trim() === 'sip' ? 'sip' : 'iex';

  // Fail-closed paper-only lock: refuse any non-paper Alpaca URL
  const isPaperUrl = baseUrl === PAPER_BASE_URL;
  const configured = Boolean(apiKey && apiSecret && isPaperUrl);

  return {
    configured,
    isPaperUrl,
    apiKey,
    apiSecret,
    baseUrl,
    feed,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  app.get('/api/alpaca/status', (_req, res) => {
    const cfg = getAlpacaPaperConfig();
    res.json({
      configured: cfg.configured,
      paperOnlyLocked: cfg.isPaperUrl,
      feed: cfg.feed,
      allowedSymbols: Array.from(ALLOWED_SYMBOLS),
    });
  });

  app.get('/api/alpaca/account', async (_req, res) => {
    const cfg = getAlpacaPaperConfig();
    if (!cfg.isPaperUrl) {
      return res.status(403).json({
        connected: false,
        paperOnlyLocked: false,
        error: 'Fail-closed guard: non-paper Alpaca URLs are blocked.',
      });
    }
    if (!cfg.configured) {
      return res.json({
        connected: false,
        paperOnlyLocked: true,
        error: 'Alpaca paper API keys are not configured.',
      });
    }

    try {
      const response = await fetch(`${PAPER_BASE_URL}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': cfg.apiKey,
          'APCA-API-SECRET-KEY': cfg.apiSecret,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          connected: false,
          paperOnlyLocked: true,
          error: `Alpaca account check failed (${response.status}): ${text.slice(0, 160)}`,
        });
      }
      const account = (await response.json()) as {
        status?: string;
        equity?: string;
        buying_power?: string;
        cash?: string;
      };
      return res.json({
        connected: true,
        paperOnlyLocked: true,
        status: account.status ?? 'UNKNOWN',
        equity: Number(account.equity ?? 0),
        buyingPower: Number(account.buying_power ?? 0),
        cash: Number(account.cash ?? 0),
      });
    } catch (err) {
      return res.status(502).json({
        connected: false,
        paperOnlyLocked: true,
        error: err instanceof Error ? err.message : 'Unable to reach Alpaca paper account API.',
      });
    }
  });

  async function fetchSymbolBars(
    symbol: string,
    limit: number,
    cfg: ReturnType<typeof getAlpacaPaperConfig>
  ) {
    const startIso = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const url = `${DATA_BASE_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=15Min&start=${encodeURIComponent(startIso)}&limit=${limit}&sort=desc&adjustment=split&feed=${cfg.feed}`;
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': cfg.apiKey,
        'APCA-API-SECRET-KEY': cfg.apiSecret,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Alpaca market data error (${response.status}) for ${symbol}: ${text.slice(0, 160)}`);
    }
    const payload = (await response.json()) as {
      bars?: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>;
    };
    const rawBars = (payload.bars ?? []).slice().reverse();
    return rawBars.map((b, idx) => {
      const d = new Date(b.t);
      const parts = Object.fromEntries(
        etFormatter.formatToParts(d).map((p) => [p.type, p.value])
      );
      const hhNum = Number(parts.hour === '24' ? '00' : parts.hour);
      const minNum = Number(parts.minute);
      const mins = hhNum * 60 + minNum;
      const isRegularHours = mins >= 9 * 60 + 30 && mins < 16 * 60;
      const hhStr = String(hhNum).padStart(2, '0');
      const minStr = String(minNum).padStart(2, '0');
      return {
        index: idx,
        timestamp: `${parts.month}-${parts.day} ${hhStr}:${minStr}`,
        barEpochMs: d.getTime(),
        isRegularHours,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      };
    });
  }

  app.get('/api/alpaca/bars', async (req, res) => {
    const cfg = getAlpacaPaperConfig();
    if (!cfg.isPaperUrl) {
      return res.status(403).json({
        error: 'Fail-closed guard: ALPACA_BASE_URL must be https://paper-api.alpaca.markets.',
      });
    }
    if (!cfg.configured) {
      return res.status(503).json({
        configured: false,
        error: 'Alpaca paper API keys are not configured in server environment.',
      });
    }

    const rawSymbol = String(req.query.symbol || 'NVDA').toUpperCase();
    if (!ALLOWED_SYMBOLS.has(rawSymbol)) {
      return res.status(400).json({ error: `Unsupported symbol ${rawSymbol}. US equities/ETFs only.` });
    }

    const limit = Math.min(500, Math.max(60, Number(req.query.limit || 240)));

    try {
      const bars = await fetchSymbolBars(rawSymbol, limit, cfg);
      return res.json({
        symbol: rawSymbol,
        feed: cfg.feed,
        fingerprint: `alpaca-${cfg.feed}-${rawSymbol.toLowerCase()}-${bars.length}b`,
        bars,
      });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch Alpaca market data.',
      });
    }
  });

  app.get('/api/alpaca/discover-bars', async (req, res) => {
    const cfg = getAlpacaPaperConfig();
    if (!cfg.isPaperUrl) {
      return res.status(403).json({
        error: 'Fail-closed guard: ALPACA_BASE_URL must be https://paper-api.alpaca.markets.',
      });
    }
    if (!cfg.configured) {
      return res.status(503).json({
        configured: false,
        error: 'Alpaca paper API keys are not configured in server environment.',
      });
    }

    const rawSymbol = String(req.query.symbol || '').trim().toUpperCase();
    if (!MOVER_SYMBOL_REGEX.test(rawSymbol)) {
      return res.status(400).json({
        error: 'Invalid ticker format. Only 1-5 letter US equity/ETF tickers are permitted.',
      });
    }

    const limit = Math.min(240, Math.max(60, Number(req.query.limit || 140)));

    try {
      const bars = await fetchSymbolBars(rawSymbol, limit, cfg);
      return res.json({
        symbol: rawSymbol,
        feed: cfg.feed,
        readOnly: true,
        fingerprint: `alpaca-discover-${cfg.feed}-${rawSymbol.toLowerCase()}-${bars.length}b`,
        bars,
      });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch discovered ticker bars.',
      });
    }
  });

  app.get('/api/alpaca/universe-bars', async (req, res) => {
    const cfg = getAlpacaPaperConfig();
    if (!cfg.isPaperUrl) {
      return res.status(403).json({
        error: 'Fail-closed guard: ALPACA_BASE_URL must be https://paper-api.alpaca.markets.',
      });
    }
    if (!cfg.configured) {
      return res.status(503).json({
        configured: false,
        error: 'Alpaca paper API keys are not configured in server environment.',
      });
    }

    const limit = Math.min(240, Math.max(60, Number(req.query.limit || 140)));

    try {
      const symbols = Array.from(ALLOWED_SYMBOLS);
      const entries = await Promise.all(
        symbols.map(async (sym) => [sym, await fetchSymbolBars(sym, limit, cfg)] as const)
      );
      const barsBySymbol = Object.fromEntries(entries);
      return res.json({
        feed: cfg.feed,
        fetchedAt: new Date().toISOString(),
        barsBySymbol,
      });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch Alpaca universe bars.',
      });
    }
  });

  app.get('/api/alpaca/movers', async (_req, res) => {
    const cfg = getAlpacaPaperConfig();
    if (!cfg.isPaperUrl) {
      return res.status(403).json({
        error: 'Fail-closed guard: ALPACA_BASE_URL must be https://paper-api.alpaca.markets.',
      });
    }
    if (!cfg.configured) {
      return res.status(503).json({
        configured: false,
        error: 'Alpaca paper API keys are not configured in server environment.',
      });
    }

    const headers = {
      'APCA-API-KEY-ID': cfg.apiKey,
      'APCA-API-SECRET-KEY': cfg.apiSecret,
    };

    try {
      const [moversRes, activesRes] = await Promise.all([
        fetch(`${DATA_BASE_URL}/v1beta1/screener/stocks/movers?top=20`, { headers }),
        fetch(`${DATA_BASE_URL}/v1beta1/screener/stocks/most-actives?by=volume&top=20`, { headers }),
      ]);

      const sourceTags = new Map<string, Set<string>>();
      const addSource = (sym: string, tag: string) => {
        const clean = String(sym || '').trim().toUpperCase();
        const isWarrantOrUnit = clean.length === 5 && /[WRU]$/.test(clean);
        if (!MOVER_SYMBOL_REGEX.test(clean) || isWarrantOrUnit || ALLOWED_SYMBOLS.has(clean)) return;
        const set = sourceTags.get(clean) ?? new Set<string>();
        set.add(tag);
        sourceTags.set(clean, set);
      };

      let screenerLiveCount = 0;

      if (activesRes.ok) {
        const activesData = (await activesRes.json()) as {
          most_actives?: Array<{ symbol?: string }>;
        };
        for (const item of (activesData.most_actives ?? []).slice(0, 15)) {
          if (item.symbol) {
            addSource(item.symbol, 'Most Active');
            screenerLiveCount++;
          }
        }
      }

      if (moversRes.ok) {
        const moversData = (await moversRes.json()) as {
          gainers?: Array<{ symbol?: string }>;
          losers?: Array<{ symbol?: string }>;
        };
        for (const item of (moversData.gainers ?? []).slice(0, 12)) {
          if (item.symbol) {
            addSource(item.symbol, 'Top Gainer');
            screenerLiveCount++;
          }
        }
        for (const item of (moversData.losers ?? []).slice(0, 6)) {
          if (item.symbol) {
            addSource(item.symbol, 'Top Mover');
            screenerLiveCount++;
          }
        }
      }

      // Always include liquid watchpool supplement if few candidates came back
      if (sourceTags.size < 16) {
        for (const sym of FALLBACK_LIQUID_WATCHPOOL) {
          if (!sourceTags.has(sym)) {
            addSource(sym, 'Watchpool Snapshot');
          }
        }
      }

      const candidateSymbols = Array.from(sourceTags.keys()).slice(0, 35);
      if (candidateSymbols.length === 0) {
        return res.json({
          feed: cfg.feed,
          sourceSummary: 'No external candidates returned',
          fetchedAt: new Date().toISOString(),
          movers: [],
        });
      }

      const snapUrl = `${DATA_BASE_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(
        candidateSymbols.join(',')
      )}&feed=${cfg.feed}`;
      const snapRes = await fetch(snapUrl, { headers });
      if (!snapRes.ok) {
        const text = await snapRes.text();
        throw new Error(`Alpaca snapshots error (${snapRes.status}): ${text.slice(0, 160)}`);
      }

      const snapshots = (await snapRes.json()) as Record<
        string,
        {
          latestTrade?: { p?: number };
          dailyBar?: { o?: number; h?: number; l?: number; c?: number; v?: number };
          prevDailyBar?: { c?: number; v?: number };
        }
      >;

      const movers = candidateSymbols
        .map((symbol) => {
          const snap = snapshots[symbol];
          if (!snap) return null;
          const price = Number(snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0);
          const prevClose = Number(snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price);
          const dailyHigh = Number(snap.dailyBar?.h ?? price);
          const dailyLow = Number(snap.dailyBar?.l ?? price);
          const volume = Number(snap.dailyBar?.v ?? 0);
          const prevVolume = Number(snap.prevDailyBar?.v ?? 0);
          if (!Number.isFinite(price) || price <= 0) return null;

          const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
          const rangePct = price > 0 ? ((dailyHigh - dailyLow) / price) * 100 : 0;
          const rvol = prevVolume > 0 ? volume / prevVolume : 1;
          const dollarVolume = price * volume;

          const tags = Array.from(sourceTags.get(symbol) ?? ['Snapshot']);
          const sourceLabel = tags.join(' + ');

          let passedLiquidityGate = true;
          let filterReason = 'Meets price & volume liquidity standards';
          if (price < 10) {
            passedLiquidityGate = false;
            filterReason = `Filtered: price $${price.toFixed(2)} below $10.00 minimum`;
          } else if (volume < 500000 && dollarVolume < 10000000) {
            passedLiquidityGate = false;
            filterReason = `Filtered: daily volume ${(volume / 1000).toFixed(0)}k below 500k liquidity floor`;
          }

          return {
            symbol,
            price,
            prevClose,
            changePct,
            volume,
            prevVolume,
            rvol,
            rangePct,
            dollarVolume,
            sourceLabel,
            passedLiquidityGate,
            filterReason,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      return res.json({
        feed: cfg.feed,
        sourceSummary:
          screenerLiveCount > 0
            ? 'Alpaca Screener Movers + Most Actives + Snapshots'
            : 'Alpaca Liquid Watchpool Snapshots (Market Closed / Holiday)',
        fetchedAt: new Date().toISOString(),
        movers,
      });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to scan market-wide movers.',
      });
    }
  });

  app.post('/api/alpaca/paper-order', async (req, res) => {
    const cfg = getAlpacaPaperConfig();
    if (!cfg.isPaperUrl) {
      return res.status(403).json({
        error: 'Fail-closed guard: non-paper Alpaca endpoints are prohibited.',
      });
    }
    if (!cfg.configured) {
      return res.status(503).json({
        configured: false,
        error: 'Alpaca paper API keys are not configured in server environment.',
      });
    }

    const { symbol, side, qty, clientOrderId } = req.body as {
      symbol?: string;
      side?: string;
      qty?: number;
      clientOrderId?: string;
    };

    const sym = String(symbol || '').toUpperCase();
    const orderSide = String(side || '').toLowerCase();
    const orderQty = Math.floor(Number(qty));

    if (!ALLOWED_SYMBOLS.has(sym)) {
      return res.status(400).json({ error: `Unsupported symbol: ${sym}` });
    }
    if (orderSide !== 'buy' && orderSide !== 'sell') {
      return res.status(400).json({ error: 'Order side must be buy or sell.' });
    }
    if (!Number.isFinite(orderQty) || orderQty <= 0 || orderQty > 5000) {
      return res.status(400).json({ error: 'Order quantity must be between 1 and 5000 shares.' });
    }

    try {
      const response = await fetch(`${PAPER_BASE_URL}/v2/orders`, {
        method: 'POST',
        headers: {
          'APCA-API-KEY-ID': cfg.apiKey,
          'APCA-API-SECRET-KEY': cfg.apiSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: sym,
          qty: String(orderQty),
          side: orderSide,
          type: 'market',
          time_in_force: 'day',
          client_order_id: clientOrderId || `czar-${sym}-${Date.now()}`,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: data });
      }
      return res.json(data);
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to submit paper order to Alpaca.',
      });
    }
  });

  app.get('/api/experiments', (_req, res) => {
    const records = readRegistryFromDisk();
    res.json({ experiments: records });
  });

  app.post('/api/experiments', (req, res) => {
    const record = req.body as StoredExperiment | undefined;
    if (!record || typeof record.id !== 'string' || typeof record.title !== 'string') {
      return res.status(400).json({ error: 'Invalid experiment payload: id and title are required.' });
    }
    const current = readRegistryFromDisk().filter((item) => item.id !== record.id);
    const updated = [record, ...current].slice(0, 200);
    writeRegistryToDisk(updated);
    return res.status(201).json({ experiment: record });
  });

  app.patch('/api/experiments/:id', (req, res) => {
    const id = req.params.id;
    const patch = req.body as Record<string, unknown> | undefined;
    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ error: 'Invalid patch body.' });
    }
    const allowedKeys = new Set(['verdict', 'hypothesis', 'limitations']);
    const safePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (allowedKeys.has(k) && typeof v === 'string') {
        safePatch[k] = v;
      }
    }
    const current = readRegistryFromDisk();
    let found: StoredExperiment | null = null;
    const updated = current.map((item) => {
      if (item.id === id) {
        found = { ...item, ...safePatch };
        return found;
      }
      return item;
    });
    if (!found) {
      return res.status(404).json({ error: 'Experiment record not found.' });
    }
    writeRegistryToDisk(updated);
    return res.json({ experiment: found });
  });

  app.delete('/api/experiments/:id', (req, res) => {
    const id = req.params.id;
    const current = readRegistryFromDisk();
    const updated = current.filter((item) => item.id !== id);
    writeRegistryToDisk(updated);
    return res.json({ deleted: id });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, HOST, () => {
    console.log(`Trading-Czar server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
