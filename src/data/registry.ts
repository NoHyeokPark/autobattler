// 모드(데이터 묶음) 관리. 엔진·게임 코드는 BALANCE, MONSTERS, MONSTER_MAP 같은 객체를 직접 참조하므로,
// 모드를 적용할 때는 객체를 새로 만들지 않고 "제자리에서" 내용을 바꾼다.
// 그래서 다른 모듈이 import 시점에 잡아 둔 참조(예: const R = BALANCE.run)도 새 값을 본다.
// 예외: ticksPerSec은 모든 데이터가 tick 단위로 적혀 있어서 바꾸지 않는다.

import { BALANCE } from '../config/balance.ts';
import { SYNERGIES } from './synergies.ts';
import { activeModName, setActiveModName } from './activeMod.ts';
import type { Balance } from '../config/balance.ts';
import { clearSeedBotCache } from '../game/matching.ts';
import { UNIT_GROWTH } from './growth.ts';
import { EVENTS } from './events.ts';
import { EVENT_GROWTH, LEADER_MAP, LEADERS } from './leaders.ts';
import { MONSTER_MAP, MONSTERS } from './monsters.ts';
import { migrateFilter } from './targets.ts';
import { TRINKET_MAP, TRINKETS } from './trinkets.ts';
import { DEFAULT_TAGS, hasteFromIntervalPct } from './types.ts';
import type { EventDef, GrowthDef, LeaderDef, MonsterDef, Tag, TrinketDef, TagSynergy } from './types.ts';

export const MOD_FORMAT = 'autobattler-mod';

export interface ModData {
  format: typeof MOD_FORMAT;
  version: 3; // 3 = 등급 7단계 (고급 추가)
  name: string;
  tags: Tag[];
  balance: Balance;
  monsters: MonsterDef[];
  leaders: LeaderDef[];
  trinkets: TrinketDef[];
  unitGrowth: GrowthDef[]; // 모든 몬스터가 공유하는 성장 선택지
  eventGrowth?: GrowthDef[]; // 리더 이벤트 성장 (지도의 이벤트 노드에서 얻음, 모든 리더 공용). 없으면 기본 목록
  synergies?: TagSynergy[]; // 태그 시너지 (보드 태그 수에 따른 보조 효과)
  events?: EventDef[]; // 이벤트 (지도의 ? 노드). 없으면 기본 목록
  // "새 기본 항목 가져오기"에서 숨긴 기본 항목 ("종류:부모:id"). 일부러 뺀 기본 항목이 계속 보이지 않게
  ignoredDefaults?: string[];
}

let ignored: string[] = [];

export const TAGS: Tag[] = [...DEFAULT_TAGS];

const clone = <T>(v: T): T => structuredClone(v);

export function snapshotMod(name = activeModName()): ModData {
  return clone({
    format: MOD_FORMAT,
    version: 3,
    name,
    tags: TAGS,
    balance: BALANCE,
    monsters: MONSTERS,
    leaders: LEADERS,
    trinkets: TRINKETS,
    unitGrowth: UNIT_GROWTH,
    eventGrowth: EVENT_GROWTH,
    synergies: SYNERGIES,
    events: EVENTS,
    ...(ignored.length ? { ignoredDefaults: ignored } : {}),
  });
}

// 이 모듈이 처음 로드될 때의 데이터 = 기본값
export const DEFAULT_MOD: ModData = snapshotMod('기본');

