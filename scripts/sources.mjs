// Free finance RSS sources + fetch/parse helpers.
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'AcquireWireBot/1.0 (+https://www.acquirewire.co.uk)' },
});

// Each feed is tagged with a default editorial category as a hint to the model.
export const FEEDS = [
  // M&A / deals
  { url: 'https://news.google.com/rss/search?q=merger+OR+acquisition+OR+%22takeover+bid%22+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'deal' },
  { url: 'https://news.google.com/rss/search?q=%22private+equity%22+OR+%22buyout%22+OR+%22leveraged+buyout%22+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'pe' },
  { url: 'https://news.google.com/rss/search?q=IPO+OR+%22public+offering%22+OR+%22S-1+filing%22+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'deal' },
  // Markets / macro
  { url: 'https://news.google.com/rss/search?q=%22stock+market%22+OR+%22S%26P+500%22+OR+%22Federal+Reserve%22+when:1d&hl=en-US&gl=US&ceid=US:en', category: 'markets' },
  { url: 'https://news.google.com/rss/search?q=earnings+OR+%22quarterly+results%22+megacap+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'analysis' },
  // Regulation
  { url: 'https://news.google.com/rss/search?q=SEC+OR+antitrust+OR+%22regulatory+approval%22+deal+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'regulation' },
  // Primary: SEC EDGAR latest 8-K filings (material events)
  { url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom', category: 'deal' },
];

const clean = (s = '') =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

// Google News titles look like "Headline - Publisher"; keep the headline.
const tidyTitle = (t = '') => clean(t).replace(/\s+-\s+[^-]+$/, '').trim();

export async function fetchAll() {
  const items = [];
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const it of parsed.items || []) {
        const title = tidyTitle(it.title || '');
        if (!title || title.length < 18) continue;
        items.push({
          title,
          link: it.link || it.guid || '',
          source: parsed.title || 'RSS',
          category: feed.category,
          published: it.isoDate || it.pubDate || '',
          summary: clean(it.contentSnippet || it.content || it.summary || '').slice(0, 600),
        });
      }
    } catch (err) {
      console.warn(`! feed failed: ${feed.url.slice(0, 60)}… ${err.message}`);
    }
  }
  // De-dupe within this run by normalised title
  const seen = new Set();
  return items.filter((it) => {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
