import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { artPlugin } from './tools/artPlugin.ts';

// 웹 프론트엔드: web/ 폴더. 게임 로직은 src/를 그대로 가져다 쓴다.
// 카드 일러스트는 프로젝트의 art/ 폴더 (규칙은 src/data/art.ts)
export default defineConfig({
  root: 'web',
  plugins: [react(), artPlugin(fileURLToPath(new URL('./art', import.meta.url)))],
  server: { port: 5173 },
  build: { outDir: '../dist', emptyOutDir: true },
});
