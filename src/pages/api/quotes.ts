import type { APIRoute } from 'astro';

// Runs as a Vercel serverless function (not prerendered).
export const prerender = false;

// Symbols shown on the price tape. Yahoo symbols cover indices (^...),
// crypto (X-USD) and commodities futures (XX=F) — all free, no key.
// Edit this list to change what appears.
const SYMBOLS: { y: string; label: string }[] = [
  { y: '^GSPC', label: 'S&P 500' },
  { y: '^IXIC', label: 'Nasdaq' },
  { y: '^DJI', label: 'Dow' },
  { y: '^FTSE', label: 'FTSE 100' },
  { y: 'BTC-USD', label: 'Bitcoin' },
  { y: 'ETH-USD', label: 'Ether' },
  { y: 'CL=F', label: 'WTI Crude' },
  { y: 'GC=F', label: 'Gold' },
];

type Quote = { label: string; symbol: string; price: number; changePct: number };

// Small in-memory memo to avoid hammering the upstream during local dev /
// warm function invocations. Vercel's CDN cache (headers below) is the real cache.
let memo: { t: number; data: Quote[] } | null = null;

async function fetchOne(s: { y: string; label: string }): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    s.y
  )}?interval=1d&range=1d`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
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
    const m = j?.chart?.result?.[0]?.meta;
    const price = m?.regularMarketPrice;
    if (typeof price !== 'number') throw new Error(`${s.y}: no price`);
    const prev = m?.chartPreviousClose ?? m?.previousClose ?? price;
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return { label: s.label, symbol: s.y, price, changePct };
  } finally {
    clearTimeout(timer);
  }
}

export const GET: APIRoute = async () => {
  const now = Date.now();
  if (memo && now - memo.t < 55_000) {
    return json({ quotes: memo.data, ts: memo.t, cached: true });
  }

  const settled = await Promise.allSettled(SYMBOLS.map(fetchOne));
  const data = settled
    .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
    .map((r) => r.value);

  if (data.length) memo = { t: now, data };
  const quotes = data.length ? data : memo?.data ?? [];

  return json({ quotes, ts: now });
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // CDN-cache for 60s, serve stale up to 5 min while revalidating.
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
