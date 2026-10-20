import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { artPlugin } from './tools/artPlugin.ts';
import { savePlugin } from './tools/savePlugin.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// 웹 프론트엔드: web/ 폴더. 게임 로직은 src/를 그대로 가져다 쓴다.
// 카드 일러스트는 art/ 폴더 (규칙은 src/data/art.ts), 저장은 mods/·saves/ 폴더 (tools/savePlugin.ts)
export default defineConfig({
  root: 'web',
  plugins: [react(), artPlugin(fileURLToPath(new URL('./art', import.meta.url))), savePlugin(root)],
  // 포트가 바뀌면 다른 사이트로 취급되어 브라우저 설정(배속 등)이 갈린다. 사용 중이면 다른 포트로 넘어가지 않고 알린다
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
});
