import posts from '../generated/posts.json';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export function GET({ site }) {
  const home = new URL('/rkaw_blog/', site).href;
  const items = posts.map((post) => {
    const url = new URL(`/rkaw_blog/posts/${post.id}/`, site).href;
    return `<item><title>${escape(post.title)}</title><link>${url}</link><guid>${url}</guid><description>${escape(post.excerpt)}</description><pubDate>${new Date(`${post.date}T00:00:00+09:00`).toUTCString()}</pubDate></item>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Kawanabe Astro Notion Blog</title><link>${home}</link><description>音楽、情報科学、プログラミングなどについて。</description>${items}</channel></rss>`, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