export { activeModName };

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
  replaceList(EVENT_GROWTH, null, mod.eventGrowth ?? DEFAULT_MOD.eventGrowth ?? []);
  SYNERGIES.splice(0, SYNERGIES.length, ...(mod.synergies ?? []));
  replaceList(EVENTS, null, mod.events ?? DEFAULT_MOD.events ?? []);
  ignored = [...(mod.ignoredDefaults ?? [])];
  TAGS.length = 0;
  TAGS.push(...(mod.tags?.length ? mod.tags : DEFAULT_TAGS));
  setActiveModName(mod.name || '이름 없는 모드');
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
  // 행동 간격 % → 가속 (한 번 적용했을 때 결과가 같은 값으로)
  const toHaste = (x: unknown) => (Array.isArray(x) ? x.map((n) => hasteFromIntervalPct(Number(n))) : hasteFromIntervalPct(Number(x)));
  if (out.type === 'intervalPct') {
    out.type = 'haste';
    out.amount = toHaste(out.pct);
    delete out.pct;
  }
  if (out.type === 'permanent' && out.stat === 'intervalPct') {
    out.stat = 'haste';
    out.amount = toHaste(out.amount);
  }
  if (!('type' in out) && typeof out.intervalPct === 'number') {
    out.haste = (Number(out.haste) || 0) + hasteFromIntervalPct(out.intervalPct);
    delete out.intervalPct;
  }
  if (typeof out.desc === 'string') {
    const sign = (n: number) => `${n > 0 ? '+' : ''}${n}`;
    out.desc = out.desc
      .replace(/행동 간격 ([+-]\d+)%/g, (_, p) => `가속 ${sign(hasteFromIntervalPct(Number(p)))}`)
      .replace(/행동 간격 -(\d+(?:\/\d+)+)%/g, (_, list: string) => `가속 +${list.split('/').map((p) => hasteFromIntervalPct(-Number(p))).join('/')}`);
  }
  return out;
}

// 등급 7단계 (version 3): 등급 숫자는 그대로 두고 이름이 한 칸씩 내려간다 (희귀 2 → 고급, 에픽 3 → 희귀, 전설 4 → 영웅,
// 신화 5 → 전설, 기원 6 → 신화). 새 기원(7)은 비어 있고 상점 확률 0. 숫자로 정한 것(확률표·가격·보상 등급)은 그대로라 밸런스가 같다.
const OLD_GRADE_WORDS: Record<string, string> = { 일반: '일반', 희귀: '고급', 에픽: '희귀', 전설: '영웅', 신화: '전설', 기원: '신화' };
// 설명 글 안의 등급 표기만 ("희귀 이하", "무작위 희귀 장신구" 등). "전설의 마법소녀" 같은 이름은 건드리지 않는다
const renameGradeWords = (text: string) =>
  text.replace(/(일반|희귀|에픽|전설|신화|기원)(?=( 이하| 이상| 장신구| 몬스터| 등급|\/))/g, (w) => OLD_GRADE_WORDS[w] ?? w);

function migrateGrades(data: Obj) {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    for (const [k, x] of Object.entries(v)) v[k] = k === 'desc' && typeof x === 'string' ? renameGradeWords(x) : walk(x);
    return v;
  };
  for (const k of ['monsters', 'leaders', 'trinkets', 'unitGrowth']) walk(data[k]);
  const b = isObj(data.balance) ? data.balance : {};
  const shop = isObj(b.shop) ? b.shop : {};
  if (Array.isArray(shop.odds)) for (const row of shop.odds) if (Array.isArray(row) && row.length === 6) row.push(0);
  const eco = isObj(b.economy) ? b.economy : {};
  const mc = eco.monsterCost;
  if (Array.isArray(mc) && mc.length === 6) mc.push(Math.round(Number(mc[5]) * 1.25));
  const tc = eco.trinketCost;
  if (Array.isArray(tc) && tc.length === 6) {
    if (!Number(tc[5])) tc[5] = Number(tc[4]) + 3; // 예전 기원(상점 미등장, 0G)이 신화가 되어 상점에도 나올 수 있다
    tc.push(0);
  }
}

