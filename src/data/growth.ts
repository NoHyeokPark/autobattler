// 성장 선택지 적용. 엔진(전투 능력치)과 화면(카드)이 같은 계산을 쓴다.
//  - 몬스터: Lv2가 될 때 (전용 성장 + 공용 성장) 중에서 하나를 고른다.
//    Lv3은 새로 고르지 않고 합성에 쓴 Lv2 3장의 성장을 모두 가진다 (반복 불가 성장은 하나만).
//  - 리더: 레벨업 일차마다 리더 성장 목록에서 하나를 고른다.

import { BALANCE } from '../config/balance.ts';
import { mulDiv } from '../core/num.ts';
import type { Rng } from '../core/rng.ts';
import type { UnitStats } from '../battle/types.ts';
import { MONSTER_MAP } from './monsters.ts';
import { hasteFromIntervalPct, hasteInterval, inLevelRange } from './types.ts';
import type { GrowthDef, StatMods, Tag, Trigger, UnitDef } from './types.ts';

// 모든 몬스터가 공유하는 성장 선택지
export const UNIT_GROWTH: GrowthDef[] = [
  { id: 'u_might', name: '근력 강화', desc: '공격력 +25%', repeatable: true, stats: { atkPct: 25 } },
  { id: 'u_tough', name: '강인함', desc: '체력 +35%', repeatable: true, stats: { hpPct: 35 } },
  { id: 'u_arcane', name: '마력 증폭', desc: '주문력 +40%', repeatable: true, stats: { powerPct: 40 } },
  { id: 'u_swift', name: '날렵함', desc: '가속 +14', repeatable: true, stats: { haste: 14 } },
  { id: 'u_double', name: '연속 행동', desc: '추가발동 +1, 대신 가속 -29', repeatable: false, stats: { extra: 1, haste: -29 } },
  {
    id: 'u_growing', name: '자라나는 힘', desc: '새 능력: 전투 시작 시 자신 공격력 영구 +1', repeatable: false,
    triggers: [{ on: 'battleStart', effects: [{ type: 'permanent', target: { side: 'ally', area: 'near', dirs: ['c'] }, stat: 'atk', amount: 1 }] }],
  },
];

// 성장 찾기: 이 몬스터 전용 성장·전직 → 공용 → 다른 몬스터의 전용 순.
// 마지막 단계는 변이(혼돈의 주사위)로 다른 몬스터가 된 유닛이 원래 몬스터의 전용 성장을 그대로 유지하기 위한 것이다.
export function findUnitGrowth(defId: string, growthId: string): GrowthDef | undefined {
  const def = MONSTER_MAP[defId];
  return def?.growth?.find((g) => g.id === growthId)
    ?? def?.promotions?.find((g) => g.id === growthId)
    ?? UNIT_GROWTH.find((g) => g.id === growthId)
    ?? Object.values(MONSTER_MAP).find((m) => m.growth?.some((g) => g.id === growthId))?.growth?.find((g) => g.id === growthId);
}

// 몬스터 전직: 이 유닛이 가진 그 몬스터의 전직 (없으면 undefined)
export function monsterPromotion(defId: string, growthIds: string[] = []): GrowthDef | undefined {
  const list = MONSTER_MAP[defId]?.promotions ?? [];
  for (let i = growthIds.length - 1; i >= 0; i--) {
    const g = list.find((p) => p.id === growthIds[i]);
    if (g) return g;
  }
  return undefined;
}
// 화면·전투에 쓰는 이름 (전직했으면 전직 이름)
export const monsterName = (defId: string, growthIds: string[] = []) => monsterPromotion(defId, growthIds)?.name ?? MONSTER_MAP[defId]?.name ?? defId;

// 공격력·주문력이 있는 유닛인가 (기본값 + 이미 고른 성장의 고정값 증가)
function hasStat(def: UnitDef, taken: GrowthDef[], stat: 'atk' | 'power'): boolean {
  const base = stat === 'atk' ? def.atk : def.power ?? 0;
  return base + taken.reduce((n, g) => n + (g.stats?.[stat] ?? 0), 0) > 0;
}

