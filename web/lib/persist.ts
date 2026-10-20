// 웹 버전 저장. 개발 서버(npm run web)로 실행하면 프로젝트 폴더의 파일에 저장한다:
//   mods/editor.json (에디터 적용분) · saves/web-run.json · saves/profile.json · saves/records.json
// 파일이라 브라우저 데이터가 지워져도 남고, 터미널 버전·시뮬레이터와 같은 파일을 쓴다.
// 개발 서버가 없는 정적 빌드에서만 브라우저 저장소(localStorage)를 쓴다.
//
// 시작할 때 initStorage()가 모든 파일을 한 번 읽어 두고, 이후 읽기는 메모리에서, 쓰기는 잠시 모아서 파일로 보낸다.

import { BALANCE } from '../../src/config/balance.ts';
import { MOD_LIBRARY_DIR, modFileName } from '../../src/data/modFile.ts';
import { parseMod } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { snapshotValid } from '../../src/data/validate.ts';
import type { RecordSnapshot, RecordStore } from '../../src/game/matching.ts';
import type { Profile } from '../../src/game/profile.ts';
import type { RunState } from '../../src/game/state.ts';
import type { BalanceTestFile } from '../../src/sim/partyTest.ts';

type SaveKey = 'mod' | 'run' | 'records' | 'profile' | 'tests';
const KEYS: SaveKey[] = ['mod', 'run', 'records', 'profile', 'tests'];
const LOCAL: Record<SaveKey, string> = { mod: 'ab.mod', run: 'ab.run', records: 'ab.records', profile: 'ab.profile', tests: 'ab.tests' };
export const SAVE_PATHS: Record<SaveKey, string> = {
  mod: 'mods/editor.json', run: 'saves/web-run.json', records: 'saves/records.json', profile: 'saves/profile.json', tests: 'saves/balance-tests.json',
};

let mode: 'project' | 'browser' = 'browser';
const cache: Partial<Record<SaveKey, unknown>> = {};
const pending: Partial<Record<SaveKey, string | null>> = {}; // null = 삭제
const backupNext = new Set<SaveKey>(); // 다음 쓰기 전에 서버가 기존 파일을 백업 (기록 정리)
const timers: Partial<Record<SaveKey, ReturnType<typeof setTimeout>>> = {};
const errorListeners = new Set<(msg: string) => void>();

export const storageMode = () => mode;
export function onStorageError(cb: (msg: string) => void): () => void {
  errorListeners.add(cb);
  return () => {
    errorListeners.delete(cb);
  };
}
const reportError = (msg: string) => {
  console.error(msg);
  for (const cb of errorListeners) cb(msg);
};

