import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '~/config/site';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return rss({
    title: `Writing · ${SITE.name}`,
    description: SITE.description,
    site: context.site?.toString() ?? SITE.url,
    items: posts
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .map((post) => ({
        title: post.data.title,
        description: post.data.summary,
        pubDate: post.data.date,
        link: `/blog/${post.id}/`,
      })),
    customData: '<language>en-us</language>',
  });
}
