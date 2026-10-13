// 브라우저 자동 저장 (localStorage). 단계마다 저장해 새로고침해도 이어서 할 수 있다.

import { BALANCE } from '../../src/config/balance.ts';
import { parseMod } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { snapshotValid } from '../../src/data/validate.ts';
import type { RecordStore } from '../../src/game/matching.ts';
import type { Profile } from '../../src/game/profile.ts';
import type { RunState } from '../../src/game/state.ts';

const K = {
  run: 'ab.run',
  records: 'ab.records',
  profile: 'ab.profile',
  mod: 'ab.mod',
  speed: 'ab.speed',
  tab: 'ab.tab',
};
const MAX_RECORDS = 2500;

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 저장소를 쓸 수 없는 환경
  }
}

// 규칙 버전이 다른 저장은 이어서 할 수 없다 (데이터 구조가 바뀜)
export function loadRun(): RunState | null {
  const s = read<RunState>(K.run);
  return s && s.ruleVersion === BALANCE.ruleVersion ? s : null;
}
export const saveRun = (s: RunState) => write(K.run, s);
export const clearRun = () => remove(K.run);

// 현재 데이터로 재현할 수 없는 기록(삭제된 유닛 등)은 버린다.
export function loadRecords(): RecordStore {
  const store = read<RecordStore>(K.records) ?? { records: [] };
  store.records = store.records.filter((r) => r.ruleVersion === BALANCE.ruleVersion && snapshotValid(r.team));
  return store;
}

export function saveRecords(store: RecordStore) {
  if (store.records.length > MAX_RECORDS) store.records.splice(0, store.records.length - MAX_RECORDS);
  while (!write(K.records, store) && store.records.length > 100) {
    store.records.splice(0, Math.floor(store.records.length / 2)); // 용량 초과 시 오래된 기록부터 정리
  }
}

export const clearRecords = () => remove(K.records);

export const loadProfile = (): Profile => read<Profile>(K.profile) ?? { leaders: {} };
export const saveProfile = (p: Profile) => write(K.profile, p);

export function loadSavedMod(): ModData | null {
  try {
    const s = localStorage.getItem(K.mod);
    return s ? parseMod(s) : null;
  } catch {
    return null;
  }
}
export const saveMod = (mod: ModData) => write(K.mod, mod);
export const clearSavedMod = () => remove(K.mod);

export const loadPref = (key: 'speed' | 'tab', fallback: string) => read<string>(K[key]) ?? fallback;
export const savePref = (key: 'speed' | 'tab', v: string) => write(K[key], v);
