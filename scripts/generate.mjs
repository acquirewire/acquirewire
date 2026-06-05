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

const loadState = () => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { covered: [] });
const keyOf = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);

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

function userPrompt(candidates) {
  return `Here are today's candidate financial stories from the wire (title — source — summary):

${candidates.map((c, i) => `[${i + 1}] (${c.category}) ${c.title}\n    ${c.summary || '(no summary)'}\n    source: ${c.source}`).join('\n\n')}

Pick the SINGLE most significant, genuinely newsworthy story for an M&A/markets audience (prefer concrete deals, capital moves, or clear market events over vague commentary). Then write the full AcquireWire article about it.

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

async function draftOne(client, candidates) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(candidates) }],
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
  const written = [];
  let firstSlug = '', firstTitle = '';

  for (let i = 0; i < target; i++) {
    const candidates = fresh.filter((c) => !usedKeys.has(keyOf(c.title))).slice(0, 30);
    if (candidates.length === 0) break;

    let article;
    try {
      article = await draftOne(client, candidates);
    } catch (e) {
      console.warn(`  ! draft ${i + 1} failed, skipping: ${e.message}`);
      continue;
    }

    const story = candidates.find((c) => keyOf(c.title).includes(keyOf(article.title).slice(0, 20))) || candidates[0];
    usedKeys.add(keyOf(story.title));
    usedKeys.add(keyOf(article.title));

    const slug = (article.slug || keyOf(article.title)).replace(/[^a-z0-9-]/g, '').slice(0, 70);
    const date = BACKDATE ? dateMinusDays(i) : dateMinusDays(0);
    const md = toMarkdown(article, story, date);

    if (DRY) {
      mkdirSync(join(ROOT, '_migration'), { recursive: true });
      const out = join(ROOT, '_migration', `draft-preview-${i + 1}.md`);
      writeFileSync(out, md, 'utf8');
      console.log(`  ✓ DRY ${i + 1}/${target}: ${date} — ${article.title}`);
      continue;
    }

    writeFileSync(join(ARTICLES_DIR, `${slug}.md`), md, 'utf8');
    appendDeal(article, slug, date);
    written.push({ slug, title: article.title, date });
    if (!firstSlug) { firstSlug = slug; firstTitle = article.title; }
    console.log(`  ✓ ${i + 1}/${target}: ${date} — ${slug}.md`);
  }

  if (DRY || written.length === 0) {
    console.log(written.length === 0 && !DRY ? 'No articles written.' : 'Dry run complete.');
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
