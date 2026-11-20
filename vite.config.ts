import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

function buildCommit(): Plugin {
  let commit = '';
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) commit = head;
  } catch {
    // Aus einem Quellarchiv ohne Git-Metadaten ist die Commit-ID nicht bekannt.
  }
  return {
    name: 'garage-build-commit',
    transformIndexHtml: () => [{
      tag: 'small',
      attrs: { id: 'build-commit', title: commit || 'Commit unbekannt' },
      children: `Build: ${commit ? commit.slice(0, 12) : 'unbekannt'}`,
      injectTo: 'body',
    }],
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [buildCommit(), (mode === 'singlefile' || mode === 'singlefile-mobile') && viteSingleFile()],
  build: {
    outDir: mode === 'singlefile' ? 'dist-single' : mode === 'singlefile-mobile' ? 'dist-single-mobile' : 'dist',
    target: 'es2022',
    rollupOptions: mode === 'singlefile-mobile' ? { input: 'mobile.html' } : {},
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,mjs}'],
  },
}));
