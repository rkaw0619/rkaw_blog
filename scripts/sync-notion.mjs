import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const token = process.env.NOTION_API_KEY;
const databaseId = process.env.NOTION_DATABASE_ID;
if (!token || !databaseId) {
  throw new Error('NOTION_API_KEY と NOTION_DATABASE_ID を設定してください。');
}
if (!/^[a-f\d-]{32,36}$/i.test(databaseId)) {
  throw new Error('NOTION_DATABASE_ID の形式を確認してください。');
}

const apiRoot = 'https://api.notion.com/v1';
const version = '2025-09-03';
const generatedDir = 'src/generated';
const mediaDir = 'public/media';
const escaped = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? escaped(url.href) : null;
  } catch { return null; }
};

function spotifyEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist|artist|show|episode)\/([a-zA-Z0-9]+)\/?$/);
    return match ? `https://open.spotify.com/embed/${match[1]}/${match[2]}` : null;
  } catch { return null; }
}

function youtubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch { return null; }
}

function appleMusicEmbed(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['music.apple.com', 'embed.music.apple.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/([a-z]{2})\/(song|album|playlist|artist)\/([a-zA-Z0-9-]+)\/(\d+|pl\.[a-zA-Z0-9]+)\/?$/);
    if (!match) return null;
    const embed = new URL(`https://embed.music.apple.com${url.pathname}`);
    const songId = url.searchParams.get('i');
    if (songId && /^\d+$/.test(songId)) embed.searchParams.set('i', songId);
    return { url: embed.href, height: match[2] === 'song' || songId ? 150 : 450 };
  } catch { return null; }
}

async function notion(endpoint, options = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${apiRoot}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': version,
        'Content-Type': 'application/json',
      },
    });
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      const delay = Math.min(Number(response.headers.get('retry-after') || 2) * 1000, 12000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Notion API ${response.status} (${endpoint.split('?')[0]})。DBの共有設定・ID・権限を確認してください。`);
    }
    return response.json();
  }
}

async function paginate(endpoint, body) {
  const results = [];
  let cursor;
  do {
    const query = body ? '' : `?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await notion(`${endpoint}${query}`, body ? {
      method: 'POST', body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    } : {});
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
    if (page.has_more && !cursor) throw new Error('Notion API のページ送りに失敗しました。');
  } while (cursor);
  return results;
}

function richText(items = []) {
  return items.map((item) => {
    let content = escaped(item.plain_text ?? item.text?.content ?? '');
    const annotations = item.annotations || {};
    if (annotations.code) content = `<code>${content}</code>`;
    if (annotations.bold) content = `<strong>${content}</strong>`;
    if (annotations.italic) content = `<em>${content}</em>`;
    if (annotations.strikethrough) content = `<s>${content}</s>`;
    if (annotations.underline) content = `<u>${content}</u>`;
    const href = safeUrl(item.href ?? item.text?.link?.url);
    return href ? `<a href="${href}" rel="noopener noreferrer">${content}</a>` : content;
  }).join('');
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? '').join('');
}

