import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({
  root: resolve('demo'),
  base: './',
  publicDir: resolve('public'),
  plugins: [react()],
  resolve: {alias: {'@': resolve('.')}},
  build: {outDir: resolve('demo-dist'), emptyOutDir: true},
});