function readLocal(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

export async function initStorage(): Promise<'project' | 'browser'> {
  try {
    const ping = await fetch('/__save', { cache: 'no-store' });
    if (ping.ok) mode = 'project';
  } catch {
    mode = 'browser';
  }
  if (mode === 'browser') {
    for (const k of KEYS) cache[k] = readLocal(LOCAL[k]);
    return mode;
  }
  await Promise.all(KEYS.map(async (k) => {
    const res = await fetch(`/__save/${k}`, { cache: 'no-store' });
    if (res.status === 200) cache[k] = await res.json();
  }));
  // 처음 한 번: 브라우저 저장소에 남아 있던 것을 프로젝트 폴더로 옮긴다 (파일이 없을 때만)
  for (const k of KEYS) {
    if (cache[k] !== undefined) continue;
    const old = readLocal(LOCAL[k]);
    if (old !== undefined) {
      cache[k] = old;
      queue(k, JSON.stringify(old));
    }
  }
  return mode;
}

async function flush(k: SaveKey) {
  const body = pending[k];
  delete pending[k];
  if (body === undefined) return;
  try {
    const res = body === null
      ? await fetch(`/__save/${k}`, { method: 'DELETE' })
      : await fetch(`/__save/${k}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...(backupNext.delete(k) ? { 'X-Backup': '1' } : {}) } });
    if (!res.ok) reportError(`${SAVE_PATHS[k]} 저장 실패 (${res.status})`);
  } catch (e) {
    reportError(`${SAVE_PATHS[k]} 저장 실패: 개발 서버가 꺼져 있나요? (${String(e)})`);
  }
}

function queue(k: SaveKey, body: string | null) {
  pending[k] = body;
  clearTimeout(timers[k]);
  timers[k] = setTimeout(() => void flush(k), 150);
}

// 상태 객체는 게임 로직이 제자리에서 바꾸므로 저장하는 순간의 내용을 문자열로 떠 둔다
function save(k: SaveKey, value: unknown): boolean {
  cache[k] = value;
  if (mode === 'project') {
    queue(k, JSON.stringify(value));
    return true;
  }
  try {
    localStorage.setItem(LOCAL[k], JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(k: SaveKey) {
  delete cache[k];
  if (mode === 'project') queue(k, null);
  else {
    try {
      localStorage.removeItem(LOCAL[k]);
    } catch {
      // 저장소를 쓸 수 없는 환경
    }
  }
}

// 창을 닫을 때 아직 안 보낸 작은 저장(런 등)은 바로 보낸다
addEventListener('pagehide', () => {
  for (const k of KEYS) {
    const body = pending[k];
    if (typeof body === 'string' && body.length < 60_000) navigator.sendBeacon(`/__save/${k}`, new Blob([body], { type: 'application/json' }));
  }
});

// ── 런 ──
// 규칙 버전이 다른 저장은 이어서 할 수 없다 (데이터 구조가 바뀜)
export function loadRun(): RunState | null {
  const s = cache.run as RunState | undefined;
  return s && s.ruleVersion === BALANCE.ruleVersion ? structuredClone(s) : null;
}
export const saveRun = (s: RunState) => save('run', s);
export const clearRun = () => remove('run');

// ── PvP 기록 풀 ──
// 현재 데이터로 재현할 수 없는 기록(다른 규칙 버전, 삭제된 유닛)은 매칭에서 빼되, 파일에서는 지우지 않는다
let hiddenRecords: RecordSnapshot[] = [];
const MAX_RECORDS = 10000;

export function loadRecords(): RecordStore {
  const all = ((cache.records as RecordStore | undefined)?.records ?? []).slice();
  const usable = all.filter((r) => r.ruleVersion === BALANCE.ruleVersion && snapshotValid(r.team));
  hiddenRecords = all.filter((r) => !usable.includes(r));
  return { records: structuredClone(usable) };
}

export function saveRecords(store: RecordStore) {
  if (store.records.length > MAX_RECORDS) store.records.splice(0, store.records.length - MAX_RECORDS);
  save('records', { records: [...hiddenRecords, ...store.records] });
}

export const clearRecords = () => remove('records');

// ── 플레이 데이터 정리 (에디터) ──
// 게임 화면은 기록·리더 기록·런을 메모리에 들고 있으므로, 지운 뒤에는 알려서 다시 읽게 한다 (안 그러면 다음 저장이 되살린다)
const savesListeners = new Set<() => void>();
export function onSavesChanged(cb: () => void): () => void {
  savesListeners.add(cb);
  return () => {
    savesListeners.delete(cb);
  };
}
const savesChanged = () => {
  for (const cb of savesListeners) cb();
};

export type RecordGroup = 'old' | 'broken' | 'usable' | 'legacy' | `mod:${string}`;
export interface RecordStats {
  total: number;
  old: number; // 다른 규칙 버전 (예전 버전에서 만든 기록) - 매칭에 쓰이지 않는다
  broken: number; // 이 모드 기록인데 지금 데이터로 재현할 수 없음 (삭제된 유닛·장신구 등) - 매칭에 쓰이지 않는다
  usable: number; // 이 모드에서 매칭에 쓰이는 기록
  legacy: number; // 모드 표시가 없는 예전 기록 (모든 모드와 매칭)
  byMod: [string, number][]; // 다른 모드의 기록
}

// 기록 하나의 분류. 다른 모드 기록은 그 모드 데이터가 없으니 재현 가능 여부를 따지지 않는다
function recordGroup(r: RecordSnapshot, mod: string): RecordGroup {
  if (r.ruleVersion !== BALANCE.ruleVersion) return 'old';
  if (r.mod && r.mod !== mod) return `mod:${r.mod}`;
  if (!snapshotValid(r.team)) return 'broken';
  return r.mod ? 'usable' : 'legacy';
}

export function recordStats(mod: string): RecordStats {
  const all = (cache.records as RecordStore | undefined)?.records ?? [];
  const st: RecordStats = { total: all.length, old: 0, broken: 0, usable: 0, legacy: 0, byMod: [] };
  const mods = new Map<string, number>();
  for (const r of all) {
    const g = recordGroup(r, mod);
    if (g.startsWith('mod:')) mods.set(g.slice(4), (mods.get(g.slice(4)) ?? 0) + 1);
    else st[g as 'old']++;
  }
  st.byMod = [...mods].sort((a, b) => b[1] - a[1]);
  return st;
}

// 고른 분류의 기록만 지운다 ('all' = 전부). 서버가 덮어쓰기 전에 백업한다. 지운 개수를 돌려준다
export function deleteRecords(mod: string, groups: RecordGroup[] | 'all'): number {
  const all = (cache.records as RecordStore | undefined)?.records ?? [];
  const keep = groups === 'all' ? [] : all.filter((r) => !groups.includes(recordGroup(r, mod)));
  const removed = all.length - keep.length;
  if (removed > 0) {
    backupNext.add('records');
    save('records', { records: keep });
    savesChanged();
  }
  return removed;
}

export const hasSave = (k: 'run' | 'profile') => cache[k] !== undefined;
export function deleteProfile() {
  remove('profile');
  savesChanged();
}
export function deleteRun() {
  remove('run');
  savesChanged();
}

// ── 밸런스 테스트 파티 (에디터) ──
export function loadBalanceTests(): BalanceTestFile {
  const v = cache.tests as BalanceTestFile | undefined;
  return v?.version === 1 && v.mods ? structuredClone(v) : { version: 1, mods: {} };
}
export const saveBalanceTests = (v: BalanceTestFile) => save('tests', v);

// ── 리더 기록 ──
export const loadProfile = (): Profile => structuredClone((cache.profile as Profile | undefined) ?? { leaders: {} });
export const saveProfile = (p: Profile) => save('profile', p);

// ── 에디터 모드 ──
export function loadSavedMod(): ModData | null {
  try {
    return cache.mod ? parseMod(JSON.stringify(cache.mod)) : null;
  } catch {
    return null;
  }
}
export const saveMod = (mod: ModData) => save('mod', mod);
export const clearSavedMod = () => remove('mod');

// ── 화면 설정 (배속·탭): 보는 사람마다 다른 편의 설정이라 브라우저에 둔다 ──
const PREF_KEYS = { speed: 'ab.speed', tab: 'ab.tab' };
export function loadPref(key: 'speed' | 'tab', fallback: string): string {
  const v = readLocal(PREF_KEYS[key]);
  return typeof v === 'string' ? v : fallback;
}
export function savePref(key: 'speed' | 'tab', v: string) {
  try {
    localStorage.setItem(PREF_KEYS[key], JSON.stringify(v));
  } catch {
    // 저장 못 해도 동작에는 문제없다
  }
}

// ── 이름별 모드 라이브러리 (mods/library/<모드 이름>.json, 개발 서버에서만) ──
export interface LibraryMod {
  file: string;
  name: string;
  savedAt: number;
  monsters: number;
  leaders: number;
  trinkets: number;
}

export async function listLibrary(): Promise<{ active: string | null; mods: LibraryMod[] }> {
  if (mode !== 'project') return { active: null, mods: [] };
  const res = await fetch('/__mods', { cache: 'no-store' });
  if (!res.ok) throw new Error(`모드 목록을 읽지 못했습니다 (${res.status})`);
  return res.json();
}

export async function readLibraryMod(file: string): Promise<ModData> {
  const res = await fetch(`/__mods/${encodeURIComponent(file)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${MOD_LIBRARY_DIR}/${file}을(를) 읽지 못했습니다 (${res.status})`);
  return parseMod(await res.text());
}

export async function writeLibraryMod(mod: ModData): Promise<string> {
  const file = modFileName(mod.name);
  const res = await fetch(`/__mods/${encodeURIComponent(file)}`, {
    method: 'POST', body: JSON.stringify(mod), headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${MOD_LIBRARY_DIR}/${file} 저장 실패 (${res.status})`);
  return file;
}

// 지우지 않고 mods/backup/library/로 옮긴다
export async function deleteLibraryMod(file: string): Promise<void> {
  const res = await fetch(`/__mods/${encodeURIComponent(file)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${MOD_LIBRARY_DIR}/${file} 삭제 실패 (${res.status})`);
}