export function parseMod(json: string): ModData {
  const raw = JSON.parse(json) as Obj;
  const src = raw;
  if (isObj(raw) && typeof raw.version === 'number' && raw.version < 3) migrateGrades(src);
  const data = migrate(src) as Partial<ModData>;
  if (data.format !== MOD_FORMAT) throw new Error('모드 파일 형식이 아닙니다 (format: autobattler-mod).');
  // 빠진 항목은 기본값으로 채운다 (부분 모드 허용). 수치는 섹션 단위로 채운다.
  const balance = clone(DEFAULT_MOD.balance) as unknown as Obj;
  const oldEvents = isObj(data.balance) && isObj((data.balance as unknown as Obj).events) ? ((data.balance as unknown as Obj).events as Obj) : null;
  for (const [k, v] of Object.entries((data.balance ?? {}) as Obj)) {
    if (k === 'run' && isObj(v)) delete v.eliteRewardRowShift; // 0.2에서 삭제된 수치
    if (k === 'events') continue; // 이벤트 비율·골드 수치는 이벤트 데이터(events)로 옮겼다
    if (k === 'leader' && isObj(v) && 'transformLevels' in v) {
      // 이름 변경: 변신 레벨 → 전직 레벨
      v.promotionLevels ??= v.transformLevels;
      delete v.transformLevels;
    }
    balance[k] = isObj(v) && isObj(balance[k]) ? { ...(balance[k] as Obj), ...v } : v;
    // 팀 상태는 상태마다 한 번 더 합친다 (새로 생긴 설정 칸이 예전 모드에도 기본값으로 들어가게)
    if (k === 'statuses' && isObj(v)) {
      const def = (DEFAULT_MOD.balance as unknown as Obj).statuses as Obj;
      const merged = balance[k] as Obj;
      for (const [id, cfg] of Object.entries(v)) if (isObj(cfg) && isObj(def[id])) merged[id] = { ...(def[id] as Obj), ...cfg };
    }
  }
  // 일반 성장 목록에 섞여 있던 변신·본질 강화는 전직 목록(promotions)으로 옮긴다
  for (const l of data.leaders ?? []) {
    const moved = (l.growth ?? []).filter((g) => g.transform || g.mastery);
    if (moved.length === 0) continue;
    l.growth = l.growth.filter((g) => !moved.includes(g));
    l.promotions = [...(l.promotions ?? []), ...moved.filter((g) => !l.promotions?.some((p) => p.id === g.id))];
  }
  return {
    ...clone(DEFAULT_MOD),
    ...data,
    version: 3,
    balance: balance as unknown as Balance,
    unitGrowth: data.unitGrowth ?? clone(DEFAULT_MOD.unitGrowth),
    eventGrowth: data.eventGrowth ?? clone(DEFAULT_MOD.eventGrowth ?? []),
    events: data.events ?? eventsFromOldBalance(oldEvents),
  } as ModData;
}

// 이벤트 데이터가 없던 모드: 기본 이벤트를 쓰되, 예전 수치(balance.events)의 비율·골드 액수를 옮긴다
function eventsFromOldBalance(old: Obj | null): EventDef[] {
  const list = clone(DEFAULT_MOD.events ?? []);
  if (!old) return list;
  const w = isObj(old.weights) ? old.weights : {};
  const byOld: Record<string, unknown> = { ev_treasure: w.gold, ev_stray: w.monster, ev_strange_power: w.growth };
  for (const ev of list) if (typeof byOld[ev.id] === 'number') ev.weight = byOld[ev.id] as number;
  const gold = list.find((e) => e.id === 'ev_treasure')?.choices[0]?.outcomes[0];
  if (gold?.type === 'gold') {
    if (typeof old.goldBase === 'number') gold.amount = old.goldBase;
    if (typeof old.goldPerDay === 'number') gold.perDay = old.goldPerDay;
  }
  return list;
}

// ── 새 기본 항목 가져오기 ──
// 모드는 저장 시점의 데이터 전체라서, 그 뒤 코드에 추가된 몬스터·장신구 등은 모드를 쓰는 동안 나오지 않는다.
// 기본 데이터에는 있는데 모드에 없는 항목(id 기준)을 찾아 골라서 넣는다. 모드에 있는 항목은 건드리지 않는다.
// 리더·몬스터 안의 성장도 따로 본다: 모드에 있는 기사에 새 변신 성장이 없으면 그 성장만 넣을 수 있다.
export type DefaultKind = 'monsters' | 'leaders' | 'trinkets' | 'unitGrowth' | 'eventGrowth' | 'leaderGrowth' | 'leaderPromotion' | 'monsterGrowth';
export const DEFAULT_KINDS: [DefaultKind, string][] = [
  ['monsters', '몬스터'], ['leaders', '리더'], ['trinkets', '장신구'], ['unitGrowth', '공용 성장'], ['eventGrowth', '리더 이벤트 성장'],
  ['leaderGrowth', '리더 성장 (기존 리더에 추가)'], ['leaderPromotion', '리더 전직 (기존 리더에 추가)'],
  ['monsterGrowth', '몬스터 전용 성장 (기존 몬스터에 추가)'],
];