async function saveImage(block) {
  const raw = block.image?.file?.url ?? block.image?.external?.url;
  const source = safeUrl(raw);
  if (!source) return '';
  const response = await fetch(raw);
  if (!response.ok) throw new Error(`画像を取得できません: ${block.id}`);
  const contentType = response.headers.get('content-type')?.split(';')[0] ?? '';
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' }[contentType];
  if (!ext) throw new Error(`未対応の画像形式です: ${block.id} (${contentType})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) throw new Error(`画像が15MBを超えています: ${block.id}`);
  const name = `${block.id.replaceAll('-', '')}.${ext}`;
  await writeFile(path.join(mediaDir, name), bytes);
  const caption = richText(block.image.caption);
  return `<figure><img loading="lazy" src="/rkaw_blog/media/${name}" alt="${escaped(plainText(block.image.caption) || '記事内の画像')}" />${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
}

async function renderBlocks(blocks, notionUrl) {
  const result = [];
  let listType = null;
  const closeList = () => { if (listType) result.push(`</${listType}>`); listType = null; };
  for (const block of blocks) {
    const type = block.type;
    const data = block[type] || {};
    const isList = type === 'bulleted_list_item' || type === 'numbered_list_item';
    const nextList = type === 'bulleted_list_item' ? 'ul' : type === 'numbered_list_item' ? 'ol' : null;
    if (listType !== nextList) { closeList(); if (nextList) result.push(`<${nextList}>`); listType = nextList; }
    const children = block.has_children ? await renderBlocks(await paginate(`/blocks/${block.id}/children`), notionUrl) : '';
    const text = richText(data.rich_text);
    if (isList) result.push(`<li>${text}${children}</li>`);
    else if (type === 'paragraph') result.push(`<p>${text}</p>${children}`);
    else if (['heading_1', 'heading_2', 'heading_3'].includes(type)) result.push(`<h${type.at(-1)}>${text}</h${type.at(-1)}>${children}`);
    else if (type === 'quote') result.push(`<blockquote>${text}${children}</blockquote>`);
    else if (type === 'callout') result.push(`<blockquote>${escaped(data.icon?.emoji || '')} ${text}${children}</blockquote>`);
    else if (type === 'code') result.push(`<pre><code>${escaped(plainText(data.rich_text))}</code></pre>`);
    else if (type === 'divider') result.push('<hr />');
    else if (type === 'image') result.push(await saveImage(block));
    else if (type === 'to_do') result.push(`<p>${data.checked ? '☑' : '☐'} ${text}</p>${children}`);
    else if (type === 'toggle') result.push(`<details><summary>${text}</summary>${children}</details>`);
    else if (type === 'bookmark' || type === 'link_preview' || type === 'embed' || type === 'video' || type === 'pdf') {
      const rawUrl = data.url ?? data.external?.url ?? data.file?.url;
      const href = safeUrl(rawUrl);
      const label = text || escaped(plainText(data.caption) || '外部コンテンツを開く');
      const spotify = (type === 'embed' || type === 'video') ? spotifyEmbedUrl(rawUrl) : null;
      const youtube = (type === 'embed' || type === 'video') ? youtubeEmbedUrl(rawUrl) : null;
      const appleMusic = (type === 'embed' || type === 'video') ? appleMusicEmbed(rawUrl) : null;
      if (spotify) result.push(`<figure><iframe title="Spotifyプレイヤー" src="${spotify}" width="100%" height="352" style="border:0;border-radius:12px;max-width:100%;" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe><figcaption><a href="${href}" rel="noopener noreferrer">Spotifyで開く</a></figcaption></figure>`);
      else if (youtube) result.push(`<figure><iframe title="YouTube動画" src="${youtube}" width="100%" height="420" style="border:0;border-radius:12px;max-width:100%;" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe><figcaption><a href="${href}" rel="noopener noreferrer">YouTubeで開く</a></figcaption></figure>`);
      else if (appleMusic) result.push(`<figure><iframe title="Apple Musicプレイヤー" src="${appleMusic.url}" width="100%" height="${appleMusic.height}" style="border:0;border-radius:12px;max-width:100%;" loading="lazy" allow="autoplay *; encrypted-media *; fullscreen *" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"></iframe><figcaption><a href="${href}" rel="noopener noreferrer">Apple Musicで開く</a></figcaption></figure>`);
      else result.push(href ? `<p><a href="${href}" rel="noopener noreferrer">${label}</a></p>` : '');
    } else if (type === 'child_page') result.push(`<p><a href="${escaped(notionUrl)}">${escaped(data.title || '子ページをNotionで読む')}</a></p>`);
    else result.push(`<p><a href="${escaped(notionUrl)}">このコンテンツはNotionで読む</a></p>`);
  }
  closeList();
  return result.join('\n');
}

// ビルドに失敗した場合、古い記事が残ったまま公開されないようにする。
await rm(generatedDir, { recursive: true, force: true });
await rm(mediaDir, { recursive: true, force: true });
await mkdir(generatedDir, { recursive: true });
await mkdir(mediaDir, { recursive: true });

const database = await notion(`/databases/${databaseId}`);
const sources = database.data_sources || [];
if (sources.length !== 1) throw new Error('公開DBのデータソースを1つにしてください。');
const pages = await paginate(`/data_sources/${sources[0].id}/query`, true);
if (pages.length === 0) throw new Error('公開DBに記事がありません。DBのIDと共有設定を確認してください。');
const posts = [];
for (const page of pages) {
  if (page.object !== 'page' || page.archived || page.in_trash) continue;
  const properties = Object.values(page.properties);
  const title = plainText(properties.find((property) => property.type === 'title')?.title);
  const date = page.properties['公開日']?.date?.start;
  if (!title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`記事 ${page.id} にタイトルまたは日付形式の公開日がありません。`);
  }
  const tags = page.properties['タグ']?.multi_select?.map((tag) => tag.name) ?? [];
  const blocks = await paginate(`/blocks/${page.id}/children`);
  const excerpt = blocks.filter((block) => block.type === 'paragraph').map((block) => plainText(block.paragraph.rich_text)).find(Boolean)?.slice(0, 150) || `${title}の記事です。`;
  posts.push({
    id: page.id.replaceAll('-', ''), title, date, tags, excerpt,
    html: await renderBlocks(blocks, page.url),
    lastModified: page.last_edited_time,
  });
}
posts.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
if (posts.length === 0) throw new Error('公開できる記事がありません。公開DBの記事と公開日を確認してください。');
await writeFile(path.join(generatedDir, 'posts.json'), JSON.stringify(posts, null, 2));
console.log(`${posts.length} 件の記事を生成しました。`);
