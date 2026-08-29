// Daily article generator: fetch RSS -> pick the best fresh story -> draft via Claude.
//
//   node scripts/generate.mjs            # generate + write a real draft (used in CI)
//   node scripts/generate.mjs --dry-run  # generate to _migration/draft-preview.md, don't touch state
//   node scripts/generate.mjs --no-api   # just print candidate stories (no Claude call)
//
// Emits GitHub Actions outputs (slug, title) via $GITHUB_OUTPUT when present.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { fetchAll } from './sources.mjs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTICLES_DIR = join(ROOT, 'src', 'content', 'articles');
const STATE_PATH = join(__dirname, 'state.json');
const DEALS_PATH = join(ROOT, 'src', 'data', 'deals.json');

const DRY = process.argv.includes('--dry-run');
const NO_API = process.argv.includes('--no-api');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Batch mode: --count N writes N articles in one run (default 1).
// When count > 1 (or --backdate), each successive article is dated one day
// earlier, so a backlog reads as if published over the past N days.
function argVal(name) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  return eq ? eq.split('=')[1] : undefined;
}
const COUNT = Math.max(1, parseInt(argVal('--count') || process.env.COUNT || '1', 10) || 1);
const BACKDATE = process.argv.includes('--backdate') || COUNT > 1;
const dateMinusDays = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// Errors that will fail identically on every retry: billing, auth, a bad model
// id, a malformed request. Retrying these burns the attempt budget and buries
// the real cause under a wall of identical warnings, so we abort on the first.
const FATAL_STATUSES = new Set([400, 401, 403, 404]);
const isFatalApiError = (e) => e instanceof Anthropic.APIError && FATAL_STATUSES.has(e.status);

function hintFor(e) {
  const msg = (e.message || '').toLowerCase();
  if (msg.includes('credit balance'))
    return `  → The Anthropic account behind ANTHROPIC_API_KEY is out of credit.
    Top up at https://console.anthropic.com/settings/billing, then re-run:
    Actions → Daily article draft → Run workflow.`;
  if (e.status === 401 || e.status === 403)
    return `  → ANTHROPIC_API_KEY is invalid, revoked, or lacks access to this model.
    Replace it with: gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>`;
  if (e.status === 404)
    return `  → Model "${MODEL}" was not found. Point the ANTHROPIC_MODEL repo variable at a current model id.`;
  return `  → This request will fail the same way on every retry; fix the cause above.`;
}

