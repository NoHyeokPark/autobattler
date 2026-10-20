// 자동 저장: 단계마다 JSON으로 저장해 앱이 꺼져도 이어서 할 수 있게 한다.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOD_LIBRARY_DIR, modFileName } from '../data/modFile.ts';
import { applyMod, parseMod } from '../data/registry.ts';
import { validateMod } from '../data/validate.ts';
import type { RecordStore } from './matching.ts';
import type { Profile } from './profile.ts';
import type { RunState } from './state.ts';

export const SAVE_DIR = process.env.AB_SAVE_DIR ?? join(process.cwd(), 'saves');

function path(name: string) {
  return join(SAVE_DIR, name);
}

function readJson<T>(name: string): T | null {
  const p = path(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(name: string, data: unknown) {
  mkdirSync(SAVE_DIR, { recursive: true });
  const tmp = path(`${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path(name));
}

export const loadRun = () => readJson<RunState>('run.json');
export const saveRun = (s: RunState) => writeJson('run.json', s);
export const loadRecords = (): RecordStore => readJson<RecordStore>('records.json') ?? { records: [] };
export const saveRecords = (store: RecordStore) => writeJson('records.json', store);
export const loadProfile = (): Profile => readJson<Profile>('profile.json') ?? { leaders: {} };
export const saveProfile = (p: Profile) => writeJson('profile.json', p);

// 웹 에디터에서 "적용"하면 저장되는 모드 파일. 터미널 버전과 시뮬레이터는 이 파일이 있으면 자동으로 쓴다.
export const EDITOR_MOD_PATH = join(process.cwd(), 'mods', 'editor.json');

export const MOD_LIBRARY_PATH = join(process.cwd(), MOD_LIBRARY_DIR);

// 이름별 모드 목록 (mods/library/*.json의 모드 이름)
export function libraryModNames(): string[] {
  if (!existsSync(MOD_LIBRARY_PATH)) return [];
  return readdirSync(MOD_LIBRARY_PATH).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      return String(JSON.parse(readFileSync(join(MOD_LIBRARY_PATH, f), 'utf8')).name ?? f);
    } catch {
      return f;
    }
  });
}

// 쓸 모드 파일 경로: --mod 지정(파일 경로 또는 라이브러리의 모드 이름) > --no-mod면 없음 > mods/editor.json이 있으면 그것
export function resolveModPath(explicit: string | undefined, noMod: boolean): string | undefined {
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    const named = join(MOD_LIBRARY_PATH, modFileName(explicit));
    if (existsSync(named)) return named;
    // 라이브러리에 아직 없어도 적용 중인 모드(mods/editor.json)의 이름이면 그 파일
    if (existsSync(EDITOR_MOD_PATH)) {
      try {
        if (JSON.parse(readFileSync(EDITOR_MOD_PATH, 'utf8')).name === explicit) return EDITOR_MOD_PATH;
      } catch {
        // 깨진 파일은 무시
      }
    }
    const names = libraryModNames();
    throw new Error(`모드 "${explicit}"를 찾을 수 없습니다. 파일 경로나 모드 이름을 쓰세요.${names.length ? `
  이름별 모드: ${names.join(', ')}` : ''}`);
  }
  if (noMod) return undefined;
  return existsSync(EDITOR_MOD_PATH) ? EDITOR_MOD_PATH : undefined;
}

// 웹 에디터에서 내보낸 모드 JSON을 적용한다. 검증 오류가 있으면 예외.
export function loadModFile(file: string): string {
  const mod = parseMod(readFileSync(file, 'utf8'));
  const v = validateMod(mod);
  if (v.errors.length) throw new Error(`모드 오류:\n  ${v.errors.join('\n  ')}`);
  applyMod(mod);
  return `${mod.name}${v.warnings.length ? ` (경고 ${v.warnings.length}건)` : ''}`;
}
