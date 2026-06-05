// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';
import vercel from '@astrojs/vercel';

// https://astro.build
export default defineConfig({
  site: 'https://www.acquirewire.co.uk',
  // Pages stay static (prerendered) by default; only routes that opt out
  // (export const prerender = false) — e.g. /api/quotes — run as functions.
  adapter: vercel(),
  integrations: [sitemap(), pagefind()],
  markdown: {
    shikiConfig: { theme: 'css-variables' },
  },
});
