// 자동 저장: 단계마다 JSON으로 저장해 앱이 꺼져도 이어서 할 수 있게 한다.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

// 웹 에디터에서 내보낸 모드 JSON을 적용한다. 검증 오류가 있으면 예외.
export function loadModFile(file: string): string {
  const mod = parseMod(readFileSync(file, 'utf8'));
  const v = validateMod(mod);
  if (v.errors.length) throw new Error(`모드 오류:\n  ${v.errors.join('\n  ')}`);
  applyMod(mod);
  return `${mod.name}${v.warnings.length ? ` (경고 ${v.warnings.length}건)` : ''}`;
}
