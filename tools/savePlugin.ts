// 웹 버전의 저장을 브라우저가 아니라 프로젝트 폴더의 파일로 하는 Vite 플러그인 (개발 서버 전용).
//  GET  /__save            저장 API가 있는지 확인
//  GET  /__save/<이름>      파일 내용 (없으면 204)
//  POST /__save/<이름>      본문(JSON)을 파일에 저장. mod는 덮어쓰기 전에 mods/backup/에 백업한다
//  DELETE /__save/<이름>    파일 삭제 (진행 중인 런 포기, 기록 삭제 등). 런·기록은 지우기 전에 saves/backup/에 백업
//                         (POST에 X-Backup: 1 헤더가 있으면 덮어쓰기 전에도 백업 = 기록 정리)
// 파일 위치 (터미널 버전과 시뮬레이터도 같은 파일을 쓴다):
//  mod     → mods/editor.json      에디터에서 "적용"한 데이터·수치
//  run     → saves/web-run.json    웹에서 진행 중인 런
//  profile → saves/profile.json    리더별 기록
//  records → saves/records.json    PvP 기록 풀
//  tests   → saves/balance-tests.json  에디터 "밸런스 테스트" 탭의 테스트 파티·측정 기록
//
// 이름별 모드 라이브러리 (mods/library/<모드 이름>.json):
//  GET    /__mods           목록 [{ file, name, savedAt, monsters, leaders, trinkets }] + active(적용 중인 모드 이름)
//  GET    /__mods/<파일>    모드 내용
//  POST   /__mods/<파일>    저장 (기존 파일은 mods/backup/library/에 백업)
//  DELETE /__mods/<파일>    삭제 = mods/backup/library/로 옮김 (되살릴 수 있게 지우지 않는다)
// 적용 중인 모드(mods/editor.json)가 라이브러리에 없으면 목록을 볼 때 한 번 복사해 넣는다.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { isSafeModFile, MOD_LIBRARY_DIR, modFileName } from '../src/data/modFile.ts';

export const SAVE_FILES: Record<string, string> = {
  mod: 'mods/editor.json',
  run: 'saves/web-run.json',
  profile: 'saves/profile.json',
  records: 'saves/records.json',
  tests: 'saves/balance-tests.json',
};
const MAX_BODY = 50 * 1024 * 1024;
const MOD_BACKUPS = 20;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// 임시 파일에 쓰고 바꿔치기: 쓰다가 꺼져도 기존 파일이 깨지지 않는다
export function writeAtomic(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function backupMod(root: string, file: string) {
  if (!existsSync(file)) return;
  const dir = join(root, 'mods', 'backup');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(file, join(dir, `editor-${stamp}.json`));
  const old = readdirSync(dir).filter((f) => f.startsWith('editor-') && f.endsWith('.json')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - MOD_BACKUPS))) unlinkSync(join(dir, f));
}

const LIBRARY_BACKUPS = 10; // 모드 파일당
const SAVE_BACKUPS = 10; // 런·기록 이름당

// 런·리더 기록·PvP 기록을 지우거나 정리하기 전에 saves/backup/<이름>-<시각>.json으로 복사. 이름별 최근 SAVE_BACKUPS개만 남긴다
function backupSave(root: string, name: string, file: string) {
  if (!existsSync(file)) return;
  const dir = join(root, 'saves', 'backup');
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, join(dir, `${name}-${stamp()}.json`));
  const old = readdirSync(dir).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.json')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - SAVE_BACKUPS))) unlinkSync(join(dir, f));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// 라이브러리 파일을 백업 폴더로 복사(keep) 또는 이동. 파일별로 최근 LIBRARY_BACKUPS개만 남긴다
export function backupLibrary(root: string, file: string, how: 'copy' | 'move') {
  const src = join(root, MOD_LIBRARY_DIR, file);
  if (!existsSync(src)) return;
  const dir = join(root, 'mods', 'backup', 'library');
  mkdirSync(dir, { recursive: true });
  const base = file.slice(0, -'.json'.length);
  const dest = join(dir, `${base}@${how === 'move' ? 'deleted-' : ''}${stamp()}.json`);
  if (how === 'move') renameSync(src, dest);
  else copyFileSync(src, dest);
  const old = readdirSync(dir).filter((f) => f.startsWith(`${base}@`) && !f.includes('@deleted-')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - LIBRARY_BACKUPS))) unlinkSync(join(dir, f));
}

interface ModInfo {
  file: string;
  name: string;
  savedAt: number;
  monsters: number;
  leaders: number;
  trinkets: number;
}

