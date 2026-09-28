import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('公開DBのページから安全な本文を生成し、ページ送りを処理する', async () => {
  const originalDirectory = process.cwd();
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notion-blog-'));
  process.chdir(directory);
  process.env.NOTION_API_KEY = 'test-token';
  process.env.NOTION_DATABASE_ID = 'fb1a924d564b83d4900481ba6c0245f6';
  const pageId = '12345678-1234-1234-1234-123456789abc';
  const responses = [
    { data_sources: [{ id: 'source' }] },
    { results: [{
      object: 'page', id: pageId, url: 'https://notion.site/article',
      properties: {
        名前: { type: 'title', title: [{ plain_text: '記事 <テスト>' }] },
        公開日: { date: { start: '2026-08-08' } },
        タグ: { multi_select: [{ name: '音楽' }] },
      },
      last_edited_time: '2026-09-28T00:00:00.000Z',
    }], has_more: false },
    { results: [{
      id: 'block-1', type: 'paragraph', has_children: false,
      paragraph: { rich_text: [{ plain_text: '<script>alert(1)</script>', href: 'javascript:alert(1)' }] },
    }], has_more: true, next_cursor: 'second' },
    { results: [{
      id: 'block-2', type: 'heading_2', has_children: false,
      heading_2: { rich_text: [{ plain_text: '続き' }] },
    }], has_more: false },
  ];
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => responses.shift() };
  };
  try {
    await import(`../scripts/sync-notion.mjs?test=${Date.now()}`);
    const posts = JSON.parse(await readFile('src/generated/posts.json', 'utf8'));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, pageId.replaceAll('-', ''));
    assert.equal(posts[0].date, '2026-08-08');
    assert.deepEqual(posts[0].tags, ['音楽']);
    assert.match(posts[0].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(posts[0].html, /href="javascript:/);
    assert.match(posts[0].html, /<h2>続き<\/h2>/);
    assert.match(requests.at(-1).url, /start_cursor=second/);
    assert.ok(requests.every((request) => request.options.headers.Authorization === 'Bearer test-token'));
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalDirectory);
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_DATABASE_ID;
    await rm(directory, { recursive: true, force: true });
  }
});
