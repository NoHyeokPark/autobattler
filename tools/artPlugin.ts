// 카드 일러스트 폴더(art/)를 웹에 제공하는 Vite 플러그인.
//  개발 서버:  GET  /art/manifest.json  폴더를 읽어 { 키: 파일경로?v=수정시각 } 목록을 돌려준다
//              GET  /art/<파일>          이미지 파일
//              POST /__art/upload?key=…  에디터 업로드 (본문 = webp 이미지). 같은 키의 다른 확장자 파일은 지운다
//              POST /__art/delete?key=…  삭제
//  빌드:      dist/art/ 로 복사하고 manifest.json 을 만든다
// 폴더가 Vite 루트(web/) 밖에 있어서 파일을 올려도 페이지가 새로고침되지 않는다 (에디터 초안 유지).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { ART_EXTS, ART_KEY_RE } from '../src/data/art.ts';

const MIME: Record<string, string> = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif',
};
const MAX_UPLOAD = 5 * 1024 * 1024;

export function buildManifest(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (ART_EXTS.includes(extname(name).toLowerCase())) {
        const rel = relative(dir, p).split(sep).join('/');
        files[rel.slice(0, -extname(rel).length)] = `${rel}?v=${Math.floor(st.mtimeMs)}`;
      }
    }
  };
  walk(dir);
  return files;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(JSON.stringify(body));
}

function removeKey(dir: string, key: string) {
  for (const ext of ART_EXTS) {
    const p = join(dir, key + ext);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function artPlugin(artDir: string): Plugin {
  let outDir = '';
  return {
    name: 'autobattler-art',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = decodeURIComponent(url.pathname);
        if (req.method === 'GET' && path === '/art/manifest.json') return json(res, 200, { files: buildManifest(artDir) });
        if (req.method === 'GET' && path.startsWith('/art/')) {
          const file = resolve(artDir, path.slice('/art/'.length));
          if (!file.startsWith(resolve(artDir) + sep) || !existsSync(file)) return json(res, 404, { error: 'not found' });
          const st = statSync(file);
          const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
          res.setHeader('ETag', etag);
          res.setHeader('Cache-Control', 'no-cache'); // 매번 확인하되, 바뀌지 않았으면 304 (주소의 ?v= 로 갱신을 강제)
          if (req.headers['if-none-match'] === etag) {
            res.statusCode = 304;
            return res.end();
          }
          res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
          return res.end(readFileSync(file));
        }
        if (req.method === 'POST' && (path === '/__art/upload' || path === '/__art/delete')) {
          const key = url.searchParams.get('key') ?? '';
          if (!ART_KEY_RE.test(key)) return json(res, 400, { error: `잘못된 이름: ${key}` });
          if (path === '/__art/delete') {
            removeKey(artDir, key);
            return json(res, 200, { ok: true });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          req.on('data', (c: Buffer) => {
            size += c.length;
            if (size <= MAX_UPLOAD) chunks.push(c);
          });
          req.on('end', () => {
            if (size > MAX_UPLOAD) return json(res, 413, { error: '5MB를 넘는 파일' });
            const file = join(artDir, `${key}.webp`);
            mkdirSync(join(file, '..'), { recursive: true });
            removeKey(artDir, key);
            writeFileSync(file, Buffer.concat(chunks));
            json(res, 200, { ok: true, file: `${key}.webp`, bytes: size });
          });
          return;
        }
        next();
      });
    },
    closeBundle() {
      if (!outDir || !existsSync(artDir)) return;
      const target = join(outDir, 'art');
      cpSync(artDir, target, { recursive: true });
      writeFileSync(join(target, 'manifest.json'), JSON.stringify({ files: buildManifest(artDir) }));
    },
  };
}
