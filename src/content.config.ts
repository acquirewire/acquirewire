import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The controlled sector list. Keep this in step with scripts/generate.mjs —
// The Wire builds its filter from whatever values actually appear in content.
export const SECTORS = [
  'Financials',
  'Technology',
  'Healthcare',
  'Industrials',
  'Consumer & Retail',
  'Energy & Utilities',
  'Media & Telecom',
  'Real Estate',
  'Transport & Travel',
  'Markets',
] as const;

// Text-first article model: no hero image by default. An image is carried only
// when it adds something the prose cannot, so it stays optional.
const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    // Headline
    title: z.string(),
    // Standfirst / dek — the 1–2 sentence summary under the headline
    subtitle: z.string(),
    // Publication date
    date: z.coerce.date(),
    // Estimated read time in minutes
    readTime: z.number().int().positive().default(4),
    // Byline
    author: z.string().default('AcquireWire Desk'),
    // Optional lightweight topical tags (shown subtly at the foot)
    tags: z.array(z.string()).default([]),
    // Controlled sector, used by the filter on The Wire
    sector: z.enum(SECTORS).default('Markets'),
    // Optional imagery. Only set when the picture earns its place: a chart, a
    // document, a photograph of the people or assets actually at issue.
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    imageCredit: z.string().optional(),
    // Drafts are excluded from the live build
    draft: z.boolean().default(false),
  }),
});

// Deal Tracker roundups live in their own collection so they never appear in
// the main article feed, the RSS feed, or the front-page lead slot.
const roundups = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/roundups' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    date: z.coerce.date(),
    author: z.string().default('AcquireWire Desk'),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, roundups };
