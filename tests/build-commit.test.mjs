import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

it('schreibt die Commit-ID des Checkouts in beide HTML-Einstiege', async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const server = await createServer({ server: { middlewareMode: true, hmr: false } });
  try {
    for (const file of ['index.html', 'mobile.html']) {
      const html = await server.transformIndexHtml(`/${file}`, readFileSync(file, 'utf8'));
      expect(html).toContain(`id="build-commit" title="${head}">Build: ${head.slice(0, 12)}</`);
    }
  } finally {
    await server.close();
  }
});