// 이 유닛에게 의미 있는 공용 성장인가.
// 능력치만 바꾸는 성장인데 그 능력치가 전부 유닛에게 없는 것(공격력 0인 유닛의 공격력 성장, 주문력 0인 유닛의 주문력 성장)이면 제외한다.
// 새 능력·능력 제거·태그 변화가 있는 성장은 그대로 둔다.
export function growthFitsUnit(g: GrowthDef, def: UnitDef, taken: GrowthDef[] = []): boolean {
  if (g.triggers?.length || g.removeTriggers?.length || g.addTags?.length || g.removeTags?.length || g.deploy) return true;
  const keys = Object.entries(g.stats ?? {}).filter(([, v]) => v).map(([k]) => k);
  if (keys.length === 0) return true;
  return keys.some((k) => {
    if (k === 'atk' || k === 'atkPct') return hasStat(def, taken, 'atk');
    if (k === 'power' || k === 'powerPct') return hasStat(def, taken, 'power');
    return true;
  });
}

// 공용 성장의 등장 조건: 등급 구간, 태그(지금 태그 = 기본 태그 + 고른 성장의 태그 변화)
export function commonGrowthFor(g: GrowthDef, def: UnitDef & { grade?: number }, taken: GrowthDef[] = []): boolean {
  const grade = def.grade ?? 1;
  if (g.minGrade !== undefined && grade < g.minGrade) return false;
  if (g.maxGrade !== undefined && grade > g.maxGrade) return false;
  if (!g.forTags?.length) return true;
  const tags = new Set(def.tags);
  for (const t of taken) {
    for (const x of t.removeTags ?? []) tags.delete(x);
    for (const x of t.addTags ?? []) tags.add(x);
  }
  const hit = g.forTags.some((t) => tags.has(t));
  return g.tagMode === 'except' ? !hit : hit;
}

// 몬스터가 받을 수 있는 성장 전체 (전용이 같은 id의 공용보다 우선).
// 공용 성장은 이 몬스터에게 의미 있는 것만 (growthFitsUnit). 전용 성장은 기획자가 그 몬스터용으로 만든 것이라 거르지 않는다.
export function unitGrowthPool(defId: string, takenIds: string[] = []): GrowthDef[] {
  const def = MONSTER_MAP[defId];
  const own = def?.growth ?? [];
  const taken = takenIds.map((id) => findUnitGrowth(defId, id)).filter((g): g is GrowthDef => !!g);
  const common = UNIT_GROWTH.filter((g) => !own.some((o) => o.id === g.id) && (!def || (growthFitsUnit(g, def, taken) && commonGrowthFor(g, def, taken))));
  return [...own, ...common];
}

// 이번에 고를 수 있는 성장 후보. level: 성장을 고르는 레벨 (등장 레벨 구간 minLevel·maxLevel 확인용)
export function unitGrowthCandidates(defId: string, taken: string[], level = 2): GrowthDef[] {
  return unitGrowthPool(defId, taken).filter((g) => (g.repeatable || !taken.includes(g.id)) && inLevelRange(g, level));
}

export function rollUnitGrowth(defId: string, taken: string[], rng: Rng, level = 2): string[] {
  const pool = unitGrowthCandidates(defId, taken, level);
  rng.shuffle(pool);
  return pool.slice(0, BALANCE.unit.growthChoices).map((g) => g.id);
}

// 다시 뽑기: 지금 보이는 것과 다른 후보를 우선으로 n개 (모자라면 지금 것으로 채움). 다른 후보가 없으면 null
export function rerollPick(pool: string[], current: string[], n: number, rng: Rng): string[] | null {
  const fresh = pool.filter((id) => !current.includes(id));
  if (fresh.length === 0) return null;
  rng.shuffle(fresh);
  const rest = current.filter((id) => pool.includes(id));
  rng.shuffle(rest);
  return [...fresh, ...rest].slice(0, n);
}

// 이 레벨의 몬스터가 정상적으로 가질 수 있는 성장 개수 (Lv1 0, Lv2 1, Lv3 = Lv2 3장분 3)
export function maxGrowthCount(level: number): number {
  if (level <= 1) return 0;
  return BALANCE.unit.mergeCount * maxGrowthCount(level - 1) + (BALANCE.unit.growthChoiceLevels.includes(level) ? 1 : 0);
}

export interface ComputedUnit {
  hp: number;
  atk: number;
  power: number;
  haste: number; // 가속 합계
  extra: number;
  healShieldPct: number;
  tags: Tag[];
  triggers: Trigger[];
  changedAbilities: boolean; // 성장으로 능력이 추가·제거됐는지 (카드 설명을 자동 생성할지)
}

