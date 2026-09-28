import posts from '../generated/posts.json';

export function GET({ site }) {
  const base = '/rkaw_blog';
  const urls = [
    { path: `${base}/`, lastmod: posts.map((p) => p.lastModified).sort().at(-1) },
    ...posts.map((post) => ({ path: `${base}/posts/${post.id}/`, lastmod: post.lastModified })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(({ path, lastmod }) => `<url><loc>${new URL(path, site).href}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`).join('')}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
