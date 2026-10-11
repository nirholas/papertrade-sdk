import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM build scripts without type declarations
import { parseFrontMatter, readPages, slugify, toolsMarkdown } from '../scripts/build-docs.mjs';
// @ts-expect-error plain ESM build scripts without type declarations
import { ROBOTS, buildCards, buildOpenApi } from '../scripts/build-discovery.mjs';
// @ts-expect-error plain ESM build scripts without type declarations
import { loadCatalog } from '../scripts/lib/site.mjs';

const ROOT = resolve(__dirname, '..');
const BANNED_DASH = /[–—]/;

describe('docs build helpers', () => {
  it('parses front matter and body', () => {
    const { meta, body } = parseFrontMatter('---\ntitle: Hello\norder: 3\n---\n# Hi\n');
    expect(meta).toEqual({ title: 'Hello', order: '3' });
    expect(body).toBe('# Hi\n');
  });

  it('slugifies headings the way the anchors expect', () => {
    expect(slugify('Trade with a session key')).toBe('trade-with-a-session-key');
    expect(slugify('Bust (liquidation) price')).toBe('bust-liquidation-price');
  });

  it('has every required page with a title, description and unique order', () => {
    const pages = readPages();
    const slugs = pages.map((p: { slug: string }) => p.slug);
    for (const need of ['index', 'quickstart', 'concepts', 'reference', 'mcp', 'connect', 'discovery', 'self-hosting', 'security', 'faq', 'changelog']) {
      expect(slugs).toContain(need);
    }
    for (const p of pages) expect(p.description.length).toBeGreaterThan(10);
    expect(new Set(pages.map((p: { order: number }) => p.order)).size).toBe(pages.length);
  });

  it('never uses en or em dashes in docs sources', () => {
    for (const f of readdirSync(resolve(ROOT, 'docs'))) {
      expect(BANNED_DASH.test(readFileSync(resolve(ROOT, 'docs', f), 'utf8')), f).toBe(false);
    }
  });
});

describe('generated catalog', () => {
  it('lists every tool in the docs table and discovery cards', async () => {
    const catalog = await loadCatalog();
    const md = toolsMarkdown(catalog.tools);
    const { serverCard, agentCard, catalog: api } = buildCards(catalog);
    for (const t of catalog.tools) {
      expect(md).toContain(`### ${t.name}`);
      expect(serverCard.tools.map((x: { name: string }) => x.name)).toContain(t.name);
      expect(agentCard.skills.map((x: { id: string }) => x.id)).toContain(t.name);
      expect(t.annotations.readOnlyHint).toBe(true);
    }
    expect(serverCard.transport).toEqual({ type: 'streamable-http', endpoint: 'https://papertrade-sdk.pages.dev/mcp' });
    expect(api.linkset[0].anchor).toBe('https://papertrade-sdk.pages.dev/mcp');
  });

  it('produces an OpenAPI 3.1 document that documents /mcp', async () => {
    const spec = buildOpenApi(await loadCatalog());
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths['/mcp'])).toEqual(expect.arrayContaining(['post', 'get', 'delete', 'options']));
    expect(JSON.stringify(spec)).not.toMatch(BANNED_DASH);
  });

  it('robots.txt carries Content-Signal and allows the AI crawlers', () => {
    expect(ROBOTS).toContain('Content-Signal:');
    for (const bot of ['GPTBot', 'ClaudeBot', 'Claude-User', 'OAI-SearchBot', 'Google-Extended', 'PerplexityBot']) {
      expect(ROBOTS).toMatch(new RegExp(`User-agent: ${bot}\\nAllow: /`));
    }
  });
});
