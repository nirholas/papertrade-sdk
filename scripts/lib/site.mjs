import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE_URL = 'https://papertrade-sdk.pages.dev';
export const OS_URL = 'https://papertrade-os.pages.dev';
export const GITHUB = 'https://github.com/nirholas/papertrade-sdk';
export const PUBLIC = resolve(ROOT, 'site/public');

export const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

/** Bundle the real tool catalog so docs and discovery files are generated from what /mcp runs. */
export async function loadCatalog() {
  const out = await build({
    entryPoints: [resolve(ROOT, 'site/functions/_lib/tools.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const info = await build({
    entryPoints: [resolve(ROOT, 'site/functions/_lib/server-info.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    logLevel: 'silent',
  });
  const infoMod = await import(`data:text/javascript;base64,${Buffer.from(info.outputFiles[0].text).toString('base64')}`);
  const tools = mod.TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    annotations: t.annotations,
  }));
  return { tools, serverInfo: infoMod.SERVER_INFO };
}
