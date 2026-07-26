import type { MetadataRoute } from 'next';

/**
 * Auto-generated robots.txt (SPEC I5a SEO). Public content is crawlable; the
 * token-guarded admin console and the bare foundation status page are kept out
 * of the index. Points crawlers at the live sitemap.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/admin/', '/status'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
