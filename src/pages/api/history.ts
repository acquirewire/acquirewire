import type { APIRoute } from 'astro';

export const prerender = false;

// Instruments shown in the homepage Markets charts section.
const SYMBOLS: { y: string; label: string }[] = [
  { y: '^GSPC', label: 'S&P 500' },
  { y: '^IXIC', label: 'Nasdaq' },
  { y: '^DJI', label: 'Dow Jones' },
  { y: '^FTSE', label: 'FTSE 100' },
  { y: 'BTC-USD', label: 'Bitcoin' },
  { y: 'ETH-USD', label: 'Ether' },
  { y: 'CL=F', label: 'WTI Crude' },
  { y: 'GC=F', label: 'Gold' },
];

type Series = { label: string; symbol: string; price: number; changePct: number; series: number[] };

// Allowed ranges → Yahoo range + interval (coarser interval for longer windows)
const RANGES: Record<string, { range: string; interval: string }> = {
  '1mo': { range: '1mo', interval: '1d' },
  '3mo': { range: '3mo', interval: '1d' },
  '6mo': { range: '6mo', interval: '1d' },
  '1y': { range: '1y', interval: '1wk' },
};

const memo: Record<string, { t: number; data: Series[] }> = {};

async function fetchOne(s: { y: string; label: string }, rng: { range: string; interval: string }): Promise<Series> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    s.y
  )}?interval=${rng.interval}&range=${rng.range}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!r.ok) throw new Error(`${s.y}: ${r.status}`);
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    const series = closes.filter((c): c is number => typeof c === 'number');
    if (series.length < 2) throw new Error(`${s.y}: no series`);
    const price = res?.meta?.regularMarketPrice ?? series[series.length - 1];
    const first = series[0];
    const changePct = first ? ((price - first) / first) * 100 : 0;
    // Downsample to ~40 points to keep payload small
    const step = Math.max(1, Math.floor(series.length / 40));
    const thin = series.filter((_, i) => i % step === 0);
    if (thin[thin.length - 1] !== price) thin.push(price);
    return { label: s.label, symbol: s.y, price, changePct, series: thin };
  } finally {
    clearTimeout(timer);
  }
}

export const GET: APIRoute = async ({ url }) => {
  const now = Date.now();
  const key = url.searchParams.get('range') || '3mo';
  const rng = RANGES[key] || RANGES['3mo'];

  const cached = memo[key];
  if (cached && now - cached.t < 9 * 60_000) {
    return json({ markets: cached.data, range: key, ts: cached.t, cached: true });
  }
  const settled = await Promise.allSettled(SYMBOLS.map((s) => fetchOne(s, rng)));
  const data = settled
    .filter((r): r is PromiseFulfilledResult<Series> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (data.length) memo[key] = { t: now, data };
  const markets = data.length ? data : cached?.data ?? [];
  return json({ markets, range: key, ts: now });
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800',
    },
  });
}
