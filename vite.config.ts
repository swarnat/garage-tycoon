import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'singlefile' || mode === 'singlefile-mobile' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'singlefile' ? 'dist-single' : mode === 'singlefile-mobile' ? 'dist-single-mobile' : 'dist',
    target: 'es2022',
    rollupOptions: mode === 'singlefile-mobile' ? { input: 'mobile.html' } : {},
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