const loadState = () => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { covered: [] });
const keyOf = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Topic-overlap dedupe so the same event from different outlets isn't re-covered.
const STOP = new Set(
  ('the a an of to in on for and or with at by from as is are be into over after amid it its has have will would could ' +
   'billion million trillion takeover bid deal deals acquisition acquire acquires merger buyout offer talks stake shares ' +
   'share company group inc corp plc ltd co rejects rejected rebuffs spurns approach new report reported reportedly says ' +
   'said about more same than what does just hit set close closing first').split(/\s+/)
);
const sigTokens = (t) =>
  new Set((t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
const sameTopic = (t1, t2) => {
  const a = sigTokens(t1), b = sigTokens(t2);
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n >= 2;
};

const SYSTEM = `You are the senior markets editor at AcquireWire, a sharp financial-intelligence publication covering M&A, private capital, regulation, and markets.

House style:
- Authoritative, concise, numbers-first. Lead with what happened and the figures, then the "so what".
- Always give both a risk case and a bull case.
- Sound like a smart human analyst, not a press release. No hype, no filler, no "in conclusion".

CRITICAL ACCURACY RULES (this is a finance publication):
- Use ONLY facts and figures present in the SOURCE MATERIAL provided, plus widely-known, stable background context you are highly confident about.
- NEVER invent specific numbers (prices, valuations, percentages, dates) that are not supported by the source. If a precise figure isn't given, describe it qualitatively or omit it.
- If the source is thin, write a shorter, well-hedged piece rather than padding with fabricated detail.
- It is far better to be vague and correct than specific and wrong.

You output ONLY a single valid JSON object, no prose, no markdown fences.`;

function userPrompt(candidates, exclude = []) {
  const excludeBlock = exclude.length
    ? `\nALREADY COVERED — do NOT write about any of these, or the same underlying event, company, or deal, even if a candidate below is from a different outlet or worded differently (e.g. "UMG" and "Universal Music Group" are the SAME story). Pick a story about a genuinely DIFFERENT company/event:\n${exclude.map((t) => `- ${t}`).join('\n')}\n`
    : '';
  return `Here are today's candidate financial stories from the wire (title — source — summary):

${candidates.map((c, i) => `[${i + 1}] (${c.category}) ${c.title}\n    ${c.summary || '(no summary)'}\n    source: ${c.source}`).join('\n\n')}
${excludeBlock}
Pick the SINGLE most significant, genuinely newsworthy story for an M&A/markets audience that is NOT already covered above (prefer concrete deals, capital moves, or clear market events over vague commentary). Then write the full AcquireWire article about it.

Return ONLY this JSON object:
{
  "slug": "kebab-case-url-slug-max-8-words",
  "title": "Headline (punchy, specific, no clickbait)",
  "subtitle": "1-2 sentence standfirst with the key numbers and the tension",
  "readTime": 4,
  "tags": ["two", "or", "three", "lowercase", "tags"],
  "deal": null,
  "body_markdown": "Markdown body. Start with a '## What Happened' H2, then 1-2 tight paragraphs that weave the key figures into the prose. Then '## Why It Matters' with 2-3 paragraphs, each starting with a **bold lead-in:**. Then include EXACTLY these two callout blocks as raw HTML (no emoji in the titles):\\n<div class=\\"callout risk\\">\\n  <div class=\\"ttl\\">Risks to Watch</div>\\n  <ul>\\n    <li><strong>Point:</strong> detail.</li>\\n  </ul>\\n</div>\\n<div class=\\"callout bull\\">\\n  <div class=\\"ttl\\">Bull Case</div>\\n  <ul>\\n    <li><strong>Point:</strong> detail.</li>\\n  </ul>\\n</div>"
}

If — and ONLY if — this story is a specific M&A deal, take-private, or IPO, set "deal" to an object (else leave it null):
{ "acquirer": "Buyer (or — for an IPO)", "target": "Company/asset", "value": <number in USD billions, or null if unknown>, "sector": "e.g. Pharma", "status": "rumoured | agreed | closed | ipo" }

This is a text-first publication: no images, no metrics boxes, no category labels. Put the numbers in the writing. Keep the body ~450-650 words.`;
}

function toMarkdown(a, story, date) {
  const fm = [
    '---',
    `title: ${JSON.stringify(a.title)}`,
    `subtitle: ${JSON.stringify(a.subtitle)}`,
    `date: ${date}`,
    `readTime: ${a.readTime || 4}`,
    'author: "AcquireWire Desk"',
    `tags: ${JSON.stringify(a.tags || [])}`,
    'draft: false',
    '---',
    '',
  ].join('\n');
  const sourceNote = story?.link
    ? `\n\n*Source: [${story.source}](${story.link})*\n`
    : '\n';
  return fm + (a.body_markdown || '').trim() + '\n' + sourceNote;
}

async function draftOne(client, candidates, exclude = []) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(candidates, exclude) }],
  });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(jsonStr);
}

function appendDeal(article, slug, date) {
  if (!article.deal || !article.deal.target) return;
  try {
    const deals = existsSync(DEALS_PATH) ? JSON.parse(readFileSync(DEALS_PATH, 'utf8')) : [];
    const d = article.deal;
    deals.unshift({
      date,
      acquirer: String(d.acquirer || '—'),
      target: String(d.target),
      value: typeof d.value === 'number' ? d.value : null,
      sector: String(d.sector || '—'),
      status: ['rumoured', 'agreed', 'closed', 'ipo'].includes(d.status) ? d.status : 'agreed',
      slug,
    });
    writeFileSync(DEALS_PATH, JSON.stringify(deals, null, 2) + '\n');
    console.log(`  ✓ Added to Deal Tracker: ${d.acquirer} / ${d.target}`);
  } catch (e) {
    console.warn('  ! could not update deals.json:', e.message);
  }
}

