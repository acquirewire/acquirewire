import type { APIRoute } from 'astro';

export const prerender = false;

// Grouped market board. Yahoo symbols, all free / no key.
const GROUPS: Record<string, { y: string; label: string }[]> = {
  indices: [
    { y: '^GSPC', label: 'S&P 500' },
    { y: '^IXIC', label: 'Nasdaq' },
    { y: '^DJI', label: 'Dow Jones' },
    { y: '^RUT', label: 'Russell 2000' },
    { y: '^FTSE', label: 'FTSE 100' },
    { y: '^VIX', label: 'VIX' },
  ],
  sectors: [
    { y: 'XLK', label: 'Technology' },
    { y: 'XLF', label: 'Financials' },
    { y: 'XLE', label: 'Energy' },
    { y: 'XLV', label: 'Health Care' },
    { y: 'XLI', label: 'Industrials' },
    { y: 'XLY', label: 'Cons. Disc.' },
    { y: 'XLP', label: 'Cons. Staples' },
    { y: 'XLC', label: 'Comm. Svcs' },
    { y: 'XLU', label: 'Utilities' },
    { y: 'XLB', label: 'Materials' },
    { y: 'XLRE', label: 'Real Estate' },
  ],
  rates: [
    { y: '^IRX', label: '13-Week' },
    { y: '^FVX', label: '5-Year' },
    { y: '^TNX', label: '10-Year' },
    { y: '^TYX', label: '30-Year' },
  ],
  fx: [
    { y: 'EURUSD=X', label: 'EUR / USD' },
    { y: 'GBPUSD=X', label: 'GBP / USD' },
    { y: 'USDJPY=X', label: 'USD / JPY' },
    { y: 'USDCNY=X', label: 'USD / CNY' },
    { y: 'DX-Y.NYB', label: 'Dollar Index' },
  ],
  commodities: [
    { y: 'CL=F', label: 'WTI Crude' },
    { y: 'BZ=F', label: 'Brent Crude' },
    { y: 'GC=F', label: 'Gold' },
    { y: 'SI=F', label: 'Silver' },
    { y: 'NG=F', label: 'Nat Gas' },
    { y: 'HG=F', label: 'Copper' },
  ],
  crypto: [
    { y: 'BTC-USD', label: 'Bitcoin' },
    { y: 'ETH-USD', label: 'Ether' },
    { y: 'SOL-USD', label: 'Solana' },
    { y: 'XRP-USD', label: 'XRP' },
    { y: 'BNB-USD', label: 'BNB' },
    { y: 'DOGE-USD', label: 'Dogecoin' },
  ],
};

type Quote = { label: string; symbol: string; price: number; changePct: number };

let memo: { t: number; data: Record<string, Quote[]> } | null = null;

async function fetchSpot(s: { y: string; label: string }): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.y)}?interval=1d&range=1d`;
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
    return { label: s.label, symbol: s.y, price, changePct: prev ? ((price - prev) / prev) * 100 : 0 };
  } finally {
    clearTimeout(timer);
  }
}

export const GET: APIRoute = async () => {
  const now = Date.now();
  if (memo && now - memo.t < 55_000) {
    return json({ board: memo.data, ts: memo.t, cached: true });
  }
  const out: Record<string, Quote[]> = {};
  await Promise.all(
    Object.entries(GROUPS).map(async ([group, syms]) => {
      const settled = await Promise.allSettled(syms.map(fetchSpot));
      out[group] = settled
        .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
        .map((r) => r.value);
    })
  );
  const hasData = Object.values(out).some((g) => g.length);
  if (hasData) memo = { t: now, data: out };
  return json({ board: hasData ? out : memo?.data ?? {}, ts: now });
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