export function listLibrary(root: string): { active: string | null; mods: ModInfo[] } {
  const dir = join(root, MOD_LIBRARY_DIR);
  const editor = join(root, SAVE_FILES.mod);
  let active: string | null = null;
  if (existsSync(editor)) {
    try {
      active = String(JSON.parse(readFileSync(editor, 'utf8')).name ?? '') || null;
    } catch {
      active = null;
    }
    // 처음 한 번: 적용 중인 모드를 라이브러리에 넣어 둔다 (같은 이름 파일이 없을 때만)
    if (active && !existsSync(join(dir, modFileName(active)))) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(editor, join(dir, modFileName(active)));
    }
  }
  const mods: ModInfo[] = [];
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const p = join(dir, file);
        const m = JSON.parse(readFileSync(p, 'utf8'));
        mods.push({
          file, name: String(m.name ?? file), savedAt: statSync(p).mtimeMs,
          monsters: m.monsters?.length ?? 0, leaders: m.leaders?.length ?? 0, trinkets: m.trinkets?.length ?? 0,
        });
      } catch {
        // 깨진 파일은 목록에서 뺀다 (지우지는 않음)
      }
    }
  }
  mods.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { active, mods };
}

function readBody(req: IncomingMessage, res: ServerResponse, done: (text: string) => void) {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size <= MAX_BODY) chunks.push(c);
  });
  req.on('end', () => {
    if (size > MAX_BODY) return send(res, 413, { error: '50MB 초과' });
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      JSON.parse(text);
    } catch {
      return send(res, 400, { error: 'JSON이 아닙니다' });
    }
    done(text);
  });
}

export function savePlugin(projectRoot: string): Plugin {
  return {
    name: 'autobattler-save',
    configureServer(server) {
      // 저장 파일이 바뀌어도 페이지를 새로고침하지 않는다 (편집 중인 화면 유지)
      server.watcher.unwatch([join(projectRoot, 'saves'), join(projectRoot, 'mods')]);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/__mods' || url.pathname.startsWith('/__mods/')) {
          try {
            if (url.pathname === '/__mods' || url.pathname === '/__mods/') return send(res, 200, listLibrary(projectRoot));
            const file = decodeURIComponent(url.pathname.slice('/__mods/'.length));
            if (!isSafeModFile(file)) return send(res, 400, { error: `잘못된 모드 파일 이름: ${file}` });
            const p = join(projectRoot, MOD_LIBRARY_DIR, file);
            if (req.method === 'GET') return existsSync(p) ? send(res, 200, readFileSync(p, 'utf8')) : send(res, 404, { error: '없는 모드' });
            if (req.method === 'DELETE') {
              backupLibrary(projectRoot, file, 'move');
              return send(res, 200, { ok: true });
            }
            if (req.method === 'POST') {
              return readBody(req, res, (text) => {
                try {
                  backupLibrary(projectRoot, file, 'copy');
                  writeAtomic(p, text);
                  send(res, 200, { ok: true, file });
                } catch (e) {
                  send(res, 500, { error: String(e) });
                }
              });
            }
            return send(res, 405, { error: 'method not allowed' });
          } catch (e) {
            return send(res, 500, { error: String(e) });
          }
        }
        if (!url.pathname.startsWith('/__save')) return next();
        if (url.pathname === '/__save' || url.pathname === '/__save/') return send(res, 200, { ok: true, files: SAVE_FILES });
        const name = url.pathname.slice('/__save/'.length);
        const rel = SAVE_FILES[name];
        if (!rel) return send(res, 404, { error: `알 수 없는 저장 이름: ${name}` });
        const file = join(projectRoot, rel);
        if (req.method === 'GET') {
          if (!existsSync(file)) return send(res, 204);
          return send(res, 200, readFileSync(file, 'utf8'));
        }
        if (req.method === 'DELETE') {
          if (name !== 'mod') backupSave(projectRoot, name, file);
          if (existsSync(file)) unlinkSync(file);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'POST') {
          return readBody(req, res, (text) => {
            try {
              if (name === 'mod') backupMod(projectRoot, file);
              else if (req.headers['x-backup'] === '1') backupSave(projectRoot, name, file);
              writeAtomic(file, text);
              send(res, 200, { ok: true, file: rel, bytes: text.length });
            } catch (e) {
              send(res, 500, { error: String(e) });
            }
          });
        }
        send(res, 405, { error: 'method not allowed' });
      });
    },
  };
}
