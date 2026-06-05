import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const articles = (await getCollection('articles', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  return rss({
    title: 'AcquireWire — M&A & Markets Intelligence',
    description:
      'Sharp, daily intelligence on the deals, capital flows, and market moves that matter.',
    site: context.site!,
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.subtitle,
      pubDate: a.data.date,
      link: `/articles/${a.id}/`,
      categories: a.data.tags,
    })),
    customData: '<language>en-gb</language>',
  });
}
