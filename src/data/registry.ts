// 모드(데이터 묶음) 관리. 엔진·게임 코드는 BALANCE, MONSTERS, MONSTER_MAP 같은 객체를 직접 참조하므로,
// 모드를 적용할 때는 객체를 새로 만들지 않고 "제자리에서" 내용을 바꾼다.
// 그래서 다른 모듈이 import 시점에 잡아 둔 참조(예: const R = BALANCE.run)도 새 값을 본다.
// 예외: ticksPerSec은 모든 데이터가 tick 단위로 적혀 있어서 바꾸지 않는다.

import { BALANCE } from '../config/balance.ts';
import type { Balance } from '../config/balance.ts';
import { clearSeedBotCache } from '../game/matching.ts';
import { UNIT_GROWTH } from './growth.ts';
import { LEADER_MAP, LEADERS } from './leaders.ts';
import { MONSTER_MAP, MONSTERS } from './monsters.ts';
import { migrateFilter } from './targets.ts';
import { TRINKET_MAP, TRINKETS } from './trinkets.ts';
import { DEFAULT_TAGS } from './types.ts';
import type { GrowthDef, LeaderDef, MonsterDef, Tag, TrinketDef } from './types.ts';

export const MOD_FORMAT = 'autobattler-mod';

export interface ModData {
  format: typeof MOD_FORMAT;
  version: 2;
  name: string;
  tags: Tag[];
  balance: Balance;
  monsters: MonsterDef[];
  leaders: LeaderDef[];
  trinkets: TrinketDef[];
  unitGrowth: GrowthDef[]; // 모든 몬스터가 공유하는 성장 선택지
}

export const TAGS: Tag[] = [...DEFAULT_TAGS];
let activeName = '기본';

const clone = <T>(v: T): T => structuredClone(v);

export function snapshotMod(name = activeName): ModData {
  return clone({
    format: MOD_FORMAT,
    version: 2,
    name,
    tags: TAGS,
    balance: BALANCE,
    monsters: MONSTERS,
    leaders: LEADERS,
    trinkets: TRINKETS,
    unitGrowth: UNIT_GROWTH,
  });
}

// 이 모듈이 처음 로드될 때의 데이터 = 기본값
export const DEFAULT_MOD: ModData = snapshotMod('기본');

export function activeModName(): string {
  return activeName;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function assignInPlace(target: Obj, source: Obj) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const [k, v] of Object.entries(source)) {
    const cur = target[k];
    if (Array.isArray(v) && Array.isArray(cur)) {
      cur.length = 0;
      cur.push(...clone(v));
    } else if (isObj(v) && isObj(cur)) {
      assignInPlace(cur, v);
    } else {
      target[k] = clone(v);
    }
  }
}

function replaceList<T extends { id: string }>(list: T[], map: Record<string, T> | null, next: T[]) {
  list.length = 0;
  list.push(...clone(next));
  if (!map) return;
  for (const k of Object.keys(map)) delete map[k];
  for (const item of list) map[item.id] = item;
}

export function applyMod(mod: ModData) {
  const ticks = BALANCE.ticksPerSec;
  assignInPlace(BALANCE as unknown as Obj, mod.balance as unknown as Obj);
  BALANCE.ticksPerSec = ticks;
  replaceList(MONSTERS, MONSTER_MAP, mod.monsters);
  replaceList(LEADERS, LEADER_MAP, mod.leaders);
  replaceList(TRINKETS, TRINKET_MAP, mod.trinkets);
  replaceList(UNIT_GROWTH, null, mod.unitGrowth ?? []);
  TAGS.length = 0;
  TAGS.push(...(mod.tags?.length ? mod.tags : DEFAULT_TAGS));
  activeName = mod.name || '이름 없는 모드';
  clearSeedBotCache();
}

// 예전 형식 데이터 변환: 대상 { scope } → { side, area, dirs }, 팀 상태 { stacks } → { flat }
function migrate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(migrate);
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) out[k] = migrate(x);
  if (out.type === 'status' && 'stacks' in out) {
    out.flat = out.stacks;
    delete out.stacks;
  }
  if ('target' in out && isObj(out.target)) out.target = migrateFilter(out.target);
  return out;
}

export function parseMod(json: string): ModData {
  const data = migrate(JSON.parse(json)) as Partial<ModData>;
  if (data.format !== MOD_FORMAT) throw new Error('모드 파일 형식이 아닙니다 (format: autobattler-mod).');
  // 빠진 항목은 기본값으로 채운다 (부분 모드 허용). 수치는 섹션 단위로 채운다.
  const balance = clone(DEFAULT_MOD.balance) as unknown as Obj;
  for (const [k, v] of Object.entries((data.balance ?? {}) as Obj)) {
    if (k === 'run' && isObj(v)) delete v.eliteRewardRowShift; // 0.2에서 삭제된 수치
    balance[k] = isObj(v) && isObj(balance[k]) ? { ...(balance[k] as Obj), ...v } : v;
  }
  return {
    ...clone(DEFAULT_MOD),
    ...data,
    version: 2,
    balance: balance as unknown as Balance,
    unitGrowth: data.unitGrowth ?? clone(DEFAULT_MOD.unitGrowth),
  } as ModData;
}