// 전투 밖 기본 능력치 (레벨·성장·영구 강화까지, 칸 효과 전). 카드·상세 보기·전투 요약이 같은 값을 쓴다
export function baseStats(def: UnitDef, c: ComputedUnit): UnitStats {
  return {
    hp: c.hp, atk: c.atk, power: c.power, extra: c.extra, healShieldPct: c.healShieldPct,
    interval: Math.max(BALANCE.engine.minIntervalTicks, hasteInterval(def.intervalTicks, c.haste)),
    haste: c.haste,
  };
}

// 높을수록 좋은지 (예전 형식의 행동 간격 %만 낮을수록 좋다. 가속은 높을수록 좋음)
const LOWER_IS_BETTER: (keyof StatMods)[] = ['intervalPct'];

// 영구 강화 병합: 합산하지 않고 계열(키)별로 가장 좋은 값 하나만 남긴다.
// 예) 가속 +10, +18, +5인 Lv1 3장을 합성 → +18 (+33이 되지 않는다)
// 없는 값은 0으로 본다. 그래서 불리한 값(공격력 -3 같은)은 강화가 없는 재료와 합치면 사라진다.
export function mergeBonus(list: (StatMods | undefined)[]): StatMods | undefined {
  const keys = new Set(list.flatMap((b) => Object.keys(b ?? {}))) as Set<keyof StatMods>;
  const out: StatMods = {};
  for (const k of keys) {
    const values = list.map((b) => b?.[k] ?? 0);
    const best = LOWER_IS_BETTER.includes(k) ? Math.min(...values) : Math.max(...values);
    if (best !== 0) out[k] = best;
  }
  return Object.keys(out).length ? out : undefined;
}

// 레벨 배율(levelPct %)을 적용한 기본 능력치에 성장과 영구 강화를 더한다. 고정값을 먼저 더하고 % 증감을 나중에 곱한다.
export function computeUnit(def: UnitDef, levelPct: number, growthList: GrowthDef[], bonus?: StatMods): ComputedUnit {
  // 영구 강화는 능력치만 바꾸는 성장처럼 계산한다
  const growths = bonus ? [...growthList, { id: '@bonus', name: '', desc: '', repeatable: false, stats: bonus }] : growthList;
  let hp = mulDiv(def.hp, levelPct, 100);
  let atk = mulDiv(def.atk, levelPct, 100);
  let power = mulDiv(def.power ?? 0, levelPct, 100);
  let haste = 0;
  let extra = def.extra ?? 0;
  let healShieldPct = 100;
  let atkPct = 0;
  let hpPct = 0;
  let powerPct = 0;
  const removed = new Set(growths.flatMap((g) => g.removeTriggers ?? []));
  const triggers = def.triggers.filter((_, i) => !removed.has(i));
  const tags = [...def.tags];
  let changedAbilities = removed.size > 0;
  for (const g of growths) {
    const s = g.stats ?? {};
    atk += s.atk ?? 0;
    hp += s.hp ?? 0;
    power += s.power ?? 0;
    extra += s.extra ?? 0;
    healShieldPct += s.healShieldPct ?? 0;
    atkPct += s.atkPct ?? 0;
    hpPct += s.hpPct ?? 0;
    powerPct += s.powerPct ?? 0;
    haste += s.haste ?? 0;
    if (s.intervalPct) haste += hasteFromIntervalPct(s.intervalPct); // 옛 저장 데이터
    if (g.triggers?.length) {
      triggers.push(...g.triggers);
      changedAbilities = true;
    }
    for (const t of g.removeTags ?? []) {
      const i = tags.indexOf(t);
      if (i >= 0) tags.splice(i, 1);
    }
    for (const t of g.addTags ?? []) if (!tags.includes(t)) tags.push(t);
  }
  return {
    hp: Math.max(1, mulDiv(hp, 100 + hpPct, 100)),
    atk: Math.max(0, mulDiv(atk, 100 + atkPct, 100)),
    power: Math.max(0, mulDiv(power, 100 + powerPct, 100)),
    haste,
    extra: Math.max(0, extra),
    healShieldPct,
    tags,
    triggers,
    changedAbilities,
  };
}