export interface MissingDefault {
  kind: DefaultKind;
  id: string;
  name: string;
  parent?: string; // 리더·몬스터 성장: 그 성장이 들어갈 리더·몬스터 id
  parentName?: string;
}

type Named = { id: string; name: string; growth?: Named[]; promotions?: Named[] };
// 리더·몬스터 안의 목록: [부모 목록, 부모 안의 목록 키]
const NESTED: Partial<Record<DefaultKind, ['leaders' | 'monsters', 'growth' | 'promotions']>> = {
  leaderGrowth: ['leaders', 'growth'], leaderPromotion: ['leaders', 'promotions'], monsterGrowth: ['monsters', 'growth'],
};

// [기본 목록, 모드 목록]. 성장은 부모(리더·몬스터)가 양쪽에 다 있어야 한다. create면 모드 쪽 목록을 만든다.
function listPair(mod: ModData, kind: DefaultKind, parent?: string, create = false): [Named[], Named[]] | null {
  const nested = NESTED[kind];
  if (!nested) {
    if (create && !mod[kind as 'trinkets']) (mod as unknown as Record<string, unknown[]>)[kind] = [];
    return [(DEFAULT_MOD[kind as 'trinkets'] ?? []) as Named[], (mod[kind as 'trinkets'] ?? []) as Named[]];
  }
  const [top, key] = nested;
  const dp = (DEFAULT_MOD[top] as Named[]).find((x) => x.id === parent);
  const mp = ((mod[top] ?? []) as Named[]).find((x) => x.id === parent);
  if (!dp || !mp) return null;
  if (create) mp[key] ??= [];
  return [dp[key] ?? [], mp[key] ?? []];
}

// 숨김 목록의 키
export const defaultKey = (m: { kind: string; id: string; parent?: string }) => `${m.kind}:${m.parent ?? ''}:${m.id}`;

export function missingDefaults(mod: ModData): MissingDefault[] {
  const out: MissingDefault[] = [];
  for (const [kind] of DEFAULT_KINDS) {
    const nested = NESTED[kind];
    const parents = nested ? (DEFAULT_MOD[nested[0]] as Named[]) : [undefined];
    for (const p of parents) {
      const pair = listPair(mod, kind, p?.id);
      if (!pair) continue;
      const have = new Set(pair[1].map((x) => x.id));
      const hidden = new Set(mod.ignoredDefaults ?? []);
      for (const x of pair[0]) if (!have.has(x.id) && !hidden.has(defaultKey({ kind, id: x.id, parent: p?.id }))) out.push({ kind, id: x.id, name: x.name, ...(p ? { parent: p.id, parentName: p.name } : {}) });
    }
  }
  return out;
}

// 항목이 쓰는 태그 (몬스터 태그, 성장의 태그 추가, 대상 필터의 태그)
function tagsUsed(v: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) tagsUsed(x, acc);
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'tags' || k === 'addTags') && Array.isArray(x)) for (const t of x) if (typeof t === 'string') acc.add(t);
      if (k === 'tag' && typeof x === 'string' && x) acc.add(x);
      tagsUsed(x, acc);
    }
  }
  return acc;
}

// 고른 항목을 모드에 넣는다. 위치는 기본 데이터에서 바로 앞에 있던 항목 뒤(없으면 맨 앞).
// 항목이 쓰는 태그가 모드의 태그 목록에 없으면 함께 추가하고, 추가한 태그를 돌려준다.
export function importDefaults(mod: ModData, picks: { kind: DefaultKind; id: string; parent?: string }[]): string[] {
  const addedTags: string[] = [];
  for (const { kind, id, parent } of picks) {
    const pair = listPair(mod, kind, parent, true);
    if (!pair) continue;
    const [defs, list] = pair;
    const di = defs.findIndex((x) => x.id === id);
    if (di < 0 || list.some((x) => x.id === id)) continue;
    let at = 0;
    for (let j = di - 1; j >= 0; j--) {
      const k = list.findIndex((x) => x.id === defs[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    const item = clone(defs[di]);
    list.splice(at, 0, item);
    for (const t of tagsUsed(item)) {
      if (!mod.tags.includes(t)) {
        mod.tags.push(t);
        addedTags.push(t);
      }
    }
  }
  return addedTags;
}
