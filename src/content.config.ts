import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Text-first article model: no category, no hero image, no metrics strip.
// Just an editorial briefing — headline, standfirst, byline, prose.
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
    // Drafts are excluded from the live build
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