async function main() {
  console.log(`▶ Fetching wire…`);
  const all = await fetchAll();
  console.log(`  ${all.length} unique stories fetched`);

  const state = loadState();
  const covered = new Set(state.covered || []);
  let fresh = all.filter((s) => !covered.has(keyOf(s.title)));
  console.log(`  ${fresh.length} not yet covered`);
  if (fresh.length === 0) {
    console.log('Nothing new to write today. Exiting cleanly.');
    return;
  }

  if (NO_API) {
    fresh.slice(0, Math.max(30, COUNT)).forEach((c, i) => console.log(`  [${i + 1}] (${c.category}) ${c.title}`));
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (add it to .env or as a GitHub secret).');
  const client = new Anthropic({ apiKey });

  const target = Math.min(COUNT, fresh.length);
  console.log(`▶ Drafting ${target} article(s) with ${MODEL}${BACKDATE ? ' (dated backwards from today)' : ''}…`);

  const usedKeys = new Set();
  const coveredHeadlines = []; // passed to the model so it avoids repeats
  const coveredTargets = new Set(); // normalised deal targets already written
  const written = [];
  let firstSlug = '', firstTitle = '';
  let attempts = 0;
  let softFailures = 0;   // transient errors we retried past
  let fatal = null;       // first non-retryable API error, if any
  const maxAttempts = target * 3 + 5; // cap API calls so skips can't run away

  while (written.length < target && attempts < maxAttempts) {
    attempts++;
    const candidates = fresh.filter((c) => !usedKeys.has(keyOf(c.title))).slice(0, 30);
    if (candidates.length === 0) break;

    let article;
    try {
      article = await draftOne(client, candidates, coveredHeadlines);
    } catch (e) {
      if (isFatalApiError(e)) { fatal = e; break; }
      softFailures++;
      console.warn(`  ! draft failed, retrying: ${e.message}`);
      continue;
    }

    const story = candidates.find((c) => keyOf(c.title).includes(keyOf(article.title).slice(0, 20))) || candidates[0];
    usedKeys.add(keyOf(story.title));
    usedKeys.add(keyOf(article.title));

    // Skip if this repeats a topic already written this batch (entity or token overlap)
    const tgt = article.deal && article.deal.target ? norm(article.deal.target) : '';
    const dup = (tgt && coveredTargets.has(tgt)) || coveredHeadlines.some((h) => sameTopic(h, article.title));
    if (dup) {
      console.log(`  ↪ skipped duplicate topic: ${article.title}`);
      continue;
    }

    const slug = (article.slug || keyOf(article.title)).replace(/[^a-z0-9-]/g, '').slice(0, 70);
    const date = BACKDATE ? dateMinusDays(written.length) : dateMinusDays(0);
    const md = toMarkdown(article, story, date);

    if (DRY) {
      mkdirSync(join(ROOT, '_migration'), { recursive: true });
      const out = join(ROOT, '_migration', `draft-preview-${written.length + 1}.md`);
      writeFileSync(out, md, 'utf8');
      console.log(`  ✓ DRY ${written.length + 1}/${target}: ${date} — ${article.title}`);
    } else {
      writeFileSync(join(ARTICLES_DIR, `${slug}.md`), md, 'utf8');
      appendDeal(article, slug, date);
      console.log(`  ✓ ${written.length + 1}/${target}: ${date} — ${slug}.md`);
    }

    coveredHeadlines.push(article.title);
    if (tgt) coveredTargets.add(tgt);
    written.push({ slug, title: article.title, date });
    if (!firstSlug) { firstSlug = slug; firstTitle = article.title; }
  }

  // Nothing written. Distinguish "no news today" (fine, exit 0) from "the API
  // refused us" (broken, exit 1) — a silent green run hid an 11-day outage in
  // August 2026, so an API problem must fail the workflow and page us.
  if (written.length === 0) {
    if (fatal) {
      console.error(`
✗ Aborted: the Anthropic API rejected the request (HTTP ${fatal.status}).`);
      console.error(`  ${fatal.message}`);
      console.error(hintFor(fatal));
      process.exit(1);
    }
    if (softFailures > 0) {
      console.error(`
✗ No articles written: ${softFailures} attempt(s) failed and none succeeded.`);
      process.exit(1);
    }
    console.log('No articles written: no usable candidates on the wire today.');
    return;
  }

  if (DRY) {
    console.log('Dry run complete.');
    return;
  }

  // Record covered keys (cap the rolling history)
  const newCovered = [...usedKeys, ...(state.covered || [])].slice(0, 400);
  writeFileSync(STATE_PATH, JSON.stringify({ covered: newCovered, lastRun: new Date().toISOString() }, null, 2));
  console.log(`✓ Wrote ${written.length} article(s).`);

  // GitHub Actions outputs
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `slug=${firstSlug}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `title=${written.length > 1 ? `${written.length} new articles` : firstTitle.replace(/\n/g, ' ')}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `count=${written.length}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `created=true\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
