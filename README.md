# AcquireWire

Financial-intelligence publication — M&A, private capital, regulation, and markets.
Built with [Astro](https://astro.build), deployed on Vercel, with an automated daily
article-drafting pipeline (RSS → Claude → review-by-PR).

---

## How it works

```
free finance RSS  ──►  scripts/generate.mjs  ──►  src/content/articles/<slug>.md
   (sources.mjs)         (Claude drafts it)              (one markdown file)
                                                              │
GitHub Action (daily cron) opens a Pull Request ◄────────────┘
                                                              │
        you review the Vercel PR preview ──► merge = publish (or close = discard)
```

- **Content is data.** Every article is one Markdown file in `src/content/articles/`
  with frontmatter (title, subtitle, category, date, metrics, …). Schema lives in
  `src/content.config.ts`.
- **Adding an article by hand** = drop a new `.md` in that folder. No HTML, no JS.
- **Automation** drafts one article each weekday and opens a PR. Nothing goes live
  until you merge. This is your review queue.

## Local development

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run preview    # serve the built site
```

## The daily pipeline

Scripts:

| command | what it does |
| --- | --- |
| `npm run generate -- --no-api` | fetch RSS, print candidate stories (no Claude call) |
| `npm run generate -- --dry-run` | full run, writes `_migration/draft-preview.md`, leaves state untouched |
| `npm run generate` | full run, writes a real `src/content/articles/<slug>.md` + updates `scripts/state.json` |

Set your key locally first:

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm run generate -- --dry-run
```

`scripts/state.json` records covered story keys so the same story isn't written twice.

### Editorial guardrails

The system prompt in `scripts/generate.mjs` forces the model to use **only figures
present in the source material** and to hedge when sources are thin — because every
draft is reviewed before publishing, errors are caught in the PR, not in public.

## Live market price tape

The strip below the masthead shows live prices for indices, crypto, and
commodities. It's powered by `src/pages/api/quotes.ts` — a Vercel serverless
function that pulls from Yahoo Finance's public endpoints **server-side** (no
API key, no CORS issues), normalises the data, and caches it ~60s so all
visitors share one upstream call. The browser polls `/api/quotes` every 60s.

- **Change what's shown**: edit the `SYMBOLS` list in `src/pages/api/quotes.ts`
  (Yahoo symbols — e.g. `^GSPC` S&P 500, `BTC-USD` Bitcoin, `CL=F` WTI crude).
- **Want an official feed instead?** Yahoo is unofficial and can change. To swap
  in a keyed provider (Finnhub/Twelve Data), replace the `fetchOne()` body and
  read the key from `import.meta.env` / a Vercel env var.

## Markets charts section

The homepage "Markets" section (separate from the news index) renders a grid of
area charts — one per instrument, showing the 3-month trend with price, period
change, and a hover read-out. Data comes from `src/pages/api/history.ts` (same
Yahoo proxy approach as the tape, but cached ~10 min). A **1M/3M/6M/1Y range
toggle** refetches per window (each range cached server- and client-side).
Charts are hand-drawn SVG (no chart library); the symbol list and allowed ranges
live in that endpoint. Client logic is the inline script at the bottom of
`src/pages/index.astro`.

## Deal Tracker

`/deals` is a running, sortable/filterable log of M&A, take-privates, and IPOs.
Data lives in `src/data/deals.json` (fields: date, acquirer, target, value in $B,
sector, status `rumoured|agreed|closed|ipo`, optional `slug` linking to the
article). The homepage shows a teaser of the latest five. **The generator
auto-appends** to this file when it drafts a deal story (the model returns a
`deal` object), so the tracker stays current with no manual upkeep.

## Markets hub

`/markets` is a full dashboard — indices, a colour-graded **sector heatmap**,
treasury yields, currencies, commodities, and crypto. Data comes from
`src/pages/api/board.ts` (grouped Yahoo quotes, cached ~60s). Edit the `GROUPS`
map there to change instruments.

## Site search

`/search` uses [Pagefind](https://pagefind.app) (via `astro-pagefind`), which
indexes the built site at the end of `astro build` — fully static, no server, no
cost. Article bodies are tagged with `data-pagefind-body`. A search icon sits in
the masthead.

## Categories

`deal` · `pe` · `analysis` · `markets` · `regulation` — each has its own colour. Drafts
(`draft: true`) are hidden from the live build but visible in `npm run dev`.

---

## Deployment & cutover (one-time)

1. **Create the GitHub repo** and push this project (see `SETUP.md` for exact commands).
2. **Vercel**: point the existing `acquirewire.co.uk` project at the new repo.
   - Framework preset: **Astro** · Build: `astro build` · Output: `dist`
   - The custom domain + SSL carry over automatically.
3. **GitHub secret/variables** (repo → Settings → Secrets and variables → Actions):
   - Secret `ANTHROPIC_API_KEY` — required.
   - Variable `ANTHROPIC_MODEL` — optional (default `claude-sonnet-4-6`).
   - Variable `NTFY_TOPIC` (+ optional `NTFY_SERVER`) — optional ntfy ping on new draft.
4. **Test it**: Actions tab → *Daily article draft* → *Run workflow*. It should open a
   PR with a Vercel preview. Merge to publish.

See `SETUP.md` for the step-by-step.
